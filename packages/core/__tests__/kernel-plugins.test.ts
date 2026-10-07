import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kernel } from '../kernel/index.js';
import { PluginState } from '../plugin-host/types.js';
import { createPluginsDir, cleanupPluginsDir } from '../plugin-host/__tests__/helpers/plugins-dir.js';

describe('Kernel System Plugins Auto-loading', () => {
  let kernel: Kernel;
  let pluginsDir: string;

  beforeAll(async () => {
    // 必须传 pluginsDir：Kernel 默认写 <cwd>/plugins，会把插件产物堆进工作树
    // （H-1：实测已积累 1705 个孤儿目录 / 24MB，且被 .gitignore 忽略故 git status 看不见）
    pluginsDir = createPluginsDir('kernel-plugins');
    kernel = new Kernel({ pluginsDir });
    await kernel.ready;
  });

  afterAll(() => {
    cleanupPluginsDir(pluginsDir);
  });

  it('should automatically insert system plugins into the plugins table', () => {
    const vfsRow = kernel.db.prepare('SELECT * FROM plugins WHERE id = ?').get('@openlearn/plugin-vfs') as any;
    const processRow = kernel.db.prepare('SELECT * FROM plugins WHERE id = ?').get('@openlearn/plugin-process') as any;

    expect(vfsRow).toBeDefined();
    expect(vfsRow.execution_mode).toBe('inline');
    expect(vfsRow.loader_version).toBe('esm');

    expect(processRow).toBeDefined();
    expect(processRow.execution_mode).toBe('inline');
    expect(processRow.loader_version).toBe('esm');
  });

  it('should automatically register and activate system plugins in PluginHost', () => {
    const vfsState = kernel.pluginHost.getPluginState('@openlearn/plugin-vfs');
    const processState = kernel.pluginHost.getPluginState('@openlearn/plugin-process');

    expect(vfsState).toBe(PluginState.ACTIVE);
    expect(processState).toBe(PluginState.ACTIVE);
  });
});
