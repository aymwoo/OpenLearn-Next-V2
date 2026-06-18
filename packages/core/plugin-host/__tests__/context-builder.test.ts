/**
 * context-builder 单元测试。
 *
 * 覆盖 buildContext() 和 createSafeFunction 的行为：
 *
 * Test 1: buildContext 返回正确的 PluginContext 形状（7 个 services 键）
 * Test 2: PluginContext.services 被 Object.freeze() 冻结
 * Test 3: createSafeFunction 切断原型链并阻止 constructor
 * Test 4: 包装的 commandBus.registerHandler 自动调用 tracker.track() 注册 dispose
 * Test 5: 包装的 eventBus.subscribe 自动调用 tracker.track() 注册 dispose
 * Test 6: 包装的 processManager.registerHandler 自动调用 tracker.track() 注册 dispose
 * Test 7: 包装的 processManager.registerInterval 自动调用 tracker.track() 注册 dispose
 * Test 8: capability 服务方法经过 createSafeFunction 包装但不注册 dispose
 */
import { describe, it, expect, vi } from 'vitest';
import { ServiceRegistry } from '../../di/service-registry.js';
import { ResourceTracker } from '../resource-tracker.js';
import { buildContext, createSafeFunction } from '../context-builder.js';
import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
} from '../../di/interfaces.js';
import type { Manifest } from '../../esm-loader/manifest-schema.js';
import type { PluginContext } from '../types.js';

// ── 辅助工具 ──────────────────────────────────────────────────────────────

/** 构建最小化有效 Manifest */
const testManifest: Manifest = {
  id: 'test-plugin',
  name: 'Test Plugin',
  version: '1.0.0',
  main: 'index.js',
};

/** 创建 mock DB 对象 */
function mockDb() {
  return {
    prepare: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(null),
      run: vi.fn(),
    }),
  };
}

/**
 * 构建最小化有效 ServiceRegistry，注册全部 7 个 IService mock。
 *
 * 每个 mock 服务实现 IxxxService 接口的全部方法，返回解析为 undefined 的 Promise。
 */
async function setupRegistry(): Promise<ServiceRegistry> {
  const registry = new ServiceRegistry();

  // Mock 服务：所有方法都是 vi.fn().mockResolvedValue(undefined)
  const mockCmd = {
    execute: vi.fn().mockResolvedValue(undefined),
    registerHandler: vi.fn().mockResolvedValue(undefined),
    unregisterHandler: vi.fn().mockResolvedValue(undefined),
    createCommand: vi.fn().mockResolvedValue(undefined),
    setInterceptor: vi.fn().mockResolvedValue(undefined),
  };
  const mockEvent = {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
  };
  const mockAction = {
    register: vi.fn().mockResolvedValue(undefined),
    unregister: vi.fn().mockResolvedValue(undefined),
    getAllActions: vi.fn().mockResolvedValue([]),
    getAgentTools: vi.fn().mockResolvedValue([]),
    getActionByToolName: vi.fn().mockResolvedValue(undefined),
    getActionByCommandType: vi.fn().mockResolvedValue(undefined),
  };
  const mockCap = {
    grant: vi.fn().mockResolvedValue(undefined),
    revokeAll: vi.fn().mockResolvedValue(undefined),
    check: vi.fn().mockResolvedValue(true),
  };
  const mockProc = {
    spawn: vi.fn().mockResolvedValue('proc-1'),
    kill: vi.fn().mockResolvedValue(undefined),
    registerHandler: vi.fn().mockResolvedValue(undefined),
    unregisterHandler: vi.fn().mockResolvedValue(undefined),
    registerInterval: vi.fn().mockResolvedValue('interval-456'),
    restore: vi.fn().mockResolvedValue(undefined),
  };
  const mockStore = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const mockAi = {
    generateText: vi.fn().mockResolvedValue('AI response'),
  };

  await registry.register(ICommandBusServiceToken, mockCmd as any);
  await registry.register(IEventBusServiceToken, mockEvent as any);
  await registry.register(IActionRegistryServiceToken, mockAction as any);
  await registry.register(ICapabilityServiceToken, mockCap as any);
  await registry.register(IProcessServiceToken, mockProc as any);
  await registry.register(IStorageServiceToken, mockStore as any);
  await registry.register(IAIServiceToken, mockAi as any);

  return registry;
}

/** 辅助：构建 PluginContext */
async function setupContext(overrides?: {
  registry?: ServiceRegistry;
  tracker?: ResourceTracker;
  pluginId?: string;
  manifest?: Manifest;
}): Promise<PluginContext> {
  const registry = overrides?.registry ?? (await setupRegistry());
  const tracker = overrides?.tracker ?? new ResourceTracker();
  const pluginId = overrides?.pluginId ?? 'plugin-id-123';
  const manifest = overrides?.manifest ?? testManifest;
  const db = mockDb();
  return buildContext(registry, tracker, pluginId, manifest, db);
}

// ── 测试 ─────────────────────────────────────────────────────────────────

describe('buildContext', () => {
  // ── Test 1 ──────────────────────────────────────────────────────────

  it('Test 1: buildContext 返回 PluginContext 形状 — 包含 { services, pluginId, manifest } 且 services 有 7 个键', async () => {
    const ctx = await setupContext();

    expect(ctx).toBeDefined();
    expect(ctx.services).toBeDefined();
    expect(ctx.pluginId).toBe('plugin-id-123');
    expect(ctx.manifest).toBe(testManifest);

    // 验证 7 个 services 键
    const keys = Object.keys(ctx.services);
    expect(keys).toHaveLength(7);
    expect(keys).toContain('commandBus');
    expect(keys).toContain('eventBus');
    expect(keys).toContain('actionRegistry');
    expect(keys).toContain('capability');
    expect(keys).toContain('processManager');
    expect(keys).toContain('storage');
    expect(keys).toContain('ai');
  });

  // ── Test 2 ──────────────────────────────────────────────────────────

  it('Test 2: PluginContext.services 被 Object.freeze() 冻结', async () => {
    const ctx = await setupContext();
    expect(Object.isFrozen(ctx.services)).toBe(true);
  });

  // ── Test 3 ──────────────────────────────────────────────────────────

  it('Test 3: createSafeFunction 切断原型链并阻止 constructor 访问', () => {
    const originalFn = () => 'hello';
    const safeFn = createSafeFunction(originalFn);

    // 原型链应被切断
    expect(Object.getPrototypeOf(safeFn)).toBeNull();

    // constructor 属性应被阻止
    expect((safeFn as any).constructor).toBeUndefined();

    // 函数应仍可正常调用
    expect(safeFn()).toBe('hello');
  });

  // ── Test 4 ──────────────────────────────────────────────────────────

  it('Test 4: 包装的 commandBus.registerHandler 在 tracker 中注册 dispose', async () => {
    const tracker = new ResourceTracker();
    const registry = await setupRegistry();
    const rawCommandBus = await registry.resolve(ICommandBusServiceToken);
    const ctx = await setupContext({ registry, tracker });

    // 调用 registerHandler — 应自动 registerHandler + tracker.track()
    const handler = { execute: vi.fn().mockResolvedValue(undefined) };
    await ctx.services.commandBus.registerHandler('test.command', handler);

    // 验证原始 registerHandler 被调用
    expect(rawCommandBus.registerHandler).toHaveBeenCalled();

    // 验证 disposeAll 会调用 unregisterHandler
    tracker.disposeAll('plugin-id-123');
    expect(rawCommandBus.unregisterHandler).toHaveBeenCalledWith('test.command');
  });

  // ── Test 5 ──────────────────────────────────────────────────────────

  it('Test 5: 包装的 eventBus.subscribe 在 tracker 中注册 dispose', async () => {
    const tracker = new ResourceTracker();
    const registry = await setupRegistry();
    const rawEventBus = await registry.resolve(IEventBusServiceToken);
    const ctx = await setupContext({ registry, tracker });

    // 订阅事件 — 应自动 tracker.track()
    await ctx.services.eventBus.subscribe('test.event', vi.fn());

    // 验证原始 subscribe 被调用
    expect(rawEventBus.subscribe).toHaveBeenCalled();

    // 验证 disposeAll 会清理资源（通过调用 unsubscribe）
    tracker.disposeAll('plugin-id-123');
    expect(rawEventBus.unsubscribe).toHaveBeenCalled();
  });

  // ── Test 6 ──────────────────────────────────────────────────────────

  it('Test 6: 包装的 processManager.registerHandler 在 tracker 中注册 dispose', async () => {
    const tracker = new ResourceTracker();
    const registry = await setupRegistry();
    const rawProcess = await registry.resolve(IProcessServiceToken);
    const ctx = await setupContext({ registry, tracker });

    // 注册 process handler — 应自动 tracker.track()
    await ctx.services.processManager.registerHandler('test.task', vi.fn());

    // 验证原始 registerHandler 被调用
    expect(rawProcess.registerHandler).toHaveBeenCalled();

    // 验证 disposeAll 会清理资源
    tracker.disposeAll('plugin-id-123');
    expect(rawProcess.unregisterHandler).toHaveBeenCalledWith('test.task');
  });

  // ── Test 7 ──────────────────────────────────────────────────────────

  it('Test 7: 包装的 processManager.registerInterval 在 tracker 中注册 dispose', async () => {
    const tracker = new ResourceTracker();
    const registry = new ServiceRegistry();

    // 为 processService 的 registerInterval 提供返回 processId 的 mock
    const mockProcessService = {
      spawn: vi.fn().mockResolvedValue('proc-1'),
      kill: vi.fn().mockResolvedValue(undefined),
      registerHandler: vi.fn().mockResolvedValue(undefined),
      unregisterHandler: vi.fn().mockResolvedValue(undefined),
      registerInterval: vi.fn().mockResolvedValue('interval-456'),
      restore: vi.fn().mockResolvedValue(undefined),
    };

    await registry.register(IProcessServiceToken, mockProcessService as any);
    await registry.register(ICommandBusServiceToken, {
      execute: vi.fn().mockResolvedValue(undefined),
      registerHandler: vi.fn().mockResolvedValue(undefined),
      unregisterHandler: vi.fn().mockResolvedValue(undefined),
      createCommand: vi.fn().mockResolvedValue(undefined),
      setInterceptor: vi.fn().mockResolvedValue(undefined),
    } as any);
    await registry.register(IEventBusServiceToken, {
      publish: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    } as any);
    await registry.register(IActionRegistryServiceToken, {
      register: vi.fn().mockResolvedValue(undefined),
      unregister: vi.fn().mockResolvedValue(undefined),
      getAllActions: vi.fn().mockResolvedValue([]),
      getAgentTools: vi.fn().mockResolvedValue([]),
      getActionByToolName: vi.fn().mockResolvedValue(undefined),
      getActionByCommandType: vi.fn().mockResolvedValue(undefined),
    } as any);
    await registry.register(ICapabilityServiceToken, {
      grant: vi.fn().mockResolvedValue(undefined),
      revokeAll: vi.fn().mockResolvedValue(undefined),
      check: vi.fn().mockResolvedValue(true),
    } as any);
    await registry.register(IStorageServiceToken, {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    } as any);
    await registry.register(IAIServiceToken, {
      generateText: vi.fn().mockResolvedValue('AI response'),
    } as any);

    const ctx = await setupContext({ registry, tracker });

    // 注册 interval — 应自动 tracker.track()
    const processId = await ctx.services.processManager.registerInterval(
      'test-interval',
      1000,
      vi.fn(),
    );

    expect(processId).toBe('interval-456');
    expect(mockProcessService.registerInterval).toHaveBeenCalled();

    // 验证 disposeAll 会 kill 进程
    tracker.disposeAll('plugin-id-123');
    expect(mockProcessService.kill).toHaveBeenCalledWith('interval-456');
  });

  // ── Test 8 ──────────────────────────────────────────────────────────

  it('Test 8: capability 服务方法经过 createSafeFunction 包装但不在 tracker 中注册 dispose', async () => {
    const tracker = new ResourceTracker();
    const registry = await setupRegistry();
    const rawCapability = await registry.resolve(ICapabilityServiceToken);
    const ctx = await setupContext({ registry, tracker });

    // 调用 capability 方法 — 不应触发任何 tracker 操作
    await ctx.services.capability.grant('actor-1', 'test:read');
    await ctx.services.capability.check('actor-1', 'test:read');
    await ctx.services.capability.revokeAll('actor-1');

    // 验证原始 capability service 方法被调用
    expect(rawCapability.grant).toHaveBeenCalledWith('actor-1', 'test:read');
    expect(rawCapability.check).toHaveBeenCalledWith('actor-1', 'test:read');
    expect(rawCapability.revokeAll).toHaveBeenCalledWith('actor-1');

    // 验证 capability 方法不注册 dispose（disposeAll 不应有副作用）
    // 不应抛出错误 — capability 不注册资源
    expect(() => tracker.disposeAll('plugin-id-123')).not.toThrow();
  });
});
