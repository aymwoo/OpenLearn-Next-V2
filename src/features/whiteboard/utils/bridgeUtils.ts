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
      var origPM = window.postMessage;
      window.postMessage = function(msg, targetOrigin, transfer) {
        var origin = (targetOrigin === 'null' || targetOrigin === null) ? '*' : targetOrigin;
        try { return origPM.call(this, msg, origin, transfer); }
        catch(err) { if (err.name === 'SyntaxError') return origPM.call(this, msg, '*', transfer); throw err; }
      };
      if (window.parent && window.parent !== window) {
        var origParentPM = window.parent.postMessage;
        window.parent.postMessage = function(msg, targetOrigin, transfer) {
          var origin = (targetOrigin === 'null' || targetOrigin === null) ? '*' : targetOrigin;
          try { return origParentPM.call(window.parent, msg, origin, transfer); }
          catch(err) { if (err.name === 'SyntaxError') return origParentPM.call(window.parent, msg, '*', transfer); throw err; }
        };
      }
    } catch(e) {}
  })();
<\/script>
<script src="/bridge.js"><\/script>
</head><body>
${rawCode || ''}
</body></html>`;
}
