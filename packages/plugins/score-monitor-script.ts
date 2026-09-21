/**
 * 平台原生「分数变量监视器」脚本（阶段 B）。
 *
 * 背景：互动课件运行在 `credentialless` + sandbox（无 `allow-same-origin`）的 iframe 中，
 * 父窗口读不到其内部变量，服务端向课件 HTML 注入脚本是平台唯一能持续观察课件状态的位置。
 * 该脚本此前由第三方插件 `interactive-courseware` 持有并通过「课件运行时脚本扩展点」注册，
 * 现改为平台自有：由内置插件 `@openlearn/plugin-builtin` 在 activate 时注册，
 * 因此停用任何第三方插件后监视能力依然存在。
 *
 * 采集三层（任一可用即生效）：
 *   1. 课件显式声明：`window.__LMS_WATCH__ = 'score'` 或 `['score', 'obj.right']`；
 *   2. 自动发现：遍历 `window` 上键名匹配 score/point/grade/... 的有限数值；
 *   3. DOM 兜底：读取 `#score` / `.score` 等可见元素的文本（`82`、`82/100`、`82%`）。
 *
 * 上报：变量变化并静默 1200ms 后，取「本轮变化变量中的最大值」作为样本分，
 * 通过 `window.LMS.saveProgress({ score, watch })` 写回平台。
 * `saveProgress` 以 `status='inprogress'` 落库、不会提前把 attempt 置为已完成，
 * 但同样写 `submission_raw` / `submission_result`，因此样本进入成绩管道，
 * 由宿主 `packages/plugins/courseware-score.ts` 按 `score_policy`（LATEST / MAX / AVERAGE / FIRST）聚合出官方成绩。
 *
 * 退出方式：`window.__LMS_WATCH__ === false`（关掉本课件的变量监视）、
 * `window.__LMS_WATCH_DISABLED__ === true`（整页禁用）、或单会话累计上报达 60 次。
 *
 * ⚠️ 本文件用字符串拼接而非模板字符串、且刻意不写任何反斜杠转义序列（用 `[0-9]` 代替 `\d`），
 * 因为脚本最终要嵌进 HTML 的 `<script>` 标签与 TS 模板字符串，历史上曾因双重转义出过事故。
 */
export const SCORE_MONITOR_SCRIPT_ID = 'score-variable-monitor';
export const SCORE_MONITOR_SCRIPT_OWNER = '@openlearn/plugin-builtin';

export const SCORE_MONITOR_SCRIPT = `(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__LMS_WATCH_DISABLED__ === true) return;
  if (window.__LMS_WATCH__ === false) return;
  if (window.__LMS_SCORE_WATCHER_READY__ === true) return;
  window.__LMS_SCORE_WATCHER_READY__ = true;

  var INTERVAL_MS = 800;
  var SILENCE_MS = 1200;
  var MAX_SUBMITS = 60;
  var KEY_RE = /score|point|grade|mark|correct|right/i;
  var SKIP_RE = /^_|^on[A-Z]|^webkit|^moz|^ms/;
  var NUM_RE = /[0-9]+(?:[.][0-9]+)?/;
  var RATIO_RE = /([0-9]+(?:[.][0-9]+)?)[^0-9]*[/／|之][^0-9]*([0-9]+)/;
  var DOM_SELECTORS = [
    '#score', '#points', '#grade', '#finalScore', '#totalScore', '#scoreDisplay', '#score-num',
    '.score', '.points', '.grade', '.final-score',
    '[id*="score" i]', '[id*="point" i]', '[id*="grade" i]'
  ];

  var state = { snapshot: null, pendingChanged: null, timer: null, submitted: 0, stopped: false };
  var seenElements = [];

  function num(value) {
    if (typeof value === 'number') return isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    var match = value.match(RATIO_RE);
    if (match) {
      var part = parseFloat(match[1]);
      var whole = parseFloat(match[2]);
      if (whole > 0) return Math.round((part / whole) * 10000) / 100;
    }
    var found = value.match(NUM_RE);
    if (!found) return null;
    var parsed = parseFloat(found[0]);
    return isFinite(parsed) ? parsed : null;
  }

  function selectorKey(selector) {
    return 'dom_' + selector.replace(/[^A-Za-z0-9_-]+/g, '_');
  }

  function isShown(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    var node = el;
    while (node && node.nodeType === 1) {
      var style = null;
      try { style = window.getComputedStyle(node); } catch (err) { style = null; }
      if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
      node = node.parentNode;
    }
    return true;
  }

  function resolvePath(path) {
    try {
      var node = window;
      var parts = String(path).split('.');
      for (var i = 0; i < parts.length; i++) {
        if (node === null || typeof node === 'undefined') return null;
        node = node[parts[i]];
      }
      return node;
    } catch (err) {
      return null;
    }
  }

  function snapshot() {
    var result = {};
    var explicit = window.__LMS_WATCH__;
    var names = [];
    if (typeof explicit === 'string' && explicit) names.push(explicit);
    else if (Object.prototype.toString.call(explicit) === '[object Array]') {
      for (var i = 0; i < explicit.length; i++) if (typeof explicit[i] === 'string') names.push(explicit[i]);
    }
    if (names.length) {
      for (var n = 0; n < names.length; n++) {
        var value = num(resolvePath(names[n]));
        if (value !== null) result[names[n]] = value;
      }
    } else {
      var keys = Object.keys(window);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        if (SKIP_RE.test(key) || !KEY_RE.test(key)) continue;
        var raw = null;
        try { raw = window[key]; } catch (err) { continue; }
        if (typeof raw !== 'number' && typeof raw !== 'string') continue;
        var numValue = num(raw);
        if (numValue !== null) result[key] = numValue;
      }
    }
    seenElements = [];
    for (var s = 0; s < DOM_SELECTORS.length; s++) {
      var selector = DOM_SELECTORS[s];
      var nodes = [];
      try { nodes = document.querySelectorAll(selector); } catch (err) { nodes = []; }
      for (var t = 0; t < nodes.length; t++) {
        var el = nodes[t];
        if (seenElements.indexOf(el) !== -1) continue;
        seenElements.push(el);
        if (!isShown(el)) continue;
        var text = (el.textContent || '').trim();
        if (!text || text.length > 40) continue;
        var domValue = num(text);
        if (domValue === null) continue;
        if (typeof result[selectorKey(selector)] === 'undefined') result[selectorKey(selector)] = domValue;
      }
    }
    return result;
  }

  function diff(prev, next) {
    var changed = {};
    var keys = Object.keys(next);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (!prev || prev[key] !== next[key]) changed[key] = next[key];
    }
    return changed;
  }

  function report(payload) {
    try {
      if (window.LMS && typeof window.LMS.saveProgress === 'function') {
        window.LMS.saveProgress(payload);
        return true;
      }
    } catch (err) { /* 忽略并尝试兜底通道 */ }
    try {
      var student = window.__LMS_STUDENT__ || {};
      var courseware = window.__LMS_COURSEWARE__ || {};
      window.parent.postMessage(
        { type: 'LMS_SAVE_PROGRESS', uuid: courseware.uuid, attempt_id: student.attempt_id, payload: payload },
        '*'
      );
      return true;
    } catch (err) {
      return false;
    }
  }

  function flush() {
    if (state.stopped) return;
    if (window.__LMS_WATCH_DISABLED__ === true) { state.stopped = true; return; }
    var changed = state.pendingChanged || {};
    state.pendingChanged = null;
    var keys = Object.keys(changed);
    if (!keys.length) return;
    if (state.submitted >= MAX_SUBMITS) return;
    var best = null;
    for (var i = 0; i < keys.length; i++) {
      var value = changed[keys[i]];
      if (typeof value !== 'number') continue;
      if (best === null || value > best) best = value;
    }
    if (best === null) return;
    var snap = {};
    var all = state.snapshot || {};
    var allKeys = Object.keys(all);
    for (var j = 0; j < allKeys.length; j++) snap[allKeys[j]] = all[allKeys[j]];
    snap._changed = keys;
    snap._at = Date.now();
    try { console.warn('Score variable changed (' + keys.join(', ') + ') -> ' + best); } catch (err) { /* noop */ }
    var ok = report({ score: best, watch: snap });
    if (ok) state.submitted = state.submitted + 1;
  }

  function tick() {
    if (state.stopped) return;
    if (window.__LMS_WATCH_DISABLED__ === true) { state.stopped = true; return; }
    if (state.submitted >= MAX_SUBMITS) { state.stopped = true; return; }
    var student = window.__LMS_STUDENT__;
    if (!student || !student.attempt_id) return;
    var next = snapshot();
    var changed = diff(state.snapshot, next);
    state.snapshot = next;
    if (!Object.keys(changed).length) return;
    state.pendingChanged = Object.assign(state.pendingChanged || {}, changed);
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(function () { state.timer = null; flush(); }, SILENCE_MS);
  }

  function init() {
    state.snapshot = snapshot();
    setInterval(tick, INTERVAL_MS);
    try {
      if (!window.__LMS_SCORE_WATCHERS__ || Object.prototype.toString.call(window.__LMS_SCORE_WATCHERS__) !== '[object Array]') {
        window.__LMS_SCORE_WATCHERS__ = [];
      }
      window.__LMS_SCORE_WATCHERS__.push({
        stop: function () {
          state.stopped = true;
          if (state.timer) { clearTimeout(state.timer); state.timer = null; }
        }
      });
    } catch (err) { /* noop */ }
    if (typeof MutationObserver === 'function' && document.documentElement) {
      var scheduled = false;
      var observer = new MutationObserver(function () {
        if (scheduled) return;
        scheduled = true;
        setTimeout(function () { scheduled = false; tick(); }, 300);
      });
      try {
        observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      } catch (err) { /* noop */ }
    }
    try { console.warn('[native] score monitor armed, watching score-like variables'); } catch (err) { /* noop */ }
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();`;
