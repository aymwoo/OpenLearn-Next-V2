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
<\/script>
<script src="/bridge.js"><\/script>
</head><body>
${rawCode || ''}
</body></html>`;
}
