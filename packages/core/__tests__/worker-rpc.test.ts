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
      kernel.db.prepare("DELETE FROM vfs_nodes WHERE name = 'cookie_test_result.txt'").run();
      kernel.db.prepare("DELETE FROM classes WHERE name = 'Class from Worker RPC'").run();
      kernel.db.prepare("DELETE FROM plugins WHERE manifest LIKE '%ext-test-worker-rpc%'").run();
      kernel.db.prepare("DELETE FROM plugins WHERE manifest LIKE '%ext-test-dynamic-dep%'").run();
      kernel.db.prepare("DELETE FROM plugins WHERE manifest LIKE '%ext-test-state-inherit%'").run();
      kernel.db.prepare("DELETE FROM plugins WHERE manifest LIKE '%ext-test-alias-resolve%'").run();
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

  it('应该支持插件通过 manifest.json 声明 dependencies 并在沙箱中成功 require 动态加载它们', async () => {
    const zip = new JSZip();
    const manifest = {
      id: 'ext-test-dynamic-dep',
      name: 'Test Dynamic Dependency',
      version: '1.0.0',
      description: 'Tests dynamic npm dependencies auto-installation and loading inside Worker sandbox',
      main: 'index.js',
      requires: [
        '@openlearn/core:ICommandBusService@^1.0.0'
      ],
      capabilitiesProposed: ['vfs:write'],
      dependencies: {
        'cookie': '^0.5.0'
      }
    };

    const pluginCode = `
export default {
  activate: async (ctx) => {
    console.log('[Test Worker] Activating with dynamic dependency test...');
    try {
      const cookie = ctx.require('cookie');
      const parsed = cookie.parse('foo=bar');
      console.log('[Test Worker] Successfully required and called cookie:', JSON.stringify(parsed));
      
      const commandBus = ctx.services.commandBus;
      await commandBus.execute({
        id: 'cmd-write-cookie-success',
        type: 'vfs.write_file',
        actorId: 'plugin:ext-test-dynamic-dep',
        payload: {
          path: '/cookie_test_result.txt',
          content: 'Parsed foo=' + parsed.foo
        }
      });
    } catch (err) {
      console.error('[Test Worker] Failed to load dependency:', err.message);
    }
  }
};
    `;

    zip.file('manifest.json', JSON.stringify(manifest));
    zip.file('index.js', pluginCode);

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    // Install zip (this will trigger npm install in the pluginDir)
    await kernel.pluginHost.installPluginFromZip(zipBuffer);

    // Find the UUID of the installed plugin
    const list = kernel.pluginHost.listPlugins();
    const testPlugin = list.find(p => p.name === 'Test Dynamic Dependency');
    expect(testPlugin).toBeDefined();

    // Set execution mode to worker and activate
    kernel.db.prepare('UPDATE plugins SET execution_mode = ? WHERE id = ?').run('worker', testPlugin!.id);
    await kernel.pluginHost.activatePlugin(testPlugin!.id);

    // Verify it is active
    expect(kernel.pluginHost.getPluginState(testPlugin!.id)).toBe('active');

    // Wait a little bit for worker thread to process and write to VFS
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify that the file was written to VFS with the expected content
    const fileResult = kernel.db.prepare("SELECT content FROM vfs_nodes WHERE name = 'cookie_test_result.txt'").get() as { content: string } | undefined;
    expect(fileResult).toBeDefined();
    expect(fileResult!.content).toBe('Parsed foo=bar');
  }, 120000);

  it('应该支持 Worker 模式插件在热重载时成功传递并继承内存运行状态', async () => {
    const zip = new JSZip();
    const manifest = {
      id: 'ext-test-state-inherit',
      name: 'Test State Inheritance',
      version: '1.0.0',
      description: 'Tests memory state inheritance during worker hot reload',
      main: 'index.js',
      requires: [
        '@openlearn/core:ICommandBusService@^1.0.0'
      ],
      capabilitiesProposed: ['vfs:write']
    };

    const pluginCodeV1 = `
export default {
  manifest: {
    id: "ext-test-state-inherit",
    name: "Test State Inheritance",
    version: "1.0.0",
    main: "index.js",
    capabilitiesProposed: ["vfs:write"]
  },
  activate: async (ctx, prevState) => {
    globalThis.count = prevState ? prevState.count : 0;
    const commandBus = ctx.services.commandBus;
    await commandBus.registerHandler('test.increment', {
      execute: async () => {
        globalThis.count += 10;
        return { count: globalThis.count };
      }
    });
  },
  deactivate: async () => {
    return { count: globalThis.count };
  }
};
    `;

    zip.file('manifest.json', JSON.stringify(manifest));
    zip.file('index.js', pluginCodeV1);

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    // Install zip
    await kernel.pluginHost.installPluginFromZip(zipBuffer);

    // Find the UUID of the installed plugin
    const list = kernel.pluginHost.listPlugins();
    const testPlugin = list.find(p => p.name === 'Test State Inheritance');
    expect(testPlugin).toBeDefined();

    // Set execution mode to worker and activate
    kernel.db.prepare('UPDATE plugins SET execution_mode = ? WHERE id = ?').run('worker', testPlugin!.id);
    await kernel.pluginHost.activatePlugin(testPlugin!.id);

    // Verify it is active
    expect(kernel.pluginHost.getPluginState(testPlugin!.id)).toBe('active');

    // Run increment command to modify the count state in Worker (0 -> 10)
    const result1 = await kernel.commandBus.execute({
      id: 'cmd-inc-1',
      type: 'test.increment',
      actorId: 'user-teacher',
      payload: {}
    }) as any;
    expect(result1.count).toBe(10);

    // Prepare updated source code (version 2.0.0)
    const pluginCodeV2 = `
export default {
  manifest: {
    id: "ext-test-state-inherit",
    name: "Test State Inheritance",
    version: "2.0.0",
    main: "index.js",
    capabilitiesProposed: ["vfs:write"]
  },
  activate: async (ctx, prevState) => {
    globalThis.count = prevState ? prevState.count : 0;
    const commandBus = ctx.services.commandBus;
    await commandBus.registerHandler('test.increment', {
      execute: async () => {
        globalThis.count += 5; // V2 increments by 5
        return { count: globalThis.count };
      }
    });
  },
  deactivate: async () => {
    return { count: globalThis.count };
  }
};
    `;

    // Run hot reload on worker-mode plugin
    await kernel.pluginHost.reloadPlugin(testPlugin!.id, pluginCodeV2);

    // Wait a little bit for the new worker thread to boot and register its handler
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Run increment command again on the reloaded worker (should increment from 10 to 15)
    const result2 = await kernel.commandBus.execute({
      id: 'cmd-inc-2',
      type: 'test.increment',
      actorId: 'user-teacher',
      payload: {}
    }) as any;
    expect(result2.count).toBe(15);
  }, 40000);

  it('应该支持通过 manifest.id 别名解析为真实 DB UUID (resolvePluginUuid)', async () => {
    await kernel.ready;

    // Install a minimal inline plugin directly via pluginHost (bypasses capability guard — testing alias logic, not security)
    const manifestId = 'ext-test-alias-resolve';
    const sourceCode = `
export default {
  manifest: {
    id: '${manifestId}',
    name: 'Alias Resolve Test',
    version: '1.0.0',
    main: 'index.js',
    requires: [],
    capabilitiesProposed: []
  },
  activate: async (ctx) => {},
  deactivate: async () => {}
};`;
    await kernel.pluginHost.installPlugin(sourceCode);

    // Resolve from manifest ID immediately after install to get the DB UUID
    const dbUuid = kernel.pluginHost.resolvePluginUuid(manifestId);
    expect(dbUuid).toBeTruthy();
    // Must not equal the manifest ID itself (i.e. actually resolved to a UUID)
    expect(dbUuid).not.toBe(manifestId);

    // 1. resolvePluginUuid by manifest ID should return the DB UUID
    const resolved = kernel.pluginHost.resolvePluginUuid(manifestId);
    expect(resolved).toBe(dbUuid);

    // 2. resolvePluginUuid by DB UUID should round-trip correctly
    const resolvedFromUuid = kernel.pluginHost.resolvePluginUuid(dbUuid);
    expect(resolvedFromUuid).toBe(dbUuid);

    // 3. plugin.info command should work with manifest ID alias
    //    (plugin:read is open to all authenticated actors, so no capability grant needed)
    const infoResult = await kernel.commandBus.execute({
      id: 'cmd-alias-info',
      type: 'plugin.info',
      actorId: 'agent-system-0',
      payload: { pluginId: manifestId }
    }) as any;
    expect(infoResult.id).toBe(dbUuid);
    expect(infoResult.manifestId).toBe(manifestId);

    // 4. plugin.info command should also work with DB UUID
    const infoByUuid = await kernel.commandBus.execute({
      id: 'cmd-uuid-info',
      type: 'plugin.info',
      actorId: 'agent-system-0',
      payload: { pluginId: dbUuid }
    }) as any;
    expect(infoByUuid.manifestId).toBe(manifestId);

    // Cleanup
    kernel.db.prepare("DELETE FROM plugins WHERE manifest LIKE '%ext-test-alias-resolve%'").run();
  }, 20000);
});
