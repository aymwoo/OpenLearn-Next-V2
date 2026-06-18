/**
 * Worker-side transparent RPC Proxy for cross-boundary service calls.
 *
 * Creates JavaScript Proxy objects that intercept property access and method
 * calls, serialize them as 'invoke' messages, and send them via IWorkerTransport
 * to the main thread ServiceHost. The calling code (Worker-side plugin) is not
 * aware it is calling across a thread boundary.
 *
 * ## Architecture
 *
 * ```
 * Plugin code -> services.commandBus.execute(cmd)
 *                     |
 *         createMethodProxy (Proxy get trap)
 *                     |
 *         pendingCalls.set(invokeId, { resolve, reject })
 *                     |
 *         transport.postMessage({ type: 'invoke', invokeId, token, method, args })
 *                     |
 *         (main thread processes, returns result/error)
 *                     |
 *         onMessage handler matches invokeId -> resolve/reject pending
 * ```
 *
 * ## Timeouts
 *
 * Each method call has a configurable timeout (default 30s). If no response
 * arrives within the timeout, the promise rejects with WorkerTimeoutError.
 * The pending call is deleted from the Map and the timeout is cleared on
 * response arrival.
 *
 * @module
 */

import type { IWorkerTransport, PendingCall } from './types.js';
import { WorkerTimeoutError, WorkerTransportError } from './errors.js';

// ── createMethodProxy ──────────────────────────────────────────────────────

/**
 * Create a JavaScript Proxy that transparently forwards method calls to the
 * main thread via IWorkerTransport.
 *
 * The returned Proxy's `get` trap returns an async function that:
 * 1. Generates a unique invokeId via `crypto.randomUUID()`
 * 2. Stores `{ resolve, reject }` in the shared pendingCalls Map
 * 3. Posts an `'invoke'` message via transport
 * 4. Returns a Promise that resolves/rejects when the response arrives
 *
 * @param transport - Worker transport for cross-thread messaging
 * @param token - Service token string (e.g. `'@openlearn/core:ICommandBusService'`)
 * @param pendingCalls - Shared Map for matching invoke responses by invokeId
 * @param timeoutMs - Per-call timeout in ms (0 = no timeout, default 30000)
 * @returns A Proxy-wrapped object where property access returns callable functions
 */
export function createMethodProxy(
  transport: IWorkerTransport,
  token: string,
  pendingCalls: Map<string, PendingCall>,
  timeoutMs: number = 30000,
): Record<string, Function> {
  return new Proxy({} as Record<string, Function>, {
    get(
      _target: Record<string, Function>,
      method: string | symbol,
    ): Function {
      // Return an async invoke function for any property access
      return (...args: unknown[]) => {
        const invokeId = crypto.randomUUID();
        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        const promise = new Promise<unknown>((resolve, reject) => {
          // Wrap resolve/reject to clear the timeout on response arrival
          const wrappedResolve = (value: unknown) => {
            if (timeoutId) clearTimeout(timeoutId);
            resolve(value);
          };
          const wrappedReject = (err: Error) => {
            if (timeoutId) clearTimeout(timeoutId);
            reject(err);
          };

          // Register the pending call
          pendingCalls.set(invokeId, {
            resolve: wrappedResolve,
            reject: wrappedReject,
          });

          // Send the invoke message
          transport.postMessage({
            type: 'invoke',
            invokeId,
            token,
            method: String(method),
            args,
          });

          // Set timeout if enabled
          if (timeoutMs > 0 && timeoutMs < Infinity) {
            timeoutId = setTimeout(() => {
              pendingCalls.delete(invokeId);
              wrappedReject(new WorkerTimeoutError(timeoutMs));
            }, timeoutMs);
          }
        });

        return promise;
      };
    },
  });
}

// ── createServicesProxy ────────────────────────────────────────────────────

/**
 * Result of {@link createServicesProxy}.
 */
export interface ServicesProxyResult {
  /**
   * Frozen services object with Proxy-wrapped entries for each token.
   * Each entry is a {@link createMethodProxy} result.
   */
  services: Record<string, Record<string, Function>>;

  /**
   * Shared Map tracking all pending RPC calls by invokeId.
   * Exposed for advanced use cases (e.g., custom cleanup).
   */
  pendingCalls: Map<string, PendingCall>;

  /**
   * Release all resources: reject all pending calls and clear the
   * onMessage handler. Must be called when the Worker terminates or
   * the plugin is deactivated.
   */
  dispose: () => void;
}

/**
 * Create the full services proxy object for a Worker-side PluginContext.
 *
 * Builds a `services` object with Proxy-wrapped entries for each token string,
 * registers an onMessage handler that dispatches incoming `result`/`error`
 * messages to the matching pending calls, and returns a `dispose` function
 * for cleanup on Worker termination.
 *
 * The services object is frozen with `Object.freeze()` to prevent tampering,
 * following the context-builder.ts pattern (PATTERNS.md line 169).
 *
 * @param transport - Worker transport for cross-thread messaging
 * @param serviceTokens - Array of service token strings to create proxies for
 * @returns {@link ServicesProxyResult} with services, pendingCalls, and dispose
 */
export function createServicesProxy(
  transport: IWorkerTransport,
  serviceTokens: string[],
): ServicesProxyResult {
  const pendingCalls = new Map<string, PendingCall>();

  // Register the onMessage handler to dispatch responses
  transport.onMessage((msg: unknown) => {
    const typed = msg as { type?: string; invokeId?: string };
    const invokeId = typed?.invokeId;
    if (!invokeId) return;

    const pending = pendingCalls.get(invokeId);
    if (!pending) return;
    pendingCalls.delete(invokeId);

    if (typed.type === 'error') {
      const err = new Error(
        (msg as { message?: string }).message ?? 'RPC error',
      );
      err.name = (msg as { code?: string }).code ?? 'RpcError';
      err.stack = (msg as { stack?: string }).stack;
      pending.reject(err);
    } else if (typed.type === 'result') {
      pending.resolve((msg as { value?: unknown }).value);
    }
    // 'event' type is silently ignored (reserved for Plan 4 EventBusProxy)
  });

  // Build services object with Proxy for each token
  const services: Record<string, Record<string, Function>> = {};
  for (const token of serviceTokens) {
    services[token] = createMethodProxy(transport, token, pendingCalls);
  }

  // Freeze the services object to prevent tampering (context-builder.ts pattern)
  Object.freeze(services);

  /**
   * Dispose the proxy: reject all pending calls and clear the onMessage handler.
   * Should be called when the Worker terminates or the plugin is deactivated.
   */
  function dispose(): void {
    // Reject all pending calls with transport disposed error
    for (const [, pending] of pendingCalls) {
      pending.reject(
        new WorkerTransportError('Transport disposed'),
      );
    }
    pendingCalls.clear();

    // Clear the onMessage handler by registering a no-op
    transport.onMessage(() => {});
  }

  return { services, pendingCalls, dispose };
}
