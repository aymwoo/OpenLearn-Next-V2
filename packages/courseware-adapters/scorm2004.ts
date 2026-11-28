/**
 * SCORM 2004 运行时适配器（`window.API_1484_11`）。
 *
 * 与 1.2 的差异：
 * - 完成态是 `cmi.completion_status`（completed / incomplete / not attempted / unknown）；
 * - 成功态是 `cmi.success_status`（passed / failed / unknown）；
 * - 分数可以是 `cmi.score.raw` 或 `cmi.score.scaled`（-1~1）。
 *
 * 终态仍只由 `LMS.submit` 触发；其余分数变化走 `LMS.saveProgress`。
 */
export const SCORM2004_ADAPTER_SCRIPT = String.raw`(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  if (window.__LMS_SCORM2004_READY__) return;
  window.__LMS_SCORM2004_READY__ = true;
  window.__LMS_ADAPTER_MANAGED__ = true;

  var values = {
    'cmi.completion_status': 'unknown',
    'cmi.success_status': 'unknown',
    'cmi.score.raw': '',
    'cmi.score.scaled': '',
    'cmi.score.min': '0',
    'cmi.score.max': '100',
    'cmi.location': '',
    'cmi.suspend_data': '',
    'cmi.exit': '',
    'cmi.session_time': '',
    'cmi.total_time': '',
    'cmi.learner_id': '',
    'cmi.learner_name': '',
    'cmi.launch_data': '',
    'cmi.comments_from_learner': ''
  };
  var initialized = false;
  var finished = false;
  var lastError = '0';
  var timer = null;

  function text(value) {
    if (value === null || typeof value === 'undefined') return '';
    return String(value);
  }

  function numeric(value) {
    if (value === '' || value === null || typeof value === 'undefined') return null;
    var num = parseFloat(value);
    return isFinite(num) ? num : null;
  }

  function maxScore() {
    var max = numeric(values['cmi.score.max']);
    return max !== null && max > 0 ? max : 100;
  }

  function score() {
    var raw = numeric(values['cmi.score.raw']);
    if (raw !== null) return raw;
    var scaled = numeric(values['cmi.score.scaled']);
    if (scaled !== null) return scaled * maxScore();
    return null;
  }

  function completionStatus() {
    return values['cmi.completion_status'] || 'unknown';
  }

  function successStatus() {
    return values['cmi.success_status'] || 'unknown';
  }

  function isFinalStatus() {
    var completion = completionStatus();
    var success = successStatus();
    return completion === 'completed' || success === 'passed' || success === 'failed';
  }

  function buildPayload() {
    var payload = {
      protocol: 'scorm-2004',
      scorm_version: '2004',
      scorm_completion_status: completionStatus(),
      scorm_success_status: successStatus()
    };
    var currentScore = score();
    if (currentScore !== null) payload.score = currentScore;
    payload.total = maxScore();
    if (values['cmi.session_time']) payload.scorm_session_time = values['cmi.session_time'];
    return payload;
  }

  function send(complete) {
    if (!window.LMS) return;
    var payload = buildPayload();
    if (complete) {
      payload.completion = 1;
      payload.status = 'completed';
      window.LMS.submit(payload);
    } else if (typeof payload.score === 'number') {
      window.LMS.saveProgress(payload);
    }
  }

  function finalize() {
    if (finished) return;
    finished = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    send(isFinalStatus() || score() !== null);
    if (window.LMS && typeof window.LMS.finish === 'function') {
      window.LMS.finish({ protocol: 'scorm-2004' });
    }
  }

  function schedule() {
    if (finished) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      if (finished) return;
      if (isFinalStatus() && score() !== null) finalize();
      else send(false);
    }, 400);
  }

  function setValue(key, value) {
    var name = text(key);
    if (!name) {
      lastError = '201';
      return 'false';
    }
    if (name.indexOf('cmi.') !== 0) {
      lastError = '401';
      return 'false';
    }
    values[name] = text(value);
    if (
      name === 'cmi.score.raw' ||
      name === 'cmi.score.scaled' ||
      name === 'cmi.completion_status' ||
      name === 'cmi.success_status'
    ) {
      schedule();
    }
    return 'true';
  }

  var api = {
    Initialize: function () {
      initialized = true;
      lastError = '0';
      return 'true';
    },
    GetValue: function (key) {
      if (!initialized) {
        lastError = '122';
        return '';
      }
      var name = text(key);
      return typeof values[name] === 'undefined' ? '' : values[name];
    },
    SetValue: function (key, value) {
      if (!initialized) {
        lastError = '122';
        return 'false';
      }
      return setValue(key, value);
    },
    Commit: function () {
      if (!initialized) {
        lastError = '122';
        return 'false';
      }
      if (isFinalStatus() && score() !== null) finalize();
      else send(false);
      return 'true';
    },
    Terminate: function () {
      if (!initialized) {
        lastError = '122';
        return 'false';
      }
      finalize();
      initialized = false;
      return 'true';
    },
    GetLastError: function () {
      return lastError;
    },
    GetErrorString: function (code) {
      var current = text(code) || lastError;
      if (current === '0') return 'No error';
      if (current === '101') return 'General exception';
      if (current === '201') return 'Invalid argument error';
      if (current === '122') return 'Retrieve was called before initialization';
      if (current === '401') return 'Not implemented error';
      return 'SCORM 2004 error ' + current;
    },
    GetDiagnostic: function (code) {
      return 'OpenLearn SCORM 2004 adapter (error ' + (text(code) || lastError) + ')';
    }
  };

  window.API_1484_11 = api;
  try {
    if (!window.parent.API_1484_11) window.parent.API_1484_11 = api;
  } catch (err) {}
  try {
    if (!window.top.API_1484_11) window.top.API_1484_11 = api;
  } catch (err) {}
})();`;
