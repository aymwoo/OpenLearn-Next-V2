/**
 * SCORM 1.2 运行时适配器。
 *
 * 课件在自己的 iframe 里通过 `window.API` 调用 SCORM 1.2 数据模型；
 * 适配器只做翻译：把 `cmi.core.score.raw` / `cmi.core.lesson_status`
 * 等读写译入官方 `window.LMS`，不另建成绩表、不另发网络请求。
 *
 * 终态规则：只有 `lesson_status` 进入 completed/passed/failed（并有分或明确结束）
 * 时才调用 `LMS.submit`；其余分数变化一律走 `LMS.saveProgress`（过程样本）。
 */
export const SCORM12_ADAPTER_SCRIPT = String.raw`(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  if (window.__LMS_SCORM12_READY__) return;
  window.__LMS_SCORM12_READY__ = true;
  window.__LMS_ADAPTER_MANAGED__ = true;

  var values = {
    'cmi.core.lesson_status': 'not attempted',
    'cmi.core.lesson_location': '',
    'cmi.core.score.raw': '',
    'cmi.core.score.min': '0',
    'cmi.core.score.max': '100',
    'cmi.core.session_time': '',
    'cmi.core.exit': '',
    'cmi.core.credit': 'credit',
    'cmi.suspend_data': '',
    'cmi.launch_data': '',
    'cmi.comments': '',
    'cmi.student_data.mastery_score': '',
    'cmi.student_data.max_time_allowed': '',
    'cmi.student_data.time_limit_action': '',
    'cmi.student_preference.language': '',
    'cmi.student_preference.audio': '0',
    'cmi.student_preference.speed': '0',
    'cmi.student_preference.text': '0'
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

  function score() {
    return numeric(values['cmi.core.score.raw']);
  }

  function status() {
    return values['cmi.core.lesson_status'] || 'not attempted';
  }

  function isFinalStatus() {
    var current = status();
    return current === 'completed' || current === 'passed' || current === 'failed';
  }

  function buildPayload() {
    var payload = {
      protocol: 'scorm-12',
      scorm_version: '1.2',
      scorm_lesson_status: status()
    };
    var currentScore = score();
    if (currentScore !== null) payload.score = currentScore;
    var maxScore = numeric(values['cmi.core.score.max']);
    if (maxScore !== null && maxScore > 0) payload.total = maxScore;
    if (values['cmi.core.session_time']) payload.scorm_session_time = values['cmi.core.session_time'];
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
      window.LMS.finish({ protocol: 'scorm-12' });
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
    if (name === 'cmi.core.score.raw' || name === 'cmi.core.lesson_status') {
      schedule();
    }
    return 'true';
  }

  var api = {
    LMSInitialize: function () {
      initialized = true;
      lastError = '0';
      return 'true';
    },
    LMSGetValue: function (key) {
      if (!initialized) {
        lastError = '301';
        return '';
      }
      var name = text(key);
      return typeof values[name] === 'undefined' ? '' : values[name];
    },
    LMSSetValue: function (key, value) {
      if (!initialized) {
        lastError = '301';
        return 'false';
      }
      return setValue(key, value);
    },
    LMSCommit: function () {
      if (!initialized) {
        lastError = '301';
        return 'false';
      }
      if (isFinalStatus() && score() !== null) finalize();
      else send(false);
      return 'true';
    },
    LMSFinish: function () {
      if (!initialized) {
        lastError = '301';
        return 'false';
      }
      finalize();
      initialized = false;
      return 'true';
    },
    LMSGetLastError: function () {
      return lastError;
    },
    LMSGetErrorString: function (code) {
      var current = text(code) || lastError;
      if (current === '0') return 'No error';
      if (current === '101') return 'General exception';
      if (current === '201') return 'Invalid argument error';
      if (current === '301') return 'Not initialized';
      if (current === '401') return 'Not implemented error';
      return 'SCORM 1.2 error ' + current;
    },
    LMSGetDiagnostic: function (code) {
      return 'OpenLearn SCORM 1.2 adapter (error ' + (text(code) || lastError) + ')';
    }
  };

  window.API = api;
  // 部分 SCORM 包从 window.parent / window.top 查找 API；跨域赋值会抛错，静默跳过。
  try {
    if (!window.parent.API) window.parent.API = api;
  } catch (err) {}
  try {
    if (!window.top.API) window.top.API = api;
  } catch (err) {}
})();`;
