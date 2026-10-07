import { describe, it, expect } from 'vitest';
import {
  Token,
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IPluginLifecycleManagerToken,
  IPluginDistributionManagerToken,
} from '../../../plugin-sdk/index.js';
// M-10 / F-3（D-2 + D-6 决策）：这三个 token 已从 SDK 导出面移除（零生产 resolve），
// 内核侧改从规范源导入。
import {
  IPluginRuntimeCompositionToken,
  IUnifiedExtensionRegistryToken,
  IPluginCapabilityGatewayToken,
} from '../../../core/di/interfaces.js';
// Concrete host-runtime classes live in core/plugin-host; the SDK package only
// re-exports their types (see plugin-sdk/index.ts). Host-process code and tests
// import implementations from the canonical core path.
import { PluginRuntimeAdapter } from '../plugin-runtime-adapter.js';
import { PluginRuntimeComposition } from '../plugin-runtime-composition.js';
import { PluginContextAdapter } from '../plugin-context-adapter.js';
import { PluginLifecycleManager } from '../plugin-lifecycle-manager.js';
import { PluginCapabilityGateway } from '../plugin-capability-gateway.js';
import { UnifiedExtensionRegistry } from '../unified-extension-registry.js';

describe('Plugin SDK Compatibility Layer (P7-B6 EU-01)', () => {
  it('should export legacy DI tokens and Token class', () => {
    expect(Token).toBeDefined();
    expect(ICommandBusServiceToken).toBeDefined();
    expect(IEventBusServiceToken).toBeDefined();
    expect(ICommandBusServiceToken.name).toBe('@openlearn/core:ICommandBusService');
  });

  it('should export all unified foundation facades and classes', () => {
    expect(PluginRuntimeAdapter).toBeDefined();
    expect(PluginRuntimeComposition).toBeDefined();
    expect(PluginContextAdapter).toBeDefined();
    expect(PluginLifecycleManager).toBeDefined();
    expect(PluginCapabilityGateway).toBeDefined();
    expect(UnifiedExtensionRegistry).toBeDefined();
  });

  it('P7-A2: should surface unified plugin facade DI tokens (consumable via ctx.resolve)', () => {
    expect(IPluginLifecycleManagerToken).toBeDefined();
    expect(IPluginLifecycleManagerToken.name).toBe('@openlearn/core:IPluginLifecycleManager');
    expect(IPluginDistributionManagerToken).toBeDefined();
    expect(IPluginRuntimeCompositionToken).toBeDefined();
    expect(IUnifiedExtensionRegistryToken).toBeDefined();
    expect(IPluginCapabilityGatewayToken).toBeDefined();
  });
});
