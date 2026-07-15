/**
 * context-builder.ts — 从 ServiceRegistry 构建安全的 PluginContext。
 *
 * 直接迁移自 PluginRuntime.evaluateAndActivateEsm() (lines 252–585) 的
 * wrapped* 安全包装器代码，将 `this.kernel.xxx` 调用替换为通过 DI 容器
 * 获取的服务实例方法调用。
 *
 * D-04: buildContext 异步构建 PluginContext（7 个 IService 各 1 个包装函数）
 * D-05: 每个 register/subscribe 方法通过 ResourceTracker 注册清理
 * D-06: ctx.services 被 Object.freeze() 冻结
 * D-07: ResourceTracker 按插入顺序管理 cleanup
 */

import type { CommandHandler } from '../command-bus/index.js';
import type { ActionDescriptor } from '../registry/index.js';
import type { Manifest } from '../esm-loader/manifest-schema.js';
import type { PluginContext, PluginDatabaseAPI, IPluginLogger, ContributionAccessor } from './types.js';
import { PLUGIN_SHARED_MODULES } from './types.js';
import type { ContributionRegistry } from './contribution-registry.js';
import { ConfigService } from './config-service.js';
import type { Token } from '../di/token.js';
import type { ResourceTracker } from './resource-tracker.js';
import type { ServiceRegistry } from '../di/service-registry.js';
import { createLogger } from '../../../server/utils/logger.js';
import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
} from '../di/interfaces.js';
import type {
  ICommandBusService,
  IEventBusService,
  IActionRegistryService,
  ICapabilityService,
  IProcessService,
  IStorageService,
  IAIService,
} from '../di/interfaces.js';

// ── 共享模块注册表 ──────────────────────────────────────────────────────

const sharedModules: Record<string, any> = {};

export function registerSharedModule(name: string, mod: any): void {
  sharedModules[name] = mod;
}

/** 注册所有白名单共享模块（由 Kernel 在启动时调用） */
export async function bootstrapSharedModules(): Promise<void> {
  // 服务端共享模块：排除前端专属库（konva/react-konva 是 Canvas 2D 库，CJS bundle 无法加载 ESM 模块）
  const modules = await Promise.allSettled([
    import('recharts').then(m => ({ name: 'recharts', mod: m })),
    import('react-markdown').then(m => ({ name: 'react-markdown', mod: m })),
    import('jspdf').then(m => ({ name: 'jspdf', mod: m })),
    import('jspdf-autotable').then(m => ({ name: 'jspdf-autotable', mod: m })),
    import('lucide-react').then(m => ({ name: 'lucide-react', mod: m })),
    import('uuid').then(m => ({ name: 'uuid', mod: m })),
    // xlsx 按需可选，失败不阻塞
    import('xlsx').then(m => ({ name: 'xlsx', mod: m })).catch(err => {
      console.warn('[PluginHost] xlsx not available (optional):', err.message);
      return null;
    }),
  ]);
  for (const result of modules) {
    if (result.status === 'fulfilled' && result.value !== null) {
      sharedModules[result.value.name] = result.value.mod;
    } else if (result.status === 'rejected') {
      console.warn(`[PluginHost] Failed to register shared module:`, result.reason?.message);
    }
  }
}

// ── createSafeFunction ──────────────────────────────────────────────────────

/**
 * 创建一个安全的函数代理：切断原型链并阻止 constructor 属性访问。
 *
 * 直接迁移自 PluginRuntime line 252-264。
 * 防止插件通过 fn.constructor 访问全局 Function constructor 进行原型污染攻击。
 *
 * @param fn - 原始函数
 * @returns 被安全包装的函数
 */
export function createSafeFunction(fn: Function): Function {
  const safeFn = (...args: any[]) => {
    return fn(...args);
  };
  Object.setPrototypeOf(safeFn, null);
  Object.defineProperty(safeFn, 'constructor', {
    value: undefined,
    writable: false,
    configurable: false,
  });
  return safeFn;
}

// ── 包装函数（从 PluginRuntime 迁移，DI 驱动）──────────────────────────

/**
 * 包装 ICommandBusService：对 registerHandler 自动调用 tracker.track()。
 *
 * 迁移自 PluginRuntime lines 298-324。
 */
function wrapCommandBus(
  commandBus: ICommandBusService,
  tracker: ResourceTracker,
  pluginId: string,
  manifestId?: string,
): ICommandBusService {
  // V3.0: non-kernel plugins get auto-prefixed commands. Kernel plugins
  // (@openlearn/*) keep global namespace for backward compatibility.
  const isKernelPlugin = pluginId.startsWith('@openlearn/');
  // The manifest ID is the stable public namespace (e.g. 'ext-my-service').
  // The pluginId is the UUID assigned at install time.
  const manifestPrefix = manifestId ? manifestId + '.' : null;

  /** Resolve the registered command type — UUID-prefixed commands stay as-is;
   *  non-UUID commands with dots pass through as-is (their own semantic namespace);
   *  only apply pluginId prefix if the commandType has NO dots (bare action name). */
  const resolveType = (commandType: string): string => {
    if (isKernelPlugin) return commandType;
    if (commandType.startsWith(pluginId + '.')) return commandType;
    // Manifest-ID prefixed commands pass through as-is (stable semantic namespace)
    if (manifestPrefix && commandType.startsWith(manifestPrefix)) return commandType;
    // Commands with dots are already namespaced (e.g. quiz.create, vote.create) — pass through
    if (commandType.includes('.')) return commandType;
    // Bare command names (no dots) get UUID-prefixed for isolation
    return `${pluginId}.${commandType}`;
  };

  return {
    registerHandler: createSafeFunction((commandType: string, handler: CommandHandler) => {
      const prefixed = resolveType(commandType);

      // Namespace guard: reject only commands that start with a different plugin's UUID prefix.
      // This prevents rogue plugins from hijacking another plugin's sandboxed namespace.
      // Short-form semantic namespaces like "quiz.create" or "vote.create" are intentional
      // and are always allowed — they are just registered with an auto-prepended UUID prefix.
      const UUID_V7_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}\./i;
      if (!isKernelPlugin && UUID_V7_PREFIX.test(commandType) && !commandType.startsWith(pluginId + '.')) {
        throw new Error(
          `[PluginHost] Plugin "${pluginId}" attempted to register command "${commandType}" ` +
          `which belongs to another plugin's UUID namespace.`,
        );
      }

      const safeHandler: CommandHandler = {
        execute: async (command) => {
          try {
            return await handler.execute(command);
          } catch (e) {
            console.error(`[Plugin:${pluginId}] Error executing command ${prefixed}:`, e);
            throw e;
          }
        },
      };
      return Promise.resolve(commandBus.registerHandler(prefixed, safeHandler)).then(() => {
        tracker.track(pluginId, {
          dispose: () => {
            Promise.resolve(commandBus.unregisterHandler(prefixed)).catch(() => {});
          },
        });
      });
    }),
    createCommand: createSafeFunction(
      (type: string, payload: any, actorId: string, metadata?: any) => {
        return commandBus.createCommand(resolveType(type), payload, actorId, metadata);
      },
    ),
    execute: createSafeFunction(async (command: any) => {
      // ponytail: try prefixed first, fall back to original for kernel commands
      const prefixedCmd = { ...command, type: resolveType(command.type) };
      try {
        return await commandBus.execute(prefixedCmd);
      } catch (e: any) {
        // If the prefixed type doesn't exist, try the original type
        // (e.g. kernel commands like whiteboard.draw that plugins call directly)
        if (e.message?.includes('No handler registered') || e.message?.includes('handler')) {
          return commandBus.execute(command);
        }
        throw e;
      }
    }),
    setInterceptor: createSafeFunction((interceptor: any) => {
      return commandBus.setInterceptor(interceptor);
    }),
    unregisterHandler: createSafeFunction((commandType: string) => {
      return commandBus.unregisterHandler(resolveType(commandType));
    }),
  } as ICommandBusService;
}

/**
 * 包装 IEventBusService：对 subscribe 自动调用 tracker.track()。
 *
 * 迁移自 PluginRuntime lines 266-296。
 */
function wrapEventBus(
  eventBus: IEventBusService,
  tracker: ResourceTracker,
  pluginId: string,
): IEventBusService {
  return {
    subscribe: createSafeFunction((eventType: string, subscriber: any) => {
      const safeSubscriber = (event: any) => {
        try {
          return subscriber(event);
        } catch (e) {
          console.error(`[Plugin:${pluginId}] Error in event subscriber for ${eventType}:`, e);
        }
      };
      return Promise.resolve(eventBus.subscribe(eventType, safeSubscriber)).then(() => {
        tracker.track(pluginId, {
          dispose: () => {
            Promise.resolve(eventBus.unsubscribe(eventType, safeSubscriber)).catch(() => {});
          },
        });
      });
    }),
    unsubscribe: createSafeFunction((eventType: string, subscriber: any) => {
      return eventBus.unsubscribe(eventType, subscriber);
    }),
    publish: createSafeFunction(async (event: any) => {
      const enrichedEvent = {
        ...event,
        source: event.source ? `plugin:${pluginId}.${event.source}` : `plugin:${pluginId}`,
      };
      return eventBus.publish(enrichedEvent);
    }),
  } as IEventBusService;
}

/**
 * 包装 IProcessService：对 registerHandler/registerInterval 自动调用 tracker.track()。
 *
 * 迁移自 PluginRuntime lines 326-358。
 */
function wrapProcessManager(
  processService: IProcessService,
  tracker: ResourceTracker,
  pluginId: string,
): IProcessService {
  return {
    registerHandler: createSafeFunction((taskType: string, handler: any) => {
      const safeHandler = async (
        processId: string,
        payload: any,
        state: any,
        log: any,
        updateState: any,
      ) => {
        try {
          await handler(processId, payload, state, log, updateState);
        } catch (e: any) {
          console.error(`[Plugin:${pluginId}] Error in process handler ${taskType}:`, e);
          throw e;
        }
      };
      return Promise.resolve(processService.registerHandler(taskType, safeHandler)).then(() => {
        tracker.track(pluginId, {
          dispose: () => {
            Promise.resolve(processService.unregisterHandler(taskType)).catch(() => {});
          },
        });
      });
    }),
    registerInterval: createSafeFunction(
      (name: string, intervalMs: number, tickFn: any) => {
        return processService
          .registerInterval(name, intervalMs, (log) => {
            try {
              tickFn(log);
            } catch (e) {
              console.error(`[Plugin:${pluginId}] Error in interval task ${name}:`, e);
            }
          })
          .then((processId) => {
            tracker.track(pluginId, {
              dispose: () => {
                processService.kill(processId).catch(() => {});
              },
            });
            return processId;
          });
      },
    ),
    kill: createSafeFunction((processId: string) => {
      return processService.kill(processId);
    }),
    spawn: createSafeFunction((name: string, taskType: string, payload: unknown) => {
      return processService.spawn(name, taskType, payload);
    }),
    unregisterHandler: createSafeFunction((taskType: string) => {
      return processService.unregisterHandler(taskType);
    }),
    restore: createSafeFunction(() => {
      return processService.restore();
    }),
  } as IProcessService;
}

/**
 * 包装 IActionRegistryService：对 register 自动调用 tracker.track()。
 *
 * 迁移自 PluginRuntime lines 360-380。
 */
function wrapActionRegistry(
  actionRegistry: IActionRegistryService,
  tracker: ResourceTracker,
  pluginId: string,
): IActionRegistryService {
  return {
    register: createSafeFunction((descriptor: ActionDescriptor) => {
      return Promise.resolve(actionRegistry.register(descriptor)).then(() => {
        tracker.track(pluginId, {
          dispose: () => {
            Promise.resolve(actionRegistry.unregister(descriptor.id)).catch(() => {});
          },
        });
      });
    }),
    unregister: createSafeFunction((id: string) => {
      return Promise.resolve(actionRegistry.unregister(id));
    }),
    getAllActions: createSafeFunction(() => {
      return actionRegistry.getAllActions();
    }),
    getAgentTools: createSafeFunction(() => {
      return actionRegistry.getAgentTools();
    }),
    getActionByToolName: createSafeFunction((toolName: string) => {
      return actionRegistry.getActionByToolName(toolName);
    }),
    getActionByCommandType: createSafeFunction((commandType: string) => {
      return actionRegistry.getActionByCommandType(commandType);
    }),
  } as IActionRegistryService;
}

/**
 * 包装 ICapabilityService：纯代理，不注册资源。
 *
 * 迁移自 PluginRuntime 的能力管理模型。
 * 能力授予/撤销由 PluginHost 直接管理，此处仅提供安全代理。
 */
function wrapCapability(capabilityService: ICapabilityService): ICapabilityService {
  return {
    grant: createSafeFunction((actorId: string, cap: string) => {
      return capabilityService.grant(actorId, cap);
    }),
    revokeAll: createSafeFunction((actorId: string) => {
      return capabilityService.revokeAll(actorId);
    }),
    check: createSafeFunction((actorId: string, requiredCap: string) => {
      return capabilityService.check(actorId, requiredCap);
    }),
  } as ICapabilityService;
}

/**
 * 包装 IStorageService：按 manifestId 隔离键空间。
 *
 * 迁移自 PluginRuntime lines 392-427。
 * 将 `this.kernel.db` 替换为函数参数 `db`。
 */
function wrapStorage(
  storageService: IStorageService,
  db: any,
  manifestId: string,
): IStorageService {
  return {
    get: createSafeFunction(async (key: string) => {
      try {
        const row = db
          .prepare('SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?')
          .get(manifestId, key) as any;
        return row ? JSON.parse(row.value) : null;
      } catch (e) {
        console.error(`[Plugin:${manifestId}] Error getting storage key "${key}":`, e);
        throw e;
      }
    }),
    set: createSafeFunction(async (key: string, value: any) => {
      try {
        const valueStr = JSON.stringify(value);
        db.prepare(
          `INSERT INTO plugin_storage (plugin_id, key, value, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        ).run(manifestId, key, valueStr, Date.now());
      } catch (e) {
        console.error(`[Plugin:${manifestId}] Error setting storage key "${key}":`, e);
        throw e;
      }
    }),
    delete: createSafeFunction(async (key: string) => {
      try {
        db.prepare(
          'DELETE FROM plugin_storage WHERE plugin_id = ? AND key = ?',
        ).run(manifestId, key);
      } catch (e) {
        console.error(`[Plugin:${manifestId}] Error deleting storage key "${key}":`, e);
        throw e;
      }
    }),
  } as IStorageService;
}

/**
 * 包装 IAIService：纯代理到 AIService，简化自 PluginRuntime lines 429-508。
 *
 * PluginRuntime 的 ai 包装器内联 AI 提供者逻辑，但 Phase 2 的 AIService
 * 已包含该逻辑，因此此处仅做安全代理。
 */
function wrapAI(aiService: IAIService): IAIService {
  return {
    generateText: createSafeFunction(
      async (prompt: string, options?: { systemInstruction?: string; temperature?: number }) => {
        try {
          return await aiService.generateText(prompt, options);
        } catch (e: any) {
          console.error(`[PluginHost] Error in generateText:`, e);
          throw e;
        }
      },
    ),
  } as IAIService;
}

// ── buildContext ────────────────────────────────────────────────────────────

/**
 * 从 ServiceRegistry 构建安全的 PluginContext。
 *
 * D-04: 异步构建，接收 ServiceRegistry、ResourceTracker、pluginId、Manifest
 * D-05: 每个 IService 的 register/subscribe 方法自动调用 tracker.track()
 * D-06: ctx.services 被 Object.freeze() 冻结
 * D-07: 包装器函数通过 createSafeFunction 切断原型链
 *
 * @param serviceRegistry - DI 容器，提供 7 个 IService 实例
 * @param tracker - 资源追踪器，管理插件生命周期内的 disposable 资源
 * @param pluginId - 插件标识符（manifest.id）
 * @param manifest - 插件 manifest 元数据
 * @param db - SQLite 数据库实例（用于 storage 包装器的键空间隔离）
 * @returns 完整的、安全包装的 PluginContext
 */
export async function buildContext(
  serviceRegistry: ServiceRegistry,
  tracker: ResourceTracker,
  pluginId: string,
  manifest: Manifest,
  db: any,
  skipTokens?: Set<string>,  // Phase 6 (D-12): incompatible optional token names
  contributionRegistry?: ContributionRegistry,  // V3.0: 贡献点注册表引用
): Promise<PluginContext> {
  // 1. 从 DI 容器解析 7 个 IService
  const commandBusService = await serviceRegistry.resolve(ICommandBusServiceToken);
  const eventBusService = await serviceRegistry.resolve(IEventBusServiceToken);
  const actionRegistryService = await serviceRegistry.resolve(IActionRegistryServiceToken);
  const capabilityService = await serviceRegistry.resolve(ICapabilityServiceToken);
  const processService = await serviceRegistry.resolve(IProcessServiceToken);
  const storageService = await serviceRegistry.resolve(IStorageServiceToken);
  const aiService = await serviceRegistry.resolve(IAIServiceToken);

  // 2. 逐个包装 IService — 应用 createSafeFunction + ResourceTracker 集成
  const wrappedCommandBus = wrapCommandBus(commandBusService, tracker, pluginId, manifest.id);
  const wrappedEventBus = wrapEventBus(eventBusService, tracker, pluginId);
  const wrappedProcessManager = wrapProcessManager(processService, tracker, pluginId);
  const wrappedActionRegistry = wrapActionRegistry(actionRegistryService, tracker, pluginId);
  const wrappedCapability = wrapCapability(capabilityService);
  const wrappedStorage = wrapStorage(storageService, db, manifest.id);
  const wrappedAI = wrapAI(aiService);

  // 3. 冻结包装对象的原型链（迁移自 PluginRuntime lines 512-518）
  Object.setPrototypeOf(wrappedCommandBus, null);
  Object.setPrototypeOf(wrappedEventBus, null);
  Object.setPrototypeOf(wrappedProcessManager, null);
  Object.setPrototypeOf(wrappedActionRegistry, null);
  Object.setPrototypeOf(wrappedCapability, null);
  Object.setPrototypeOf(wrappedStorage, null);
  Object.setPrototypeOf(wrappedAI, null);

  // 4. 构建 services 容器并冻结（D-06）
  const services = {
    commandBus: wrappedCommandBus,
    eventBus: wrappedEventBus,
    actionRegistry: wrappedActionRegistry,
    capability: wrappedCapability,
    processManager: wrappedProcessManager,
    storage: wrappedStorage,
    ai: wrappedAI,
  };

  // === Phase 6: Null out incompatible optional service keys (D-12) =============
  // skipTokens contains token names from checkSemVerCompatibility.
  // Map token names (e.g. '@openlearn/core:ICommandBusService') to services
  // object keys (e.g. 'commandBus') and null them before freeze.
  // Plugin can check: if (ctx.services.thatService === null) { /* degrade */ }
  if (skipTokens && skipTokens.size > 0) {
    const TOKEN_TO_SERVICE_KEY: Record<string, keyof typeof services> = {
      '@openlearn/core:ICommandBusService': 'commandBus',
      '@openlearn/core:IEventBusService': 'eventBus',
      '@openlearn/core:IActionRegistryService': 'actionRegistry',
      '@openlearn/core:ICapabilityService': 'capability',
      '@openlearn/core:IProcessService': 'processManager',
      '@openlearn/core:IStorageService': 'storage',
      '@openlearn/core:IAIService': 'ai',
    };
    for (const tokenName of skipTokens) {
      const serviceKey = TOKEN_TO_SERVICE_KEY[tokenName];
      if (serviceKey) {
        // TypeScript: PluginContext.services types don't include null for each IService.
        // Type assertion is acceptable -- the null is a runtime sentinel for plugin
        // degradation checks (D-12). Plugin code checks with `=== null`.
        services[serviceKey] = null as never;
      } else {
        console.warn(`[PluginHost] Cannot skip unknown token: ${tokenName}`);
      }
    }
  }
  // =============================================================================

  Object.freeze(services);

  // 5. 构建插件自建表 API（v5.1）
  const tablePrefix = `plugin_${pluginId.replace(/[^a-zA-Z0-9_]/g, '_')}_`;

  const dbApi: PluginDatabaseAPI = {
    async ensureTable(tableName: string, schema: string) {
      const fullName = tablePrefix + tableName;
      db.exec(`CREATE TABLE IF NOT EXISTS ${fullName} (${schema})`);
    },
    table(tableName: string) {
      return tablePrefix + tableName;
    },
    async dropAllTables() {
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ?`)
        .all(tablePrefix + '%') as { name: string }[];
      for (const t of tables) {
        db.exec(`DROP TABLE IF EXISTS ${t.name}`);
      }
    },
    async migrate(targetVersion: number, upgradeFn: (db: any) => Promise<void> | void) {
      db.exec(`CREATE TABLE IF NOT EXISTS plugin_migrations (plugin_id TEXT PRIMARY KEY, version INTEGER NOT NULL)`);
      const row = db.prepare(`SELECT version FROM plugin_migrations WHERE plugin_id = ?`).get(pluginId) as { version: number } | undefined;
      const currentVersion = row ? row.version : 0;
      if (currentVersion < targetVersion) {
        await upgradeFn(db);
        db.prepare(`INSERT OR REPLACE INTO plugin_migrations (plugin_id, version) VALUES (?, ?)`).run(pluginId, targetVersion);
      }
    },
  };

  const pluginLogger = createLogger(`Plugin:${manifest.id || pluginId}`);
  const pluginLog: IPluginLogger = {
    debug(message, meta) {
      pluginLogger.debug({ meta }, message);
    },
    info(message, meta) {
      pluginLogger.info({ meta }, message);
    },
    warn(message, meta) {
      pluginLogger.warn({ meta }, message);
    },
    error(message, meta) {
      pluginLogger.error({ meta }, message);
    },
  };

  // 5.6. V3.0: 配置服务
  const configService = new ConfigService(db, manifest);
  configService.loadFromDB();

  // 5.7. 构建贡献点访问器（V3.0）
  const contributionsAccessor: ContributionAccessor = {
    list() {
      if (contributionRegistry) {
        return contributionRegistry.summary(manifest.id);
      }
      // Fallback: 从 manifest 直接构建（无 registry 时，如测试环境）
      const contributes = (manifest as any).contributes as Record<string, any[]> | undefined;
      if (!contributes) return [];
      return Object.entries(contributes)
        .filter(([, configs]) => configs && configs.length > 0)
        .map(([slot, configs]) => ({
          slot,
          count: configs.length,
          items: configs.map((c: any) => ({ id: c.id, label: c.label ?? c.name ?? c.id })),
        }));
    },
  };

  // 6. 构建完整的 PluginContext
  return {
    services,
    pluginId,
    manifest,
    resolve: <T>(token: string | Token<T>): Promise<T> => {
      if (typeof token === 'string') {
        return serviceRegistry.resolveByName(token) as Promise<T>;
      }
      return serviceRegistry.resolve(token);
    },
    // V3.2: 插件向 DI 容器提供服务（对应 manifest.provides）
    provide: async <T>(token: Token<T>, instance: T): Promise<void> => {
      // 验证 token.name 在 manifest.provides 中声明
      const declared = (manifest as any).provides as string[] | undefined;
      if (!declared || !declared.includes(token.name)) {
        throw new Error(
          `[PluginHost] Plugin "${pluginId}" attempted to provide "${token.name}" ` +
          `which is not declared in manifest.provides. ` +
          `Add it to manifest.provides: [${declared?.join(', ') ?? ''}]`,
        );
      }
      // V3.2: 使用插件传入的 Token（含 version），不再硬编码 '1.0.0'
      await serviceRegistry.register(token, instance);
      // 跟踪清理
      tracker.track(pluginId, {
        dispose: () => {
          serviceRegistry.unregister(token).catch(() => {});
        },
      });
    },
    db: dbApi,
    log: pluginLog,
    config: configService,
    contributions: contributionsAccessor,
    require: (moduleName: string) => {
      if (!PLUGIN_SHARED_MODULES.includes(moduleName as any)) {
        throw new Error(
          `Plugin "${pluginId}" cannot require "${moduleName}". ` +
          `Allowed modules: ${PLUGIN_SHARED_MODULES.join(', ')}`,
        );
      }
      if (!sharedModules[moduleName]) {
        throw new Error(`Shared module "${moduleName}" is not registered.`);
      }
      return sharedModules[moduleName];
    },
  };
}
