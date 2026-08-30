/**
 * OpenLearn Platform Kernel - Plugin Distribution Manager (P7-B7 EU-01)
 * Manages plugin repositories, package metadata, installation orchestration, update orchestration, and removal.
 * Marketplace UI is decoupled and acts only as a consumer of this distribution layer.
 */

import type { PluginHost } from './index.js';
import type { Manifest } from '../esm-loader/manifest-schema.js';
import type {
  IntegrationHealthStatus,
  IntegrationDescriptor,
} from '../bootstrap/integration/integration-types.js';

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

export class LocalRepositoryAdapter implements IPluginRepositoryAdapter {
  public readonly type = 'local';
  private readonly _packages = new Map<string, { meta: PluginPackageMetadata; zipBuffer: Buffer }>();

  constructor(
    public readonly id: string = 'repo_local',
    public readonly name: string = 'Local Plugin Repository',
  ) {}

  public addPackage(meta: PluginPackageMetadata, zipBuffer: Buffer): void {
    this._packages.set(meta.id, { meta, zipBuffer });
  }

  public async listPackages(): Promise<ReadonlyArray<PluginPackageMetadata>> {
    return Array.from(this._packages.values()).map((p) => p.meta);
  }

  public async getPackage(pluginId: string): Promise<PluginPackageMetadata | undefined> {
    return this._packages.get(pluginId)?.meta;
  }

  public async fetchZipBuffer(pluginId: string): Promise<Buffer> {
    const pkg = this._packages.get(pluginId);
    if (!pkg) {
      throw new Error(`Package "${pluginId}" not found in local repository "${this.id}"`);
    }
    return pkg.zipBuffer;
  }
}

export interface PluginUpdateOptions {
  targetPluginId?: string;
  executionMode?: 'worker' | 'inline';
  allowDowngrade?: boolean;
}

export interface PluginUpdateResult {
  pluginId: string;
  manifest: Manifest;
  oldVersion: string;
  newVersion: string;
  previousStatus: string;
  wasActive: boolean;
}

export interface IPluginDistributionManager {
  readonly pluginHost: PluginHost;
  registerRepository(repo: IPluginRepositoryAdapter): void;
  listRepositories(): ReadonlyArray<IPluginRepositoryAdapter>;
  listAvailablePackages(): Promise<ReadonlyArray<PluginPackageMetadata>>;
  installFromZip(
    zipBuffer: Buffer,
    executionMode?: 'worker' | 'inline',
  ): Promise<{ pluginId: string; manifest: Manifest }>;
  installFromRepository(repoId: string, pluginId: string): Promise<{ pluginId: string; manifest: Manifest }>;
  updatePlugin(pluginId: string, zipBuffer?: Buffer): Promise<void>;
  updateFromZip(zipBuffer: Buffer, options?: PluginUpdateOptions): Promise<PluginUpdateResult>;
  uninstallPlugin(pluginId: string): Promise<void>;
  health(): IntegrationHealthStatus;
  metadata(): IntegrationDescriptor;
}

export class PluginDistributionManager implements IPluginDistributionManager {
  public readonly id = 'srv_plugin_distribution_manager';
  public readonly name = 'PluginDistributionManager';
  public readonly version = '0.2.5';

  private readonly _repositories = new Map<string, IPluginRepositoryAdapter>();

  constructor(public readonly pluginHost: PluginHost) {}

  public registerRepository(repo: IPluginRepositoryAdapter): void {
    if (this._repositories.has(repo.id)) {
      throw new Error(`Duplicate repository registration for ID "${repo.id}"`);
    }
    this._repositories.set(repo.id, repo);
  }

  public listRepositories(): ReadonlyArray<IPluginRepositoryAdapter> {
    return Array.from(this._repositories.values());
  }

  public async listAvailablePackages(): Promise<ReadonlyArray<PluginPackageMetadata>> {
    const result: PluginPackageMetadata[] = [];
    for (const repo of this._repositories.values()) {
      const pkgs = await repo.listPackages();
      result.push(...pkgs);
    }
    return result;
  }

  public async installFromZip(
    zipBuffer: Buffer,
    executionMode?: 'worker' | 'inline',
  ): Promise<{ pluginId: string; manifest: Manifest }> {
    const manifest = await this.pluginHost.installPluginFromZip(zipBuffer, executionMode);
    // installPluginFromZip returns Manifest & { pluginId: <DB UUID> }.
    // Prefer the UUID so callers can toggle/activate without alias resolution.
    const pluginId = (manifest as Manifest & { pluginId?: string }).pluginId ?? manifest.id;
    return { pluginId, manifest };
  }

  public async installFromRepository(
    repoId: string,
    pluginId: string,
  ): Promise<{ pluginId: string; manifest: Manifest }> {
    const repo = this._repositories.get(repoId);
    if (!repo) {
      throw new Error(`Repository "${repoId}" not found`);
    }

    const zipBuffer = await repo.fetchZipBuffer(pluginId);
    return this.installFromZip(zipBuffer);
  }

  public async updatePlugin(pluginId: string, zipBuffer?: Buffer): Promise<void> {
    if (zipBuffer) {
      await this.updateFromZip(zipBuffer, { targetPluginId: pluginId });
      return;
    }
    // No zip: reload from on-disk index.js
    const filePath = this.pluginHost.getPluginFilePath(this.pluginHost.resolvePluginUuid(pluginId));
    const fs = await import('node:fs');
    if (!fs.existsSync(filePath)) {
      throw new Error(`Cannot reload plugin "${pluginId}": source file missing at ${filePath}`);
    }
    const code = fs.readFileSync(filePath, 'utf-8');
    await this.pluginHost.reloadPlugin(pluginId, code);
  }

  public async updateFromZip(
    zipBuffer: Buffer,
    options: PluginUpdateOptions = {},
  ): Promise<PluginUpdateResult> {
    return this.pluginHost.updatePluginFromZip(zipBuffer, options);
  }

  public async uninstallPlugin(pluginId: string): Promise<void> {
    await this.pluginHost.uninstallPlugin(pluginId);
  }

  public health(): IntegrationHealthStatus {
    return {
      isHealthy: true,
      details: {
        registeredRepositoriesCount: this._repositories.size,
        repositoryIds: Array.from(this._repositories.keys()),
      },
    };
  }

  public metadata(): IntegrationDescriptor {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      description: 'Plugin Distribution & Repository Manager for OpenLearn V2',
    };
  }
}
