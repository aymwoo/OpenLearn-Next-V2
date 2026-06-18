/**
 * createMethodProxy 和 createServicesProxy 单元测试。
 *
 * 覆盖 6 个关键行为维度：
 * 1. Proxy 正确返回可调用函数
 * 2. invoke 消息格式正确
 * 3. result 消息解析和 Promise resolve
 * 4. error 消息解析和 Promise reject
 * 5. 超时机制
 * 6. createServicesProxy 整体行为（多 token、冻结、dispose、并发匹配）
 *
 * 测试策略：使用 mock transport（IWorkerTransport 接口最小模拟），
 * 不依赖真实 Worker 通道。
 *
 * 注意：createMethodProxy 仅创建 Proxy 并发送消息。响应处理由
 * createServicesProxy 或调用方注册的 onMessage 处理器完成。
 * 独立测试 createMethodProxy 时，需手动注册 onMessage 处理逻辑。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMethodProxy,
  createServicesProxy,
} from '../service-proxy.js';
import type { IWorkerTransport, PendingCall } from '../types.js';
import { WorkerTimeoutError, WorkerTransportError } from '../errors.js';

// ── Mock Transport ─────────────────────────────────────────────────────────

interface MockTransport extends IWorkerTransport {
  _messages: unknown[];
  _triggerMessage: (msg: unknown) => void;
}

function createMockTransport(): MockTransport {
  let handler: ((msg: any) => void) | null = null;
  const messages: unknown[] = [];
  return {
    postMessage: vi.fn((msg: any) => {
      messages.push(msg);
    }),
    onMessage: vi.fn((h: (msg: any) => void) => {
      handler = h;
    }),
    terminate: vi.fn(async () => {}),
    id: 'mock-transport',
    get _messages() {
      return messages;
    },
    _triggerMessage: (msg: unknown) => handler?.(msg),
  } as any;
}

/**
 * Register a response-dispatch handler on the transport that matches
 * incoming result/error messages against a pendingCalls Map.
 * This replicates the onMessage logic from createServicesProxy.
 */
function registerResponseHandler(
  transport: MockTransport,
  pendingCalls: Map<string, PendingCall>,
): void {
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
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Group 1: createMethodProxy
// ═══════════════════════════════════════════════════════════════════════════

describe('createMethodProxy', () => {
  let transport: MockTransport;
  let pendingCalls: Map<string, PendingCall>;

  beforeEach(() => {
    transport = createMockTransport();
    pendingCalls = new Map();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return a Proxy where property access returns a function', () => {
    const proxy = createMethodProxy(transport, 'test:Service', pendingCalls);
    expect(typeof proxy.someMethod).toBe('function');
    expect(typeof proxy.anotherMethod).toBe('function');
    expect(typeof proxy['$special']).toBe('function');
  });

  it('should send invoke message with correct structure when method is called', async () => {
    const proxy = createMethodProxy(transport, 'test:Service', pendingCalls);

    // Register the response handler so the promise can resolve
    registerResponseHandler(transport, pendingCalls);

    const promise = proxy.foo('arg1', 42);

    // The postMessage should have been called synchronously
    expect(transport.postMessage).toHaveBeenCalledTimes(1);
    const call = (transport.postMessage as any).mock.calls[0][0];
    expect(call).toHaveProperty('type', 'invoke');
    expect(call).toHaveProperty('invokeId');
    expect(typeof call.invokeId).toBe('string');
    expect(call.invokeId.length).toBeGreaterThan(0);
    expect(call).toHaveProperty('token', 'test:Service');
    expect(call).toHaveProperty('method', 'foo');
    expect(call).toHaveProperty('args');
    expect(call.args).toEqual(['arg1', 42]);

    // Resolve the promise to avoid hanging
    const invokeId = call.invokeId;
    transport._triggerMessage({ type: 'result', invokeId, value: null });
    await promise;
  });

  it('should resolve when result message arrives', async () => {
    const proxy = createMethodProxy(transport, 'test:Service', pendingCalls);
    registerResponseHandler(transport, pendingCalls);

    const promise = proxy.getValue();

    // Capture the invokeId from the sent message
    const msg = (transport.postMessage as any).mock.calls[0][0] as any;
    const invokeId = msg.invokeId;

    // Simulate a result response
    transport._triggerMessage({
      type: 'result',
      invokeId,
      value: 'hello-world',
    });

    const result = await promise;
    expect(result).toBe('hello-world');
  });

  it('should reject when error message arrives', async () => {
    const proxy = createMethodProxy(transport, 'test:Service', pendingCalls);
    registerResponseHandler(transport, pendingCalls);

    const promise = proxy.fail();

    const msg = (transport.postMessage as any).mock.calls[0][0] as any;
    const invokeId = msg.invokeId;

    transport._triggerMessage({
      type: 'error',
      invokeId,
      message: 'Something went wrong',
      code: 'MyError',
    });

    await expect(promise).rejects.toThrow(Error);
    try {
      await promise;
    } catch (err: any) {
      expect(err.message).toBe('Something went wrong');
      expect(err.name).toBe('MyError');
    }
  });

  it('should timeout with WorkerTimeoutError', async () => {
    const proxy = createMethodProxy(
      transport,
      'test:Service',
      pendingCalls,
      50,
    );
    // No response handler needed — timeout fires automatically
    const promise = proxy.slowOp();

    await expect(promise).rejects.toThrow(WorkerTimeoutError);
    try {
      await promise;
    } catch (err: any) {
      expect(err.timeoutMs).toBe(50);
    }
  });

  it('should not timeout when timeoutMs is 0', async () => {
    const proxy = createMethodProxy(
      transport,
      'test:Service',
      pendingCalls,
      0,
    );
    registerResponseHandler(transport, pendingCalls);

    const promise = proxy.noTimeout();

    const msg = (transport.postMessage as any).mock.calls[0][0] as any;
    const invokeId = msg.invokeId;

    // Respond to resolve the promise
    transport._triggerMessage({
      type: 'result',
      invokeId,
      value: 'got-it',
    });

    const result = await promise;
    expect(result).toBe('got-it');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Group 2: createServicesProxy
// ═══════════════════════════════════════════════════════════════════════════

describe('createServicesProxy', () => {
  let transport: MockTransport;

  beforeEach(() => {
    transport = createMockTransport();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create services object with entries for each token', () => {
    const result = createServicesProxy(transport, [
      '@openlearn/core:ICommandBusService',
      '@openlearn/core:IEventBusService',
    ]);

    expect(result.services).toHaveProperty(
      '@openlearn/core:ICommandBusService',
    );
    expect(result.services).toHaveProperty(
      '@openlearn/core:IEventBusService',
    );
    expect(
      typeof result.services['@openlearn/core:ICommandBusService'],
    ).toBe('object');
  });

  it('should return a callable function for each service method', () => {
    const result = createServicesProxy(transport, [
      '@openlearn/core:ICommandBusService',
    ]);
    const svc = result.services['@openlearn/core:ICommandBusService'];
    expect(typeof svc.execute).toBe('function');
    expect(typeof svc.registerHandler).toBe('function');
    expect(typeof svc.unregisterHandler).toBe('function');
  });

  it('should freeze the services object', () => {
    const result = createServicesProxy(transport, ['test:Service']);
    expect(Object.isFrozen(result.services)).toBe(true);
  });

  it('should reject all pending calls on dispose', async () => {
    const result = createServicesProxy(transport, ['test:Service']);
    const svc = result.services['test:Service'];

    // Start two method calls (without responding)
    const promise1 = svc.methodA();
    const promise2 = svc.methodB();

    // Dispose should reject all pending calls
    result.dispose();

    await expect(promise1).rejects.toThrow(WorkerTransportError);
    await expect(promise2).rejects.toThrow(WorkerTransportError);
  });

  it('should clear pending calls after dispose', () => {
    const result = createServicesProxy(transport, ['test:Service']);
    result.dispose();
    expect(result.pendingCalls.size).toBe(0);
  });

  it('should handle concurrent invocations with correct invokeId matching', async () => {
    const result = createServicesProxy(transport, ['test:Service']);
    const svc = result.services['test:Service'];

    // Issue 3 concurrent calls
    const promiseA = svc.methodA('a');
    const promiseB = svc.methodB('b');
    const promiseC = svc.methodC('c');

    // At this point, 3 postMessage calls have been made synchronously
    expect(transport._messages).toHaveLength(3);
    const msgs = transport._messages as Array<{
      invokeId: string;
      token: string;
      method: string;
      args: unknown[];
    }>;

    // Respond in REVERSE order to test invokeId matching
    transport._triggerMessage({
      type: 'result',
      invokeId: msgs[2].invokeId,
      value: 'C-result',
    });
    transport._triggerMessage({
      type: 'result',
      invokeId: msgs[1].invokeId,
      value: 'B-result',
    });
    transport._triggerMessage({
      type: 'result',
      invokeId: msgs[0].invokeId,
      value: 'A-result',
    });

    // All promises should resolve with correct values
    const [resultA, resultB, resultC] = await Promise.all([
      promiseA,
      promiseB,
      promiseC,
    ]);
    expect(resultA).toBe('A-result');
    expect(resultB).toBe('B-result');
    expect(resultC).toBe('C-result');
  });

  it('should handle mixed result and error for concurrent calls', async () => {
    const result = createServicesProxy(transport, ['test:Service']);
    const svc = result.services['test:Service'];

    const promiseOk = svc.good();
    const promiseFail = svc.bad();

    const msgs = transport._messages as Array<{ invokeId: string }>;

    // Respond with result for first, error for second
    transport._triggerMessage({
      type: 'result',
      invokeId: msgs[0].invokeId,
      value: 'ok-value',
    });
    transport._triggerMessage({
      type: 'error',
      invokeId: msgs[1].invokeId,
      message: 'bad-error',
    });

    await expect(promiseOk).resolves.toBe('ok-value');
    await expect(promiseFail).rejects.toThrow('bad-error');
  });
});
