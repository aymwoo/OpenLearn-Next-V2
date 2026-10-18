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
import { verifyPluginPackage } from '../security/plugin-signature.js';
import {
  PluginSignatureError,
  PluginIntegrityRequiredError,
  PluginAttestationRequiredError,
  PluginIntegrityMismatchError,
  PluginSignatureInvalidError,
} from './errors.js';

export interface PluginPackageMetadata {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly repositoryId: string;
  readonly downloadUrl?: string;
  readonly manifest?: Manifest;
  readonly integrity?: string;
  readonly signature?: string;
  readonly publisher?: string;
  readonly keyId?: string;
}

export interface IPluginRepositoryAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: 'official' | 'private' | 'local' | 'offline' | 'community' | 'remote';
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
  executionMode?: PluginExecutionMode;
  executionModeCoerced?: boolean;
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

    // SEC-SIGNATURE: 来源分级强安全门禁校验（完整性 SHA-256 + 发布者 Ed25519 签名）
    const isCommunity = repo.type === 'community' || repo.type === 'remote';
    const verifyResult = await verifyPluginPackage({
      packageSource: zipBuffer,
      sourceType: isCommunity ? 'community' : 'local',
      metadata: {
        id: pluginId,
        version: pkgMeta?.version,
        integrity: pkgMeta?.integrity,
        signature: pkgMeta?.signature,
        publisher: pkgMeta?.publisher,
      },
    });

    if (!verifyResult.ok) {
      if (verifyResult.code === 'COMMUNITY_INTEGRITY_REQUIRED') {
        throw new PluginIntegrityRequiredError(pluginId, verifyResult.error);
      }
      if (verifyResult.code === 'COMMUNITY_ATTESTATION_REQUIRED') {
        throw new PluginAttestationRequiredError(pluginId, verifyResult.error);
      }
      if (
        verifyResult.code === 'COMMUNITY_INTEGRITY_MISMATCH' ||
        verifyResult.code === 'LOCAL_INTEGRITY_MISMATCH'
      ) {
        throw new PluginIntegrityMismatchError(pluginId, verifyResult.error);
      }
      if (
        verifyResult.code === 'COMMUNITY_SIGNATURE_INVALID' ||
        verifyResult.code === 'LOCAL_SIGNATURE_INVALID'
      ) {
        throw new PluginSignatureInvalidError(pluginId, verifyResult.error);
      }
      throw new PluginSignatureError(pluginId, verifyResult.code, verifyResult.error);
    }

    let zipPath: string | undefined;
    try {
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
