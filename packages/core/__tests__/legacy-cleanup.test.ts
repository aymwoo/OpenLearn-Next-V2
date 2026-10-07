import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Kernel } from '../kernel/index.js';
import fs from 'fs';
import path from 'path';
import { createPluginsDir, cleanupPluginsDir } from '../plugin-host/__tests__/helpers/plugins-dir.js';

describe('Legacy Cleanup (Phase 8)', () => {
  // Kernel 建在各个 it() 内部，故用 beforeEach/afterEach 而非 beforeAll/afterAll。
  // 每个用例都 new Kernel()，所以每例都需要一份独立的 pluginsDir。
  let pluginsDir: string;

  beforeEach(() => {
    pluginsDir = createPluginsDir('legacy-cleanup');
  });

  afterEach(() => {
    cleanupPluginsDir(pluginsDir);
  });

  it('should not have packages/core/plugin-runtime directory', () => {
    const runtimePath = path.resolve(process.cwd(), 'packages', 'core', 'plugin-runtime');
    expect(fs.existsSync(runtimePath)).toBe(false);
  });

  it('should not expose pluginRuntime on Kernel instance', () => {
    const kernel = new Kernel({ pluginsDir });
    expect((kernel as any).pluginRuntime).toBeUndefined();
    expect(kernel.pluginHost).toBeDefined();
  });

  it('should bootstrap the 6 built-in plugins automatically', async () => {
    const kernel = new Kernel({ pluginsDir });
    await kernel.ready;

    const plugins = kernel.pluginHost.listPlugins();
    // Verify we have at least the 6 system plugins
    expect(plugins.length).toBeGreaterThanOrEqual(6);

    const ids = plugins.map((p) => p.id);
    expect(ids).toContain('@openlearn/plugin-vfs');
    expect(ids).toContain('@openlearn/plugin-process');
    expect(ids).toContain('@openlearn/plugin-management');
    expect(ids).toContain('@openlearn/plugin-builtin');
    expect(ids).toContain('@openlearn/plugin-ai-planner');
    expect(ids).toContain('@openlearn/plugin-ai-submit-injector');

    // System plugins should be active
    const systemIds = [
      '@openlearn/plugin-vfs',
      '@openlearn/plugin-process',
      '@openlearn/plugin-management',
      '@openlearn/plugin-builtin',
      '@openlearn/plugin-ai-planner',
      '@openlearn/plugin-ai-submit-injector',
    ];

    for (const sysId of systemIds) {
      const p = plugins.find((pl) => pl.id === sysId);
      expect(p).toBeDefined();
      expect(p!.state).toBe('active');
    }
  });
});
