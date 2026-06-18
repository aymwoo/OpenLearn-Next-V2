import { Kernel } from '../kernel/index.js';
import type { ActionDescriptor } from '../registry/index.js';
import type { CommandHandler } from '../command-bus/index.js';
import { v7 as uuidv7 } from 'uuid';
import vm from 'vm';
import { EsmLoader, EsmActivationError, EsmLoadTimeoutError } from '../esm-loader/index.js';
import { validateAndBundleZip } from '../esm-loader/install-utils.js';
import { PluginHost } from '../plugin-host/index.js';

type PluginRegistration = {
  actions: string[];
  commandTypes: string[];
  eventSubscriptions: Array<{ eventType: string; subscriber: any }>;
  processHandlers: string[];
  spawnedProcessIds: string[];
  actorId: string;
};

export class PluginRuntime {
  private activePluginRegistrations = new Map<string, PluginRegistration>();
  private pluginHost: PluginHost;

  /**
   * D-01, D-13: 构造函数接收可选的 pluginHost 参数。
   *
   * 如果未提供 pluginHost，延迟创建（向后兼容）。
   * PluginHost 需要 serviceRegistry、esmLoader 和 db。
   *
   * @param kernel - Kernel 实例（向后兼容一直需要）
   * @param esmLoader - EsmLoader 实例（可选，用于 ESM 加载分支）
   * @param pluginHost - PluginHost 实例（可选，惰性创建）
   */
  constructor(private kernel: Kernel, private esmLoader?: EsmLoader, pluginHost?: PluginHost) {
    this.pluginHost = pluginHost ?? new PluginHost(
      (kernel as any).serviceRegistry,
      esmLoader!,
      kernel.db,
    );
  }
  
  public get loadedPlugins() {
    return this.kernel.db.prepare('SELECT id, name, manifest, status, created_at FROM plugins ORDER BY created_at DESC').all();
  }

  /**
   * D-13: 从数据库恢复插件。
   *
   * - ESM 插件委托给 PluginHost.restoreActivePlugins()
   * - vm 插件保留 evaluateAndActivate 调用
   * - 错误处理保持与现有实现一致
   */
  public async loadFromDB() {
    const plugins = this.kernel.db.prepare('SELECT * FROM plugins WHERE status = ?').all('active') as any[];
    for (const p of plugins) {
       try {
          const loaderVersion = p.loader_version ?? 'vm';
          if (loaderVersion === 'esm' && this.esmLoader) {
            // ESM 插件：委托给 PluginHost.activatePlugin
            await this.pluginHost.activatePlugin(p.id);
          } else if (loaderVersion === 'esm' && !this.esmLoader) {
            console.error(`[PluginRuntime] Plugin ${p.name} requires ESM loader but no esmLoader injected — skipping activation`);
          } else {
            await this.evaluateAndActivate(p.source_code, p.id);
          }
       } catch (e) {
          console.error(`Failed to activate plugin ${p.name}:`, e);
       }
    }

    // 额外从 PluginHost 恢复所有 active ESM 插件（冗余但安全的双保险）
    if (this.esmLoader) {
      await this.pluginHost.restoreActivePlugins();
    }
  }

  /**
   * D-13: 安装插件 — 委托给 PluginHost。
   *
   * 保留现有公共签名，内部委托给 PluginHost.installPlugin
   * + activatePlugin 以匹配现有行为（安装后立即激活）。
   */
  public async installPlugin(sourceCode: string): Promise<any> {
     try {
       // 委托给 PluginHost：安装到 DB（状态 INSTALLED）
       const manifest = await this.pluginHost.installPlugin(sourceCode);

       // 安装后立即激活（匹配现有 PluginRuntime 行为）
       // 从 DB 获取 pluginId（manifest.id 用于查询）
       const row = this.kernel.db.prepare(
         'SELECT id FROM plugins WHERE manifest LIKE ? ORDER BY created_at DESC LIMIT 1'
       ).get(`%"id":"${manifest.id}"%`) as any;
       if (row) {
         await this.pluginHost.activatePlugin(row.id);
       }

       return manifest;
     } catch (err) {
       throw err;
     }
  }

  /**
   * Install plugin from ZIP buffer — ESM 安装路径。
   *
   * D-13: 委托给 PluginHost.installPluginFromZip + activatePlugin
   * 以匹配现有行为（安装后立即激活）。
   *
   * @param zipBuffer - ZIP 文件的原始字节
   * @returns plugin manifest
   */
  public async installPluginFromZip(zipBuffer: Buffer): Promise<any> {
    if (!this.esmLoader) {
      throw new Error('Cannot install ZIP plugin: no esmLoader injected');
    }

    try {
      // 委托给 PluginHost：安装到 DB（状态 INSTALLED）
      const manifest = await this.pluginHost.installPluginFromZip(zipBuffer);

      // 安装后立即激活（匹配现有 PluginRuntime 行为）
      const row = this.kernel.db.prepare(
        'SELECT id FROM plugins WHERE manifest LIKE ? ORDER BY created_at DESC LIMIT 1'
      ).get(`%"id":"${manifest.id}"%`) as any;
      if (row) {
        await this.pluginHost.activatePlugin(row.id);
      }

      return manifest;
    } catch (err) {
      throw err;
    }
  }

  /**
   * D-13: 切换插件状态。
   *
   * 根据 loader_version 区分 vm 插件（使用 evaluateAndActivate）
   * 和 ESM 插件（委托给 PluginHost.activatePlugin / deactivatePlugin）。
   */
  public async togglePlugin(id: string): Promise<string> {
     const plugin = this.kernel.db.prepare('SELECT * FROM plugins WHERE id = ?').get(id) as any;
     if (!plugin) throw new Error('Plugin not found');

     const loaderVersion: string = plugin.loader_version ?? 'vm';
     const newStatus = plugin.status === 'active' ? 'disabled' : 'active';
     if (newStatus === 'disabled') {
       // 停用：区分 vm 和 ESM
       if (loaderVersion === 'esm') {
         await this.pluginHost.deactivatePlugin(plugin.id);
       } else {
         this.deactivatePlugin(plugin.id);
       }
     } else {
       // 激活：区分 vm 和 ESM
       if (loaderVersion === 'esm') {
         await this.pluginHost.activatePlugin(plugin.id);
       } else {
         await this.evaluateAndActivate(plugin.source_code, plugin.id);
       }
     }

     this.kernel.db.prepare('UPDATE plugins SET status = ? WHERE id = ?').run(newStatus, id);
     return newStatus;
  }

  /**
   * D-13: 卸载插件 — 委托给 PluginHost。
   *
   * 先调用 deactivatePlugin（清理运行时资源），
   * 再委托给 PluginHost.uninstallPlugin（处理 DB 删除）。
   */
  public async uninstallPlugin(id: string): Promise<void> {
     const plugin = this.kernel.db.prepare('SELECT * FROM plugins WHERE id = ?').get(id) as any;
     if (!plugin) throw new Error('Plugin not found');

     // 先清理运行时资源
     this.deactivatePlugin(id);

     // 委托给 PluginHost 处理 DB 删除
     await this.pluginHost.uninstallPlugin(id);
  }

  /**
   * D-13: 停用插件 — 区分 vm 和 ESM 插件。
   *
   * - ESM 插件：委托给 PluginHost.deactivatePlugin
   * - vm 插件：保留现有清理逻辑
   *
   * 区分方式：检查 pluginHost.getPluginState 返回值。
   *   如果返回非 undefined，表示该插件由 PluginHost 追踪 → ESM 插件。
   *   否则使用现有 vm cleanup。
   */
  private deactivatePlugin(pluginId: string) {
    // ESM 插件 — 委托给 PluginHost
    if (this.pluginHost.getPluginState(pluginId) !== undefined) {
      // 异步委托，但不等待结果（保持与现有同步 deactivatePlugin 签名兼容）
      this.pluginHost.deactivatePlugin(pluginId).catch((err) => {
        console.error(`[PluginRuntime] PluginHost.deactivatePlugin failed for ${pluginId}:`, err);
      });
      return;
    }

    // vm 插件 — 保留现有清理逻辑
    const registration = this.activePluginRegistrations.get(pluginId);
    if (!registration) return;

    // Unregister actions and command handlers
    registration.actions.forEach(actionId => {
      try {
        this.kernel.actionRegistry.unregister(actionId);
      } catch (e) {
        console.error(`Error unregistering action ${actionId}:`, e);
      }
    });

    registration.commandTypes.forEach(commandType => {
      try {
        this.kernel.commandBus.unregisterHandler(commandType);
      } catch (e) {
        console.error(`Error unregistering command handler ${commandType}:`, e);
      }
    });

    // Unsubscribe event listeners
    registration.eventSubscriptions.forEach(sub => {
      try {
        this.kernel.eventBus.unsubscribe(sub.eventType, sub.subscriber);
      } catch (e) {
        console.error(`Error unsubscribing event ${sub.eventType}:`, e);
      }
    });

    // Unregister process handlers
    registration.processHandlers.forEach(taskType => {
      try {
        this.kernel.processManager.unregisterHandler(taskType);
      } catch (e) {
        console.error(`Error unregistering process handler ${taskType}:`, e);
      }
    });

    // Kill spawned intervals/processes
    registration.spawnedProcessIds.forEach(processId => {
      try {
        this.kernel.processManager.kill(processId);
      } catch (e) {
        console.error(`Error killing process ${processId}:`, e);
      }
    });

    // Revoke capabilities
    try {
      this.kernel.capabilityGuard.revokeAll(registration.actorId);
    } catch (e) {
      console.error(`Error revoking capabilities for ${registration.actorId}:`, e);
    }

    this.activePluginRegistrations.delete(pluginId);
  }

  private ensureUniqueManifestId(manifestId: string) {
    const existing = this.kernel.db.prepare('SELECT id, manifest FROM plugins').all() as any[];
    for (const plugin of existing) {
      try {
        const manifest = JSON.parse(plugin.manifest);
        if (manifest.id === manifestId) {
          throw new Error(`Plugin manifest id "${manifestId}" is already installed.`);
        }
      } catch (err: any) {
        if (err.message?.includes('already installed')) throw err;
      }
    }
  }

  /**
   * ESM 加载路径 — 委托给 PluginHost.activatePlugin。
   *
   * D-14: evaluateAndActivateEsm 简化为委托调用。
   * PluginHost 处理 EsmLoader、context building、activate 超时和 cleanup。
   *
   * 保留私有签名以向后兼容（evaluateAndActivateEsm 仍被 loadFromDB 的旧路径调用）。
   */
  private async evaluateAndActivateEsm(sourceCode: string, pluginId: string): Promise<any> {
    this.deactivatePlugin(pluginId);
    await this.pluginHost.activatePlugin(pluginId);

    // 从 DB 获取 manifest 以返回 plugin 对象（保持调用方兼容）
    const row = this.kernel.db.prepare(
      'SELECT manifest FROM plugins WHERE id = ?'
    ).get(pluginId) as any;
    if (row) {
      try {
        return { manifest: JSON.parse(row.manifest) };
      } catch {}
    }
    return { manifest: { id: pluginId } };
  }

  // [legacy vm path — remove in Phase 8]
  private async evaluateAndActivate(sourceCode: string, pluginId: string) {
     this.deactivatePlugin(pluginId);

     // First compile/run the script in a lightweight context to get the manifest
     const preContext = {
        exports: {} as any
     };
     vm.createContext(preContext);
     const preScript = new vm.Script(`
        ${sourceCode};
        exports.default = exports.default || exports;
     `);
     preScript.runInContext(preContext, { timeout: 1000 });
     const prePlugin = preContext.exports.default;
     if (!prePlugin || !prePlugin.manifest || !prePlugin.activate) {
        throw new Error('Invalid plugin format: missing manifest or activate function.');
     }
     const manifest = prePlugin.manifest;
     if (!manifest.id || !manifest.name) {
        throw new Error('Invalid plugin manifest: id and name are required.');
     }
     if (typeof prePlugin.activate !== 'function') {
        throw new Error('Invalid plugin format: activate must be a function.');
     }

     const actorId = `plugin:${manifest.id}`;

     // Grant capabilities to the actor
     if (Array.isArray(manifest.capabilitiesProposed)) {
       for (const cap of manifest.capabilitiesProposed) {
         this.kernel.capabilityGuard.grant(actorId, cap);
       }
     }

     const registration: PluginRegistration = {
       actions: [],
       commandTypes: [],
       eventSubscriptions: [],
       processHandlers: [],
       spawnedProcessIds: [],
       actorId
     };

     // Helper to sever prototype and block constructor chain leaks
     const createSafeFunction = (fn: Function) => {
       const safeFn = (...args: any[]) => {
         return fn(...args);
       };
       Object.setPrototypeOf(safeFn, null);
       Object.defineProperty(safeFn, 'constructor', {
         value: undefined,
         writable: false,
         configurable: false
       });
       return safeFn;
     };

     // Wrap EventBus
     const wrappedEventBus = {
       subscribe: createSafeFunction((eventType: string, subscriber: any) => {
         const safeSubscriber = (event: any) => {
           try {
             return subscriber(event);
           } catch (e) {
             console.error(`[Plugin:${manifest.id}] Error in event subscriber for ${eventType}:`, e);
           }
         };
         this.kernel.eventBus.subscribe(eventType, safeSubscriber);
         registration.eventSubscriptions.push({ eventType, subscriber: safeSubscriber });
       }),
       unsubscribe: createSafeFunction((eventType: string, subscriber: any) => {
         const idx = registration.eventSubscriptions.findIndex(
           s => s.eventType === eventType && s.subscriber === subscriber
         );
         if (idx !== -1) {
           const { subscriber: wrapper } = registration.eventSubscriptions[idx];
           this.kernel.eventBus.unsubscribe(eventType, wrapper);
           registration.eventSubscriptions.splice(idx, 1);
         }
       }),
       publish: createSafeFunction(async (event: any) => {
         const enrichedEvent = {
           ...event,
           source: event.source ? `plugin:${manifest.id}.${event.source}` : `plugin:${manifest.id}`
         };
         return this.kernel.eventBus.publish(enrichedEvent);
       })
     };

     // Wrap CommandBus
     const wrappedCommandBus = {
       registerHandler: createSafeFunction((commandType: string, handler: CommandHandler) => {
         const safeHandler: CommandHandler = {
           execute: async (command) => {
             try {
               return await handler.execute(command);
             } catch (e) {
               console.error(`[Plugin:${manifest.id}] Error executing command ${commandType}:`, e);
               throw e;
             }
           }
         };
         this.kernel.commandBus.registerHandler(commandType, safeHandler);
         registration.commandTypes.push(commandType);
       }),
       createCommand: createSafeFunction((type: string, payload: any, metadata?: any) => {
         return this.kernel.commandBus.createCommand(type, payload, actorId, metadata);
       }),
       execute: createSafeFunction(async (command: any) => {
         const cmdWithActor = {
           ...command,
           actorId: actorId
         };
         return this.kernel.commandBus.execute(cmdWithActor);
       })
     };

     // Wrap ProcessManager
     const wrappedProcessManager = {
       registerHandler: createSafeFunction((taskType: string, handler: any) => {
         const safeHandler = async (processId: string, payload: any, state: any, log: any, updateState: any) => {
           try {
             await handler(processId, payload, state, log, updateState);
           } catch (e: any) {
             console.error(`[Plugin:${manifest.id}] Error in process handler ${taskType}:`, e);
             throw e;
           }
         };
         this.kernel.processManager.registerHandler(taskType, safeHandler);
         registration.processHandlers.push(taskType);
       }),
       registerInterval: createSafeFunction((name: string, intervalMs: number, tickFn: any) => {
         const processId = this.kernel.processManager.registerInterval(name, intervalMs, (log) => {
           try {
             tickFn(log);
           } catch (e) {
             console.error(`[Plugin:${manifest.id}] Error in interval task ${name}:`, e);
           }
         });
         registration.spawnedProcessIds.push(processId);
         return processId;
       }),
       kill: createSafeFunction((processId: string) => {
         this.kernel.processManager.kill(processId);
         const idx = registration.spawnedProcessIds.indexOf(processId);
         if (idx !== -1) {
           registration.spawnedProcessIds.splice(idx, 1);
         }
       })
     };

     // Wrap ActionRegistry
     const wrappedActionRegistry = {
       register: createSafeFunction((descriptor: ActionDescriptor) => {
         this.kernel.actionRegistry.register(descriptor);
         registration.actions.push(descriptor.id);
       }),
       unregister: createSafeFunction((id: string) => {
         this.kernel.actionRegistry.unregister(id);
         const idx = registration.actions.indexOf(id);
         if (idx !== -1) registration.actions.splice(idx, 1);
       }),
       getAllActions: createSafeFunction(this.kernel.actionRegistry.getAllActions.bind(this.kernel.actionRegistry)),
       getActionByToolName: createSafeFunction(this.kernel.actionRegistry.getActionByToolName.bind(this.kernel.actionRegistry)),
       getActionByCommandType: createSafeFunction(this.kernel.actionRegistry.getActionByCommandType.bind(this.kernel.actionRegistry))
     };

     // Safe console proxy
     const safeConsole = {
       log: createSafeFunction((...args: any[]) => console.log(`[Plugin:${manifest.id}]`, ...args)),
       error: createSafeFunction((...args: any[]) => console.error(`[Plugin:${manifest.id}]`, ...args)),
       warn: createSafeFunction((...args: any[]) => console.warn(`[Plugin:${manifest.id}]`, ...args)),
       info: createSafeFunction((...args: any[]) => console.info(`[Plugin:${manifest.id}]`, ...args)),
       debug: createSafeFunction((...args: any[]) => console.debug(`[Plugin:${manifest.id}]`, ...args)),
     };

     // Wrap Storage (Key-Value persistence)
     const wrappedStorage = {
       get: createSafeFunction(async (key: string) => {
         try {
           const row = this.kernel.db.prepare(
             'SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?'
           ).get(manifest.id, key) as any;
           return row ? JSON.parse(row.value) : null;
         } catch (e) {
           console.error(`[Plugin:${manifest.id}] Error getting storage key "${key}":`, e);
           throw e;
         }
       }),
       set: createSafeFunction(async (key: string, value: any) => {
         try {
           const valueStr = JSON.stringify(value);
           this.kernel.db.prepare(
             `INSERT INTO plugin_storage (plugin_id, key, value, updated_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
           ).run(manifest.id, key, valueStr, Date.now());
         } catch (e) {
           console.error(`[Plugin:${manifest.id}] Error setting storage key "${key}":`, e);
           throw e;
         }
       }),
       delete: createSafeFunction(async (key: string) => {
         try {
           this.kernel.db.prepare(
             'DELETE FROM plugin_storage WHERE plugin_id = ? AND key = ?'
           ).run(manifest.id, key);
         } catch (e) {
           console.error(`[Plugin:${manifest.id}] Error deleting storage key "${key}":`, e);
           throw e;
         }
       })
     };

     // Wrap AI Services
     const wrappedAI = {
       generateText: createSafeFunction(async (prompt: string, options?: { systemInstruction?: string; temperature?: number }) => {
         try {
           // 1. Check if there is a configured third-party AI provider in db with a valid key
           const provider = this.kernel.db.prepare(
             'SELECT id, name, api_url, api_key, model_name FROM ai_providers WHERE api_key IS NOT NULL AND api_key != \'\' LIMIT 1'
           ).get() as any;

           if (provider) {
             let cleanUrl = provider.api_url.trim();
             if (!cleanUrl.endsWith('/chat/completions')) {
               cleanUrl = cleanUrl.endsWith('/') ? cleanUrl + 'chat/completions' : cleanUrl + '/chat/completions';
             }

             const headers: Record<string, string> = {
               'Content-Type': 'application/json',
               'Authorization': `Bearer ${provider.api_key.trim()}`
             };

             const messages: any[] = [];
             if (options?.systemInstruction) {
               messages.push({ role: 'system', content: options.systemInstruction });
             }
             messages.push({ role: 'user', content: prompt });

             const response = await fetch(cleanUrl, {
               method: 'POST',
               headers,
               body: JSON.stringify({
                 model: provider.model_name,
                 messages,
                 temperature: options?.temperature ?? 0.2
               })
             });

             if (!response.ok) {
               const errorText = await response.text();
               throw new Error(`AI provider request failed (${response.status}): ${errorText || response.statusText}`);
             }

             const data = await response.json();
             const content = data.choices?.[0]?.message?.content;
             if (typeof content !== 'string') {
               throw new Error('AI provider returned no text content');
             }
             return content.trim();
           }

           // 2. Fallback to Gemini using GoogleGenAI SDK
           const geminiKey = process.env.GEMINI_API_KEY;
           if (geminiKey) {
             const { GoogleGenAI } = await import('@google/genai');
             const ai = new GoogleGenAI({ apiKey: geminiKey });
             
             const response = await ai.models.generateContent({
               model: 'gemini-3.5-flash',
               contents: [{ role: 'user', parts: [{ text: prompt }] }],
               config: {
                 systemInstruction: options?.systemInstruction,
                 temperature: options?.temperature ?? 0.2
               }
             });

             if (!response.text) {
               throw new Error('Gemini API returned no text content');
             }
             return response.text.trim();
           }

           throw new Error('No AI providers or Gemini API key configured in the system.');
         } catch (e: any) {
           console.error(`[Plugin:${manifest.id}] Error in generateText:`, e);
           throw e;
         }
       })
     };

     // Freeze prototype chains of wrapper structures to prevent VM escape
     Object.setPrototypeOf(wrappedEventBus, null);
     Object.setPrototypeOf(wrappedCommandBus, null);
     Object.setPrototypeOf(wrappedProcessManager, null);
     Object.setPrototypeOf(wrappedActionRegistry, null);
     Object.setPrototypeOf(safeConsole, null);
     Object.setPrototypeOf(wrappedStorage, null);
     Object.setPrototypeOf(wrappedAI, null);

     const context = {
        ctx: {
          commandBus: wrappedCommandBus,
          eventBus: wrappedEventBus,
          actionRegistry: wrappedActionRegistry,
          processManager: wrappedProcessManager,
          storage: wrappedStorage,
          ai: wrappedAI
        },
        exports: {} as any,
        console: safeConsole
     };

     Object.defineProperty(context, 'ctx', { writable: false, configurable: false });
     Object.defineProperty(context.ctx, 'commandBus', { writable: false, configurable: false });
     Object.defineProperty(context.ctx, 'eventBus', { writable: false, configurable: false });
     Object.defineProperty(context.ctx, 'actionRegistry', { writable: false, configurable: false });
     Object.defineProperty(context.ctx, 'processManager', { writable: false, configurable: false });
     Object.defineProperty(context.ctx, 'storage', { writable: false, configurable: false });
     Object.defineProperty(context.ctx, 'ai', { writable: false, configurable: false });

     try {
       vm.createContext(context);
       
       const script = new vm.Script(`
          ${sourceCode};
          exports.default = exports.default || exports;
       `);

       script.runInContext(context, { timeout: 1000 });
       
       const plugin = context.exports.default;
       
       // Timeout-protected activation call (5 seconds max)
       const activatePromise = plugin.activate(context.ctx);
       const timeoutPromise = new Promise((_, reject) => 
         setTimeout(() => reject(new Error(`Plugin ${manifest.name} activation timed out after 5s`)), 5000)
       );
       
       await Promise.race([activatePromise, timeoutPromise]);
       
       this.activePluginRegistrations.set(pluginId, registration);
       return plugin;
     } catch (err) {
       this.deactivatePlugin(pluginId);
       // Explicit rollback
       registration.actions.forEach(actionId => {
         try { this.kernel.actionRegistry.unregister(actionId); } catch {}
       });
       registration.commandTypes.forEach(commandType => {
         try { this.kernel.commandBus.unregisterHandler(commandType); } catch {}
       });
       registration.eventSubscriptions.forEach(sub => {
         try { this.kernel.eventBus.unsubscribe(sub.eventType, sub.subscriber); } catch {}
       });
       registration.processHandlers.forEach(taskType => {
         try { this.kernel.processManager.unregisterHandler(taskType); } catch {}
       });
       registration.spawnedProcessIds.forEach(processId => {
         try { this.kernel.processManager.kill(processId); } catch {}
       });
       try { this.kernel.capabilityGuard.revokeAll(actorId); } catch {}
       throw err;
     }
  }
}
