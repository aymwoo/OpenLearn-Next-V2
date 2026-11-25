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
  const statePatchCallbacks = [];
  const questionUpdateCallbacks = [];
  let currentContext = null;
  let currentQuestion = null;

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
      currentQuestion = currentContext.question || null;
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

    if (data.type === 'question.update') {
      currentQuestion = data.payload || null;
      for (let i = 0; i < questionUpdateCallbacks.length; i++) {
        try {
          questionUpdateCallbacks[i](currentQuestion);
        } catch (e) {
          console.error('[OpenLearnPluginBridge] questionUpdate callback error:', e);
        }
      }
      return;
    }

    if (data.type === 'state.patch') {
      for (let i = 0; i < statePatchCallbacks.length; i++) {
        try {
          statePatchCallbacks[i](data.payload || {});
        } catch (e) {
          console.error('[OpenLearnPluginBridge] statePatch callback error:', e);
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
    /**
     * 题型 UI 通道（仅 assessment.question_type 的沙箱页面可用）。
     *
     * 页面通过 setConfig / setAnswerKey / setValue 把状态写回宿主；
     * 宿主按角色校验（answer 只能写 value，review 只读）。
     */
    question: {
      getState: function () {
        return currentQuestion;
      },
      onUpdate: function (callback) {
        if (typeof callback === 'function') {
          if (currentQuestion) {
            try {
              callback(currentQuestion);
            } catch (e) {
              console.error('[OpenLearnPluginBridge] question onUpdate initial callback error:', e);
            }
          }
          questionUpdateCallbacks.push(callback);
        }
        return bridge;
      },
      setConfig: function (config) {
        return call('question.setConfig', [config]);
      },
      setAnswerKey: function (answerKey) {
        return call('question.setAnswerKey', [answerKey]);
      },
      setValue: function (value) {
        return call('question.setValue', [value]);
      },
    },
    /**
     * LearningSurface 渲染器事件（阶段 4）。
     *
     * 只上报进度与提交意图，不接触 attempt id / HTTP；宿主校验来源、
     * 渲染器归属与 payload 大小后写成统一 attempt。
     */
    surface: {
      progress: function (data) {
        post({ type: 'surface-event', event: 'progress', payload: data || {} });
      },
      submit: function (data) {
        post({ type: 'surface-event', event: 'submit', payload: data || {} });
      },
      onStatePatch: function (callback) {
        if (typeof callback === 'function') {
          statePatchCallbacks.push(callback);
        }
        return bridge;
      },
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
