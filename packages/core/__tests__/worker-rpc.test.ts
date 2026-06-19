import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Kernel } from '../kernel/index.js';
import JSZip from 'jszip';

describe('Worker RPC and Event Forwarding', () => {
  let kernel: Kernel;

  beforeEach(async () => {
    kernel = new Kernel();
    await kernel.ready;
    // Clean up test nodes/classes and old test plugins if any
    try {
      kernel.db.prepare("DELETE FROM vfs_nodes WHERE id = 'node-rpc-test-id'").run();
      kernel.db.prepare("DELETE FROM classes WHERE name = 'Class from Worker RPC'").run();
      kernel.db.prepare("DELETE FROM plugins WHERE manifest LIKE '%ext-test-worker-rpc%'").run();
    } catch (e) {
      console.error("beforeEach cleanup error:", e);
    }
  });

  afterEach(async () => {
    const plugins = kernel.pluginHost.listPlugins();
    for (const p of plugins) {
      if (p.state === 'active') {
        try {
          await kernel.pluginHost.deactivatePlugin(p.id);
        } catch (e) {}
      }
    }
  });

  it('should forward events to worker and allow RPC database/command access', async () => {
    await kernel.ready;

    // Create a mock zip plugin on the fly
    const zip = new JSZip();
    const manifest = {
      id: 'ext-test-worker-rpc',
      name: 'Test Worker RPC',
      version: '1.0.0',
      main: 'index.js',
      requires: [
        '@openlearn/core:ICommandBusService@^1.0.0',
        '@openlearn/core:IEventBusService@^1.0.0',
        '@openlearn/core:IDatabase@^1.0.0'
      ],
      capabilitiesProposed: ['management:write']
    };

    const pluginCode = `
export default {
  activate: async (ctx) => {
    const commandBus = ctx.services.commandBus;
    const eventBus = ctx.services.eventBus;
    const db = await ctx.resolve('@openlearn/core:IDatabase');

    await eventBus.subscribe('test.trigger', async (event) => {
      // 1. Perform database insert via RPC
      db.prepare("INSERT INTO vfs_nodes (id, parent_id, type, name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run('node-rpc-test-id', null, 'file', 'rpc-test.txt', 'Hello from Worker RPC', Date.now(), Date.now());

      // 2. Perform command execution via RPC
      await commandBus.execute({
        id: 'cmd-from-worker-id',
        type: 'class.create',
        actorId: 'plugin:ext-test-worker-rpc',
        timestamp: Date.now(),
        payload: {
          name: 'Class from Worker RPC',
          description: 'Created by worker thread plugin via RPC proxy'
        }
      });
    });
  }
};
    `;

    zip.file('manifest.json', JSON.stringify(manifest));
    zip.file('index.js', pluginCode);

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    // Install zip
    await kernel.pluginHost.installPluginFromZip(zipBuffer);
    
    // Find the UUID of the installed plugin
    const list = kernel.pluginHost.listPlugins();
    const testPlugin = list.find(p => p.name === 'Test Worker RPC');
    expect(testPlugin).toBeDefined();

    // Set execution mode to worker and activate
    kernel.db.prepare('UPDATE plugins SET execution_mode = ? WHERE id = ?').run('worker', testPlugin!.id);
    await kernel.pluginHost.activatePlugin(testPlugin!.id);

    // Verify it is active
    expect(kernel.pluginHost.getPluginState(testPlugin!.id)).toBe('active');

    // Publish event on main thread
    await kernel.eventBus.publish({
      id: 'evt-trigger-id',
      type: 'test.trigger',
      source: 'test.main',
      payload: {},
      timestamp: Date.now()
    });

    // Wait a little bit for worker thread to process event and complete database writes/commands
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Verify database write succeeded (RPC database access checked!)
    const node = kernel.db.prepare('SELECT * FROM vfs_nodes WHERE id = ?').get('node-rpc-test-id') as any;
    expect(node).toBeDefined();
    expect(node.name).toBe('rpc-test.txt');

    // Verify class creation succeeded (RPC command execution and capabilities checked!)
    const classes = kernel.db.prepare('SELECT * FROM classes WHERE name = ?').all('Class from Worker RPC') as any[];
    expect(classes.length).toBeGreaterThan(0);
    expect(classes[0].description).toBe('Created by worker thread plugin via RPC proxy');
  });
});
