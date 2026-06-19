import { describe, it, expect, beforeAll } from 'vitest';
import { Kernel } from '../kernel/index.js';
import { PluginState } from '../plugin-host/types.js';

describe('Kernel System Plugins Auto-loading', () => {
  let kernel: Kernel;

  beforeAll(async () => {
    // Clear existing built-in plugin rows if any to test insertion
    const tempKernel = new Kernel();
    await tempKernel.ready;
    const db = tempKernel.db;
    db.prepare("DELETE FROM plugins WHERE id = ?").run('@openlearn/plugin-vfs');
    db.prepare("DELETE FROM plugins WHERE id = ?").run('@openlearn/plugin-process');

    kernel = new Kernel();
    await kernel.ready;
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
