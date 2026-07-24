import { describe, it, expect, beforeEach } from 'vitest';
import {
  PlatformCompositionRoot,
  PluginCompositionModule,
  getPlatformServiceRegistry,
  resetPlatformServiceRegistry,
} from '../bootstrap/composition/index.js';
import { PluginRuntimeComposition } from '../plugin-host/plugin-runtime-composition.js';
import { PluginLifecycleManager } from '../plugin-host/plugin-lifecycle-manager.js';
import { PluginDistributionManager } from '../plugin-host/plugin-distribution-manager.js';
import { UnifiedExtensionRegistry } from '../plugin-host/unified-extension-registry.js';
import { PluginCapabilityGateway } from '../plugin-host/plugin-capability-gateway.js';
import { CapabilityRegistry } from '../ai-capability/registry/capability-registry.js';
import type { PluginHost } from '../plugin-host/index.js';
import type { WorkerManager } from '../worker-runtime/worker-manager.js';

describe('P7-A2 Stage 2 — PluginCompositionModule wires real singletons', () => {
  beforeEach(() => {
    resetPlatformServiceRegistry();
  });

  it('registers real plugin service instances (no mock fallbacks) when infrastructureRefs are provided', () => {
    // 轻量替身：仅用于验证组合层把"真实实例"而非 mock 占位对象注册进注册表。
    const fakePluginHost = { getContributionRegistry: () => ({}) } as unknown as PluginHost;
    const fakeWorkerManager = {} as unknown as WorkerManager;
    const fakeContributionRegistry = {};

    const runtimeComposition = new PluginRuntimeComposition(fakePluginHost, fakeWorkerManager);
    const lifecycleManager = new PluginLifecycleManager(fakePluginHost);
    const distributionManager = new PluginDistributionManager(fakePluginHost);
    const extensionRegistry = new UnifiedExtensionRegistry();
    const capabilityRegistry = new CapabilityRegistry();
    const capabilityGateway = new PluginCapabilityGateway(capabilityRegistry);

    const infrastructureRefs = new Map<string, unknown>([
      ['pluginHost', fakePluginHost],
      ['contributionRegistry', fakeContributionRegistry],
      ['runtimeComposition', runtimeComposition],
      ['lifecycleManager', lifecycleManager],
      ['capabilityGateway', capabilityGateway],
      ['extensionRegistry', extensionRegistry],
      ['distributionManager', distributionManager],
    ]);

    const root = PlatformCompositionRoot.create();
    root.registerModule(new PluginCompositionModule());
    root.compose({ infrastructureRefs });

    const registry = getPlatformServiceRegistry();

    // srv_plugin_host 必须是真实实例，而非 { name: 'PluginHostService' } mock 占位对象
    expect(registry.resolve('srv_plugin_host')).toBe(fakePluginHost);
    expect(registry.resolve('srv_plugin_host')).not.toEqual({
      name: 'PluginHostService',
      isReady: true,
      pluginsCount: 0,
    });

    // 5 个 facade 必须是真实实例，且 id 与预期一致
    expect(registry.resolve('srv_plugin_runtime_composition')).toBe(runtimeComposition);
    expect((registry.resolve('srv_plugin_runtime_composition') as { id: string }).id).toBe(
      'srv_plugin_runtime_composition',
    );
    expect((registry.resolve('srv_plugin_lifecycle_manager') as { id: string }).id).toBe(
      'srv_plugin_lifecycle_manager',
    );
    expect((registry.resolve('srv_plugin_distribution_manager') as { id: string }).id).toBe(
      'srv_plugin_distribution_manager',
    );
    expect((registry.resolve('srv_unified_extension_registry') as { id: string }).id).toBe(
      'srv_unified_extension_registry',
    );
    expect((registry.resolve('srv_plugin_capability_gateway') as { id: string }).id).toBe(
      'srv_plugin_capability_gateway',
    );
    expect(registry.resolve('srv_plugin_contribution_registry')).toBe(fakeContributionRegistry);
  });

  it('falls back to mock placeholders only when an infrastructureRef is missing', () => {
    resetPlatformServiceRegistry();
    // 不提供任何 infrastructureRefs —— 应触发 mock 兜底
    const root = PlatformCompositionRoot.create();
    root.registerModule(new PluginCompositionModule());
    root.compose({ environment: 'development' });

    const registry = getPlatformServiceRegistry();
    expect(registry.resolve('srv_plugin_host')).toEqual({
      name: 'PluginHostService',
      isReady: true,
      pluginsCount: 0,
    });
  });
});
