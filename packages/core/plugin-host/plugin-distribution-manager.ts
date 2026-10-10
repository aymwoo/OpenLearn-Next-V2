/**
 * OpenLearn Platform Kernel - Plugin Distribution Manager (P7-B7 EU-01)
 * Manages plugin repositories, package metadata, installation orchestration, update orchestration, and removal.
 * Marketplace UI is decoupled and acts only as a consumer of this distribution layer.
 */

import type { PluginHost } from './index.js';
import type { PluginExecutionMode } from './types.js';
import type { Manifest } from '../esm-loader/manifest-schema.js';
import type { IntegrationHealthStatus, IntegrationDescriptor } from '../bootstrap/integration/integration-types.js';
import { PLATFORM_VERSION } from '../version.js';
import { removeTempZip, writeBufferToTempZip } from '../esm-loader/install-utils.js';

export interface PluginPackageMetadata {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly repositoryId: string;
  readonly downloadUrl?: string;
  readonly manifest?: Manifest;
  readonly integrity?: string;
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
  executionMode?: PluginExecutionMode;
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
  /**
   * @param zipPath ZIP 文件路径（R-4：安装链路只持路径）
   */
  installFromZip(
    zipPath: string,
    executionMode?: PluginExecutionMode,
  ): Promise<{ pluginId: string; manifest: Manifest }>;
  installFromRepository(repoId: string, pluginId: string): Promise<{ pluginId: string; manifest: Manifest }>;
  updatePlugin(pluginId: string, zipPath?: string): Promise<void>;
  updateFromZip(zipPath: string, options?: PluginUpdateOptions): Promise<PluginUpdateResult>;
  uninstallPlugin(pluginId: string): Promise<void>;
  health(): IntegrationHealthStatus;
  metadata(): IntegrationDescriptor;
}

export class PluginDistributionManager implements IPluginDistributionManager {
  public readonly id = 'srv_plugin_distribution_manager';
  public readonly name = 'PluginDistributionManager';
  public readonly version = PLATFORM_VERSION;

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

  /**
   * @param zipPath ZIP 文件路径（R-4：安装链路只持路径；Buffer 调用方先经
   *   `writeBufferToTempZip` 落盘并负责清理）
   */
  public async installFromZip(
    zipPath: string,
    executionMode?: PluginExecutionMode,
  ): Promise<{ pluginId: string; manifest: Manifest }> {
    const manifest = await this.pluginHost.installPluginFromZip(zipPath, executionMode);
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

    const pkgMeta = await repo.getPackage(pluginId);
    const zipBuffer = await repo.fetchZipBuffer(pluginId);

    // SEC-INTEGRITY: 如果元数据中声明了 integrity，强校验 SHA-256 哈希
    let zipPath: string | undefined;
    try {
      if (pkgMeta?.integrity) {
        const crypto = await import('node:crypto');
        const hash = crypto.createHash('sha256').update(zipBuffer);
        const expected = pkgMeta.integrity.trim();
        let matches = false;
        if (expected.startsWith('sha256-')) {
          const base64Digest = hash.digest('base64');
          matches = expected.slice(7) === base64Digest;
        } else {
          const hexDigest = hash.digest('hex');
          matches = expected.toLowerCase() === hexDigest.toLowerCase();
        }
        if (!matches) {
          throw new Error(
            `[PluginDistributionManager] Integrity verification failed for plugin "${pluginId}". ` +
              `Downloaded ZIP checksum does not match repository metadata.`,
          );
        }
      }

      // R-4：仓库适配器暴露的仍是 Buffer（内存态仓库，无下载环节），
      // 在此转换成路径contract 并负责清理。
      zipPath = writeBufferToTempZip(zipBuffer, 'plugin-repo-');
      return await this.installFromZip(zipPath);
    } finally {
      removeTempZip(zipPath);
    }
  }

  public async updatePlugin(pluginId: string, zipPath?: string): Promise<void> {
    if (zipPath) {
      await this.updateFromZip(zipPath, { targetPluginId: pluginId });
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

  public async updateFromZip(zipPath: string, options: PluginUpdateOptions = {}): Promise<PluginUpdateResult> {
    return this.pluginHost.updatePluginFromZip(zipPath, options);
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
