/**
 * LMS Bridge SDK — 课件与宿主 iframe 通信桥接代码。
 *
 * 服务端：注入到课件 HTML 中（injectLmsSdk），或通过 /bridge.js 路由提供。
 * 前端白板：wrapSrcDocWithBridge() 中通过 <script src="/bridge.js"> 引用。
 */
export const BRIDGE_SDK_CODE = `(function() {
  // Proxy postMessage calls to enrich them with attempt_id and uuid
  try {
    const originalPostMessage = window.postMessage;
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
      return originalPostMessage.apply(this, arguments);
    };

    if (window.parent && window.parent !== window) {
      const parentPostMessage = window.parent.postMessage;
      try {
        window.parent.postMessage = function(message, targetOrigin, transfer) {
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
          return parentPostMessage.apply(this, arguments);
        };
      } catch (e) {}
    }
  } catch (e) {}

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
    log(event, data) {
      window.parent.postMessage({
        type: "LMS_LOG",
        uuid: window.__LMS_COURSEWARE__?.uuid,
        attempt_id: window.__LMS_STUDENT__?.attempt_id,
        event: event,
        payload: data
      }, "*");
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
                const fractionMatch = text.match(/(\\\\d+(\\\\.\\\\d+)?)\\\\s*[\\\\/|之]\\\\s*(\\\\d+)/);
                if (fractionMatch) {
                  const num = parseFloat(fractionMatch[1]);
                  const den = parseFloat(fractionMatch[3]);
                  if (den > 0) {
                    const pct = (num / den) * 100;
                    logData.push("Parsed fraction: " + num + "/" + den + " -> " + pct);
                    return { score: pct, log: logData };
                  }
                }
                const match = text.match(/\\\\d+(\\\\.\\\\d+)?/);
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
                  const m = txt.match(/\\\\d+(\\\\.\\\\d+)?/);
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

    function initAutoSubmit() {
      try {
        logToServer("Initializing AutoSubmit SDK");
        const observer = new MutationObserver(function() {
          attachListeners();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        attachListeners();
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
