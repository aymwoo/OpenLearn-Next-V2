/**
 * IService interfaces and Kernel registration integration tests.
 *
 * Covers:
 * - **SC-1** — IService 接口定义（7 个 Token 类型推断）
 * - **SC-2** — Token 命名格式验证（@openlearn/core:IServiceName）
 * - **SC-3** — Kernel 构造函数中 7 个 IService 注册成功并可 resolve
 * - **SC-4** — Kernel 直接属性访问与 serviceRegistry.resolve 返回同一引用
 * - **SC-5** — StorageService 和 AIService 独立实例 + 方法可调用
 *
 * These tests verify the end-to-end DI wiring: Token creation → Kernel
 * construction → serviceRegistry registration → resolve path.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Kernel } from '../../kernel/index.js';
import { ServiceRegistry } from '../service-registry.js';
import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
} from '../interfaces.js';

// ── Test data ────────────────────────────────────────────────────────────────

const tokens = [
  { name: 'ICommandBusServiceToken', token: ICommandBusServiceToken, expected: '@openlearn/core:ICommandBusService' },
  { name: 'IEventBusServiceToken', token: IEventBusServiceToken, expected: '@openlearn/core:IEventBusService' },
  { name: 'IActionRegistryServiceToken', token: IActionRegistryServiceToken, expected: '@openlearn/core:IActionRegistryService' },
  { name: 'ICapabilityServiceToken', token: ICapabilityServiceToken, expected: '@openlearn/core:ICapabilityService' },
  { name: 'IProcessServiceToken', token: IProcessServiceToken, expected: '@openlearn/core:IProcessService' },
  { name: 'IStorageServiceToken', token: IStorageServiceToken, expected: '@openlearn/core:IStorageService' },
  { name: 'IAIServiceToken', token: IAIServiceToken, expected: '@openlearn/core:IAIService' },
];

// ── Describe block 1: Token naming format ────────────────────────────────────

describe('IService Token 命名格式', () => {
  it.each(tokens)(
    '$name 的 name 应为 $expected',
    ({ token, expected }) => {
      expect(token.name).toBe(expected);
    },
  );

  it('所有 Token 实例应该互不相同', () => {
    const names = tokens.map((t) => t.token.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(tokens.length);
  });

  it('所有 Token name 应通过 TOKEN_NAME_RE 格式验证', () => {
    // Verify each name matches the expected format pattern:
    // @scope/domain:ServiceName — no spaces, no Chinese, no special chars
    const formatRe = /^@[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+:[a-zA-Z0-9_]+$/;
    for (const { token } of tokens) {
      expect(token.name).toMatch(formatRe);
    }
  });
});

// ── Describe block 2: Kernel IService registration ───────────────────────────

describe('Kernel IService 注册', () => {
  let kernel: Kernel;

  beforeAll(() => {
    kernel = new Kernel();
  });

  it('应该通过 serviceRegistry.resolve 获取所有 7 个 IService（SC-3）', async () => {
    const commandBus = await kernel.serviceRegistry.resolve(ICommandBusServiceToken);
    const eventBus = await kernel.serviceRegistry.resolve(IEventBusServiceToken);
    const actionRegistry = await kernel.serviceRegistry.resolve(IActionRegistryServiceToken);
    const capability = await kernel.serviceRegistry.resolve(ICapabilityServiceToken);
    const process = await kernel.serviceRegistry.resolve(IProcessServiceToken);
    const storage = await kernel.serviceRegistry.resolve(IStorageServiceToken);
    const ai = await kernel.serviceRegistry.resolve(IAIServiceToken);

    expect(commandBus).toBeDefined();
    expect(eventBus).toBeDefined();
    expect(actionRegistry).toBeDefined();
    expect(capability).toBeDefined();
    expect(process).toBeDefined();
    expect(storage).toBeDefined();
    expect(ai).toBeDefined();
  });

  it('resolve 返回的实例应与 kernelContainer 直接属性一致（5 个直接注册的子系统，SC-4）', async () => {
    // verify resolve === kernel direct property (same reference, toBe)
    expect(
      await kernel.serviceRegistry.resolve(ICommandBusServiceToken),
    ).toBe(kernel.commandBus);
    expect(
      await kernel.serviceRegistry.resolve(IEventBusServiceToken),
    ).toBe(kernel.eventBus);
    expect(
      await kernel.serviceRegistry.resolve(IActionRegistryServiceToken),
    ).toBe(kernel.actionRegistry);
    expect(
      await kernel.serviceRegistry.resolve(ICapabilityServiceToken),
    ).toBe(kernel.capabilityGuard);
    expect(
      await kernel.serviceRegistry.resolve(IProcessServiceToken),
    ).toBe(kernel.processManager);
  });

  it('resolve 返回的 StorageService 应是独立实例（SC-5）', async () => {
    const storage = await kernel.serviceRegistry.resolve(IStorageServiceToken);
    expect(storage).toBe(kernel.storageService);
    expect(storage).toBeDefined();
    // Verify get() method is accessible
    expect(typeof (storage as any).get).toBe('function');
    // Verify get() can be called (returns null for unknown key)
    const result = await (storage as any).get('__nonexistent_test_key__');
    expect(result).toBeNull();
  });

  it('resolve 返回的 AIService 应是独立实例（SC-5）', async () => {
    const ai = await kernel.serviceRegistry.resolve(IAIServiceToken);
    expect(ai).toBe(kernel.aiService);
    expect(ai).toBeDefined();
    // Verify generateText() method is accessible
    expect(typeof (ai as any).generateText).toBe('function');
  });
});

// ── Describe block 3: Kernel IService introspection ──────────────────────────

describe('Kernel IService 内省', () => {
  let kernel: Kernel;

  beforeAll(() => {
    kernel = new Kernel();
  });

  it('serviceRegistry.list() 应包含全部 7 个 Token（SC-3）', () => {
    const list = kernel.serviceRegistry.list();
    expect(list.length).toBeGreaterThanOrEqual(7);

    const names = list.map((e) => e.name);
    expect(names).toContain('@openlearn/core:ICommandBusService');
    expect(names).toContain('@openlearn/core:IEventBusService');
    expect(names).toContain('@openlearn/core:IActionRegistryService');
    expect(names).toContain('@openlearn/core:ICapabilityService');
    expect(names).toContain('@openlearn/core:IProcessService');
    expect(names).toContain('@openlearn/core:IStorageService');
    expect(names).toContain('@openlearn/core:IAIService');
  });
});
