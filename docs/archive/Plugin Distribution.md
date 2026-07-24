# Plugin Distribution Layer

**Module:** `@openlearn/core/plugin-host/plugin-distribution-manager`  
**Service ID:** `srv_plugin_distribution_manager`  

---

## Overview

The **Plugin Distribution Layer** decouples marketplace clients from low-level plugin installation mechanics. It orchestrates repository discovery, package metadata queries, plugin installation, update, and removal.

Marketplace UI is purely a client consumer of this layer.

---

## Key Interfaces & Public API

```typescript
export interface PluginPackageMetadata {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly repositoryId: string;
  readonly downloadUrl?: string;
  readonly manifest?: Manifest;
}

export interface IPluginRepositoryAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: 'official' | 'private' | 'local' | 'offline';
  listPackages(): Promise<ReadonlyArray<PluginPackageMetadata>>;
  getPackage(pluginId: string): Promise<PluginPackageMetadata | undefined>;
  fetchZipBuffer(pluginId: string): Promise<Buffer>;
}

export interface IPluginDistributionManager {
  readonly pluginHost: PluginHost;
  registerRepository(repo: IPluginRepositoryAdapter): void;
  listRepositories(): ReadonlyArray<IPluginRepositoryAdapter>;
  listAvailablePackages(): Promise<ReadonlyArray<PluginPackageMetadata>>;
  installFromZip(zipBuffer: Buffer): Promise<{ pluginId: string }>;
  installFromRepository(repoId: string, pluginId: string): Promise<{ pluginId: string }>;
  updatePlugin(pluginId: string, zipBuffer?: Buffer): Promise<void>;
  uninstallPlugin(pluginId: string): Promise<void>;
  health(): IntegrationHealthStatus;
  metadata(): IntegrationDescriptor;
}
```

---

## Composition Root Integration

Registered in `PluginCompositionModule` under service ID `srv_plugin_distribution_manager`.
Can be injected or retrieved via `options.infrastructureRefs.get('distributionManager')`.
