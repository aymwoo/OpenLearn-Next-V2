/**
 * WorkerManager + WorkerRegistry 单元测试。
 *
 * 测试分组：
 * 1. WorkerRegistry — 注册、重复检测、崩溃检测、终止、列表
 * 2. WorkerManager — 构造（无 PluginHost）、Worker 创建、终止
 *
 * @module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { WorkerManager, WorkerRegistry } from '../worker-manager.js';
import { ServiceHost } from '../service-host.js';
import { NodeWorkerTransport } from '../transport.js';
import type { IWorkerTransport } from '../types.js';
import type { Manifest } from '../../esm-loader/manifest-schema.js';
import type { ServiceRegistry } from '../../di/service-registry.js';
import type { CapabilityGuard } from '../../capability-system/index.js';
import type Database from 'better-sqlite3';

// ── Mocks ────────────────────────────────────────────────────────────────────

function createMockServiceRegistry(): ServiceRegistry {
  return {
    resolveByName: vi.fn().mockResolvedValue(undefined),
    resolve: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue(undefined),
  } as unknown as ServiceRegistry;
}

function createMockCapabilityGuard(): CapabilityGuard {
  return {
    check: vi.fn().mockReturnValue(true),
    grant: vi.fn(),
    revokeAll: vi.fn(),
  } as unknown as CapabilityGuard;
}

function createMockDb(): Database.Database {
  return {
    prepare: vi.fn().mockReturnValue({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn().mockReturnValue([]),
    }),
  } as unknown as Database.Database;
}

/**
 * 创建一个模拟 Worker 实例（使用 EventEmitter）。
 * 用于 WorkerRegistry 测试（不涉及真实的 Worker 线程）。
 */
function createMockWorkerInstance(
  pluginId: string,
  extra?: Partial<{
    threadId: number;
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    onMessageHandler: ((msg: unknown) => void) | null;
  }>,
) {
  const ee = new EventEmitter();
  const threadId = extra?.threadId ?? 1;

  const transport: IWorkerTransport = {
    postMessage: extra?.postMessage ?? vi.fn(),
    onMessage: vi.fn((handler: (msg: unknown) => void) => {
      (transport as any).messageHandler = handler;
    }),
    terminate: extra?.terminate ?? vi.fn().mockResolvedValue(undefined),
    id: `worker:${threadId}`,
  };

  const mockWorker = {
    threadId,
    postMessage: extra?.postMessage ?? vi.fn(),
    terminate: extra?.terminate ?? vi.fn().mockResolvedValue(undefined),
    on: ee.on.bind(ee),
    emit: ee.emit.bind(ee),
  };

  const serviceHost = {
    handleMessage: vi.fn().mockResolvedValue(undefined),
    actorId: `plugin:${pluginId}`,
  } as unknown as ServiceHost;

  return {
    pluginId,
    worker: mockWorker as any,
    createdAt: Date.now(),
    status: 'running' as const,
    transport,
    serviceHost,
    emitter: ee,
  };
}

// ── Test data ────────────────────────────────────────────────────────────────

const MOCK_MANIFEST: Manifest = {
  id: 'test-plugin',
  name: 'Test Plugin',
  version: '1.0.0',
} as Manifest;

const MINIMAL_PLUGIN_CODE = `
export default {
  manifest: { id: 'test-plugin', name: 'Test Plugin', version: '1.0.0' },
  activate: async (ctx) => {},
  deactivate: async () => {}
};
`;

// ── Tests: WorkerRegistry ─────────────────────────────────────────────────────

describe('WorkerRegistry', () => {
  let registry: WorkerRegistry;

  beforeEach(() => {
    registry = new WorkerRegistry();
  });

  it('should register a WorkerInstance and retrieve it', () => {
    const instance = createMockWorkerInstance('plugin-a');
    registry.register('plugin-a', instance);

    const retrieved = registry.get('plugin-a');
    expect(retrieved).toBeDefined();
    expect(retrieved!.pluginId).toBe('plugin-a');
    expect(retrieved!.status).toBe('running');
  });

  it('should throw on duplicate registration', () => {
    const a = createMockWorkerInstance('plugin-a');
    const b = createMockWorkerInstance('plugin-a');

    registry.register('plugin-a', a);
    expect(() => registry.register('plugin-a', b)).toThrow(
      'Worker already registered for plugin "plugin-a"',
    );
  });

  it('should detect crash via exit event with non-zero code', () => {
    const instance = createMockWorkerInstance('crash-plugin');
    registry.register('crash-plugin', instance);

    // Simulate Worker exit(1)
    instance.emitter.emit('exit', 1);

    // Worker should be cleaned up after crash
    expect(registry.get('crash-plugin')).toBeUndefined();
    expect(registry.activeCount).toBe(0);
  });

  it('should not crash-cleanup for zero exit code', () => {
    const instance = createMockWorkerInstance('ok-plugin');
    registry.register('ok-plugin', instance);

    // Simulate Worker exit(0) — normal exit
    instance.emitter.emit('exit', 0);

    // Should still be tracked
    expect(registry.get('ok-plugin')).toBeDefined();
    expect(registry.activeCount).toBe(1);
  });

  it('should list active pluginIds', () => {
    registry.register('plugin-a', createMockWorkerInstance('plugin-a', { threadId: 1 }));
    registry.register('plugin-b', createMockWorkerInstance('plugin-b', { threadId: 2 }));

    const ids = registry.list();
    expect(ids).toContain('plugin-a');
    expect(ids).toContain('plugin-b');
    expect(ids.length).toBe(2);
  });

  it('should terminate and clean up', async () => {
    const terminateFn = vi.fn().mockResolvedValue(undefined);
    const postMessageFn = vi.fn();
    const instance = createMockWorkerInstance('term-plugin', {
      terminate: terminateFn,
      postMessage: postMessageFn,
    });
    registry.register('term-plugin', instance);

    // Set up the onMessage to respond with 'deactivated'
    const originalOnMessage = instance.transport.onMessage;
    (originalOnMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (handler: (msg: unknown) => void) => {
        // Simulate 'deactivated' response on deactivate-request
        (instance.transport as any)._onDeactivate = handler;
      },
    );

    // Patch postMessage to trigger deactivated response
    (postMessageFn as any).mockImplementation((msg: unknown) => {
      const typed = msg as { type?: string };
      if (typed.type === 'deactivate-request') {
        // After a microtask, call the onMessage handler with 'deactivated'
        setTimeout(() => {
          if ((instance.transport as any)._onDeactivate) {
            (instance.transport as any)._onDeactivate({ type: 'deactivated' });
          }
        }, 10);
      }
    });

    await registry.terminate('term-plugin', 1000);

    expect(registry.get('term-plugin')).toBeUndefined();
    expect(terminateFn).toHaveBeenCalled();
  });
});

// ── Tests: WorkerManager ──────────────────────────────────────────────────────

describe('WorkerManager', () => {
  let wm: WorkerManager;
  let mockRegistry: ServiceRegistry;
  let mockCapGuard: CapabilityGuard;
  let mockDb: Database.Database;

  beforeEach(() => {
    mockRegistry = createMockServiceRegistry();
    mockCapGuard = createMockCapabilityGuard();
    mockDb = createMockDb();
    wm = new WorkerManager(mockRegistry, mockCapGuard, mockDb);
  });

  afterEach(async () => {
    // Clean up any running Workers
    const ids = wm.registry.list();
    for (const id of ids) {
      await wm.terminateWorker(id);
    }
  });

  it('should construct without PluginHost dependency', () => {
    // WorkerManager constructor does NOT take PluginHost
    expect(wm).toBeDefined();
    expect(wm.registry).toBeDefined();
    expect(wm.registry.activeCount).toBe(0);
  });

  it('should create a Worker and return transport + serviceHost', async () => {
    const result = await wm.createWorker(
      'test-plugin',
      MOCK_MANIFEST,
      MINIMAL_PLUGIN_CODE,
      ['@openlearn/core:ICommandBusService'],
    );

    expect(result.transport).toBeDefined();
    expect(result.serviceHost).toBeDefined();
    expect(result.transport.id).toMatch(/^worker:/);
    expect(result.serviceHost.actorId).toBe('plugin:test-plugin');
  });

  it('should reject duplicate Worker creation', async () => {
    await wm.createWorker(
      'dup-plugin',
      MOCK_MANIFEST,
      MINIMAL_PLUGIN_CODE,
      [],
    );

    await expect(
      wm.createWorker('dup-plugin', MOCK_MANIFEST, MINIMAL_PLUGIN_CODE, []),
    ).rejects.toThrow('Worker already exists for plugin "dup-plugin"');
  });

  it('should terminate a running Worker', async () => {
    await wm.createWorker(
      'term-test',
      MOCK_MANIFEST,
      MINIMAL_PLUGIN_CODE,
      [],
    );

    expect(wm.registry.list()).toContain('term-test');

    await wm.terminateWorker('term-test');
    expect(wm.registry.list()).not.toContain('term-test');
  });

  it('should track active count', async () => {
    expect(wm.registry.activeCount).toBe(0);

    await wm.createWorker(
      'count-test-1',
      MOCK_MANIFEST,
      MINIMAL_PLUGIN_CODE,
      [],
    );
    expect(wm.registry.activeCount).toBe(1);

    await wm.createWorker(
      'count-test-2',
      MOCK_MANIFEST,
      MINIMAL_PLUGIN_CODE,
      [],
    );
    expect(wm.registry.activeCount).toBe(2);

    await wm.terminateWorker('count-test-1');
    expect(wm.registry.activeCount).toBe(1);
  });

  it('should restore workers from database (empty result)', async () => {
    // Mock DB returns empty array
    await wm.restoreWorkers();
    expect(wm.registry.activeCount).toBe(0);
  });
});
