import { v7 as uuidv7 } from 'uuid';
import {
  ICommandBusServiceToken,
  IActionRegistryServiceToken,
  IEventBusServiceToken,
  IDatabaseToken,
} from '../core/di/interfaces.js';
import type { PluginContext } from '../core/plugin-host/types.js';

export const VfsPlugin = {
  manifest: {
    id: '@openlearn/plugin-vfs',
    name: '虚拟文件系统插件',
    version: '1.0.0',
    main: 'index.js',
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
    ],
    capabilitiesProposed: ['vfs:read', 'vfs:write'],
  },
  activate: async (ctx: PluginContext) => {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;
    const eventBus = ctx.services.eventBus;
    const db = await ctx.resolve(IDatabaseToken);

    function resolvePath(pathStr: string): { parentId: string | null; name: string } {
      const parts = pathStr.split('/').filter(Boolean);
      if (parts.length === 0) throw new Error('Invalid path');

      let currentParentId: string | null = null;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const pName = part;
        const node = db.prepare('SELECT * FROM vfs_nodes WHERE parent_id IS ? AND name = ? AND type = ?').get(currentParentId, pName, 'dir') as any;
        if (!node) {
          const newId = uuidv7();
          db.prepare('INSERT INTO vfs_nodes (id, parent_id, type, name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(newId, currentParentId, 'dir', pName, null, Date.now(), Date.now());
          currentParentId = newId;
        } else {
          currentParentId = node.id;
        }
      }
      return { parentId: currentParentId, name: parts[parts.length - 1] };
    }

    // 1. VFS WRITE
    const vfsWriteCmdType = 'vfs.write_file';
    await actionRegistry.register({
      id: 'core-vfs-write',
      commandType: vfsWriteCmdType,
      description: '使用绝对路径向虚拟文件系统写入文件',
      capabilityRequired: 'vfs:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          path: { type: 'STRING', description: '完整绝对路径（如 /Mathematics/formula.txt）' },
          content: { type: 'STRING', description: '文件内容' }
        },
        required: ['path', 'content']
      }
    });

    await commandBus.registerHandler(vfsWriteCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const { parentId, name } = resolvePath(payload.path);
        const fileId = uuidv7();

        db.prepare('DELETE FROM vfs_nodes WHERE parent_id IS ? AND name = ? AND type = ?').run(parentId, name, 'file');

        const stmt = db.prepare('INSERT INTO vfs_nodes (id, parent_id, type, name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
        stmt.run(fileId, parentId, 'file', name, payload.content, Date.now(), Date.now());

        await eventBus.publish({
          id: uuidv7(),
          type: 'vfs.file_written',
          source: 'builtin.vfs',
          payload: { fileId, path: payload.path },
          timestamp: Date.now(),
          correlationId: command.id
        });

        return { fileId };
      }
    });

    // 2. VFS READ BY PATH
    const vfsReadPathCmdType = 'vfs.read_file';
    await actionRegistry.register({
      id: 'core-vfs-read-path',
      commandType: vfsReadPathCmdType,
      description: '通过绝对路径读取虚拟文件系统中的文件',
      capabilityRequired: 'vfs:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          path: { type: 'STRING', description: '完整绝对路径（如 /Mathematics/formula.txt）' }
        },
        required: ['path']
      }
    });

    await commandBus.registerHandler(vfsReadPathCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const { parentId, name } = resolvePath(payload.path);
        const file = db.prepare('SELECT * FROM vfs_nodes WHERE parent_id IS ? AND name = ? AND type = ?').get(parentId, name, 'file') as any;
        if (!file) throw new Error(`File at path ${payload.path} not found`);
        return { content: file.content };
      }
    });

    // 3. VFS LIST DIR
    const vfsListDirCmdType = 'vfs.list_dir';
    await actionRegistry.register({
      id: 'core-vfs-list-dir',
      commandType: vfsListDirCmdType,
      description: '通过绝对路径列出虚拟文件系统中的目录内容',
      capabilityRequired: 'vfs:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          path: { type: 'STRING', description: '完整绝对目录路径（如 /Mathematics 或 /）' }
        },
        required: ['path']
      }
    });

    await commandBus.registerHandler(vfsListDirCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        let parentId: string | null = null;

        if (payload.path !== '/') {
          const res = resolvePath(payload.path);
          const dir = db.prepare('SELECT * FROM vfs_nodes WHERE parent_id IS ? AND name = ? AND type = ?').get(res.parentId, res.name, 'dir') as any;
          if (!dir) throw new Error(`Directory at path ${payload.path} not found`);
          parentId = dir.id;
        }

        const nodes = db.prepare('SELECT id, type, name, created_at FROM vfs_nodes WHERE parent_id IS ?').all(parentId);
        return { nodes };
      }
    });

    // 4. VFS MAKE DIR
    const vfsMkdirCmdType = 'vfs.mkdir';
    await actionRegistry.register({
      id: 'core-vfs-mkdir',
      commandType: vfsMkdirCmdType,
      description: '在虚拟文件系统中创建目录',
      capabilityRequired: 'vfs:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          path: { type: 'STRING', description: '完整绝对目录路径（如 /Mathematics/Algebra）' }
        },
        required: ['path']
      }
    });

    await commandBus.registerHandler(vfsMkdirCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const { parentId, name } = resolvePath(payload.path);
        let node = db.prepare('SELECT * FROM vfs_nodes WHERE parent_id IS ? AND name = ? AND type = ?').get(parentId, name, 'dir') as any;

        if (!node) {
          const dirId = uuidv7();
          const stmt = db.prepare('INSERT INTO vfs_nodes (id, parent_id, type, name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
          stmt.run(dirId, parentId, 'dir', name, null, Date.now(), Date.now());

          await eventBus.publish({
            id: uuidv7(),
            type: 'vfs.dir_created',
            source: 'builtin.vfs',
            payload: { dirId, path: payload.path },
            timestamp: Date.now(),
            correlationId: command.id
          });
          return { dirId };
        }

        return { dirId: node.id };
      }
    });
  },
  deactivate: async () => {
    // Handlers automatically disposed by ResourceTracker via buildContext
  }
};

/** @deprecated Deprecated in Phase 8. Built-in plugins are auto-loaded by the Kernel using PluginHost. */
export function bootstrapVFSPlugins() {
  // Deprecated. Left as no-op to support server.ts during Wave 1 transition.
}
