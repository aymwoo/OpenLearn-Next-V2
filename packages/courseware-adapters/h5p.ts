/**
 * H5P 适配器。
 *
 * H5P 内容通常通过两种方式向父页面汇报：
 * - `postMessage({ type: 'xAPI', statement })`；
 * - `H5P.externalDispatcher.on('xAPI', ...)` / `setFinished`。
 *
 * 本适配器只监听并翻译，不打包完整 H5P 运行时，也不改成绩模型。
 */
export const H5P_ADAPTER_SCRIPT = String.raw`(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  if (window.__LMS_H5P_READY__) return;
  window.__LMS_H5P_READY__ = true;
  window.__LMS_ADAPTER_MANAGED__ = true;

  var lastSignature = '';

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

  function submit(payload) {
    if (!window.LMS) return;
    var signature;
    try {
      signature = JSON.stringify(payload);
    } catch (err) {
      signature = '';
    }
    if (signature && signature === lastSignature) return;
    lastSignature = signature;
    if (payload.completion === 1 || payload.status === 'completed') {
      window.LMS.submit(payload);
    } else {
      window.LMS.saveProgress(payload);
    }
  }

  function translateEvent(event) {
    if (!event || typeof event !== 'object') return;
    var statement = event.statement || event.xAPI || (event.verb ? event : null);
    if (statement && typeof statement === 'object') {
      var result = statement.result && typeof statement.result === 'object' ? statement.result : {};
      var verb = statement.verb && statement.verb.id ? String(statement.verb.id) : '';
      var score = scoreOf(result);
      var final =
        result.completion === true ||
        result.success === true ||
        result.success === false ||
        (verb.length >= 10 && verb.slice(-10) === '/completed') ||
        (verb.length >= 7 && (verb.slice(-7) === '/passed' || verb.slice(-7) === '/failed'));
      var payload = { protocol: 'h5p', h5p_verb: verb, xapi_statement: statement };
      if (score !== null && isFinite(score)) payload.score = score;
      if (final) {
        payload.completion = 1;
        payload.status = 'completed';
      }
      submit(payload);
      return;
    }
    if (event.type === 'setFinished' || event.type === 'finished' || event.finished === true) {
      var finished = {
        protocol: 'h5p',
        completion: 1,
        status: 'completed',
        h5p_event: event.type || 'finished'
      };
      if (typeof event.score === 'number' && isFinite(event.score)) finished.score = event.score;
      submit(finished);
    }
  }

  window.addEventListener('message', function (event) {
    var data = event && event.data;
    if (!data || typeof data !== 'object') return;
    if (
      data.type === 'xAPI' ||
      data.type === 'h5p' ||
      data.type === 'setFinished' ||
      data.type === 'finished'
    ) {
      translateEvent(data);
    }
  });

  // H5P 运行时可能在本脚本之后才挂到 window 上；短轮询等待 externalDispatcher。
  var tries = 0;
  var timer = setInterval(function () {
    tries = tries + 1;
    try {
      var dispatcher = window.H5P && window.H5P.externalDispatcher;
      if (dispatcher && typeof dispatcher.on === 'function') {
        dispatcher.on('xAPI', function (event) {
          var payload = event && event.data ? event.data : event;
          translateEvent(payload);
        });
        clearInterval(timer);
        return;
      }
    } catch (err) {}
    if (tries > 50) clearInterval(timer);
  }, 200);
})();`;
