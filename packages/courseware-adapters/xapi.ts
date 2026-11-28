/**
 * xAPI / TinCan 语句适配器（轻量接收，不建 LRS）。
 *
 * 两条路径：
 * 1. 课件使用全局 `ADL.XAPIWrapper`：包一层 sendStatement/sendStatements；
 * 2. 课件直接向 LRS 的 `/statements` 发 fetch/XHR：拦截请求体里的语句并翻译。
 *
 * 翻译后调用官方 `window.LMS.submit` / `saveProgress`；
 * 原始语句随 extra.xapi_statement 写入 submission_raw，便于追溯。
 * 不向外部 LRS 转发（沙箱 CSP 只允许 'self'），避免必然失败的跨域请求。
 */
export const XAPI_ADAPTER_SCRIPT = String.raw`(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  if (window.__LMS_XAPI_READY__) return;
  window.__LMS_XAPI_READY__ = true;
  window.__LMS_ADAPTER_MANAGED__ = true;

  var seen = {};

  function isStatementUrl(url) {
    if (!url) return false;
    var value = String(url);
    return value.indexOf('/statements') >= 0 || value.indexOf('statements') >= 0;
  }

  function endsWith(value, suffix) {
    return value.length >= suffix.length && value.slice(value.length - suffix.length) === suffix;
  }

  function verbId(statement) {
    if (!statement || !statement.verb) return '';
    var verb = statement.verb;
    if (typeof verb === 'string') return verb;
    return String(verb.id || (verb.display && verb.display.id) || '');
  }

  function scoreOf(result) {
    if (!result || typeof result !== 'object' || !result.score || typeof result.score !== 'object') return null;
    var score = result.score;
    if (typeof score.scaled === 'number') {
      var max = typeof score.max === 'number' && score.max > 0 ? score.max : 100;
      return score.scaled * max;
    }
    if (typeof score.raw === 'number') return score.raw;
    return null;
  }

  function translate(statement) {
    if (!statement || typeof statement !== 'object') return;
    var id = statement.id ? String(statement.id) : '';
    if (id && seen[id]) return;
    if (id) seen[id] = true;

    var verb = verbId(statement);
    var result = statement.result && typeof statement.result === 'object' ? statement.result : {};
    var score = scoreOf(result);
    var completion = result.completion === true;
    var success = result.success;
    var final =
      completion ||
      success === true ||
      success === false ||
      endsWith(verb, '/completed') ||
      endsWith(verb, '/passed') ||
      endsWith(verb, '/failed');

    var payload = { protocol: 'xapi', xapi_verb: verb, xapi_statement: statement };
    if (score !== null && isFinite(score)) payload.score = score;
    if (!window.LMS) return;
    if (final) {
      payload.completion = 1;
      payload.status = 'completed';
      window.LMS.submit(payload);
    } else if (typeof payload.score === 'number') {
      window.LMS.saveProgress(payload);
    }
  }

  function translateBody(body) {
    if (body === null || typeof body === 'undefined') return;
    var parsed = body;
    if (typeof body === 'string') {
      try {
        parsed = JSON.parse(body);
      } catch (err) {
        return;
      }
    }
    if (Object.prototype.toString.call(parsed) === '[object Array]') {
      for (var i = 0; i < parsed.length; i++) translate(parsed[i]);
      return;
    }
    if (parsed && typeof parsed === 'object') translate(parsed);
  }

  // ── 1. ADL.XAPIWrapper：没有就补一个最小实现，有就包一层 ──
  window.ADL = window.ADL || {};
  if (!window.ADL.XAPIWrapper) {
    window.ADL.XAPIWrapper = {
      lrs: { endpoint: '', auth: '' },
      changeConfig: function () {
        return true;
      },
      sendStatement: function (statement, callback) {
        try {
          translate(statement);
        } catch (err) {}
        if (typeof callback === 'function') callback();
        return statement;
      },
      sendStatements: function (statements, callback) {
        try {
          translateBody(statements);
        } catch (err) {}
        if (typeof callback === 'function') callback();
        return statements;
      }
    };
  } else {
    var wrapper = window.ADL.XAPIWrapper;
    var originalSendStatement = wrapper.sendStatement;
    var originalSendStatements = wrapper.sendStatements;
    if (typeof originalSendStatement === 'function') {
      wrapper.sendStatement = function (statement) {
        try {
          translate(statement);
        } catch (err) {}
        return originalSendStatement.apply(this, arguments);
      };
    }
    if (typeof originalSendStatements === 'function') {
      wrapper.sendStatements = function (statements) {
        try {
          translateBody(statements);
        } catch (err) {}
        return originalSendStatements.apply(this, arguments);
      };
    }
  }

  // ── 2. fetch：命中 /statements 时只翻译，返回合成的 200 ──
  if (typeof window.fetch === 'function') {
    var originalFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : input && input.url ? input.url : '';
      if (!isStatementUrl(url)) return originalFetch.apply(this, arguments);
      try {
        translateBody(init && init.body);
      } catch (err) {}
      if (typeof Response === 'function') {
        return Promise.resolve(
          new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
        );
      }
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([]); } });
    };
  }

  // ── 3. XHR：命中 /statements 时只翻译，并合成一次成功回调 ──
  if (typeof window.XMLHttpRequest === 'function') {
    var originalOpen = window.XMLHttpRequest.prototype.open;
    var originalSend = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.open = function (method, url) {
      this.__lmsXapiUrl = url;
      return originalOpen.apply(this, arguments);
    };
    window.XMLHttpRequest.prototype.send = function (body) {
      if (!isStatementUrl(this.__lmsXapiUrl)) {
        return originalSend.apply(this, arguments);
      }
      try {
        translateBody(body);
      } catch (err) {}
      var xhr = this;
      setTimeout(function () {
        try {
          Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
          Object.defineProperty(xhr, 'status', { value: 200, configurable: true });
          Object.defineProperty(xhr, 'responseText', { value: '[]', configurable: true });
          if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange();
          if (typeof xhr.onload === 'function') xhr.onload();
        } catch (err) {}
      }, 0);
    };
  }
})();`;
