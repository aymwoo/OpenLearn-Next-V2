/**
 * WorkerManager — Worker 线程生命周期管理器。
 *
 * 封装 WorkerRegistry（状态机 + 资源追踪）和 Worker 创建/销毁流程。
 * 与 PluginHost 无循环依赖：WorkerManager 不接收 PluginHost，
 * PluginHost 通过 setter 接收 WorkerManager。
 *
 * ## 架构
 *
 * ```
 * PluginHost.activatePlugin(mode='worker')
 *   → WorkerManager.createWorker(pluginId, manifest, sourceCode, tokens)
 *     → new Worker(bootstrapDataUrl)
 *     → NodeWorkerTransport(worker)
 *     → ServiceHost(registry, capGuard, actorId, caps)
 *     → WorkerRegistry.register(pluginId, instance)
 *     → transport.postMessage({ type: 'activate', ... })
 *     → wait for 'activated' response (10s timeout)
 *     → return { transport, serviceHost }
 * ```
 *
 * ## 威胁模型
 *
 * - T-05-09: WorkerRegistry.activeCount 上限 32，达到上限时 createWorker 抛出错误
 * - T-05-11: Worker 终止在 finally 块中保证清理
 * - T-05-13: WorkerRegistry 按 pluginId 追踪，transport 通道在创建时 1:1 配对
 *
 * @module
 */

import { Worker } from 'node:worker_threads';
import type { Database } from 'better-sqlite3';
import fs from 'fs';
import { ServiceRegistry } from '../di/service-registry.js';
import { CapabilityGuard } from '../capability-system/index.js';
import type { EventBus } from '../event-bus/index.js';
import { NodeWorkerTransport } from './transport.js';
import type { IWorkerTransport } from './types.js';
import { ServiceHost } from './service-host.js';
import type { Manifest } from '../esm-loader/manifest-schema.js';
import { createLogger } from '../../../server/utils/logger.js';
import { WorkerActivateError, WorkerTimeoutError } from './errors.js';
import { v7 as uuidv7 } from 'uuid';
import { IEventBusServiceToken } from '../di/index.js';

// ── Constants ────────────────────────────────────────────────────────────────

/** 7 个内核服务 Token 名称字符串 — 用于 Worker 端 RPC 代理。 */
export const ALL_SERVICE_TOKENS = [
  '@openlearn/core:ICommandBusService',
  '@openlearn/core:IEventBusService',
  '@openlearn/core:IActionRegistryService',
  '@openlearn/core:ICapabilityService',
  '@openlearn/core:IProcessService',
  '@openlearn/core:IStorageService',
  '@openlearn/core:IAIService',
  '@openlearn/core:IDatabase',
  '@openlearn/core:IPluginHost',
];

/** 最大并行 Worker 数（T-05-09: DoS 缓解）。 */
const MAX_WORKERS = 32;

/** Worker 激活超时（毫秒）。 */
const ACTIVATE_TIMEOUT_MS = 10000;

// ── WorkerInstance ───────────────────────────────────────────────────────────

/**
 * WorkerInstance — 已注册 Worker 的内部运行时记录。
 *
 * 由 WorkerRegistry 追踪，包含 Worker 线程引用、运输层、ServiceHost 等。
 * status 字段追踪生命周期：running → terminating/crashed。
 */
interface WorkerInstance {
  pluginId: string;
  worker: Worker;
  createdAt: number;
  status: 'running' | 'terminating' | 'crashed';
  transport: IWorkerTransport;
  serviceHost: ServiceHost;
  manifest?: Manifest;
  sourceCode?: string;
  serviceTokens?: string[];
  eventBus?: EventBus;
  pluginDir?: string;
}

// ── WorkerRegistry ───────────────────────────────────────────────────────────

/**
 * WorkerRegistry — Worker 实例注册表。
 *
 * 职责：
 * - 按 pluginId 追踪活跃 Worker
 * - 通过 threadId → pluginId 反向映射
 * - 'exit' 事件监听器自动检测 Worker 崩溃并触发自动拉起监控
 */
export class WorkerRegistry {
  /** pluginId → WorkerInstance */
  private workers = new Map<string, WorkerInstance>();

  /** threadId → pluginId 反向映射（用于崩溃检测） */
  private workerByThreadId = new Map<number, string>();

  /** pluginId → { count: number, lastTime: number } */
  private crashStats = new Map<string, { count: number; lastTime: number }>();

  public recreateWorkerCallback?: (
    pluginId: string,
    manifest: Manifest,
    sourceCode: string,
    serviceTokens: string[],
    eventBus?: EventBus,
    pluginDir?: string
  ) => Promise<any>;

  public onCircuitBreakerTriggered?: (pluginId: string) => void;

  /**
   * 注册一个 WorkerInstance。
   *
   * 如果 pluginId 已有 Worker，抛出错误。
   * 注册时自动附加 'exit' 事件处理，用于崩溃检测。
   *
   * @param pluginId - 插件标识符
   * @param instance - Worker 实例
   * @throws Error 如果 pluginId 已存在
   */
  register(pluginId: string, instance: WorkerInstance): void {
    if (this.workers.has(pluginId)) {
      throw new Error(`Worker already registered for plugin "${pluginId}"`);
    }

    this.workers.set(pluginId, instance);
    this.workerByThreadId.set(instance.worker.threadId, pluginId);

    // T-05-13: 自动崩溃检测 — 非零退出码且仍在追踪中时标记 crashed
    instance.worker.on('error', (err) => {
      console.error(
        `[WorkerRegistry] Worker for "${pluginId}" encountered error:`,
        err
      );
    });

    instance.worker.on('exit', (code) => {
      if (code !== 0 && this.workers.has(pluginId)) {
        const entry = this.workers.get(pluginId)!;
        if (entry.status === 'terminating') {
          // Intentionally terminated, not a crash!
          return;
        }
        entry.status = 'crashed';
        console.error(
          `[WorkerRegistry] Worker for "${pluginId}" exited with code ${code}`,
        );

        const manifest = entry.manifest;
        const sourceCode = entry.sourceCode;
        const serviceTokens = entry.serviceTokens;
        const eventBus = entry.eventBus;
        const pluginDir = entry.pluginDir;

        // Clean up registered commands and resources on the host side
        if (entry.serviceHost && typeof entry.serviceHost.dispose === 'function') {
          entry.serviceHost.dispose().catch(err => {
            console.error(`[WorkerRegistry] Failed to dispose serviceHost on crash for "${pluginId}":`, err);
          });
        }

        this.cleanup(pluginId);

        if (manifest && sourceCode && serviceTokens) {
          let stats = this.crashStats.get(pluginId) || { count: 0, lastTime: 0 };
          const now = Date.now();
          if (now - stats.lastTime > 300000) {
            stats.count = 0;
          }
          stats.count += 1;
          stats.lastTime = now;
          this.crashStats.set(pluginId, stats);

          if (stats.count <= 3) {
            const delay = Math.pow(2, stats.count - 1) * 1000;
            console.warn(
              `[WorkerRegistry] Worker for "${pluginId}" crashed. Watchdog restarting (attempt ${stats.count}/3) in ${delay}ms...`
            );
            setTimeout(async () => {
              try {
                if (this.recreateWorkerCallback) {
                  await this.recreateWorkerCallback(
                    pluginId,
                    manifest,
                    sourceCode,
                    serviceTokens,
                    eventBus,
                    pluginDir
                  );
                }
              } catch (err) {
                console.error(`[WorkerRegistry] Watchdog recovery failed for "${pluginId}":`, err);
              }
            }, delay);
          } else {
            console.error(
              `[WorkerRegistry] Worker for "${pluginId}" crashed ${stats.count} times in 5 mins. Circuit breaker triggered.`
            );
            if (this.onCircuitBreakerTriggered) {
              this.onCircuitBreakerTriggered(pluginId);
            }
          }
        }
      }
    });
  }

  /**
   * 通过 pluginId 获取 WorkerInstance。
   *
   * @param pluginId - 插件标识符
   * @returns WorkerInstance 或 undefined
   */
  get(pluginId: string): WorkerInstance | undefined {
    return this.workers.get(pluginId);
  }

  /**
   * 终止指定 Worker 并清理所有资源。
   *
   * 流程：
   * 1. 发送 deactivate-request 消息
   * 2. Promise.race 等待 'deactivated' 响应或超时
   * 3. finally 块中总是调用 worker.terminate()（T-05-11）
   * 4. cleanup 从两个 Map 中移除
   *
   * @param pluginId - 插件标识符
   * @param timeoutMs - deactivate 等待超时（默认 3000ms）
   */
  async terminate(pluginId: string, timeoutMs = 3000): Promise<any> {
    const instance = this.workers.get(pluginId);
    if (!instance) return;

    this.crashStats.delete(pluginId);
    instance.status = 'terminating';
    let state: any = undefined;

    try {
      // 发送 deactivate-request，等待 deactivated 响应或超时
      instance.transport.postMessage({ type: 'deactivate-request' });

      state = await Promise.race([
        new Promise<any>((resolve, reject) => {
          // 注册一次性消息处理器等待 deactivated 响应
          const originalHandler = (
            instance.transport as unknown as { messageHandler?: (msg: unknown) => void }
          ).messageHandler;

          instance.transport.onMessage((msg: unknown) => {
            const typed = msg as { type?: string; state?: any };
            if (typed.type === 'deactivated') {
              resolve(typed.state);
            } else if (typed.type === 'error') {
              // Worker 报告错误 — 记录但继续等待 deactivated
              console.error(
                `[WorkerRegistry] Worker "${pluginId}" error during deactivate:`,
                (msg as { message?: string }).message,
              );
            }
          });

          // 超时
          setTimeout(() => {
            reject(new Error(`Deactivate timeout for "${pluginId}"`));
          }, timeoutMs);
        }),
      ]);
    } catch {
      // 超时或错误 — 记录警告，继续强制终止
      console.warn(
        `[WorkerRegistry] Graceful deactivate failed for "${pluginId}", force terminating`,
      );
    } finally {
      // T-05-11: finally 块保证 Worker 终止
      try {
        await instance.worker.terminate();
      } catch (termErr) {
        console.error(
          `[WorkerRegistry] Worker terminate error for "${pluginId}":`,
          termErr,
        );
      }
      this.cleanup(pluginId);
    }
    return state;
  }

  /**
   * 清理 Worker 注册数据。
   *
   * 从 workers 和 workerByThreadId 两个 Map 中移除。
   * 幂等操作 — 可重复调用。
   *
   * @param pluginId - 插件标识符
   */
  cleanup(pluginId: string): void {
    const instance = this.workers.get(pluginId);
    if (instance) {
      this.workerByThreadId.delete(instance.worker.threadId);
    }
    this.workers.delete(pluginId);
  }

  /** 当前活跃 Worker 数量（用于 DoS 上限检测 T-05-09）。 */
  get activeCount(): number {
    return this.workers.size;
  }

  /** 返回所有活跃 Worker 的 pluginId 列表。 */
  list(): string[] {
    return Array.from(this.workers.keys());
  }
}

// ── Bootstrap code generator ─────────────────────────────────────────────────

/**
 * 生成 Worker 端引导代码（自包含 ESM 模块，以 data URL 形式加载）。
 *
 * 此代码在 Worker 的隔离 V8 上下文中执行，无法访问磁盘上的模块，
 * 因此必须内联 createServicesProxy 和 createMethodProxy 的实现。
 *
 * Worker 端消息处理架构（单 handler 分发）：
 * 1. invokeId 匹配 → RPC 结果/错误分发
 * 2. type === 'activate' → 加载插件、创建代理、激活
 * 3. type === 'deactivate-request' → 停用、清理
 */
function generateBootstrapCode(): string {
  const rootPath = process.cwd().replace(/\\/g, '/');
  const requirePath = `${rootPath}/package.json`;
  return `
import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
const requireFn = createRequire('${requirePath}');

// ── 内联 RPC Proxy 实现（在 Worker 隔离上下文中运行） ──

var pendingCalls = new Map();

// ── 插件命令命名空间解析（与 packages/core/plugin-host/plugin-namespace.ts
//    保持一致 — 单一真理源；Worker bootstrap 是动态生成的代码字符串，
//    无法通过 import 共享模块，因此内联一份，必须与源文件同步修改） ──
function resolvePluginCommandType(type, pluginId) {
  var prefix = pluginId + '.';
  return type.indexOf(prefix) === 0 ? type : prefix + type;
}

// EventBusProxy — Worker 端事件订阅代理
function createEventBusProxy(transport) {
  var subscriptions = new Map();
  return {
    subscribe: function(eventType, handler) {
      var subId = globalThis.crypto.randomUUID();
      var handlers = subscriptions.get(subId) || [];
      handlers.push(handler);
      subscriptions.set(subId, handlers);
      transport.postMessage({ type: 'subscribe', subId: subId, eventType: eventType });
      return subId;
    },
    unsubscribe: function(eventType, handler) {
      for (var entry of subscriptions) {
        var subId = entry[0];
        var handlers = entry[1];
        var idx = handlers.indexOf(handler);
        if (idx !== -1) {
          handlers.splice(idx, 1);
          if (handlers.length === 0) {
            subscriptions.delete(subId);
            transport.postMessage({ type: 'unsubscribe', subId: subId });
          }
          break;
        }
      }
    },
    handleEvent: function(subId, event) {
      var handlers = subscriptions.get(subId);
      if (!handlers) return;
      for (var i = 0; i < handlers.length; i++) {
        try { handlers[i](event); } catch (e) {
          console.error('[EventBusProxy] Handler error:', e);
        }
      }
    },
    disposeAll: function() {
      for (var entry of subscriptions) {
        transport.postMessage({ type: 'unsubscribe', subId: entry[0] });
      }
      subscriptions.clear();
    }
  };
}

// 创建服务代理对象（内联 createServicesProxy + createMethodProxy）
function createServiceProxies(serviceTokens) {
  var services = {};
  for (var i = 0; i < serviceTokens.length; i++) {
    (function(token) {
      services[token] = new Proxy({}, {
        get: function(_target, method) {
          return function() {
            var args = Array.prototype.slice.call(arguments);
            var invokeId = globalThis.crypto.randomUUID();
            return new Promise(function(resolve, reject) {
              pendingCalls.set(invokeId, { resolve: resolve, reject: reject });
              parentPort.postMessage({
                type: 'invoke',
                invokeId: invokeId,
                token: token,
                method: String(method),
                args: args
              });
            });
          };
        }
      });
    })(serviceTokens[i]);
  }
  Object.freeze(services);
  return services;
}

// ── 单消息处理器 ──

var eventBusProxy = null;
var registeredCommandHandlers = new Map();

parentPort.on('message', async function(msg) {
  // 1. 转发的平台事件分发
  if (msg && msg.type === 'event' && eventBusProxy) {
    eventBusProxy.handleEvent(msg.subId, msg.event);
    return;
  }

  // 1b. Intercept command execution request from host
  if (msg && msg.type === 'executeCommand') {
    var handler = registeredCommandHandlers.get(msg.commandType);
    if (!handler) {
      parentPort.postMessage({
        type: 'commandError',
        invokeId: msg.invokeId,
        message: 'No handler registered for command ' + msg.commandType + ' in worker'
      });
      return;
    }
    try {
      var result = await handler.execute(msg.command);
      parentPort.postMessage({
        type: 'commandResult',
        invokeId: msg.invokeId,
        value: result
      });
    } catch (err) {
      parentPort.postMessage({
        type: 'commandError',
        invokeId: msg.invokeId,
        message: (err && err.message) ? err.message : String(err),
        stack: (err && err.stack) || ''
      });
    }
    return;
  }

  // 2. RPC 结果/错误分发（有 invokeId 且在 pendingCalls 中）
  if (msg && msg.invokeId && pendingCalls.has(msg.invokeId)) {
    var pending = pendingCalls.get(msg.invokeId);
    pendingCalls.delete(msg.invokeId);
    if (msg.type === 'error') {
      var err = new Error(msg.message);
      err.name = msg.code || 'RpcError';
      err.stack = msg.stack;
      pending.reject(err);
    } else if (msg.type === 'result') {
      pending.resolve(msg.value);
    }
    return;
  }

  // 3. 激活消息
  if (msg.type === 'activate') {
    try {
      var rawServices = createServiceProxies(workerData.serviceTokens);
      var TOKEN_TO_SHORT_NAME = {
        '@openlearn/core:ICommandBusService': 'commandBus',
        '@openlearn/core:IEventBusService': 'eventBus',
        '@openlearn/core:IActionRegistryService': 'actionRegistry',
        '@openlearn/core:ICapabilityService': 'capability',
        '@openlearn/core:IProcessService': 'processManager',
        '@openlearn/core:IStorageService': 'storage',
        '@openlearn/core:IAIService': 'ai'
      };

      eventBusProxy = createEventBusProxy(parentPort);
      var rawCommandBus = rawServices['@openlearn/core:ICommandBusService'];
      // Namespace prefix is the plugin's manifest.id (NOT the DB-generated
      // pluginId UUID) so the key matches what the frontend invokeCommand
      // and the host-side ServiceHost produce.
      var namespacePrefix = workerData.manifestId || workerData.pluginId;
      var commandBus = rawCommandBus ? {
        execute: function(cmd) { return rawCommandBus.execute(cmd); },
        registerHandler: function(commandType, handler) {
          var prefixed = resolvePluginCommandType(commandType, namespacePrefix);
          registeredCommandHandlers.set(prefixed, handler);
          return rawCommandBus.registerHandler(prefixed);
        },
        unregisterHandler: function(commandType) {
          var prefixed = resolvePluginCommandType(commandType, namespacePrefix);
          registeredCommandHandlers.delete(prefixed);
          return rawCommandBus.unregisterHandler(prefixed);
        },
        createCommand: function(type, payload, actorId, metadata) {
          return rawCommandBus.createCommand(type, payload, actorId, metadata);
        },
        setInterceptor: function(interceptor) {
          return rawCommandBus.setInterceptor(interceptor);
        }
      } : undefined;

      var rawEventBus = rawServices['@openlearn/core:IEventBusService'];
      var eventBus = rawEventBus ? {
        subscribe: function(type, handler) { return eventBusProxy.subscribe(type, handler); },
        unsubscribe: function(type, handler) { eventBusProxy.unsubscribe(type, handler); },
        publish: function(event) { return rawEventBus.publish(event); }
      } : undefined;

      var services = {};
      for (var token in rawServices) {
        if (token === '@openlearn/core:ICommandBusService') {
          services[token] = commandBus;
        } else if (token === '@openlearn/core:IEventBusService') {
          services[token] = eventBus;
        } else {
          services[token] = rawServices[token];
        }
        var shortName = TOKEN_TO_SHORT_NAME[token];
        if (shortName) {
          if (shortName === 'commandBus') {
            services[shortName] = commandBus;
          } else if (shortName === 'eventBus') {
            services[shortName] = eventBus;
          } else {
            services[shortName] = rawServices[token];
          }
        }
      }

      // 通过 file URL 或 data URL 加载插件代码
      var mod;
      if (workerData.pluginDir) {
        try {
          var urlModule = requireFn('node:url');
          var fileUrl = urlModule.pathToFileURL(workerData.pluginDir + '/index.js').href;
          mod = await import(fileUrl);
        } catch (importErr) {
          console.error('[Worker] Failed to import from pluginDir file URL, falling back to data URL:', importErr);
          var encoded = Buffer.from(msg.pluginCode, 'utf-8').toString('base64');
          mod = await import('data:text/javascript;base64,' + encoded);
        }
      } else {
        var encoded = Buffer.from(msg.pluginCode, 'utf-8').toString('base64');
        mod = await import('data:text/javascript;base64,' + encoded);
      }
      var plugin = (mod && mod.default) ? mod.default : (mod || {});

      if (typeof plugin.activate !== 'function') {
        parentPort.postMessage({ type: 'error', message: 'Plugin has no activate function' });
        return;
      }

      // 构建插件自建表 API (dbApi)
      var tablePrefix = 'plugin_' + workerData.pluginId.replace(/[^a-zA-Z0-9_]/g, '_') + '_';
      var dbService = rawServices['@openlearn/core:IDatabase'];
      var dbApi = dbService ? {
        ensureTable: function(tableName, schema) {
          var fullName = tablePrefix + tableName;
          return dbService.prepareAndRun('CREATE TABLE IF NOT EXISTS ' + fullName + ' (' + schema + ')', []);
        },
        table: function(tableName) {
          return tablePrefix + tableName;
        },
        dropAllTables: async function() {
          var tables = await dbService.prepareAndAll("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ?", [tablePrefix + '%']);
          for (var i = 0; i < tables.length; i++) {
            await dbService.prepareAndRun('DROP TABLE IF EXISTS ' + tables[i].name, []);
          }
        },
        migrate: async function(targetVersion, upgradeFn) {
          await dbService.prepareAndRun('CREATE TABLE IF NOT EXISTS plugin_migrations (plugin_id TEXT PRIMARY KEY, version INTEGER NOT NULL)', []);
          var row = await dbService.prepareAndGet('SELECT version FROM plugin_migrations WHERE plugin_id = ?', [workerData.pluginId]);
          var currentVersion = row ? row.version : 0;
          if (currentVersion < targetVersion) {
            var dbWrapper = {
              prepare: function(sql) {
                return {
                  run: function() {
                    var args = Array.prototype.slice.call(arguments);
                    return dbService.prepareAndRun(sql, args);
                  },
                  get: function() {
                    var args = Array.prototype.slice.call(arguments);
                    return dbService.prepareAndGet(sql, args);
                  },
                  all: function() {
                    var args = Array.prototype.slice.call(arguments);
                    return dbService.prepareAndAll(sql, args);
                  }
                };
              }
            };
            await upgradeFn(dbWrapper);
            await dbService.prepareAndRun('INSERT OR REPLACE INTO plugin_migrations (plugin_id, version) VALUES (?, ?)', [workerData.pluginId, targetVersion]);
          }
        }
      } : undefined;

      var PLUGIN_SHARED_MODULES = ['recharts', 'react-markdown', 'jspdf', 'jspdf-autotable', 'xlsx', 'lucide-react', 'uuid'];

      var pluginLog = {
        info: function() { console.log.apply(console, arguments); },
        warn: function() { console.warn.apply(console, arguments); },
        error: function() { console.error.apply(console, arguments); },
        debug: function() { (console.debug || console.log).apply(console, arguments); }
      };

      // 构建 PluginContext（带事件代理）
      var ctx = {
        services: services,
        pluginId: workerData.pluginId,
        manifest: msg.manifest,
        log: pluginLog,
        resolve: async function(token) {
          var tokenName = typeof token === 'string' ? token : (token && token.name);
          if (!tokenName) throw new Error('Invalid token');
          var svc = services[tokenName];
          if (!svc) throw new Error('No provider registered for token: ' + tokenName);
          if (tokenName === '@openlearn/core:IDatabase') {
            return {
              prepare: function(sql) {
                return {
                  run: function() {
                    var args = Array.prototype.slice.call(arguments);
                    return svc.prepareAndRun(sql, args);
                  },
                  get: function() {
                    var args = Array.prototype.slice.call(arguments);
                    return svc.prepareAndGet(sql, args);
                  },
                  all: function() {
                    var args = Array.prototype.slice.call(arguments);
                    return svc.prepareAndAll(sql, args);
                  }
                };
              }
            };
          }
          return svc;
        },
        eventBus: {
          subscribe: function(type, handler) { return eventBusProxy.subscribe(type, handler); },
          unsubscribe: function(type, handler) { eventBusProxy.unsubscribe(type, handler); },
          publish: async function() {
            throw new Error('publish not supported from Worker');
          }
        },
        db: dbApi,
        require: function(moduleName) {
          if (PLUGIN_SHARED_MODULES.indexOf(moduleName) !== -1) {
            try {
              return requireFn(moduleName);
            } catch (err) {
              throw new Error('Shared module "' + moduleName + '" is not available in worker: ' + err.message);
            }
          }
          if (workerData.pluginDir) {
            try {
              var localRequire = createRequire(workerData.pluginDir + '/index.js');
              return localRequire(moduleName);
            } catch (err) {
              throw new Error('Failed to load local dependency "' + moduleName + '": ' + err.message);
            }
          }
          throw new Error('Plugin cannot require non-shared module: ' + moduleName);
        }
      };

      // 调用 activate
      await plugin.activate(ctx, msg.prevState);

      parentPort.postMessage({ type: 'activated' });

      // 4. 停用请求（激活后注册，避免竞争）
      parentPort.on('message', async function handleDeactivate(dmsg) {
        if (dmsg.type === 'deactivate-request') {
          parentPort.removeListener('message', handleDeactivate);
          var state = undefined;
          try {
            if (typeof plugin.deactivate === 'function') {
              state = await plugin.deactivate();
            }
          } finally {
            // 清理 pending calls 和事件代理
            pendingCalls.clear();
            if (eventBusProxy) {
              eventBusProxy.disposeAll();
              eventBusProxy = null;
            }
            parentPort.postMessage({ type: 'deactivated', state: state });
          }
        }
      });
    } catch (err) {
      parentPort.postMessage({
        type: 'error',
        message: (err && err.message) ? err.message : String(err),
        stack: (err && err.stack) || ''
      });
    }
  }
});
`;
}

// ── WorkerManager ────────────────────────────────────────────────────────────

/**
 * WorkerManager — Worker 线程创建/终止管理器。
 *
 * **核心设计：** WorkerManager 不依赖 PluginHost（循环依赖已消除）。
 * PluginHost 通过 setter 接收 WorkerManager 引用。
 *
 * 构造函数参数：
 * - serviceRegistry: DI 容器，用于 ServiceHost 的 RPC 服务解析
 * - capabilityGuard: 能力守卫，用于 ServiceHost 的能力检查
 * - db: SQLite 数据库实例，用于 restoreWorkers
 *
 * @example
 * ```ts
 * const wm = new WorkerManager(serviceRegistry, capabilityGuard, db);
 * const { transport, serviceHost } = await wm.createWorker(
 *   'ext-my-service', manifest, sourceCode, ALL_SERVICE_TOKENS,
 * );
 * ```
 */
export class WorkerManager {
  /** Worker 注册表 */
  readonly registry = new WorkerRegistry();

  private serviceRegistry: ServiceRegistry;
  private capabilityGuard: CapabilityGuard;
  private db: Database;

  constructor(
    serviceRegistry: ServiceRegistry,
    capabilityGuard: CapabilityGuard,
    db: Database,
  ) {
    this.serviceRegistry = serviceRegistry;
    this.capabilityGuard = capabilityGuard;
    this.db = db;

    // Set up supervisor watchdog callbacks for auto-recovery
    this.registry.recreateWorkerCallback = async (
      pluginId,
      manifest,
      sourceCode,
      serviceTokens,
      eventBus,
      pluginDir,
    ) => {
      console.log(`[WorkerManager] Watchdog supervisor restarting worker for plugin "${pluginId}"`);
      await this.createWorker(
        pluginId,
        manifest,
        sourceCode,
        serviceTokens,
        eventBus,
        pluginDir,
      );
    };

    this.registry.onCircuitBreakerTriggered = async (pluginId) => {
      // Set plugin status to ERROR in database
      this.db.prepare("UPDATE plugins SET status = ? WHERE id = ?").run('error', pluginId);
      
      // Also publish plugin.crashed event to the EventBus
      try {
        const eventBusService = await this.serviceRegistry.resolve(IEventBusServiceToken);
        if (eventBusService) {
          eventBusService.publish({
            id: uuidv7(),
            type: 'plugin.crashed',
            source: 'worker-registry',
            payload: { pluginId },
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        console.error('[WorkerManager] Failed to publish plugin.crashed event:', err);
      }
    };
  }

  /**
   * 创建一个 Worker 隔离的插件实例。
   *
   * 流程（遵循 RESEARCH.md lines 868-963）：
   * 1. 检查 pluginId 是否已注册 → 抛出错误
   * 2. 检查 activeCount 是否达到上限（T-05-09）→ 抛出错误
   * 3. 生成引导代码 data URL
   * 4. 创建 Worker 线程
   * 5. 创建 NodeWorkerTransport
   * 6. 创建 ServiceHost（用于 RPC）
   * 7. 注册到 WorkerRegistry（含 crash 检测）
   * 8. 设置 transport.onMessage 路由到 ServiceHost
   * 9. 发送 activate 消息
   * 10. 等待 'activated' 响应（10s 超时）
   * 11. 返回 { transport, serviceHost }
   *
   * @param pluginId - 插件标识符
   * @param manifest - 插件 manifest
   * @param sourceCode - 插件源代码
   * @param serviceTokens - 服务 Token 名称列表
   * @param eventBus - 可选的 EventBus 实例，用于事件转发。提供时，Worker
   *                   的 subscribe 消息会创建 EventForwarder 订阅。
   * @returns transport 和 serviceHost
   * @throws WorkerActivateError — 创建失败
   * @throws WorkerTimeoutError — 激活超时
   * @throws Error — 已存在或达到上限
   */
  async createWorker(
    pluginId: string,
    manifest: Manifest,
    sourceCode: string,
    serviceTokens: string[],
    eventBus?: EventBus,
    pluginDir?: string,
    prevState?: any,
  ): Promise<{ transport: IWorkerTransport; serviceHost: ServiceHost }> {
    // 1. 检查重复
    if (this.registry.get(pluginId)) {
      throw new Error(`Worker already exists for plugin "${pluginId}"`);
    }

    // 2. T-05-09: DoS 上限控制
    if (this.registry.activeCount >= MAX_WORKERS) {
      throw new Error(
        `Cannot create Worker: maximum active Workers (${MAX_WORKERS}) reached`,
      );
    }

    // 3. 生成引导代码
    const bootstrapCode = generateBootstrapCode();
    const encodedBootstrap = Buffer.from(bootstrapCode, 'utf-8').toString(
      'base64',
    );
    const bootstrapDataUrl = `data:text/javascript;base64,${encodedBootstrap}`;

    // 4. 创建 Worker
    let worker: Worker;
    try {
      worker = new Worker(new URL(bootstrapDataUrl), {
        // Pass both the DB id (`pluginId` — used as the actor/registry key)
        // and `manifestId` (used as the namespace prefix for command types).
        // The two diverge for ZIP-uploaded plugins whose DB id is a generated
        // UUID while manifest.id is the plugin author's chosen name.
        workerData: { pluginId, manifestId: manifest.id, serviceTokens, pluginDir },
        eval: false,
        stdout: true,
        stderr: true,
      });
      const pluginLogger = createLogger(`Plugin:${manifest.id || pluginId}`);
      worker.stdout.on('data', (chunk) => {
        pluginLogger.info(chunk.toString().trim());
      });
      worker.stderr.on('data', (chunk) => {
        pluginLogger.error(chunk.toString().trim());
      });
    } catch (err) {
      throw new WorkerActivateError(
        pluginId,
        'Worker constructor failed',
        { cause: err instanceof Error ? err : undefined },
      );
    }

    // 5. 创建 Transport
    const transport = new NodeWorkerTransport(worker);

    // 6. 创建 ServiceHost（带可选的 EventBus 用于事件转发）
    const actorId = `plugin:${manifest.id}`;
    const manifestCaps = manifest.capabilitiesProposed ?? [];
    const serviceHost = new ServiceHost(
      this.serviceRegistry,
      this.capabilityGuard,
      actorId,
      manifestCaps,
      eventBus,  // optional: enables event forwarding
      undefined,
      // 7th arg is the namespace prefix used by the host-side
      // registerHandler/unregisterHandler intercept. It must be
      // `manifest.id` (NOT the DB UUID `pluginId`) so the prefix
      // matches what the frontend `ctx.invokeCommand` produces —
      // see packages/core/plugin-host/plugin-namespace.ts.
      manifest.id,
    );

    // 7. 注册到 WorkerRegistry（含 crash 检测）
    const createdAt = Date.now();
    this.registry.register(pluginId, {
      pluginId,
      worker,
      createdAt,
      status: 'running',
      transport,
      serviceHost,
      manifest,
      sourceCode,
      serviceTokens,
      eventBus,
      pluginDir,
    });

    // 8. 设置 transport 消息路由 → ServiceHost 及生命周期拦截
    let activationResolve: (() => void) | null = null;
    let activationReject: ((err: Error) => void) | null = null;

    transport.onMessage((msg: unknown) => {
      const typed = msg as { type?: string };
      if (typed.type === 'activated') {
        if (activationResolve) {
          activationResolve();
          activationResolve = null;
          activationReject = null;
        }
      } else if (typed.type === 'error') {
        if (activationReject) {
          activationReject(
            new WorkerActivateError(
              pluginId,
              (msg as { message?: string }).message ?? 'Unknown error',
            ),
          );
          activationResolve = null;
          activationReject = null;
        }
      }
      
      // 总是路由到 serviceHost，以处理其它 RPC/事件消息
      serviceHost.handleMessage(msg, transport);
    });

    // 9. 发送 activate 消息
    transport.postMessage({
      type: 'activate',
      pluginCode: sourceCode,
      manifest,
      serviceTokens,
      prevState,
    });

    // 10. 等待 'activated' 响应（10s 超时）
    try {
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          activationResolve = resolve;
          activationReject = reject;
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new WorkerTimeoutError(ACTIVATE_TIMEOUT_MS)),
            ACTIVATE_TIMEOUT_MS,
          ),
        ),
      ]);
    } catch (err) {
      // 激活失败 — 清理 Worker
      try {
        await serviceHost.dispose();
      } catch {}
      try {
        await worker.terminate();
      } catch {
        // 静默
      }
      this.registry.cleanup(pluginId);
      throw err;
    }

    // 11. 返回
    return { transport, serviceHost };
  }

  /**
   * 终止指定插件的 Worker 线程。
   *
   * 委托给 WorkerRegistry.terminate()。
   *
   * @param pluginId - 插件标识符
   */
  async terminateWorker(pluginId: string): Promise<any> {
    const instance = this.registry.get(pluginId);
    if (instance) {
      await instance.serviceHost.dispose();
    }
    return await this.registry.terminate(pluginId);
  }

  /**
   * 从数据库恢复所有 worker-mode 的活跃插件。
   *
   * 查询 execution_mode = 'worker' 且 status = 'active' 的插件，
   * 为每个插件重新创建 Worker。
   * 单个插件恢复失败不影响其他插件（独立 try/catch）。
   */
  async restoreWorkers(): Promise<void> {
    const plugins = this.db
      .prepare(
        "SELECT id, manifest, file_path, source_code FROM plugins WHERE status = 'active' AND execution_mode = 'worker'",
      )
      .all() as Array<{
      id: string;
      manifest: string;
      file_path?: string;
      source_code: string;
    }>;

    for (const row of plugins) {
      try {
        const manifest: Manifest = JSON.parse(row.manifest);
        // 优先从文件系统读取，fallback 到 DB source_code
        const code = (row.file_path && fs.existsSync(row.file_path))
          ? fs.readFileSync(row.file_path, 'utf-8')
          : row.source_code;
        await this.createWorker(
          row.id,
          manifest,
          code,
          ALL_SERVICE_TOKENS,
        );
        console.log(
          `[WorkerManager] Restored worker for plugin "${manifest.id}" (${row.id})`,
        );
      } catch (err) {
        console.error(
          `[WorkerManager] Failed to restore worker for plugin "${row.id}":`,
          err,
        );
      }
    }
  }
}
