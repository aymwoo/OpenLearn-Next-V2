import { describe, it, expect } from 'vitest';
import {
  Token,
  ICommandBusServiceToken,
  IEventBusServiceToken,
  PluginRuntimeAdapter,
  PluginRuntimeComposition,
  PluginContextAdapter,
  PluginLifecycleManager,
  PluginCapabilityGateway,
  UnifiedExtensionRegistry,
  PluginDistributionManager,
  IPluginLifecycleManagerToken,
  IPluginDistributionManagerToken,
  IPluginRuntimeCompositionToken,
  IUnifiedExtensionRegistryToken,
  IPluginCapabilityGatewayToken,
  ICapabilityRegistryToken,
} from '../index.js';
import type { IPluginDistributionManager } from '../index.js';

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
    expect(PluginDistributionManager).toBeDefined();
  });

  it('P7-A2: should surface unified plugin facade DI tokens (consumable via ctx.resolve)', () => {
    expect(IPluginLifecycleManagerToken).toBeDefined();
    expect(IPluginLifecycleManagerToken.name).toBe('@openlearn/core:IPluginLifecycleManager');
    expect(IPluginDistributionManagerToken).toBeDefined();
    expect(IPluginDistributionManagerToken.name).toBe('@openlearn/core:IPluginDistributionManager');
    expect(IPluginRuntimeCompositionToken).toBeDefined();
    expect(IUnifiedExtensionRegistryToken).toBeDefined();
    expect(IPluginCapabilityGatewayToken).toBeDefined();
    expect(ICapabilityRegistryToken).toBeDefined();
  });

  it('P7-A2: should surface distribution facade type alias', () => {
    // IPluginDistributionManager is a type export; assert the value-side counterpart
    // exists so the surface is coherent for plugins resolving the facade at runtime.
    expect(PluginDistributionManager).toBeDefined();
    expect(IPluginDistributionManagerToken).toBeDefined();
    const _typeCheck: IPluginDistributionManager | null = null;
    expect(_typeCheck).toBeNull();
  });
});
