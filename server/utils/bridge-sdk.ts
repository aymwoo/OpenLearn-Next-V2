/**
 * LMS Bridge SDK — 课件与宿主 iframe 通信桥接代码。
 *
 * 服务端：注入到课件 HTML 中（injectLmsSdk），或通过 /bridge.js 路由提供。
 * 前端白板：wrapSrcDocWithBridge() 中通过 <script src="/bridge.js"> 引用。
 */
export const BRIDGE_SDK_CODE = `(function() {
  // Mock document.cookie to prevent SecurityError in sandboxed iframes lacking 'allow-same-origin'
  try {
    Object.defineProperty(document, 'cookie', {
      get: function() { return ""; },
      set: function(val) {},
      configurable: true
    });
  } catch (e) {
    try {
      Object.defineProperty(Document.prototype, 'cookie', {
        get: function() { return ""; },
        set: function(val) {},
        configurable: true
      });
    } catch (err) {}
  }

  // ── Helper: create a safe postMessage wrapper that normalises 'null' → '*' ──
  function __makeSafePostMessage(realTarget, label) {
    return function(message, targetOrigin, transfer) {
      try {
        if (message && typeof message === 'object') {
          if (!message.attempt_id && window.__LMS_STUDENT__?.attempt_id) {
            message.attempt_id = window.__LMS_STUDENT__.attempt_id;
          }
          if (!message.uuid && window.__LMS_COURSEWARE__?.uuid) {
            message.uuid = window.__LMS_COURSEWARE__.uuid;
          }
        }
      } catch (e) {}

      var origin = targetOrigin;
      if (origin === 'null' || origin === null || origin === undefined) {
        console.warn('[LMS Bridge Notice] Normalized invalid targetOrigin "' + origin + '" to "*" for ' + label);
        origin = '*';
      }
      try {
        return realTarget.postMessage.call(realTarget, message, origin, transfer);
      } catch (err) {
        if (err.name === 'SyntaxError' && origin !== '*') {
          console.warn('[LMS Bridge Notice] Recovered SyntaxError on ' + label + ', fallback to "*"', err);
          return realTarget.postMessage.call(realTarget, message, '*', transfer);
        }
        throw err;
      }
    };
  }

  // ── Helper: create a Proxy wrapper around a cross-origin WindowProxy ──
  //    This is necessary because sandboxed iframes (without allow-same-origin)
  //    cannot set properties on cross-origin WindowProxy objects.
  //    We use Object.defineProperty to shadow window.parent / window.top
  //    with a Proxy that intercepts the .postMessage() call.
  function __proxyWindow(realRef, propName) {
    try {
      var safePost = __makeSafePostMessage(realRef, propName + '.postMessage');
      var proxyObj = new Proxy(realRef, {
        get: function(target, prop) {
          if (prop === 'postMessage') return safePost;
          try {
            var val = target[prop];
            if (typeof val === 'function') return val.bind(target);
            return val;
          } catch (e) { return undefined; }
        }
      });
      Object.defineProperty(window, propName, {
        get: function() { return proxyObj; },
        configurable: true
      });
    } catch (e) {
      // Proxy or defineProperty not supported, fall back to direct override attempt
      try { realRef.postMessage = __makeSafePostMessage(realRef, propName + '.postMessage (fallback)'); } catch (_) {}
    }
  }

  // Proxy postMessage calls to enrich them with attempt_id/uuid and normalize targetOrigin
  try {
    // 1. Override window.postMessage (self-targeting, always works)
    var originalPostMessage = window.postMessage;
    window.postMessage = function(message, targetOrigin, transfer) {
      try {
        if (message && typeof message === 'object') {
          if (!message.attempt_id && window.__LMS_STUDENT__?.attempt_id) {
            message.attempt_id = window.__LMS_STUDENT__.attempt_id;
          }
          if (!message.uuid && window.__LMS_COURSEWARE__?.uuid) {
            message.uuid = window.__LMS_COURSEWARE__.uuid;
          }
        }
      } catch (e) {}
      
      var origin = targetOrigin;
      if (origin === 'null' || origin === null || origin === undefined) {
        console.warn('[LMS Bridge Notice] Normalized invalid targetOrigin "null" to "*" for postMessage call');
        origin = '*';
      }
      try {
        return originalPostMessage.call(this, message, origin, transfer);
      } catch (err) {
        if (err.name === 'SyntaxError' && origin !== '*') {
          console.warn('[LMS Bridge Notice] Recovered SyntaxError on postMessage, fallback targetOrigin to "*"', err);
          return originalPostMessage.call(this, message, '*', transfer);
        }
        throw err;
      }
    };

    // 2. Shadow window.parent with a Proxy that intercepts .postMessage()
    if (window.parent && window.parent !== window) {
      __proxyWindow(window.parent, 'parent');
    }

    // 3. Shadow window.top with a Proxy that intercepts .postMessage()
    try {
      if (window.top && window.top !== window) {
        __proxyWindow(window.top, 'top');
      }
    } catch (e) {}

    // 4. Intercept message event listeners to sanitize event.source.postMessage replies
    var origAddEventListener = window.addEventListener;
    if (typeof origAddEventListener === 'function') {
      window.addEventListener = function(type, listener, options) {
        if (type === 'message' && typeof listener === 'function') {
          var wrappedListener = function(event) {
            try {
              if (event && event.source && typeof event.source.postMessage === 'function') {
                var origSourcePostMessage = event.source.postMessage;
                event.source.postMessage = function(msg, targetOrigin, transfer) {
                  var origin = targetOrigin;
                  if (origin === 'null' || origin === null) {
                    console.warn('[LMS Bridge Notice] Normalized invalid targetOrigin "null" to "*" on event.source.postMessage');
                    origin = '*';
                  }
                  try {
                    return origSourcePostMessage.call(event.source, msg, origin, transfer);
                  } catch (err) {
                    if (err.name === 'SyntaxError' && origin !== '*') {
                      console.warn('[LMS Bridge Notice] Recovered SyntaxError on event.source.postMessage, fallback to "*"', err);
                      return origSourcePostMessage.call(event.source, msg, '*', transfer);
                    }
                    throw err;
                  }
                };
              }
            } catch (e) {}
            return listener.apply(this, arguments);
          };
          return origAddEventListener.call(this, type, wrappedListener, options);
        }
        return origAddEventListener.apply(this, arguments);
      };
    }
  } catch (e) {}

  // ── Bidirectional host→courseware command bus & Theme Bridge ──
  var __lmsHandlers = {};
  var __lmsPendingRequests = {};

  function __applyThemeTokens(themeData) {
    if (!themeData || typeof themeData !== 'object') return;
    try {
      window.__LMS_THEME__ = themeData;
      var docEl = document.documentElement;
      if (docEl) {
        if (themeData.theme) {
          docEl.setAttribute('data-theme', themeData.theme);
        }
        if (themeData.tokens && typeof themeData.tokens === 'object') {
          for (var k in themeData.tokens) {
            if (Object.prototype.hasOwnProperty.call(themeData.tokens, k)) {
              docEl.style.setProperty(k, themeData.tokens[k]);
            }
          }
        }
      }
    } catch (e) {}
  }

  if (window.__LMS_THEME__) {
    __applyThemeTokens(window.__LMS_THEME__);
  }

  window.addEventListener('message', function(event) {
    var d = event.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'LMS_HOST_COMMAND' && d.event) {
      if (d.event === 'theme:changed' && d.payload) {
        __applyThemeTokens(d.payload);
      }
      var cbs = __lmsHandlers[d.event] || [];
      for (var i = 0; i < cbs.length; i++) {
        try { cbs[i](d.payload); } catch (e) {}
      }
    } else if (d.type === 'LMS_THEME_CHANGED' && (d.theme || d.tokens)) {
      __applyThemeTokens(d);
      var themeCbs = __lmsHandlers['theme:changed'] || [];
      for (var j = 0; j < themeCbs.length; j++) {
        try { themeCbs[j](d); } catch (e) {}
      }
    } else if (d.type === 'LMS_PROGRESS_RESPONSE' && d.requestId) {
      var pending = __lmsPendingRequests[d.requestId];
      if (pending) {
        delete __lmsPendingRequests[d.requestId];
        clearTimeout(pending.timer);
        pending.resolve(d.progress || null);
      }
    }
  });

  window.LMS = {
    submit(data) {
      window.parent.postMessage({
        type: "LMS_SUBMIT",
        uuid: window.__LMS_COURSEWARE__?.uuid,
        attempt_id: window.__LMS_STUDENT__?.attempt_id,
        payload: data
      }, "*");
    },
    saveProgress(data) {
      window.parent.postMessage({
        type: "LMS_SAVE_PROGRESS",
        uuid: window.__LMS_COURSEWARE__?.uuid,
        attempt_id: window.__LMS_STUDENT__?.attempt_id,
        payload: data
      }, "*");
    },
    finish(data) {
      window.parent.postMessage({
        type: "LMS_FINISH",
        uuid: window.__LMS_COURSEWARE__?.uuid,
        attempt_id: window.__LMS_STUDENT__?.attempt_id,
        payload: data
      }, "*");
    },
    getStudent() {
      return window.__LMS_STUDENT__;
    },
    getCourseware() {
      return window.__LMS_COURSEWARE__;
    },
    getTheme() {
      return window.__LMS_THEME__ || null;
    },
    log(event, data) {
      window.parent.postMessage({
        type: "LMS_LOG",
        uuid: window.__LMS_COURSEWARE__?.uuid,
        attempt_id: window.__LMS_STUDENT__?.attempt_id,
        event: event,
        payload: data
      }, "*");
    },
    on(event, callback) {
      (__lmsHandlers[event] = __lmsHandlers[event] || []).push(callback);
      return function() {
        var arr = __lmsHandlers[event] || [];
        var idx = arr.indexOf(callback);
        if (idx >= 0) arr.splice(idx, 1);
      };
    },
    off(event, callback) {
      var arr = __lmsHandlers[event] || [];
      var idx = arr.indexOf(callback);
      if (idx >= 0) arr.splice(idx, 1);
    },
    setConfig(config) {
      window.parent.postMessage({
        type: "LMS_CONFIG",
        uuid: window.__LMS_COURSEWARE__?.uuid,
        attempt_id: window.__LMS_STUDENT__?.attempt_id,
        config: config
      }, "*");
    },
    getProgress() {
      return new Promise(function(resolve) {
        var requestId = 'prog_' + Math.random().toString(36).slice(2) + '_' + Date.now();
        var timer = setTimeout(function() {
          delete __lmsPendingRequests[requestId];
          resolve(null);
        }, 5000);
        __lmsPendingRequests[requestId] = { resolve: resolve, timer: timer };
        window.parent.postMessage({
          type: "LMS_GET_PROGRESS",
          uuid: window.__LMS_COURSEWARE__?.uuid,
          attempt_id: window.__LMS_STUDENT__?.attempt_id,
          requestId: requestId
        }, "*");
      });
    }
  };

  try {
    if (window.fetch) {
      const originalFetch = window.fetch;
      window.fetch = function(input, init) {
        try {
          const url = (typeof input === 'string') ? input : (input?.url || '');
          const method = init?.method || input?.method || 'GET';
          const headers = init?.headers || input?.headers || {};
          let body = init?.body || input?.body || null;

          if (body && typeof body === 'object') {
            try { body = JSON.stringify(body); } catch(e){}
          }

          if (url && !url.includes('/api/courseware/attempts/')) {
            window.parent.postMessage({
              type: "HOOK_FETCH",
              uuid: window.__LMS_COURSEWARE__?.uuid,
              attempt_id: window.__LMS_STUDENT__?.attempt_id,
              payload: { url, method, headers: JSON.parse(JSON.stringify(headers)), body: body ? body.toString() : null }
            }, "*");
          }
        } catch (e) {
          console.error("Bridge Hook fetch error", e);
        }
        return originalFetch.apply(this, arguments);
      };
    }

    if (window.XMLHttpRequest) {
      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url) {
        this._method = method;
        this._url = url;
        return originalOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function(body) {
        try {
          let bodyStr = body;
          if (body && typeof body === 'object') {
            try { bodyStr = JSON.stringify(body); } catch(e){}
          }
          if (this._url && !this._url.includes('/api/courseware/attempts/')) {
            window.parent.postMessage({
              type: "HOOK_XHR",
              uuid: window.__LMS_COURSEWARE__?.uuid,
              attempt_id: window.__LMS_STUDENT__?.attempt_id,
              payload: { url: this._url, method: this._method, body: bodyStr ? bodyStr.toString() : null }
            }, "*");
          }
        } catch (e) {
          console.error("Bridge Hook XHR error", e);
        }
        return originalSend.apply(this, arguments);
      };
    }

    function attachToAxios(axiosInstance) {
      if (axiosInstance && axiosInstance.interceptors && axiosInstance.interceptors.request) {
        axiosInstance.interceptors.request.use(function(config) {
          try {
            if (config.url && !config.url.includes('/api/courseware/attempts/')) {
              window.parent.postMessage({
                type: "HOOK_AXIOS",
                uuid: window.__LMS_COURSEWARE__?.uuid,
                attempt_id: window.__LMS_STUDENT__?.attempt_id,
                payload: { url: config.url, method: config.method, data: config.data }
              }, "*");
            }
          } catch (e) {
            console.error("Bridge Hook Axios error", e);
          }
          return config;
        }, function(error) { return Promise.reject(error); });
      }
    }
    if (window.axios) {
      attachToAxios(window.axios);
    }
    var _axios = window.axios;
    Object.defineProperty(window, 'axios', {
      get: function() { return _axios; },
      set: function(val) {
        _axios = val;
        attachToAxios(val);
      },
      configurable: true
    });

    if (navigator && navigator.sendBeacon) {
      const originalSendBeacon = navigator.sendBeacon;
      navigator.sendBeacon = function(url, data) {
        try {
          if (url && !url.includes('/api/courseware/attempts/')) {
            window.parent.postMessage({
              type: "HOOK_BEACON",
              uuid: window.__LMS_COURSEWARE__?.uuid,
              attempt_id: window.__LMS_STUDENT__?.attempt_id,
              payload: { url: url, data: data ? data.toString() : null }
            }, "*");
          }
        } catch (e) {
          console.error("Bridge Hook Beacon error", e);
        }
        return originalSendBeacon.apply(this, arguments);
      };
    }

    window.addEventListener('submit', function(e) {
      try {
        const form = e.target;
        const formData = new FormData(form);
        const data = {};
        formData.forEach(function(value, key) {
          data[key] = value;
        });
        if (form.action && !form.action.includes('/api/courseware/attempts/')) {
          window.parent.postMessage({
            type: "HOOK_FORM",
            uuid: window.__LMS_COURSEWARE__?.uuid,
            attempt_id: window.__LMS_STUDENT__?.attempt_id,
            payload: { action: form.action, method: form.method, data: data }
          }, "*");
        }
      } catch (err) {
        console.error("Bridge Hook Form error", err);
      }
    }, true);

    // --- SMART DOM SCRAPER FOR GENERIC COURSEWARES ---
    function logToServer(msg, detail) {
      // 仅 console 输出；网络请求可能被浏览器 HTTPS 升级导致 ERR_CONNECTION_REFUSED
      try {
        console.log('[LMS Debug]', msg, detail || '');
      } catch (e) {}
    }

    function findScoreInDOM() {
      const logData = [];
      try {
        const commonVars = ['score', 'points', 'grade', 'totalScore', 'currentScore', 'userScore', 'finalScore', 'correctCount'];
        for (const v of commonVars) {
          if (typeof window[v] === 'number') {
            logData.push("Global var " + v + " is number: " + window[v]);
            return { score: window[v], log: logData };
          }
          if (typeof window[v] === 'string') {
            const num = parseFloat(window[v]);
            if (!isNaN(num)) {
              logData.push("Global var " + v + " is string with number: " + window[v]);
              return { score: num, log: logData };
            }
          }
        }

        const selectors = [
          '#score', '#scoreDisplay', '#score-num', '#scoreDisplaySpan', '#points', '#grade',
          '.score', '.points', '.grade', '.score-num', '.score-value',
          '[id*="score" i]', '[id*="point" i]', '[id*="grade" i]', '[id*="result" i]',
          '[class*="score" i]', '[class*="point" i]', '[class*="grade" i]', '[class*="result" i]'
        ];

        for (const selector of selectors) {
          try {
            const el = document.querySelector(selector);
            if (el) {
              const text = (el.textContent || el.innerText || '').trim();
              if (text) {
                logData.push("Selector '" + selector + "' matched text: '" + text + "'");
                const fractionMatch = text.match(/(\\d+(\\.\\d+)?)\\s*[\\/|之]\\s*(\\d+)/);
                if (fractionMatch) {
                  const num = parseFloat(fractionMatch[1]);
                  const den = parseFloat(fractionMatch[3]);
                  if (den > 0) {
                    const pct = (num / den) * 100;
                    logData.push("Parsed fraction: " + num + "/" + den + " -> " + pct);
                    return { score: pct, log: logData };
                  }
                }
                const match = text.match(/\\d+(\\.\\d+)?/);
                if (match) {
                  const num = parseFloat(match[0]);
                  if (!isNaN(num)) {
                    logData.push("Parsed decimal: " + num);
                    return { score: num, log: logData };
                  }
                }
              }
            }
          } catch (e) {}
        }

        try {
          const inputs = document.querySelectorAll('input[type="text"], input[type="number"], input[readonly]');
          for (const input of inputs) {
            const id = (input.id || '').toLowerCase();
            const name = (input.name || '').toLowerCase();
            if (id.includes('score') || name.includes('score') || id.includes('point') || name.includes('point')) {
              const val = parseFloat(input.value);
              if (!isNaN(val)) {
                logData.push("Input id=" + id + " name=" + name + " value: " + input.value);
                return { score: val, log: logData };
              }
            }
          }
        } catch (e) {}

        try {
          const all = document.getElementsByTagName('*');
          const ignoredTags = ['style', 'script', 'link', 'meta', 'svg', 'canvas', 'noscript', 'head', 'iframe'];
          for (let i = 0; i < all.length; i++) {
            const el = all[i];
            const tag = (el.tagName || '').toLowerCase();
            if (ignoredTags.indexOf(tag) >= 0) continue;

            if (el.children.length === 0) {
              const txt = (el.textContent || el.innerText || '').trim();
              if (txt) {
                const hasKey = txt.includes('得分') || txt.includes('分数') || txt.includes('成绩') || txt.toLowerCase().includes('score') || txt.toLowerCase().includes('points');
                if (hasKey) {
                  const m = txt.match(/\\d+(\\.\\d+)?/);
                  if (m) {
                    const val = parseFloat(m[0]);
                    logData.push("Fallback leaf <" + el.tagName + "> '" + txt + "' parsed: " + val);
                    return { score: val, log: logData };
                  }
                }
              }
            }
          }
        } catch (e) {}

      } catch (err) {
        logData.push("Scraper error: " + err.message);
      }
      return { score: null, log: logData };
    }

    // --- RESULT-SCREEN AUTO SUBMIT ---------------------------------------
    // 部分课件答完题后直接切到「结算 / 结果页」，并不点击任何提交按钮。
    // 这里监听结算页出现，自动抓取分数并上报一次。
    // 口径优先「正确题数 X/Y」→ 百分制，否则回落可见的分数元素。
    var __lmsResultSubmitted = false;
    var __lmsResultScheduled = false;
    var __lmsResultPolling = false;

    // 强结束信号：只认结算/结果页文案，避免答题过程中误触发
    var __LMS_DONE_RE = /(闯关|挑战|答题|测试|游戏|本轮|本关)(结束|完成|成功)|通关|结算|查看解析|正确率|最终得分|总得分|全部答完|答题完毕/;
    // 用 [0-9] / [^0-9] 代替 \\d / \\s，规避模板字符串的转义陷阱
    var __LMS_RATIO_RE = /([0-9]+(?:[.][0-9]+)?)[^0-9]*[/／|之][^0-9]*([0-9]+)/;
    var __LMS_NUM_RE = /[0-9]+(?:[.][0-9]+)?/;

    function __lmsVisibleText() {
      try {
        if (!document.body) return '';
        if (typeof document.body.innerText === 'string') return document.body.innerText;
        return document.body.textContent || '';
      } catch (e) { return ''; }
    }

    function __lmsIsShown(el) {
      try {
        if (!el || !el.getBoundingClientRect) return false;
        var rect = el.getBoundingClientRect();
        if (rect.width <= 0 && rect.height <= 0) return false;
        var node = el;
        while (node && node.nodeType === 1) {
          var st = window.getComputedStyle ? window.getComputedStyle(node) : null;
          if (st && (st.display === 'none' || st.visibility === 'hidden')) return false;
          node = node.parentElement;
        }
        return true;
      } catch (e) { return false; }
    }

    // 仅从「可见」的分数元素取值，避免结算页尚未展开时读到隐藏的初始值 0
    function __lmsFindVisibleScore() {
      var selectors = [
        '#finalScore', '#score', '#scoreDisplay', '.score', '.final-score',
        '[id*="score" i]', '[id*="point" i]', '[id*="grade" i]'
      ];
      for (var i = 0; i < selectors.length; i++) {
        var nodes = [];
        try { nodes = document.querySelectorAll(selectors[i]); } catch (e) { nodes = []; }
        for (var j = 0; j < nodes.length; j++) {
          if (!__lmsIsShown(nodes[j])) continue;
          var txt = (nodes[j].textContent || '').trim();
          if (!txt) continue;
          var frac = txt.match(__LMS_RATIO_RE);
          if (frac) {
            var fn = parseFloat(frac[1]);
            var fd = parseFloat(frac[2]);
            if (fd > 0 && fn >= 0 && fn <= fd) return Math.round((fn / fd) * 10000) / 100;
          }
          var num = txt.match(__LMS_NUM_RE);
          if (num) return parseFloat(num[0]);
        }
      }
      return null;
    }

    function __lmsExtractResultScore() {
      // 1) 正确题数 X/Y → 百分制（口径最稳定）
      var ratioSelectors = [
        '#correctCount', '[id*="correct" i]', '[id*="accuracy" i]',
        '[class*="correct" i]', '[class*="accuracy" i]', '[id*="ratio" i]'
      ];
      for (var i = 0; i < ratioSelectors.length; i++) {
        var nodes = [];
        try { nodes = document.querySelectorAll(ratioSelectors[i]); } catch (e) { nodes = []; }
        for (var j = 0; j < nodes.length; j++) {
          if (!__lmsIsShown(nodes[j])) continue;
          var m = (nodes[j].textContent || '').trim().match(__LMS_RATIO_RE);
          if (m) {
            var num = parseFloat(m[1]);
            var den = parseFloat(m[2]);
            if (den > 0 && num >= 0 && num <= den) return Math.round((num / den) * 10000) / 100;
          }
        }
      }
      // 2) 回落：可见分数元素
      return __lmsFindVisibleScore();
    }

    function __lmsMaybeSubmitResult() {
      if (__lmsResultSubmitted || __lmsResultPolling) return;
      if (!__LMS_DONE_RE.test(__lmsVisibleText())) return;

      __lmsResultPolling = true;
      // 结算页 DOM 可能分步渲染，短轮询取最后一次有效分数
      var tries = 0;
      var delays = [0, 120, 250, 400, 700, 1100];
      var latest = null;

      function poll() {
        var s = __lmsExtractResultScore();
        if (s !== null && !isNaN(s)) latest = s;
        tries++;
        if (tries < delays.length) {
          setTimeout(poll, delays[tries]);
          return;
        }
        __lmsResultPolling = false;
        if (latest !== null && !__lmsResultSubmitted) {
          __lmsResultSubmitted = true;
          logToServer('Result screen detected, auto-submitting score: ' + latest);
          window.LMS.submit({ score: latest, completion: 1.0, comment: '结算页自动提取得分' });
        }
      }
      poll();
    }

    function initResultWatcher() {
      try {
        if (!document.body) return;
        var observer = new MutationObserver(function() {
          if (__lmsResultSubmitted || __lmsResultScheduled) return;
          __lmsResultScheduled = true;
          setTimeout(function() {
            __lmsResultScheduled = false;
            __lmsMaybeSubmitResult();
          }, 600);
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        // 少数课件首屏即结算
        setTimeout(__lmsMaybeSubmitResult, 800);
      } catch (e) {
        logToServer('Error in initResultWatcher: ' + e.message);
      }
    }

    function attachListeners() {
      try {
        const buttons = document.querySelectorAll('button, input[type="button"], input[type="submit"], .btn, .button');
        buttons.forEach(function(btn) {
          if (btn.dataset.lmsHooked) return;
          btn.dataset.lmsHooked = "true";

          const text = (btn.textContent || btn.value || '').trim();

          let classNameStr = '';
          if (btn.className) {
            if (typeof btn.className === 'string') {
              classNameStr = btn.className;
            } else if (typeof btn.className === 'object' && btn.className.baseVal) {
              classNameStr = btn.className.baseVal;
            }
          }
          const hasClassKeyword = classNameStr.toLowerCase().includes('submit') || classNameStr.toLowerCase().includes('finish');

          const isSubmitBtn =
            text.includes('提交') ||
            text.includes('完成') ||
            text.includes('得分') ||
            text.includes('确定') ||
            text.toLowerCase().includes('submit') ||
            text.toLowerCase().includes('finish') ||
            text.toLowerCase().includes('check') ||
            (btn.id && btn.id.toLowerCase().includes('submit')) ||
            (btn.id && btn.id.toLowerCase().includes('finish')) ||
            hasClassKeyword;

          if (isSubmitBtn) {
            logToServer("Hooked submit button: '" + text + "' | ID: '" + btn.id + "' | Classes: '" + classNameStr + "'");
            btn.addEventListener('click', function() {
              logToServer("Submit button clicked: '" + text + "'");

              let highestScore = null;
              let attemptLogs = [];
              let checkCount = 0;
              const delays = [100, 200, 300, 400, 1000, 1000];

              function checkScore() {
                if (checkCount >= delays.length) {
                  const finalScore = highestScore !== null ? highestScore : 0;
                  logToServer("Polling completed. Submitting final score: " + finalScore + ". Logs: " + JSON.stringify(attemptLogs));
                  window.LMS.submit({
                    score: finalScore,
                    completion: 1.0,
                    comment: "自动提取得分"
                  });
                  return;
                }

                const result = findScoreInDOM();
                attemptLogs.push({ delay: delays[checkCount], score: result.score, log: result.log });

                if (result.score !== null) {
                  if (highestScore === null || result.score > highestScore) {
                    highestScore = result.score;
                  }

                  if (result.score > 0) {
                    logToServer("Found positive score " + result.score + ". Submitting early. Logs: " + JSON.stringify(attemptLogs));
                    window.LMS.submit({
                      score: result.score,
                      completion: 1.0,
                      comment: "自动提取得分"
                    });
                    return;
                  }
                }

                const nextDelay = delays[checkCount++];
                setTimeout(checkScore, nextDelay);
              }

              setTimeout(checkScore, delays[0]);
            });
          }
        });
      } catch (e) {
        logToServer("Error in attachListeners: " + e.message);
      }
    }

    // --- SCORE VARIABLE MONITOR -----------------------------------------
    // 监视「代表分数的变量」，变量变化时按静默窗口去抖后上报一次样本，
    // 供插件侧按成绩配置里的 score_policy 对样本历史聚合（MAX / AVERAGE / LATEST）。
    // 采集源三层：
    //   1) window.__LMS_WATCH__ 显式声明的变量名 / 点路径（课件作者或 AI 补刀写入）
    //   2) 自动发现 window 上名字像分数的数值属性
    //   3) DOM 兜底：分数类元素的可见文本（覆盖把分数只写进 #score 的静态课件）
    // 上报用 saveProgress（lms-bridge 以 status='inprogress' 落库）：不会提前把 attempt
    // 置为已完成，但同样会写 submission_result 并发出 courseware.attempt_submitted —— 已进管道。
    // watch 快照会随 extra 落到 submission_result.extra_json 与 submission_raw.payload_json。
    var __LMS_WATCH_INTERVAL_MS = 800;
    var __LMS_WATCH_SILENCE_MS = 1200;
    var __LMS_WATCH_MAX_SUBMITS = 60;
    var __LMS_WATCH_KEY_RE = /score|point|grade|mark|correct|right/i;
    var __LMS_WATCH_SKIP_RE = /^_|^on[A-Z]|^webkit|^moz|^ms/;
    var __LMS_WATCH_DOM_SELECTORS = [
      '#score', '#points', '#grade', '#finalScore', '#totalScore', '#scoreDisplay', '#score-num',
      '.score', '.points', '.grade', '.final-score',
      '[id*="score" i]', '[id*="point" i]', '[id*="grade" i]'
    ];
    var __lmsWatchState = { snapshot: {}, pendingChanged: [], pendingTimer: null, submitted: 0 };

    function __lmsWatchNumber(value) {
      if (typeof value === 'number') return isFinite(value) ? value : null;
      if (typeof value === 'string') {
        var text = value.trim();
        if (!text) return null;
        var m = text.match(__LMS_NUM_RE);
        if (!m) return null;
        var n = parseFloat(m[0]);
        return isFinite(n) ? n : null;
      }
      return null;
    }

    function __lmsWatchResolve(path) {
      var segs = String(path).split('.');
      var node = window;
      for (var i = 0; i < segs.length; i++) {
        if (node === null || node === undefined) return undefined;
        try { node = node[segs[i]]; } catch (e) { return undefined; }
      }
      return node;
    }

    function __lmsWatchSnapshot() {
      var snap = {};

      // 1) 显式声明的变量
      var declared = window.__LMS_WATCH__;
      if (typeof declared === 'string') declared = [declared];
      if (Array.isArray(declared)) {
        for (var d = 0; d < declared.length; d++) {
          if (typeof declared[d] !== 'string') continue;
          var declaredValue = __lmsWatchNumber(__lmsWatchResolve(declared[d]));
          if (declaredValue !== null) snap[declared[d]] = declaredValue;
        }
      }

      // 2) 自动发现 window 上的分数类数值变量
      try {
        for (var key in window) {
          if (typeof key !== 'string' || !key) continue;
          if (!__LMS_WATCH_KEY_RE.test(key) || __LMS_WATCH_SKIP_RE.test(key)) continue;
          var globalValue;
          try { globalValue = window[key]; } catch (e) { continue; }
          var globalNumber = __lmsWatchNumber(globalValue);
          if (globalNumber !== null) snap[key] = globalNumber;
        }
      } catch (e) {}

      // 3) DOM 兜底
      var seenElements = [];
      for (var s = 0; s < __LMS_WATCH_DOM_SELECTORS.length; s++) {
        var selector = __LMS_WATCH_DOM_SELECTORS[s];
        var el = null;
        try { el = document.querySelector(selector); } catch (e) { el = null; }
        // 同一个元素会被多个选择器命中（如 #score 同时命中 [id*="score" i]），去重避免快照里出现重复变量
        if (!el || seenElements.indexOf(el) >= 0) continue;
        if (!__lmsIsShown(el)) continue;
        seenElements.push(el);
        var text = (el.textContent || '').trim();
        if (!text) continue;
        var value = null;
        var frac = text.match(__LMS_RATIO_RE);
        if (frac) {
          var fracNum = parseFloat(frac[1]);
          var fracDen = parseFloat(frac[2]);
          if (fracDen > 0 && fracNum >= 0 && fracNum <= fracDen) {
            value = Math.round((fracNum / fracDen) * 10000) / 100;
          }
        }
        if (value === null) value = __lmsWatchNumber(text);
        if (value === null) continue;
        // 键名里不能出现 "."，否则插件侧 score_fields 的点路径解析会歧义
        snap['dom_' + selector.replace(/[^A-Za-z0-9_-]/g, '_')] = value;
      }

      return snap;
    }

    function __lmsWatchDiff(prev, next) {
      var changed = [];
      for (var k in next) {
        if (!Object.prototype.hasOwnProperty.call(next, k)) continue;
        if (!Object.prototype.hasOwnProperty.call(prev, k) || prev[k] !== next[k]) changed.push(k);
      }
      return changed;
    }

    function __lmsWatchTick() {
      if (__lmsWatchState.submitted >= __LMS_WATCH_MAX_SUBMITS) return;
      if (!window.__LMS_STUDENT__ || !window.__LMS_STUDENT__.attempt_id) return;
      var snap;
      try { snap = __lmsWatchSnapshot(); } catch (e) { return; }
      var changed = __lmsWatchDiff(__lmsWatchState.snapshot, snap);
      if (!changed.length) return;
      // 先更新基线，避免同一个变化被反复判定为「刚刚变化」
      __lmsWatchState.snapshot = snap;
      for (var i = 0; i < changed.length; i++) {
        if (__lmsWatchState.pendingChanged.indexOf(changed[i]) < 0) {
          __lmsWatchState.pendingChanged.push(changed[i]);
        }
      }
      if (__lmsWatchState.pendingTimer) clearTimeout(__lmsWatchState.pendingTimer);
      __lmsWatchState.pendingTimer = setTimeout(__lmsWatchFlush, __LMS_WATCH_SILENCE_MS);
    }

    function __lmsWatchFlush() {
      __lmsWatchState.pendingTimer = null;
      var changed = __lmsWatchState.pendingChanged;
      __lmsWatchState.pendingChanged = [];
      if (!changed.length) return;

      var snap;
      try { snap = __lmsWatchSnapshot(); } catch (e) { snap = __lmsWatchState.snapshot; }

      // 取变化变量中的最大值作为本次样本的 score（同一次变化里通常只有一个真实分数变量）
      var score = null;
      for (var i = 0; i < changed.length; i++) {
        var value = snap[changed[i]];
        if (typeof value !== 'number' || !isFinite(value)) continue;
        if (score === null || value > score) score = value;
      }
      if (score === null) return;

      snap._changed = changed.join(',');
      snap._at = Date.now();
      __lmsWatchState.submitted++;
      logToServer('Score variable changed (' + snap._changed + '), reporting sample: ' + score);
      window.LMS.saveProgress({
        score: score,
        watch: snap
      });
    }

    function initScoreWatcher() {
      try {
        // 课件可显式退出监视：window.__LMS_WATCH__ = false
        if (window.__LMS_WATCH__ === false) return;
        if (!window.__LMS_STUDENT__ || !window.__LMS_STUDENT__.attempt_id) return;
        __lmsWatchState.snapshot = __lmsWatchSnapshot();
        setInterval(__lmsWatchTick, __LMS_WATCH_INTERVAL_MS);
        var lastObservedAt = 0;
        var observer = new MutationObserver(function() {
          var now = Date.now();
          if (now - lastObservedAt < 300) return;
          lastObservedAt = now;
          __lmsWatchTick();
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      } catch (e) {
        logToServer('Error in initScoreWatcher: ' + e.message);
      }
    }

    function initAutoSubmit() {
      try {
        logToServer("Initializing AutoSubmit SDK");
        const observer = new MutationObserver(function() {
          attachListeners();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        attachListeners();
        initResultWatcher();
        initScoreWatcher();
      } catch (e) {
        logToServer("Error in initAutoSubmit: " + e.message);
      }
    }

    if (document.body) {
      initAutoSubmit();
    } else {
      document.addEventListener('DOMContentLoaded', initAutoSubmit);
    }
  } catch (err) {
    console.error("Failed to initialize Bridge SDK intercept hooks:", err);
  }
})();`;
