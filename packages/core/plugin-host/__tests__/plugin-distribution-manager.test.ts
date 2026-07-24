import { describe, it, expect, vi } from 'vitest';
import {
  PluginDistributionManager,
  LocalRepositoryAdapter,
  type PluginPackageMetadata,
} from '../plugin-distribution-manager.js';
import type { PluginHost } from '../index.js';
import { PluginCompositionModule } from '../../bootstrap/composition/plugin-composition-module.js';

describe('PluginDistributionManager (P7-B7 EU-01)', () => {
  const createMockPluginHost = () => ({
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
