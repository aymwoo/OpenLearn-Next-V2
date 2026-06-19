/**
 * BrowserWorkerManager — browser-side Web Worker lifecycle manager.
 *
 * D-07: Mirrors backend WorkerManager but uses Web Worker API.
 * Creates Web Workers from Blob URLs, tracks them in a registry,
 * and supports lifecycle (create/terminate) with activation timeout.
 *
 * ## Architecture
 *
 * ```
 * FrontendPluginHost.activatePlugin(mode='worker')
 *   -> BrowserWorkerManager.createWorker(pluginId, manifest, sourceCode, tokens)
 *     -> new Worker(blobUrl, { type: 'module' })
 *     -> BrowserWorkerTransport(worker)
 *     -> ServiceHost(registry, actorId, caps, socketService)
 *     -> workerRegistry.set(pluginId, { worker, transport, serviceHost })
 *     -> transport.onMessage -> serviceHost.handleMessage
 *     -> transport.postMessage({ type: 'activate', ... })
 *     -> wait for 'activated' response (10s timeout)
 *     -> return { transport, serviceHost }
 * ```
 *
 * ## Threat Model
 *
 * - T-09-09: MAX_WORKERS = 32, enforced at createWorker time
 * - T-09-10: terminateWorker calls serviceHost.dispose() before Worker termination
 *
 * @module
 */

import { BrowserWorkerTransport } from './browser-worker-transport';
import { ServiceHost } from './service-host';
import type { FrontendServiceRegistry } from './service-registry';
import type { FrontendPluginManifest, ISocketService } from './types';
import type { IWorkerTransport } from '../../packages/core/worker-runtime/types';

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum parallel Workers in browser (T-05-09: DoS mitigation). */
const MAX_WORKERS = 32;

/** Worker activation timeout in milliseconds. */
const ACTIVATE_TIMEOUT_MS = 10000;

/** Worker deactivation grace period in milliseconds. */
const DEACTIVATE_TIMEOUT_MS = 3000;

// ── WorkerInstance ───────────────────────────────────────────────────────────

/**
 * WorkerInstance — registered Worker runtime record for the browser.
 */
interface WorkerInstance {
  pluginId: string;
  worker: Worker;
  transport: IWorkerTransport;
  serviceHost: ServiceHost;
}

// ── BrowserWorkerManager ────────────────────────────────────────────────────

/**
 * BrowserWorkerManager — creates and manages Web Worker instances for plugins.
 */
export class BrowserWorkerManager {
  /** pluginId -> WorkerInstance */
  private workerRegistry = new Map<string, WorkerInstance>();

  /**
   * @param registry - FrontendServiceRegistry for ServiceHost RPC resolution
   */
  constructor(private readonly registry: FrontendServiceRegistry) {}

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Create a new Web Worker for the given plugin.
   *
   * Flow:
   * 1. Check pluginId is not already registered
   * 2. Check activeCount < MAX_WORKERS (T-09-09)
   * 3. Build Worker bootstrap Blob URL
   * 4. Create Worker with { type: 'module' }
   * 5. Create BrowserWorkerTransport
   * 6. Create ServiceHost for RPC handling
   * 7. Setup message routing from transport to ServiceHost
   * 8. Send activate message to Worker
   * 9. Wait for 'activated' response (10s timeout)
   * 10. Return { transport, serviceHost }
   *
   * @param pluginId - Plugin identifier
   * @param manifest - Plugin manifest (for capabilities and metadata)
   * @param sourceCode - Plugin ESM source code
   * @param serviceTokens - Token names for services to proxy to Worker
   * @param socketService - Optional ISocketService for event forwarding
   * @returns transport and serviceHost
   * @throws Error if duplicate, at capacity, activation fails/times out
   */
  async createWorker(
    pluginId: string,
    manifest: FrontendPluginManifest,
    sourceCode: string,
    serviceTokens: string[],
    socketService?: ISocketService,
  ): Promise<{ transport: IWorkerTransport; serviceHost: ServiceHost }> {
    // 1. Check duplicate
    if (this.workerRegistry.has(pluginId)) {
      throw new Error(`Worker already exists for plugin "${pluginId}"`);
    }

    // 2. T-09-09: DoS limit
    if (this.workerRegistry.size >= MAX_WORKERS) {
      throw new Error(
        `Cannot create Worker: maximum active Workers (${MAX_WORKERS}) reached`,
      );
    }

    // 3. Build Worker bootstrap Blob URL
    const blobUrl = this.buildWorkerBlobUrl();

    // 4. Create Worker
    let worker: Worker;
    try {
      worker = new Worker(blobUrl, { type: 'module' });
    } catch (err) {
      throw new Error(
        `Failed to create Worker for plugin "${pluginId}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // 5. Create Transport
    const transport = new BrowserWorkerTransport(worker);

    // 6. Create ServiceHost
    const actorId = `plugin:${manifest.id}`;
    const manifestCaps = manifest.capabilitiesProposed ?? [];
    const serviceHost = new ServiceHost(
      this.registry,
      actorId,
      manifestCaps,
      socketService,
    );

    // 7. Register and setup message routing
    this.workerRegistry.set(pluginId, { worker, transport, serviceHost });

    // Setup activation lifecycle handlers
    let activationResolve: (() => void) | null = null;
    let activationReject: ((err: Error) => void) | null = null;

    transport.onMessage((msg: unknown) => {
      const typed = msg as { type?: string };
      if (typed.type === 'activated') {
        if (activationResolve) {
          activationResolve();
          activationResolve = null;
          activationReject = null;
        }
      } else if (typed.type === 'error') {
        if (activationReject) {
          activationReject(
            new Error(
              (msg as { message?: string }).message ?? 'Unknown Worker error',
            ),
          );
          activationResolve = null;
          activationReject = null;
        }
      }

      // Always route to serviceHost for other RPC/event messages
      serviceHost.handleMessage(msg, transport);
    });

    // 8. Send activate message
    transport.postMessage({
      type: 'activate',
      pluginCode: sourceCode,
      manifest,
      serviceTokens,
    });

    // 9. Wait for 'activated' response (10s timeout)
    try {
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          activationResolve = resolve;
          activationReject = reject;
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Worker activation timed out after ${ACTIVATE_TIMEOUT_MS}ms`)),
            ACTIVATE_TIMEOUT_MS,
          ),
        ),
      ]);
    } catch (err) {
      // Activation failed — clean up
      serviceHost.dispose();
      try { worker.terminate(); } catch { /* ignore */ }
      this.workerRegistry.delete(pluginId);
      throw err;
    }

    return { transport, serviceHost };
  }

  /**
   * Terminate a Worker for the given plugin.
   *
   * Flow:
   * 1. Get instance from registry
   * 2. serviceHost.dispose() — clean up event subscriptions
   * 3. Send deactivate-request to Worker
   * 4. Wait 3s for 'deactivated' response
   * 5. Finally: worker.terminate(), remove from registry
   *
   * T-09-10: serviceHost.dispose() called before Worker termination
   *
   * @param pluginId - Plugin identifier
   */
  async terminateWorker(pluginId: string): Promise<void> {
    const instance = this.workerRegistry.get(pluginId);
    if (!instance) return;

    // T-09-10: Dispose ServiceHost subscriptions before termination
    instance.serviceHost.dispose();

    // Send deactivate request
    try {
      instance.transport.postMessage({ type: 'deactivate-request' });

      await Promise.race([
        new Promise<void>((resolve, reject) => {
          instance.transport.onMessage((msg: unknown) => {
            const typed = msg as { type?: string };
            if (typed.type === 'deactivated') {
              resolve();
            } else if (typed.type === 'error') {
              console.error(
                `[BrowserWorkerManager] Worker "${pluginId}" error during deactivate:`,
                (msg as { message?: string }).message,
              );
            }
          });
          setTimeout(() => reject(new Error(`Deactivate timeout for "${pluginId}"`)), DEACTIVATE_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // Timeout or error — log warning, continue with force termination
      console.warn(
        `[BrowserWorkerManager] Graceful deactivate failed for "${pluginId}", force terminating`,
      );
    } finally {
      try {
        instance.worker.terminate();
      } catch (termErr) {
        console.error(
          `[BrowserWorkerManager] Worker terminate error for "${pluginId}":`,
          termErr,
        );
      }
      this.workerRegistry.delete(pluginId);
    }
  }

  /**
   * Get the current number of active Workers.
   */
  get activeCount(): number {
    return this.workerRegistry.size;
  }

  /**
   * Get list of all registered plugin IDs.
   */
  list(): string[] {
    return Array.from(this.workerRegistry.keys());
  }

  // ── Private ──────────────────────────────────────────────────────────

  /**
   * Build a Blob URL for the Worker bootstrap code.
   *
   * Uses a self-contained inline bootstrap string rather than loading
   * the worker-bootstrap.ts file, because the Worker runs in an isolated
   * context and cannot access the module graph directly. The bootstrap
   * is embedded as a template literal string (same pattern as backend's
   * generateBootstrapCode()).
   *
   * For development simplicity, this uses `new Worker(new URL(...))`
   * pattern when the worker-bootstrap.ts file can be loaded as a module
   * by the bundler, falling back to inline string approach.
   */
  private buildWorkerBlobUrl(): string {
    // Inline bootstrap code — self-contained, no external imports
    const bootstrapSrc = `
// ── Worker bootstrap for browser Web Worker ──
// Self-contained — no imports allowed, runs in isolated Worker context

const pendingCalls = new Map();
let eventSubscriptions = new Map();

self.onmessage = async (event) => {
  const msg = event.data;

  // 1. Forwarded event dispatch
  if (msg?.type === 'event') {
    const handlers = eventSubscriptions.get(msg.subId);
    if (handlers) {
      for (const handler of handlers) {
        try { handler(msg.event); } catch (e) {
          console.error('[Worker] Event handler error:', e);
        }
      }
    }
    return;
  }

  // 2. RPC result/error dispatch
  if (msg?.invokeId && pendingCalls.has(msg.invokeId)) {
    const pending = pendingCalls.get(msg.invokeId);
    pendingCalls.delete(msg.invokeId);
    if (msg.type === 'error') {
      const err = new Error(msg.message);
      err.name = msg.code || 'RpcError';
      err.stack = msg.stack;
      pending.reject(err);
    } else if (msg.type === 'result') {
      pending.resolve(msg.value);
    }
    return;
  }

  // 3. Activate
  if (msg.type === 'activate') {
    try {
      const services = {};
      for (const token of msg.serviceTokens) {
        services[token] = createServiceProxy(token);
      }

      const blob = new Blob([msg.pluginCode], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      let mod;
      try {
        mod = await import(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const plugin = mod.default || mod;

      if (typeof plugin.activate !== 'function') {
        self.postMessage({ type: 'error', message: 'Plugin has no activate function' });
        return;
      }

      const ctx = {
        services,
        pluginId: msg.manifest?.id || 'unknown',
        manifest: msg.manifest,
        ui: {
          registerExtensionPoint: (...args) => {
            self.postMessage({ type: 'invoke', invokeId: crypto.randomUUID(),
              token: '@openlearn/frontend:IUIService', method: 'registerExtensionPoint', args });
          },
          unregisterExtensionPoint: (...args) => {
            self.postMessage({ type: 'invoke', invokeId: crypto.randomUUID(),
              token: '@openlearn/frontend:IUIService', method: 'unregisterExtensionPoint', args });
          },
        },
      };

      await plugin.activate(ctx);
      self.postMessage({ type: 'activated' });

      // 4. Handle deactivate request (register after activation)
      self.onmessage = async (dmsg) => {
        if (dmsg.type === 'deactivate-request') {
          try {
            if (typeof plugin.deactivate === 'function') {
              await plugin.deactivate();
            }
          } finally {
            pendingCalls.clear();
            eventSubscriptions.clear();
            self.postMessage({ type: 'deactivated' });
          }
        }
      };
    } catch (err) {
      self.postMessage({
        type: 'error',
        message: (err && err.message) ? err.message : String(err),
        stack: (err && err.stack) || '',
      });
    }
  }
};

function createServiceProxy(token) {
  return new Proxy({}, {
    get(_target, method) {
      return (...args) => {
        const invokeId = crypto.randomUUID();
        return new Promise((resolve, reject) => {
          pendingCalls.set(invokeId, { resolve, reject });
          self.postMessage({ type: 'invoke', invokeId, token, method: String(method), args });
        });
      };
    },
  });
}
`;
    const blob = new Blob([bootstrapSrc], { type: 'application/javascript' });
    return URL.createObjectURL(blob);
  }
}
