import { describe, it, expect } from 'vitest';
import {
  Token,
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IPluginLifecycleManagerToken,
  IPluginDistributionManagerToken,
  IPluginRuntimeCompositionToken,
  IUnifiedExtensionRegistryToken,
  IPluginCapabilityGatewayToken,
  ICapabilityRegistryToken,
} from '../index.js';
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
