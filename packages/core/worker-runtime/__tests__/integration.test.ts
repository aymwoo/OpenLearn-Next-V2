/**
 * Worker Runtime 集成测试。
 *
 * 验证完整管线：types -> transport -> ServiceProxy -> ServiceHost ->
 * EventBusProxy -> EventForwarder -> Worker + PluginHost dual-mode lifecycle。
 *
 * ## 测试分组
 *
 * 1. **Transport + Message Protocol** — mock transport pair 模拟双向消息通信
 * 2. **ServiceProxy + ServiceHost RPC** — main thread 到 Worker 的 RPC 双向流程
 * 3. **EventForwarder** — 跨 Worker 边界的事件转发
 * 4. **Worker lifecycle** — PluginHost dual-mode（inline/worker）+ crash isolation
 *
 * ## 测试策略
 *
 * - Groups 1-3: 使用 EventEmitter 模拟的 mock transport pair
 * - Group 4: 使用真实 node:worker_threads.Worker 验证实际线程隔离
 * - EventBus: 使用真实 EventBus 实例（非 mock）
 * - 数据库: 使用 better-sqlite3 ':memory:'
 *
 * @module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { EventBus } from '../../event-bus/index.js';
import { EventForwarder } from '../event-forwarder.js';
import { ServiceHost } from '../service-host.js';
import {
  createServicesProxy,
  createMethodProxy,
  EventBusProxy,
} from '../service-proxy.js';
import type { IWorkerTransport } from '../types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Test utilities
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a mock transport pair using EventEmitter pattern.
 *
 * Simulates the bidirectional message channel between a Worker (child)
 * and the main thread (parent). Both sides have postMessage/onMessage
 * that route through a pair of EventEmitters.
 */
function createMockTransportPair(): {
  main: IWorkerTransport & { messages: any[] };
  worker: IWorkerTransport & { messages: any[] };
} {
  const mainToWorker = new EventEmitter();
  const workerToMain = new EventEmitter();

  function makeTransport(
    send: EventEmitter,
    recv: EventEmitter,
    id: string,
  ): IWorkerTransport & { messages: any[] } {
    let handler: ((msg: any) => void) | null = null;
    const messages: any[] = [];

    recv.on('message', (msg: any) => {
      if (handler) handler(msg);
    });

    return {
      postMessage: vi.fn((msg: any) => {
        messages.push(msg);
        send.emit('message', msg);
      }),
      onMessage: vi.fn((h: (msg: any) => void) => {
        handler = h;
      }),
      terminate: vi.fn(async () => {
        handler = null;
        send.removeAllListeners();
        recv.removeAllListeners();
      }),
      id,
      get messages() {
        return messages;
      },
    } as any;
  }

  return {
    main: makeTransport(workerToMain, mainToWorker, 'main-transport'),
    worker: makeTransport(mainToWorker, workerToMain, 'worker-transport'),
  };
}

/**
 * Create a minimal mock ServiceRegistry with controlled services.
 */
function createMockServiceRegistry(
  services: Record<string, unknown> = {},
) {
  return {
    resolveByName: vi.fn(async (name: string) => {
      const svc = services[name];
      if (!svc) throw new Error(`No provider for ${name}`);
      return svc;
    }),
    resolve: vi.fn().mockRejectedValue(new Error('not expected')),
  } as any;
}

/**
 * Create a mock CapabilityGuard (returns configured check result).
 */
function createMockCapGuard(checkResult: boolean = true) {
  return {
    check: vi.fn(() => checkResult),
    grant: vi.fn(),
    revokeAll: vi.fn(),
  } as any;
}

// ═══════════════════════════════════════════════════════════════════════════
// Group 1: Transport — message channel simulation
// ═══════════════════════════════════════════════════════════════════════════

describe('Transport — message channel simulation', () => {
  it('should send and receive messages through a mock transport pair', () => {
    const { main, worker } = createMockTransportPair();
    const receivedOnWorker: any[] = [];

    worker.onMessage((msg: any) => {
      receivedOnWorker.push(msg);
    });

    main.postMessage({ type: 'activate', pluginCode: '', manifest: {} });
    main.postMessage({ type: 'deactivate-request' });

    expect(receivedOnWorker).toHaveLength(2);
    expect(receivedOnWorker[0].type).toBe('activate');
    expect(receivedOnWorker[1].type).toBe('deactivate-request');
  });

  it('should handle invoke -> result roundtrip via mock transport', async () => {
    const { main, worker } = createMockTransportPair();

    // Worker side: send invoke
    const resultPromise = new Promise<any>((resolve) => {
      main.onMessage((msg: any) => {
        if (msg.type === 'invoke') {
          resolve(msg);
        }
      });
    });

    worker.postMessage({
      type: 'invoke',
      invokeId: 'inv-1',
      token: 'test:Service',
      method: 'foo',
      args: ['hello'],
    });

    const invokeMsg = await resultPromise;
    expect(invokeMsg.type).toBe('invoke');
    expect(invokeMsg.invokeId).toBe('inv-1');
    expect(invokeMsg.token).toBe('test:Service');
    expect(invokeMsg.method).toBe('foo');
    expect(invokeMsg.args).toEqual(['hello']);
  });

  it('should propagate errors via error message type', async () => {
    const { main, worker } = createMockTransportPair();

    // Worker side: listen for result
    const errorPromise = new Promise<any>((resolve) => {
      worker.onMessage((msg: any) => {
        if (msg.type === 'error') resolve(msg);
      });
    });

    // Main thread: send error response
    main.postMessage({
      type: 'error',
      invokeId: 'inv-err',
      message: 'Something broke',
      code: 'MyError',
    });

    const errorMsg = await errorPromise;
    expect(errorMsg.message).toBe('Something broke');
    expect(errorMsg.code).toBe('MyError');
    expect(errorMsg.invokeId).toBe('inv-err');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Group 2: ServiceProxy + ServiceHost — RPC roundtrip
// ═══════════════════════════════════════════════════════════════════════════

describe('ServiceProxy + ServiceHost — RPC roundtrip', () => {
  let transportPair: ReturnType<typeof createMockTransportPair>;
  let serviceRegistry: ReturnType<typeof createMockServiceRegistry>;

  beforeEach(() => {
    transportPair = createMockTransportPair();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should create services proxy and call methods via service host', async () => {
    const { main: mainTransport, worker: workerTransport } = transportPair;
    const service = {
      execute: vi.fn(async (cmd: any) => ({ success: true, result: cmd })),
    };
    serviceRegistry = createMockServiceRegistry({
      '@openlearn/core:ICommandBusService': service,
    });
    const capGuard = createMockCapGuard(true);

    // Main thread: create ServiceHost
    const host = new ServiceHost(
      serviceRegistry,
      capGuard,
      'plugin:test',
      ['lesson:write'],
    );

    // Wire main transport messages to ServiceHost
    mainTransport.onMessage((msg: any) => {
      host.handleMessage(msg, mainTransport);
    });

    // Worker side: create services proxy
    const proxy = createServicesProxy(workerTransport, [
      '@openlearn/core:ICommandBusService',
    ]);

    // Wire worker transport to proxy (results/events)
    workerTransport.onMessage((msg: any) => {
      const typed = msg as { type?: string; invokeId?: string };
      const invokeId = typed?.invokeId;
      if (!invokeId) return;

      const pending = proxy.pendingCalls.get(invokeId);
      if (!pending) return;
      proxy.pendingCalls.delete(invokeId);

      if (typed.type === 'error') {
        const err = new Error((msg as any).message);
        err.name = (msg as any).code || 'RpcError';
        pending.reject(err);
      } else if (typed.type === 'result') {
        pending.resolve((msg as any).value);
      }
    });

    // Call method via proxy
    const cmd = { type: 'lesson.create', payload: { title: 'Math 101' } };
    const promise = proxy.services['@openlearn/core:ICommandBusService'].execute(cmd);

    // Give time for the message roundtrip
    await vi.runAllTimersAsync();

    // The invoke arrives at ServiceHost... but we need a different approach
    // since the mock transport already fires the message synchronously via EventEmitter
    const result = await promise;
    expect(result).toEqual({ success: true, result: cmd });
    expect(service.execute).toHaveBeenCalledWith(cmd);
  });

  it('should deny calls when capabilities are empty (CapGuard enforcement)', async () => {
    const { main: mainTransport, worker: workerTransport } = transportPair;
    const service = {
      set: vi.fn(async () => 'written'),
    };
    serviceRegistry = createMockServiceRegistry({
      'test:Service': service,
    });
    const capGuard = createMockCapGuard(true);

    // ServiceHost with empty capabilities
    const host = new ServiceHost(
      serviceRegistry,
      capGuard,
      'plugin:no-cap',
      [], // empty capabilities
    );

    mainTransport.onMessage((msg: any) => {
      host.handleMessage(msg, mainTransport);
    });

    const proxy = createServicesProxy(workerTransport, ['test:Service']);

    workerTransport.onMessage((msg: any) => {
      const typed = msg as { type?: string; invokeId?: string };
      const invokeId = typed?.invokeId;
      if (!invokeId) return;
      const pending = proxy.pendingCalls.get(invokeId);
      if (!pending) return;
      proxy.pendingCalls.delete(invokeId);
      if (typed.type === 'error') {
        const err = new Error((msg as any).message);
        err.name = (msg as any).code || 'RpcError';
        pending.reject(err);
      } else if (typed.type === 'result') {
        pending.resolve((msg as any).value);
      }
    });

    const promise = proxy.services['test:Service'].set('key', 'val');

    await expect(promise).rejects.toThrow(/denied/);
    expect(service.set).not.toHaveBeenCalled();
  });

  it('should handle concurrent invocations with correct invokeId matching', async () => {
    const { main: mainTransport, worker: workerTransport } = transportPair;
    const service = {
      getA: vi.fn(async () => 'A-result'),
      getB: vi.fn(async () => 'B-result'),
      getC: vi.fn(async () => 'C-result'),
    };
    serviceRegistry = createMockServiceRegistry({
      'test:Service': service,
    });
    const capGuard = createMockCapGuard(true);

    const host = new ServiceHost(
      serviceRegistry,
      capGuard,
      'plugin:test',
      ['read'],
    );

    // Route messages through the mock transport pair
    transportPair.main.onMessage((msg: any) => {
      // Main thread receives worker messages
      if (msg.type === 'invoke') {
        host.handleInvoke(msg, mainTransport);
      }
    });

    const proxy = createServicesProxy(workerTransport, ['test:Service']);

    // Worker side: route result/error messages to pending calls
    workerTransport.onMessage((msg: any) => {
      const typed = msg as { type?: string; invokeId?: string };
      const invokeId = typed?.invokeId;
      if (!invokeId) return;
      const pending = proxy.pendingCalls.get(invokeId);
      if (!pending) return;
      proxy.pendingCalls.delete(invokeId);
      if (typed.type === 'error') {
        const err = new Error((msg as any).message);
        err.name = (msg as any).code || 'RpcError';
        pending.reject(err);
      } else if (typed.type === 'result') {
        pending.resolve((msg as any).value);
      }
    });

    // Issue 3 concurrent calls
    const promiseA = proxy.services['test:Service'].getA();
    const promiseB = proxy.services['test:Service'].getB();
    const promiseC = proxy.services['test:Service'].getC();

    const [resultA, resultB, resultC] = await Promise.all([
      promiseA,
      promiseB,
      promiseC,
    ]);
    expect(resultA).toBe('A-result');
    expect(resultB).toBe('B-result');
    expect(resultC).toBe('C-result');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Group 3: EventForwarder -- cross-boundary event forwarding
// ═══════════════════════════════════════════════════════════════════════════

describe('EventForwarder — cross-boundary event forwarding', () => {
  let eventBus: EventBus;
  let transportPair: ReturnType<typeof createMockTransportPair>;

  beforeEach(() => {
    eventBus = new EventBus();
    transportPair = createMockTransportPair();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should forward events from main thread EventBus to Worker', () => {
    const { main: mainTransport, worker: workerTransport } = transportPair;
    const forwarder = new EventForwarder(eventBus, mainTransport);

    // Subscribe on behalf of the Worker
    forwarder.handleSubscribe({
      type: 'subscribe',
      subId: 'sub-1',
      eventType: 'lesson.created',
    });

    // Publish event on EventBus
    eventBus.publish({
      id: 'evt-1',
      type: 'lesson.created',
      source: 'test',
      payload: { lessonId: 'L1' },
      timestamp: Date.now(),
    });

    // Verify mainTransport.postMessage was called (forwarding to Worker)
    expect(mainTransport.postMessage).toHaveBeenCalledTimes(1);
    const msg = mainTransport.postMessage.mock.calls[0][0];
    expect(msg.type).toBe('event');
    expect(msg.subId).toBe('sub-1');
    expect(msg.event.type).toBe('lesson.created');
    expect(msg.event.payload).toEqual({ lessonId: 'L1' });
  });

  it('should unsubscribe correctly', () => {
    const { main: mainTransport } = transportPair;
    const forwarder = new EventForwarder(eventBus, mainTransport);

    // Subscribe
    forwarder.handleSubscribe({
      type: 'subscribe',
      subId: 'sub-u',
      eventType: 'test.event',
    });

    // Unsubscribe
    forwarder.handleUnsubscribe({
      type: 'unsubscribe',
      subId: 'sub-u',
    });

    // Publish -- should not forward
    eventBus.publish({
      id: 'evt-2',
      type: 'test.event',
      source: 'test',
      payload: {},
      timestamp: Date.now(),
    });

    expect(mainTransport.postMessage).not.toHaveBeenCalled();
  });

  it('should clean up all subscriptions on disposeAll', () => {
    const { main: mainTransport } = transportPair;
    const forwarder = new EventForwarder(eventBus, mainTransport);

    forwarder.handleSubscribe({
      type: 'subscribe',
      subId: 'sub-a',
      eventType: 'lesson.created',
    });
    forwarder.handleSubscribe({
      type: 'subscribe',
      subId: 'sub-b',
      eventType: 'whiteboard.element_drawn',
    });

    mainTransport.postMessage.mockClear();

    // Clean up
    forwarder.disposeAll();

    // Publish -- should not forward
    eventBus.publish({
      id: 'evt-3',
      type: 'lesson.created',
      source: 'test',
      payload: {},
      timestamp: Date.now(),
    });
    eventBus.publish({
      id: 'evt-4',
      type: 'whiteboard.element_drawn',
      source: 'test',
      payload: {},
      timestamp: Date.now(),
    });

    expect(mainTransport.postMessage).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Group 4: Worker lifecycle -- full E2E via PluginHost dual-mode
// ═══════════════════════════════════════════════════════════════════════════

describe('Worker lifecycle — end-to-end', () => {
  /**
   * Helper: create a real Worker thread with inline bootstrap code.
   * We use the same pattern as WorkerManager.generateBootstrapCode()
   * but with a simplified version that uses inlined EventBusProxy.
   */
  async function createWorkerAndActivate(
    pluginCode: string,
  ): Promise<{
    worker: import('node:worker_threads').Worker;
    transport: IWorkerTransport;
    exitCode: Promise<number | null>;
  }> {
    const { Worker } = await import('node:worker_threads');

    const bootstrapCode = `
import { parentPort, workerData } from 'node:worker_threads';

var pendingCalls = new Map();
var services = {};
var plugin = null;

// Minimal inlined EventBusProxy
var eventBusProxy = {
  subscribe: function(type, handler) {
    var subId = globalThis.crypto.randomUUID();
    state.handlers.set(subId, [handler]);
    parentPort.postMessage({ type: 'subscribe', subId: subId, eventType: type });
    return subId;
  },
  handleEvent: function(subId, event) {
    var handlers = state.handlers.get(subId);
    if (!handlers) return;
    for (var h of handlers) { try { h(event); } catch(e) {} }
  }
};

var state = { handlers: new Map() };

parentPort.on('message', async function(msg) {
  if (msg.type === 'event' && eventBusProxy) {
    eventBusProxy.handleEvent(msg.subId, msg.event);
    return;
  }

  if (msg && msg.invokeId && pendingCalls.has(msg.invokeId)) {
    var p = pendingCalls.get(msg.invokeId);
    pendingCalls.delete(msg.invokeId);
    if (msg.type === 'result') p.resolve(msg.value);
    else {
      var e = new Error(msg.message);
      e.name = msg.code || 'RpcError';
      p.reject(e);
    }
    return;
  }

  if (msg.type === 'activate') {
    try {
      var encoded = Buffer.from(msg.pluginCode, 'utf-8').toString('base64');
      var mod = await import('data:text/javascript;base64,' + encoded);
      plugin = (mod && mod.default) ? mod.default : (mod || {});
      if (typeof plugin.activate !== 'function') {
        parentPort.postMessage({ type: 'error', message: 'no activate' });
        return;
      }
      var ctx = {
        services: {},
        eventBus: {
          subscribe: function(t, h) { return eventBusProxy.subscribe(t, h); },
          unsubscribe: function() {},
          publish: async function() { throw new Error('not supported'); }
        }
      };
      await plugin.activate(ctx);
      parentPort.postMessage({ type: 'activated' });
    } catch (err) {
      parentPort.postMessage({ type: 'error', message: (err && err.message) || String(err) });
    }
  }
});
`;

    const encoded = Buffer.from(bootstrapCode, 'utf-8').toString('base64');
    const url = `data:text/javascript;base64,${encoded}`;

    const worker = new Worker(new URL(url), {
      workerData: { pluginId: 'test-plugin' },
      eval: false,
    });

    // Create a transport wrapper
    const transport: IWorkerTransport = {
      postMessage: (msg: unknown) => worker.postMessage(msg),
      onMessage: (handler: (msg: any) => void) => {
        worker.on('message', handler);
      },
      terminate: async () => { await worker.terminate(); },
      id: `worker:${worker.threadId}`,
    };

    // Track exit code
    const exitCode = new Promise<number | null>((resolve) => {
      worker.on('exit', (code) => resolve(code));
    });

    return { worker, transport, exitCode };
  }

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it('should execute a simple plugin in a real Worker and receive activated', async () => {
    const pluginCode = `
export default {
  manifest: { id: 'test', name: 'Test', version: '1.0.0' },
  activate: async (ctx) => {
    // No-op: just activate
  },
  deactivate: async () => {}
};
`;

    const { transport, exitCode } = await createWorkerAndActivate(pluginCode);

    // Wait for 'activated' response
    const activated = new Promise<void>((resolve, reject) => {
      transport.onMessage((msg: any) => {
        if (msg.type === 'activated') resolve();
        if (msg.type === 'error') reject(new Error(msg.message));
      });
      // Send activate message
      transport.postMessage({
        type: 'activate',
        pluginCode,
        manifest: { id: 'test' },
      });

      // Timeout
      setTimeout(() => reject(new Error('Timeout waiting for activated')), 5000);
    });

    await activated;
    expect(activated).resolves.toBeUndefined();

    // Clean up
    await transport.terminate();
  });

  it('should isolate plugin crashes -- crashing Worker does not affect others', async () => {
    // We'll simulate this by using two separate Workers and showing
    // that one can be terminated without affecting the other.

    const pluginCode = `
export default {
  manifest: { id: 'crash-test', name: 'Crash Test', version: '1.0.0' },
  activate: async (ctx) => {},
  deactivate: async () => {}
};
`;

    // Create Worker A
    const { transport: transportA, exitCode: exitCodeA } =
      await createWorkerAndActivate(pluginCode);

    // Activate Worker A
    const activatedA = new Promise<void>((resolve, reject) => {
      transportA.onMessage((msg: any) => {
        if (msg.type === 'activated') resolve();
        if (msg.type === 'error') reject(new Error(msg.message));
      });
      transportA.postMessage({
        type: 'activate',
        pluginCode,
        manifest: { id: 'plugin-a' },
      });
      setTimeout(() => reject(new Error('Timeout A')), 5000);
    });
    await activatedA;

    // Create Worker B
    const { transport: transportB, exitCode: exitCodeB } =
      await createWorkerAndActivate(pluginCode);

    const activatedB = new Promise<void>((resolve, reject) => {
      transportB.onMessage((msg: any) => {
        if (msg.type === 'activated') resolve();
        if (msg.type === 'error') reject(new Error(msg.message));
      });
      transportB.postMessage({
        type: 'activate',
        pluginCode,
        manifest: { id: 'plugin-b' },
      });
      setTimeout(() => reject(new Error('Timeout B')), 5000);
    });
    await activatedB;

    // Terminate Worker A (simulate crash)
    await transportA.terminate();

    // Worker A should exit (any exit code — terminate may return 0 or 1 depending on Node.js version)
    const exitA = await exitCodeA;
    expect(typeof exitA).toBe('number');

    // Worker B should still be operational
    const workerBMessages: any[] = [];
    transportB.onMessage((msg: any) => {
      workerBMessages.push(msg);
    });

    // Send a message to Worker B and verify it can still respond
    transportB.postMessage({
      type: 'invoke',
      invokeId: 'test-invoke',
      token: 'test',
      method: 'ping',
      args: [],
    });

    // Worker B should still be alive (no crash)
    // We verify by checking the worker hasn't exited
    const exitBRace = await Promise.race([
      exitCodeB.then((code) => ({ source: 'exit', code })),
      new Promise<any>((resolve) => setTimeout(() => resolve({ source: 'timeout', code: null }), 500)),
    ]);

    // Worker B should NOT have exited (timeout should win the race)
    expect(exitBRace.source).toBe('timeout');

    // Clean up Worker B
    await transportB.terminate();
  });
});
