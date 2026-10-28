/**
 * 插件可视化沙箱视图桥接脚本与常量 (Dual-Track UI Architecture Phase 1)
 *
 * 为运行在严格沙箱 iframe（sandbox="allow-scripts allow-forms allow-downloads"，不透明源）
 * 中的第三方插件 UI 页面提供与宿主系统双向安全通信通道。
 */

export const PLUGIN_VIEW_CHANNEL = 'ol-plugin-view';

export const PLUGIN_VIEW_CSP =
  "sandbox allow-scripts allow-forms allow-downloads; frame-ancestors 'self'; default-src 'self' 'unsafe-inline' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline' data: blob: https:; style-src-attr 'unsafe-inline'; connect-src 'self' blob: data: https:;";

export const PLUGIN_VIEW_BRIDGE_JS = `(function () {
  'use strict';
  const CHANNEL = 'ol-plugin-view';
  let targetOrigin = '*';
  const pending = new Map();
  const initCallbacks = [];
  const contextUpdateCallbacks = [];
  let currentContext = null;

  function post(msg) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(Object.assign({ channel: CHANNEL }, msg), targetOrigin);
    }
  }

  function call(op, args) {
    const callId = Math.random().toString(16).slice(2) + Date.now().toString(16);
    return new Promise(function (resolve, reject) {
      pending.set(callId, { resolve: resolve, reject: reject });
      post({ type: 'call', callId: callId, op: op, args: args || [] });
    });
  }

  window.addEventListener('message', function (event) {
    const data = event.data;
    if (!data || data.channel !== CHANNEL) return;
    if (event.source !== window.parent) return;

    if (data.type === 'init') {
      currentContext = data.payload || {};
      targetOrigin = event.origin && event.origin !== 'null' ? event.origin : '*';
      for (let i = 0; i < initCallbacks.length; i++) {
        try {
          initCallbacks[i](currentContext);
        } catch (e) {
          console.error('[OpenLearnPluginBridge] init callback error:', e);
        }
      }
      return;
    }

    if (data.type === 'context-update') {
      currentContext = Object.assign({}, currentContext, data.payload || {});
      for (let i = 0; i < contextUpdateCallbacks.length; i++) {
        try {
          contextUpdateCallbacks[i](currentContext);
        } catch (e) {
          console.error('[OpenLearnPluginBridge] contextUpdate callback error:', e);
        }
      }
      return;
    }

    if (data.type === 'reply') {
      const waiter = pending.get(data.callId);
      if (!waiter) return;
      pending.delete(data.callId);
      if (data.ok) {
        waiter.resolve(data.value);
      } else {
        waiter.reject(new Error(data.error || 'bridge call failed'));
      }
      return;
    }
  });

  const bridge = {
    CHANNEL: CHANNEL,
    onInit: function (callback) {
      if (typeof callback === 'function') {
        if (currentContext) {
          try {
            callback(currentContext);
          } catch (e) {
            console.error('[OpenLearnPluginBridge] onInit callback error:', e);
          }
        }
        initCallbacks.push(callback);
      }
      return bridge;
    },
    onContextUpdate: function (callback) {
      if (typeof callback === 'function') {
        contextUpdateCallbacks.push(callback);
      }
      return bridge;
    },
    getContext: function () {
      return currentContext;
    },
    ui: {
      toast: function (message, type) {
        return call('ui.toast', [message, type || 'info']);
      },
      showToast: function (message, type) {
        return call('ui.toast', [message, type || 'info']);
      },
      resize: function (height) {
        post({ type: 'resize', height: Number(height) || 0 });
      },
    },
    invokeCommand: function (type, payload) {
      return call('command.invoke', [type, payload]);
    },
    api: {
      get: function (path) {
        return call('api.get', [path]);
      },
      post: function (path, body) {
        return call('api.post', [path, body]);
      },
      del: function (path) {
        return call('api.del', [path]);
      },
    },
    storage: {
      get: function (key) {
        return call('storage.get', [key]);
      },
      set: function (key, value) {
        return call('storage.set', [key, value]);
      },
      delete: function (key) {
        return call('storage.delete', [key]);
      },
    },
  };

  window.OpenLearnPluginBridge = bridge;
  // 通知宿主视图沙箱 iframe 已就绪
  post({ type: 'ready' });
})();
`;
