import { describe, it, expect, vi } from 'vitest';
import {
  PluginDistributionManager,
  LocalRepositoryAdapter,
  type PluginPackageMetadata,
} from '../plugin-distribution-manager.js';
import type { PluginHost } from '../index.js';
import { PluginCompositionModule } from '../../bootstrap/composition/plugin-composition-module.js';

describe('PluginDistributionManager (P7-B7 EU-01)', () => {
  const createMockPluginHost = () =>
    ({
      installPluginFromZip: vi.fn().mockResolvedValue({ id: 'ext-quiz-test', name: 'Quiz Test' }),
      reloadPlugin: vi.fn().mockResolvedValue(undefined),
      uninstallPlugin: vi.fn().mockResolvedValue(undefined),
    }) as unknown as PluginHost;

  it('should register repository adapters and aggregate available packages', async () => {
    const mockHost = createMockPluginHost();
    const manager = new PluginDistributionManager(mockHost);

    const repo = new LocalRepositoryAdapter('repo_official', 'Official Repo');
    const sampleMeta: PluginPackageMetadata = {
      id: 'ext-quiz-test',
      name: 'Quiz Test',
      version: '1.0.0',
      description: 'Sample quiz plugin',
      repositoryId: 'repo_official',
    };
    repo.addPackage(sampleMeta, Buffer.from('pkghandle'));

    manager.registerRepository(repo);
    expect(manager.listRepositories().length).toBe(1);

    const available = await manager.listAvailablePackages();
    expect(available.length).toBe(1);
    expect(available[0].id).toBe('ext-quiz-test');
  });

  it('should orchestrate package installation from repository', async () => {
    const mockHost = createMockPluginHost();
    const manager = new PluginDistributionManager(mockHost);

    const repo = new LocalRepositoryAdapter('repo_local', 'Local Repo');
    repo.addPackage(
      {
        id: 'ext-vote',
        name: 'Vote Plugin',
        version: '1.0.0',
        description: 'Vote plugin',
        repositoryId: 'repo_local',
      },
      Buffer.from('dummy_zip_content'),
    );
    manager.registerRepository(repo);

    const res = await manager.installFromRepository('repo_local', 'ext-vote');
    expect(res.pluginId).toBe('ext-quiz-test');
    expect(mockHost.installPluginFromZip).toHaveBeenCalled();
  });

  it('should verify SHA-256 integrity when specified on package metadata', async () => {
    const mockHost = createMockPluginHost();
    const manager = new PluginDistributionManager(mockHost);
    const repo = new LocalRepositoryAdapter('repo_secure', 'Secure Repo');

    const zipBuffer = Buffer.from('secure_payload_bytes');
    const crypto = await import('node:crypto');
    const validHash = crypto.createHash('sha256').update(zipBuffer).digest('hex');

    repo.addPackage(
      {
        id: 'ext-secure',
        name: 'Secure Plugin',
        version: '1.0.0',
        description: 'Secure plugin',
        repositoryId: 'repo_secure',
        integrity: validHash,
      },
      zipBuffer,
    );
    manager.registerRepository(repo);

    const res = await manager.installFromRepository('repo_secure', 'ext-secure');
    expect(res.pluginId).toBe('ext-quiz-test');
  });

  it('should reject installation if SHA-256 integrity hash does not match (anti-tamper)', async () => {
    const mockHost = createMockPluginHost();
    const manager = new PluginDistributionManager(mockHost);
    const repo = new LocalRepositoryAdapter('repo_tampered', 'Tampered Repo');

    repo.addPackage(
      {
        id: 'ext-tampered',
        name: 'Tampered Plugin',
        version: '1.0.0',
        description: 'Tampered plugin',
        repositoryId: 'repo_tampered',
        integrity: 'sha256-invalid_digest_base64_tampered==',
      },
      Buffer.from('tampered_content'),
    );
    manager.registerRepository(repo);

    await expect(manager.installFromRepository('repo_tampered', 'ext-tampered')).rejects.toThrow(
      /Integrity verification failed for plugin "ext-tampered"/i,
    );
  });

  it('should report health and register in PluginCompositionModule', () => {
    const mockHost = createMockPluginHost();
    const manager = new PluginDistributionManager(mockHost);

    const health = manager.health();
    expect(health.isHealthy).toBe(true);

    const module = new PluginCompositionModule();
    const refs = new Map<string, unknown>();
    refs.set('distributionManager', manager);

    expect(() => {
      module.compose({ infrastructureRefs: refs });
    }).not.toThrow();
  });
});
