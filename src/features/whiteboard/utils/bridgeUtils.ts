/**
 * 为 srcDoc 模式的 HTML Applet 注入 LMS 上下文和 bridge.js。
 * 服务端渲染路径（/runtime/ 或 /api/resources/）由 injectLmsSdk 处理；
 * 白板手写 HTML 代码的 srcDoc 路径不走服务端，需前端手动注入。
 */
let _srcDocAttemptCounter = 0;

export function wrapSrcDocWithBridge(rawCode: string, lessonId: string): string {
  const attemptId = `att_srcdoc_${lessonId}_${Date.now()}_${++_srcDocAttemptCounter}`;
  const context = {
    student_id: 'teacher_preview',
    student_name: 'Teacher (Preview)',
    class_id: '',
    attempt_id: attemptId,
  };
  const courseware = {
    uuid: lessonId,
    name: 'Whiteboard HTML Applet',
  };
  return `<!DOCTYPE html>
<html><head>
<script>
  window.__LMS_STUDENT__ = ${JSON.stringify(context)};
  window.__LMS_COURSEWARE__ = ${JSON.stringify(courseware)};
  (function() {
    try {
      // Override window.postMessage (self-targeting, always works)
      var origPM = window.postMessage;
      window.postMessage = function(msg, targetOrigin, transfer) {
        var origin = (targetOrigin === 'null' || targetOrigin === null) ? '*' : targetOrigin;
        try { return origPM.call(this, msg, origin, transfer); }
        catch(err) { if (err.name === 'SyntaxError') return origPM.call(this, msg, '*', transfer); throw err; }
      };
      // Shadow window.parent / window.top with Proxy to intercept .postMessage()
      // Direct assignment (window.parent.postMessage = ...) silently fails on cross-origin WindowProxy
      function proxyWin(realRef, propName) {
        try {
          var safePost = function(msg, targetOrigin, transfer) {
            var origin = (targetOrigin === 'null' || targetOrigin === null) ? '*' : targetOrigin;
            try { return realRef.postMessage.call(realRef, msg, origin, transfer); }
            catch(err) { if (err.name === 'SyntaxError') return realRef.postMessage.call(realRef, msg, '*', transfer); throw err; }
          };
          var px = new Proxy(realRef, {
            get: function(t, p) {
              if (p === 'postMessage') return safePost;
              try { var v = t[p]; return typeof v === 'function' ? v.bind(t) : v; } catch(e) { return undefined; }
            }
          });
          Object.defineProperty(window, propName, { get: function() { return px; }, configurable: true });
        } catch(e) {}
      }
      if (window.parent && window.parent !== window) proxyWin(window.parent, 'parent');
      try { if (window.top && window.top !== window) proxyWin(window.top, 'top'); } catch(e) {}
    } catch(e) {}
  })();
<\/script>
<script src="/bridge.js"><\/script>
</head><body>
${rawCode || ''}
</body></html>`;
}
