import { describe, it, expect } from 'vitest';
import {
  Token,
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IPluginLifecycleManagerToken,
  IPluginDistributionManagerToken,
  ICapabilityRegistryToken,
} from '../index.js';
// M-10 / F-3（D-2 + D-6 决策）：这三个 token 已从 SDK 导出面移除。
// 它们在 kernel/index.ts:224-226 被注册进 ServiceRegistry，但**零生产 resolve** ——
// 对外承诺一个零消费者的 API 比不承诺更糟。内核侧仍从di/interfaces 正常引用。
// 这里从**规范源**导入，证明「移除导出」没有破坏内核可用性。
import {
  IPluginRuntimeCompositionToken,
  IUnifiedExtensionRegistryToken,
  IPluginCapabilityGatewayToken,
} from '../../core/di/interfaces.js';
// The unified foundation facade *classes* are exposed as TYPE-ONLY exports
// from the SDK (see `export type` in index.ts). Verify the SDK type surface
// is intact via `import type`, and assert the concrete runtime implementations
// exist by importing them from their canonical source modules.
import type {
  PluginRuntimeAdapter as SdkPluginRuntimeAdapter,
  PluginRuntimeComposition as SdkPluginRuntimeComposition,
  PluginContextAdapter as SdkPluginContextAdapter,
  PluginLifecycleManager as SdkPluginLifecycleManager,
  PluginCapabilityGateway as SdkPluginCapabilityGateway,
  UnifiedExtensionRegistry as SdkUnifiedExtensionRegistry,
  PluginDistributionManager as SdkPluginDistributionManager,
  IPluginDistributionManager,
} from '../index.js';
import { PluginRuntimeAdapter } from '../../core/plugin-host/plugin-runtime-adapter.js';
import { PluginRuntimeComposition } from '../../core/plugin-host/plugin-runtime-composition.js';
import { PluginContextAdapter } from '../../core/plugin-host/plugin-context-adapter.js';
import { PluginLifecycleManager } from '../../core/plugin-host/plugin-lifecycle-manager.js';
import { PluginCapabilityGateway } from '../../core/plugin-host/plugin-capability-gateway.js';
import { UnifiedExtensionRegistry } from '../../core/plugin-host/unified-extension-registry.js';
import { PluginDistributionManager } from '../../core/plugin-host/plugin-distribution-manager.js';
// 运行时导出面探测：用于 F-3 的「已移出导出」契约反转断言。
// 注意 esbuild tree-shaking 只会删掉**未被引用**的导出，这里显式取整个 namespace。
import * as sdkIndex from '../index.js';

// Compile-time assertion: the SDK must still expose these facade classes as
// TYPE exports (no runtime value). Fails `pnpm lint` (tsc) if any is dropped.
type _SdkFacadeTypeSurface =
  | SdkPluginRuntimeAdapter
  | SdkPluginRuntimeComposition
  | SdkPluginContextAdapter
  | SdkPluginLifecycleManager
  | SdkPluginCapabilityGateway
  | SdkUnifiedExtensionRegistry
  | SdkPluginDistributionManager;

describe('Plugin SDK Compatibility Layer (P7-B6 EU-01)', () => {
  it('should export legacy DI tokens and Token class', () => {
    expect(Token).toBeDefined();
    expect(ICommandBusServiceToken).toBeDefined();
    expect(IEventBusServiceToken).toBeDefined();
    expect(ICommandBusServiceToken.name).toBe('@openlearn/core:ICommandBusService');
  });

  it('should export all unified foundation facades and classes as constructors', () => {
    const classes = [
      PluginRuntimeAdapter,
      PluginRuntimeComposition,
      PluginContextAdapter,
      PluginLifecycleManager,
      PluginCapabilityGateway,
      UnifiedExtensionRegistry,
      PluginDistributionManager,
    ];
    for (const cls of classes) {
      expect(typeof cls).toBe('function');
      expect(cls.prototype).toBeDefined();
    }
  });

  it('P7-A2: should surface unified plugin facade DI tokens (consumable via ctx.resolve)', () => {
    const tokens = [IPluginLifecycleManagerToken, IPluginDistributionManagerToken, ICapabilityRegistryToken];
    for (const token of tokens) {
      expect(typeof token.name).toBe('string');
      expect(token.name).toMatch(/^@openlearn\/(core|plugins):/);
    }
    expect(IPluginLifecycleManagerToken.name).toBe('@openlearn/core:IPluginLifecycleManager');
    expect(IPluginDistributionManagerToken.name).toBe('@openlearn/core:IPluginDistributionManager');
  });

  it('F-3: 三个零消费者 token 已移出 SDK 导出，但内核侧仍可用', () => {
    // 契约反转断言（D-6决策）：
    // ① 它们**不再**出现在 SDK 导出面上 —— 用类型层探测「没有这个导出」
    // ② 它们仍然能从规范源导入 —— 内核 register 路径不受影响
    const sdk = sdkIndex as Record<string, unknown>;
    for (const name of [
      'IPluginRuntimeCompositionToken',
      'IUnifiedExtensionRegistryToken',
      'IPluginCapabilityGatewayToken',
      'ICapabilityGovernanceServiceToken',
    ]) {
      expect(sdk[name], `${name} 应已移出 SDK 导出面`).toBeUndefined();
    }

    // 内核侧仍然拿得到，且仍是合法 Token
    for (const token of [
      IPluginRuntimeCompositionToken,
      IUnifiedExtensionRegistryToken,
      IPluginCapabilityGatewayToken,
    ]) {
      expect(typeof token.name).toBe('string');
      expect(token.name).toMatch(/^@openlearn\/(core|plugins):/);
    }
  });

  it('P7-A2: should surface distribution facade type alias', () => {
    // IPluginDistributionManager is a type export; assert the value-side counterpart
    // exists so the surface is coherent for plugins resolving the facade at runtime.
    expect(typeof PluginDistributionManager).toBe('function');
    expect(IPluginDistributionManagerToken.name).toBe('@openlearn/core:IPluginDistributionManager');
    const _typeCheck: IPluginDistributionManager | null = null;
    expect(_typeCheck).toBeNull();
  });
});
