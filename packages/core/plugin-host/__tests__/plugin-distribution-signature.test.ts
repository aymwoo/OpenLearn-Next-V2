import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import { PluginHost } from '../index.js';
import {
  PluginDistributionManager,
  LocalRepositoryAdapter,
  type IPluginRepositoryAdapter,
  type PluginPackageMetadata,
} from '../plugin-distribution-manager.js';
import {
  PluginIntegrityRequiredError,
  PluginAttestationRequiredError,
  PluginIntegrityMismatchError,
  PluginSignatureInvalidError,
} from '../errors.js';
import { computeSha256, buildAttestationPayload, signPayload } from '../../security/plugin-signature.js';

describe('PluginDistributionManager 发布者签名与来源分级安全门禁 (Issue #143)', () => {
  let host: PluginHost;
  let manager: PluginDistributionManager;

  const keyPair = crypto.generateKeyPairSync('ed25519');
  const pubPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privPem = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  const originalEnv = process.env.OPENLEARN_COMMUNITY_PUBKEY;

  beforeEach(() => {
    process.env.OPENLEARN_COMMUNITY_PUBKEY = pubPem;
    host = new PluginHost({} as any, {} as any, {} as any);
    manager = new PluginDistributionManager(host);
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.OPENLEARN_COMMUNITY_PUBKEY = originalEnv;
    } else {
      delete process.env.OPENLEARN_COMMUNITY_PUBKEY;
    }
  });

  async function createPluginZip(pluginId: string, version = '1.0.0'): Promise<Buffer> {
    const zip = new JSZip();
    zip.file('index.js', 'export default { activate() {} };');
    zip.file(
      'manifest.json',
      JSON.stringify({
        id: pluginId,
        name: pluginId,
        version,
      }),
    );
    return zip.generateAsync({ type: 'nodebuffer' });
  }

  class MockRepoAdapter implements IPluginRepositoryAdapter {
    private readonly pkgs = new Map<string, { meta: PluginPackageMetadata; zipBuffer: Buffer }>();

    constructor(
      public readonly id: string,
      public readonly name: string,
      public readonly type: 'community' | 'remote' | 'local',
    ) {}

    add(meta: PluginPackageMetadata, zipBuffer: Buffer) {
      this.pkgs.set(meta.id, { meta, zipBuffer });
    }

    async listPackages() {
      return Array.from(this.pkgs.values()).map((p) => p.meta);
    }

    async getPackage(pluginId: string) {
      return this.pkgs.get(pluginId)?.meta;
    }

    async fetchZipBuffer(pluginId: string) {
      const p = this.pkgs.get(pluginId);
      if (!p) throw new Error('Not found');
      return p.zipBuffer;
    }
  }

  it('社区仓库：未声明 integrity 被拒绝 (PluginIntegrityRequiredError)', async () => {
    const repo = new MockRepoAdapter('repo_comm', 'Community Repo', 'community');
    const zipBuf = await createPluginZip('ext-comm-no-hash');
    repo.add(
      {
        id: 'ext-comm-no-hash',
        name: 'ext-comm-no-hash',
        version: '1.0.0',
        description: 'test',
        repositoryId: 'repo_comm',
        // 无 integrity
      },
      zipBuf,
    );
    manager.registerRepository(repo);

    await expect(manager.installFromRepository('repo_comm', 'ext-comm-no-hash')).rejects.toThrow(
      PluginIntegrityRequiredError,
    );
  });

  it('社区仓库：有 integrity 但缺少 signature 被拒绝 (PluginAttestationRequiredError)', async () => {
    const repo = new MockRepoAdapter('repo_comm_2', 'Community Repo', 'community');
    const zipBuf = await createPluginZip('ext-comm-no-sig');
    const sha = computeSha256(zipBuf);
    repo.add(
      {
        id: 'ext-comm-no-sig',
        name: 'ext-comm-no-sig',
        version: '1.0.0',
        description: 'test',
        repositoryId: 'repo_comm_2',
        integrity: sha.hex,
        // 无 signature
      },
      zipBuf,
    );
    manager.registerRepository(repo);

    await expect(manager.installFromRepository('repo_comm_2', 'ext-comm-no-sig')).rejects.toThrow(
      PluginAttestationRequiredError,
    );
  });

  it('社区仓库：签名伪造或使用未知密钥被拒绝 (PluginSignatureInvalidError)', async () => {
    const repo = new MockRepoAdapter('repo_comm_3', 'Community Repo', 'community');
    const zipBuf = await createPluginZip('ext-comm-bad-sig');
    const sha = computeSha256(zipBuf);

    // 用另一对密钥签名
    const otherKey = crypto.generateKeyPairSync('ed25519');
    const badSig = signPayload(
      buildAttestationPayload(sha.hex, { id: 'ext-comm-bad-sig', version: '1.0.0' }),
      otherKey.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    );

    repo.add(
      {
        id: 'ext-comm-bad-sig',
        name: 'ext-comm-bad-sig',
        version: '1.0.0',
        description: 'test',
        repositoryId: 'repo_comm_3',
        integrity: sha.hex,
        signature: badSig,
      },
      zipBuf,
    );
    manager.registerRepository(repo);

    await expect(manager.installFromRepository('repo_comm_3', 'ext-comm-bad-sig')).rejects.toThrow(
      PluginSignatureInvalidError,
    );
  });

  it('社区仓库：同时具备合法 integrity 与有效 signature 时验签通过并进入安装链路', async () => {
    const repo = new MockRepoAdapter('repo_comm_ok', 'Community Repo', 'community');
    const zipBuf = await createPluginZip('ext-comm-ok');
    const sha = computeSha256(zipBuf);

    const validSig = signPayload(buildAttestationPayload(sha.hex, { id: 'ext-comm-ok', version: '1.0.0' }), privPem);

    repo.add(
      {
        id: 'ext-comm-ok',
        name: 'ext-comm-ok',
        version: '1.0.0',
        description: 'test',
        repositoryId: 'repo_comm_ok',
        integrity: sha.hex,
        signature: validSig,
        publisher: 'official-openlearn',
      },
      zipBuf,
    );
    manager.registerRepository(repo);

    // mock host.installPluginFromZip
    const installSpy = vi
      .spyOn(host, 'installPluginFromZip')
      .mockResolvedValue({ id: 'ext-comm-ok', pluginId: 'uuid-comm-ok' } as any);

    const result = await manager.installFromRepository('repo_comm_ok', 'ext-comm-ok');
    expect(result.pluginId).toBe('uuid-comm-ok');
    expect(installSpy).toHaveBeenCalled();
  });

  it('本地仓库：无签名直接放行进入安装', async () => {
    const repo = new LocalRepositoryAdapter('repo_local_test');
    const zipBuf = await createPluginZip('ext-local-test');
    repo.addPackage(
      {
        id: 'ext-local-test',
        name: 'ext-local-test',
        version: '1.0.0',
        description: 'test',
        repositoryId: 'repo_local_test',
      },
      zipBuf,
    );
    manager.registerRepository(repo);

    const installSpy = vi
      .spyOn(host, 'installPluginFromZip')
      .mockResolvedValue({ id: 'ext-local-test', pluginId: 'uuid-local-ok' } as any);

    const result = await manager.installFromRepository('repo_local_test', 'ext-local-test');
    expect(result.pluginId).toBe('uuid-local-ok');
    expect(installSpy).toHaveBeenCalled();
  });
});
