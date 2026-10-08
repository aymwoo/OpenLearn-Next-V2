/**
 * Bootstrap section 5/5 · 单消息处理器。
 *
 * 体积最大的一段（激活、停用、存活探针、命令注册、HTTP 路由、事件代理、
 * 能力获取都在这里）。**任何改动都要过 `worker-runtime/__tests__/` 全套** ——
 * 这段逻辑只有在真跑 worker/子进程时才会执行，单测覆盖不到。
 */

export const MESSAGE_HANDLER_SECTION = `
// ── 单消息处理器 ──

var eventBusProxy = null;
var registeredCommandHandlers = new Map();
var pluginHttpRouter = createPluginHttpRouter();
var activeWorkerStreams = new Map();

parentPort.on('message', async function(msg) {
  // 0. 存活探针（L-1 P0）—— 必须放在所有分支之前。
  //
  // 为什么在最前面：探针的判据是「事件循环还能不能响应」。
  // 一旦插件进入同步死循环，本函数根本不会被再次调用，任何放在后面的处理都无意义；
  // 而放在最前面能保证只要事件循环还转，pong 一定立刻返回。
  //
  // 为什么需要它：一个写 while(true) 的插件会永久占住一个 Worker 槽位（上限 32），
  // 打满即全平台 DoS。崩溃看门狗监听 exit 事件，而死循环**不产生 exit**，故永不触发。
  // terminate() 本身是有效的（实测 3/3 轮 2-3ms 杀得掉），缺的只是「有人去杀」。
  if (msg && msg.type === 'ping') {
    parentPort.postMessage({ type: 'pong', seq: msg.seq });
    return;
  }

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

  // 1c. Intercept HTTP request from host (V5.2)
  if (msg && msg.type === 'httpRequest') {
    try {
      var res = await pluginHttpRouter.handle(msg.request);
      parentPort.postMessage({
        type: 'httpResponse',
        invokeId: msg.invokeId,
        response: res
      });
    } catch (err) {
      parentPort.postMessage({
        type: 'httpResponse',
        invokeId: msg.invokeId,
        error: {
          message: (err && err.message) ? err.message : String(err),
          stack: (err && err.stack) || ''
        }
      });
    }
    return;
  }

  // 1d. Intercept HTTP stream start from host (V5.3)
  if (msg && msg.type === 'httpStreamStart') {
    var streamId = msg.streamId;
    var isStreamClosed = false;
    var closeCallbacks = [];

    var streamWriter = {
      get isClosed() {
        return isStreamClosed;
      },
      write: function(data, event, id) {
        if (isStreamClosed) return false;
        var rawStr = typeof data === 'string' ? data : JSON.stringify(data);
        if (rawStr.length > 65536) {
          throw new Error('Chunk size exceeds 64KB limit');
        }
        parentPort.postMessage({
          type: 'httpStreamChunk',
          streamId: streamId,
          data: data,
          event: event,
          id: id
        });
        return true;
      },
      end: function() {
        if (isStreamClosed) return;
        isStreamClosed = true;
        activeWorkerStreams.delete(streamId);
        parentPort.postMessage({
          type: 'httpStreamEnd',
          streamId: streamId
        });
      },
      error: function(err) {
        if (isStreamClosed) return;
        isStreamClosed = true;
        activeWorkerStreams.delete(streamId);
        parentPort.postMessage({
          type: 'httpStreamError',
          streamId: streamId,
          error: {
            message: (err && err.message) ? err.message : String(err),
            stack: (err && err.stack) || ''
          }
        });
      },
      onClose: function(callback) {
        if (typeof callback === 'function') {
          if (isStreamClosed) {
            try { callback(); } catch(e) {}
          } else {
            closeCallbacks.push(callback);
          }
        }
      }
    };

    activeWorkerStreams.set(streamId, {
      stream: streamWriter,
      abort: function() {
        if (isStreamClosed) return;
        isStreamClosed = true;
        activeWorkerStreams.delete(streamId);
        for (var i = 0; i < closeCallbacks.length; i++) {
          try {
            closeCallbacks[i]();
          } catch(e) {
            console.error('[WorkerStream] Error in onClose callback:', e);
          }
        }
      }
    });

    pluginHttpRouter.handleStream(msg.request, streamWriter).catch(function(err) {
      streamWriter.error(err);
    });
    return;
  }

  // 1e. Intercept HTTP stream abort from host (V5.3)
  if (msg && msg.type === 'httpStreamAbort') {
    var activeToAbort = activeWorkerStreams.get(msg.streamId);
    if (activeToAbort) {
      activeToAbort.abort();
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
        setInterceptor: function(_interceptor) {
          throw new Error('[Security] setInterceptor cannot be configured from Worker PluginContext');
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
      // 表前缀必须用 manifestId（与命令命名空间 L525 及 ServiceHost 的 DDL 守卫一致），
      // 否则 Worker 插件在自己命名空间建表会被误判为越权 DDL。
      var tablePrefix = 'plugin_' + (workerData.manifestId || workerData.pluginId).replace(/[^a-zA-Z0-9_]/g, '_') + '_';
      var dbService = rawServices['@openlearn/core:IDatabase'];
      var dbApi = dbService ? {
        ensureTable: function(tableName, schema) {
          // SEC: tableName / schema 由插件提供，属不可信输入。直接拼接会导致 SQL 注入
          // （例如 tableName = "t (x); DROP TABLE events; --"）。此处强制标识符白名单
          // 并禁止 schema 中的分号，避免多语句注入。与 inline 模式保持一致。
          if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(String(tableName))) {
            throw new Error("[SEC] Invalid SQL identifier for ensureTable: " + String(tableName));
          }
          if (typeof schema !== "string" || schema.length === 0 || schema.length > 4000 || schema.indexOf(";") !== -1) {
            throw new Error("[SEC] Invalid CREATE TABLE schema fragment: must be non-empty and contain no semicolon");
          }
          var fullName = tablePrefix + tableName;
          return dbService.prepareAndRun('CREATE TABLE IF NOT EXISTS ' + fullName + ' (' + schema + ')', []);
        },
        table: function(tableName) {
          if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(String(tableName))) {
            throw new Error("[SEC] Invalid SQL identifier for table(): " + String(tableName));
          }
          return tablePrefix + tableName;
        },
        dropAllTables: async function() {
          var tables = await dbService.prepareAndAll("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ?", [tablePrefix + '%']);
          for (var i = 0; i < tables.length; i++) {
            // SEC: 表名来自 sqlite_master，仍二次校验后再拼进 DDL
            if (!/^plugin_[A-Za-z0-9_]+$/.test(String(tables[i].name))) continue;
            await dbService.prepareAndRun('DROP TABLE IF EXISTS ' + tables[i].name, []);
          }
        },
        migrate: async function(targetVersion, upgradeFn) {
          await dbService.prepareAndRun('CREATE TABLE IF NOT EXISTS plugin_migrations (plugin_id TEXT PRIMARY KEY, version INTEGER NOT NULL)', []);
          var row = await dbService.prepareAndGet('SELECT version FROM plugin_migrations WHERE plugin_id = ?', [workerData.pluginId]);
          var currentVersion = row ? row.version : 0;
          if (currentVersion < targetVersion) {
            var pendingPromises = [];
            var dbWrapper = {
              prepare: function(sql) {
                return {
                  run: function() {
                    var args = Array.prototype.slice.call(arguments);
                    var p = dbService.prepareAndRun(sql, args);
                    pendingPromises.push(p);
                    return p;
                  },
                  get: function() {
                    var args = Array.prototype.slice.call(arguments);
                    var p = dbService.prepareAndGet(sql, args);
                    pendingPromises.push(p);
                    return p;
                  },
                  all: function() {
                    var args = Array.prototype.slice.call(arguments);
                    var p = dbService.prepareAndAll(sql, args);
                    pendingPromises.push(p);
                    return p;
                  }
                };
              }
            };
            await upgradeFn(dbWrapper);
            if (pendingPromises.length > 0) {
              await Promise.all(pendingPromises);
            }
            await dbService.prepareAndRun('INSERT OR REPLACE INTO plugin_migrations (plugin_id, version) VALUES (?, ?)', [workerData.pluginId, targetVersion]);
          }
        }
      } : undefined;

      var PLUGIN_SHARED_MODULES = ['recharts', 'react-markdown', 'jspdf', 'jspdf-autotable', 'exceljs', 'lucide-react', 'uuid'];

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
        reportProgress: function(stage, message) {
          try {
            parentPort.postMessage({
              type: 'activate-progress',
              stage: stage || 'progress',
              message: message || ''
            });
          } catch (e) {}
        },
        resolve: async function(token) {
          var tokenName = typeof token === 'string' ? token : (token && token.name);
          if (!tokenName) throw new Error('Invalid token');
          var svc = services[tokenName];
          if (!svc) throw new Error('No provider registered for token: ' + tokenName);
          if (tokenName === '@openlearn/core:IDatabase') {
            return {
              // 主侧 exec RPC 已过 assertDatabaseAccessAllowed 守卫（DDL 命名空间 + 核心表黑名单），
              // 这里补齐转发，避免 worker 插件调用 exec 时报 "rawDb.exec is not a function"。
              // 注意返回 Promise（异步 RPC），与 prepare* 一致。
              exec: function(sql) {
                return svc.exec(sql);
              },
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
          var BLOCKED_NATIVE_MODULES = [
            'child_process', 'node:child_process',
            'fs', 'node:fs', 'fs/promises', 'node:fs/promises',
            'net', 'node:net',
            'http', 'node:http', 'https', 'node:https', 'http2', 'node:http2',
            'dgram', 'node:dgram', 'dns', 'node:dns',
            'cluster', 'node:cluster',
            'worker_threads', 'node:worker_threads',
            'vm', 'node:vm',
            'v8', 'node:v8',
            'wasi', 'node:wasi'
          ];
          if (BLOCKED_NATIVE_MODULES.indexOf(moduleName) !== -1) {
            throw new Error('[SecurityError] Direct access to Node.js native module "' + moduleName + '" is forbidden in plugin worker sandbox.');
          }
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
              var resolvedPath = localRequire.resolve(moduleName);
              var normResolved = String(resolvedPath).replaceAll('\\\\', '/');
              var normDir = String(workerData.pluginDir).replaceAll('\\\\', '/');
              if (normResolved.indexOf(normDir + '/node_modules/') !== 0) {
                throw new Error('Module "' + moduleName + '" cannot be resolved from host root node_modules');
              }
              return localRequire(moduleName);
            } catch (err) {
              throw new Error('Failed to load local dependency "' + moduleName + '": ' + err.message);
            }
          }
          throw new Error('Plugin cannot require non-shared module: ' + moduleName);
        },
        http: pluginHttpRouter
      };

      // 调用 activate
      await plugin.activate(ctx, msg.prevState);

      // 上报已注册路由元数据给宿主
      if (pluginHttpRouter) {
        parentPort.postMessage({
          type: 'routesRegistered',
          routes: pluginHttpRouter.getRegisteredRoutes()
        });
      }

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
            // 清理 pending calls、活跃流、事件代理与 HTTP 路由
            pendingCalls.clear();
            if (activeWorkerStreams) {
              for (var s of activeWorkerStreams.values()) {
                try { s.abort(); } catch(e) {}
              }
              activeWorkerStreams.clear();
            }
            if (eventBusProxy) {
              eventBusProxy.disposeAll();
              eventBusProxy = null;
            }
            if (pluginHttpRouter) {
              pluginHttpRouter.clear();
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
