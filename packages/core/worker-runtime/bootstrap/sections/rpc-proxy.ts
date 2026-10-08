/**
 * Bootstrap section 3/5 · 内联 RPC Proxy（在 Worker/子进程隔离上下文中运行）。
 *
 * 沙箱不能 import 宿主的模块 —— 那正是隔离的意义。所以 `resolvePluginCommandType`
 * 在这里是**一份拷贝**，行为必须与 `packages/core/plugin-host/plugin-namespace.ts`
 * 的实现一致。
 *
 * ⚠️ 这份拷贝**曾经漂移**：宿主侧有 UUID v7 短路，拷贝侧没有（两边当时都传
 * `manifest.id`，故未暴露）。现在由 `namespace-parity.test.ts` 强制两侧行为一致 ——
 * 不变量靠测试维持，不靠约定。
 */

export const RPC_PROXY_SECTION = `
// ── 内联 RPC Proxy 实现（在 Worker 隔离上下文中运行） ──

var pendingCalls = new Map();

// ── 插件命令命名空间解析（与 packages/core/plugin-host/plugin-namespace.ts
//    保持一致 — 单一真理源；Worker bootstrap 是动态生成的代码字符串，
//    无法通过 import 共享模块，因此内联一份，必须与源文件同步修改） ──
function resolvePluginCommandType(type, pluginId) {
  var prefix = pluginId + '.';
  if (type.indexOf(prefix) === 0) return type;
  // UUID v7 前缀 ⇒ 已是完全限定键。
  // 这一支曾经**缺失**，与 plugin-namespace.ts 的实现漂移。当时没暴露是因为
  // 两边都传 manifest.id；一旦某一侧改传 DB UUID 就会静默双重前缀，且无测试报警。
  // 现由 namespace-parity.test.ts 强制两侧对同一组用例行为一致。
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}\./i.test(type)) return type;
  return prefix + type;
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
          if (method === 'then' || method === 'catch' || method === 'finally' || typeof method === 'symbol') {
            return undefined;
          }
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
`;
