import { Kernel } from '../kernel/index.js';
import { v7 as uuidv7 } from 'uuid';
import vm from 'vm';

export class PluginRuntime {
  constructor(private kernel: Kernel) {}
  
  public get loadedPlugins() {
    return this.kernel.db.prepare('SELECT id, name, manifest, status, created_at FROM plugins ORDER BY created_at DESC').all();
  }

  public async loadFromDB() {
    const plugins = this.kernel.db.prepare('SELECT * FROM plugins WHERE status = ?').all('active') as any[];
    for (const p of plugins) {
       try {
          await this.evaluateAndActivate(p.source_code);
       } catch (e) {
          console.error(`Failed to activate plugin ${p.name}:`, e);
       }
    }
  }

  public async installPlugin(sourceCode: string) {
     const pluginObj = await this.evaluateAndActivate(sourceCode);
     const manifest = pluginObj.manifest;
     
     const id = uuidv7();
     const stmt = this.kernel.db.prepare('INSERT INTO plugins (id, name, manifest, source_code, status, created_at) VALUES (?, ?, ?, ?, ?, ?)');
     stmt.run(id, manifest.name, JSON.stringify(manifest), sourceCode, 'active', Date.now());
     
     return manifest;
  }

  public async togglePlugin(id: string) {
    const plugin = this.kernel.db.prepare('SELECT * FROM plugins WHERE id = ?').get(id) as any;
    if (!plugin) throw new Error('Plugin not found');
    
    const newStatus = plugin.status === 'active' ? 'disabled' : 'active';
    this.kernel.db.prepare('UPDATE plugins SET status = ? WHERE id = ?').run(newStatus, id);
    return newStatus;
  }

  private async evaluateAndActivate(sourceCode: string) {
     const context = {
        ctx: {
          commandBus: this.kernel.commandBus,
          eventBus: this.kernel.eventBus,
          actionRegistry: this.kernel.actionRegistry,
          processManager: this.kernel.processManager
        },
        exports: {} as any
     };

     vm.createContext(context);
     
     const script = new vm.Script(`
        ${sourceCode};
        exports.default = exports.default || exports;
     `);

     script.runInContext(context, { timeout: 1000 });
     
     const plugin = context.exports.default;
     if (!plugin || !plugin.manifest || !plugin.activate) {
        throw new Error('Invalid plugin format: missing manifest or activate function.');
     }
     
     await plugin.activate(context.ctx);
     return plugin;
  }
}

