/**
 * OpenLearn Courseware SDK v0.2.0
 *
 * AI 生成的 HTML 课件通过此 SDK 与 courseware-hub 插件通信。
 *
 * 协议：
 *   - courseware:score      — 提交成绩
 *   - courseware:complete   — 标记完成
 *   - courseware:heartbeat  — 学习心跳（自动 30s）
 *   - courseware:closing    — 页面关闭前通知
 *   - courseware:event      — 自定义事件
 *
 * @example
 *   OpenLearn.submit(85, 100, { questions: [...] });
 *   OpenLearn.complete();
 */
(function () {
  'use strict';

  var IS_EMBEDDED = (function () {
    try { return window.parent && window.parent !== window; }
    catch (e) { return false; }
  })();

  function send(type, payload) {
    if (!IS_EMBEDDED) return false;
    try {
      window.parent.postMessage({
        type: type,
        source: 'openlearn-cw-sdk',
        version: '0.2.0',
        payload: payload || {},
        timestamp: Date.now()
      }, '*');
      return true;
    } catch (e) {
      return false;
    }
  }

  // 公开 API
  window.OpenLearn = {
    version: '0.2.0',
    embedded: IS_EMBEDDED,

    submit: function (score, total, detail) {
      if (typeof score !== 'number' || typeof total !== 'number') {
        console.error('[OpenLearn SDK] submit() 需要数字类型的 score 和 total');
        return false;
      }
      return send('courseware:score', {
        score: score,
        total: total,
        detail: detail || null
      });
    },

    complete: function () {
      return send('courseware:complete', {});
    },

    emit: function (eventName, data) {
      return send('courseware:event', {
        event: eventName,
        data: data || {}
      });
    }
  };

  // 心跳（每 30 秒）
  var heartbeatTimer = setInterval(function () {
    send('courseware:heartbeat', {});
  }, 30000);

  // 页面关闭前通知
  window.addEventListener('beforeunload', function () {
    send('courseware:closing', {});
    clearInterval(heartbeatTimer);
  });

  if (IS_EMBEDDED) {
    console.log('[OpenLearn SDK] 已就绪 v' + window.OpenLearn.version);
  }
})();
