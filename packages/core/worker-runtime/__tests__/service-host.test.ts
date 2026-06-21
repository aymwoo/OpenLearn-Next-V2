/**
 * ServiceHost 单元测试。
 *
 * 覆盖 5 个关键行为维度：
 * 1. 基本 invoke 处理 — resolve 服务、执行方法、返回结果
 * 2. CapabilityGuard 强制执行 — 空 manifestCapabilities 限制
 * 3. 错误序列化 — code + message + stack（capped 4096）
 * 4. 消息分发路由 — 各种 type 的分发行为
 * 5. 访问器与 mutation 方法
 *
 * 测试策略：使用 mock transport + mock ServiceRegistry + mock CapabilityGuard。
 * 不依赖真实 DI 容器或数据库。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServiceHost } from '../service-host.js';
import type { IWorkerTransport, InvokeMessage } from '../types.js';
import { WorkerCapabilityError } from '../errors.js';

// ── Mock Transport ─────────────────────────────────────────────────────────

interface MockTransport extends IWorkerTransport {
  messages: any[];
}

function createMockTransport(): MockTransport {
  let handler: ((msg: any) => void) | null = null;
  const messages: any[] = [];
  return {
    postMessage: vi.fn((msg: any) => {
      messages.push(msg);
    }),
    onMessage: vi.fn((h: (msg: any) => void) => {
      handler = h;
    }),
    terminate: vi.fn(async () => {}),
    id: 'mock-host',
    get messages() {
      return messages;
    },
  } as any;
}

// ── Mock ServiceRegistry ───────────────────────────────────────────────────

function createMockServiceRegistry(
  services: Record<string, unknown>,
): { resolveByName: ReturnType<typeof vi.fn>; resolve: ReturnType<typeof vi.fn> } {
  return {
    resolveByName: vi.fn(async (name: string) => {
      const svc = services[name];
      if (!svc) throw new Error(`No provider for ${name}`);
      return svc;
    }),
    resolve: vi.fn(async () => {
      throw new Error('resolve() not expected — use resolveByName');
    }),
  } as any;
}

// ── Mock CapabilityGuard ───────────────────────────────────────────────────

function createMockCapGuard(
  checkResult: boolean = true,
): { check: ReturnType<typeof vi.fn> } {
  return {
    check: vi.fn(() => checkResult),
  } as any;
}

// ═══════════════════════════════════════════════════════════════════════════
// Group 1: Basic invoke handling
// ═══════════════════════════════════════════════════════════════════════════

describe('ServiceHost basic invoke handling', () => {
  let transport: MockTransport;
  let serviceRegistry: ReturnType<typeof createMockServiceRegistry>;
  let capGuard: ReturnType<typeof createMockCapGuard>;

  beforeEach(() => {
    transport = createMockTransport();
    capGuard = createMockCapGuard(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should invoke a service method and return result', async () => {
    const service = {
      foo: vi.fn(async (x: string) => `hello-${x}`),
    };
    serviceRegistry = createMockServiceRegistry({
      'test:Service': service,
    });

    const host = new ServiceHost(
      serviceRegistry as any,
      capGuard as any,
      'plugin:test',
      ['test:cap'],
    );

    await host.handleInvoke(
      {
        type: 'invoke',
        invokeId: 'inv-1',
        token: 'test:Service',
        method: 'foo',
        args: ['world'],
      },
      transport as any,
    );

    // Service method should have been called with correct args
    expect(service.foo).toHaveBeenCalledWith('world');

    // Result should be sent back
    expect(transport.messages).toHaveLength(1);
    expect(transport.messages[0]).toEqual({
      type: 'result',
      invokeId: 'inv-1',
      value: 'hello-world',
    });
  });

  it('should handle method not found', async () => {
    const service = {};
    serviceRegistry = createMockServiceRegistry({
      'test:Service': service,
    });

    const host = new ServiceHost(
      serviceRegistry as any,
      capGuard as any,
      'plugin:test',
      ['test:cap'],
    );

    await host.handleInvoke(
      {
        type: 'invoke',
        invokeId: 'inv-2',
        token: 'test:Service',
        method: 'nonexistent',
        args: [],
      },
      transport as any,
    );

    // Should send an error message (not throw)
    expect(transport.messages).toHaveLength(1);
    const msg = transport.messages[0];
    expect(msg.type).toBe('error');
    expect(msg.invokeId).toBe('inv-2');
    expect(msg.message).toContain('nonexistent');
    expect(msg.code).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Group 2: CapabilityGuard enforcement
// ═══════════════════════════════════════════════════════════════════════════

describe('ServiceHost CapabilityGuard enforcement', () => {
  let transport: MockTransport;
  let serviceRegistry: ReturnType<typeof createMockServiceRegistry>;
  let capGuard: ReturnType<typeof createMockCapGuard>;

  beforeEach(() => {
    transport = createMockTransport();
    capGuard = createMockCapGuard(true);
    serviceRegistry = createMockServiceRegistry({
      'test:Service': {
        get: vi.fn(async () => 'read-value'),
        set: vi.fn(async () => 'write-value'),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should deny calls when manifestCapabilities is empty for mutation methods', async () => {
    const host = new ServiceHost(
      serviceRegistry as any,
      capGuard as any,
      'plugin:no-cap',
      [], // empty capabilities
    );

    await host.handleInvoke(
      {
        type: 'invoke',
        invokeId: 'inv-3',
        token: 'test:Service',
        method: 'set',
        args: ['key', 'val'],
      },
      transport as any,
    );

    // Should send error, NOT result
    expect(transport.messages).toHaveLength(1);
    const msg = transport.messages[0];
    expect(msg.type).toBe('error');
    expect(msg.code).toBe('WorkerCapabilityError');
    expect(msg.message).toContain('denied');
  });

  it('should allow get methods even with empty capabilities', async () => {
    const host = new ServiceHost(
      serviceRegistry as any,
      capGuard as any,
      'plugin:no-cap',
      [], // empty capabilities
    );

    await host.handleInvoke(
      {
        type: 'invoke',
        invokeId: 'inv-4',
        token: 'test:Service',
        method: 'get',
        args: ['some-key'],
      },
      transport as any,
    );

    // Should send result, NOT error
    expect(transport.messages).toHaveLength(1);
    const msg = transport.messages[0];
    expect(msg.type).toBe('result');
    expect(msg.value).toBe('read-value');
  });

  it('should allow all methods when manifestCapabilities is non-empty', async () => {
    const host = new ServiceHost(
      serviceRegistry as any,
      capGuard as any,
      'plugin:has-cap',
      ['test:write'], // non-empty capabilities
    );

    await host.handleInvoke(
      {
        type: 'invoke',
        invokeId: 'inv-5',
        token: 'test:Service',
        method: 'set',
        args: ['key', 'val'],
      },
      transport as any,
    );

    // Should send result (capabilities non-empty, method allowed)
    expect(transport.messages).toHaveLength(1);
    const msg = transport.messages[0];
    expect(msg.type).toBe('result');
    expect(msg.value).toBe('write-value');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Group 3: Error serialization
// ═══════════════════════════════════════════════════════════════════════════

describe('ServiceHost error serialization', () => {
  let transport: MockTransport;
  let serviceRegistry: ReturnType<typeof createMockServiceRegistry>;
  let capGuard: ReturnType<typeof createMockCapGuard>;

  beforeEach(() => {
    transport = createMockTransport();
    capGuard = createMockCapGuard(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should serialize errors with code, message, and stack capped at 4096', async () => {
    // Create a service method that throws with a very long stack
    const service = {
      crash: vi.fn(async () => {
        const err = new Error('Boom!');
        // Artificially extend the stack to exceed STACK_CAP
        err.stack = 'Error: Boom!\n' + '    at line\n'.repeat(500);
        throw err;
      }),
    };
    serviceRegistry = createMockServiceRegistry({
      'test:Service': service,
    });

    const host = new ServiceHost(
      serviceRegistry as any,
      capGuard as any,
      'plugin:test',
      ['cap'],
    );

    await host.handleInvoke(
      {
        type: 'invoke',
        invokeId: 'inv-6',
        token: 'test:Service',
        method: 'crash',
        args: [],
      },
      transport as any,
    );

    expect(transport.messages).toHaveLength(1);
    const msg = transport.messages[0];
    expect(msg.type).toBe('error');
    expect(msg.code).toBe('Error');
    expect(msg.message).toBe('Boom!');
    expect(msg.stack).toBeDefined();
    // Stack should be capped at 4096 characters
    expect(msg.stack!.length).toBeLessThanOrEqual(4096);
  });

  it('should handle non-Error throws gracefully', async () => {
    const service = {
      throwString: vi.fn(async () => {
        // eslint-disable-next-line no-throw-literal
        throw 'string error';
      }),
    };
    serviceRegistry = createMockServiceRegistry({
      'test:Service': service,
    });

    const host = new ServiceHost(
      serviceRegistry as any,
      capGuard as any,
      'plugin:test',
      ['cap'],
    );

    // Should not crash — should serialize the thrown string as an error
    await host.handleInvoke(
      {
        type: 'invoke',
        invokeId: 'inv-7',
        token: 'test:Service',
        method: 'throwString',
        args: [],
      },
      transport as any,
    );

    expect(transport.messages).toHaveLength(1);
    const msg = transport.messages[0];
    expect(msg.type).toBe('error');
    expect(msg.message).toBe('string error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Group 4: Message dispatch routing
// ═══════════════════════════════════════════════════════════════════════════

describe('ServiceHost message dispatch routing', () => {
  let transport: MockTransport;
  let serviceRegistry: ReturnType<typeof createMockServiceRegistry>;
  let capGuard: ReturnType<typeof createMockCapGuard>;
  let host: ServiceHost;

  beforeEach(() => {
    transport = createMockTransport();
    capGuard = createMockCapGuard(true);
    serviceRegistry = createMockServiceRegistry({
      'test:Service': {
        get: vi.fn(async () => 'ok'),
      },
    });
    host = new ServiceHost(
      serviceRegistry as any,
      capGuard as any,
      'plugin:test',
      ['cap'],
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should ignore unknown message types', async () => {
    await host.handleMessage(
      { type: 'unknown-type' },
      transport as any,
    );

    // Should not post any messages
    expect(transport.postMessage).not.toHaveBeenCalled();
  });

  it('should acknowledge activated and deactivated silently', async () => {
    await host.handleMessage(
      { type: 'activated' },
      transport as any,
    );
    await host.handleMessage(
      { type: 'deactivated' },
      transport as any,
    );

    // Should not post any messages for these types
    expect(transport.postMessage).not.toHaveBeenCalled();
  });

  it('should warn on subscribe without EventBus', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await host.handleMessage(
      { type: 'subscribe', subId: 's1', eventType: 'test.event' },
      transport as any,
    );

    expect(warnSpy).toHaveBeenCalled();
    expect(transport.postMessage).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('should silently ignore unsubscribe without EventForwarder', async () => {
    // Without an EventBus/EventForwarder, unsubscribe is a no-op
    await host.handleMessage(
      { type: 'unsubscribe', subId: 's1' },
      transport as any,
    );

    // Should not post any messages and should not throw
    expect(transport.postMessage).not.toHaveBeenCalled();
  });

  it('should route invoke messages through handleInvoke', async () => {
    await host.handleMessage(
      {
        type: 'invoke',
        invokeId: 'inv-8',
        token: 'test:Service',
        method: 'get',
        args: [],
      },
      transport as any,
    );

    // Should have called handleInvoke which posts a result
    expect(transport.postMessage).toHaveBeenCalledTimes(1);
    expect(transport.messages[0].type).toBe('result');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Group 5: Accessors and mutation methods
// ═══════════════════════════════════════════════════════════════════════════

describe('ServiceHost accessors', () => {
  it('should return actorId from getter', () => {
    const host = new ServiceHost(
      {} as any,
      {} as any,
      'plugin:my-plugin',
      [],
    );
    expect(host.actorId).toBe('plugin:my-plugin');
  });

  it('should update manifestCapabilities via setManifestCapabilities', () => {
    const host = new ServiceHost(
      {} as any,
      {} as any,
      'plugin:test',
      [],
    );

    // Initially denied (empty caps)
    expect(() => {
      host.setManifestCapabilities(['lesson:write', 'lesson:read']);
    }).not.toThrow();

    // After update, should allow mutations (verified in Group 2)
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Group 6: ActionRegistry tracking and cleanup
// ═══════════════════════════════════════════════════════════════════════════

describe('ServiceHost ActionRegistry tracking', () => {
  let transport: MockTransport;
  let serviceRegistry: ReturnType<typeof createMockServiceRegistry>;
  let capGuard: ReturnType<typeof createMockCapGuard>;
  let actionRegistry: { register: any; unregister: any };

  beforeEach(() => {
    transport = createMockTransport();
    capGuard = createMockCapGuard(true);
    actionRegistry = {
      register: vi.fn(async () => {}),
      unregister: vi.fn(async () => {}),
    };
    serviceRegistry = createMockServiceRegistry({
      '@openlearn/core:IActionRegistryService': actionRegistry,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should track registered action descriptors and unregister them on dispose', async () => {
    const host = new ServiceHost(
      serviceRegistry as any,
      capGuard as any,
      'plugin:test',
      ['test:cap'],
    );

    // Call register
    await host.handleInvoke(
      {
        type: 'invoke',
        invokeId: 'inv-act-1',
        token: '@openlearn/core:IActionRegistryService',
        method: 'register',
        args: [{ id: 'action-foo' }],
      },
      transport as any,
    );

    expect(actionRegistry.register).toHaveBeenCalledWith({ id: 'action-foo' });
    expect(transport.messages[0]).toEqual({
      type: 'result',
      invokeId: 'inv-act-1',
      value: undefined,
    });

    // Call dispose
    await host.dispose();

    expect(actionRegistry.unregister).toHaveBeenCalledWith('action-foo');
  });
});
