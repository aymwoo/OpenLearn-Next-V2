/**
 * 把浏览器运行时错误报到同源接口。DSN 留在服务端，页面不持有上报地址。
 * 只发送消息、堆栈和路径名，不带查询串，避免会话和口令跟着走。
 */
export function reportClientRuntimeError(input: {
  source: 'runtime' | 'promise';
  message: string;
  stack?: string;
}): void {
  if (typeof window === 'undefined') return;
  const payload = JSON.stringify({
    source: input.source,
    message: input.message.slice(0, 500),
    stack: input.stack ? input.stack.slice(0, 2000) : undefined,
    path: window.location.pathname,
  });
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const sent = navigator.sendBeacon('/api/client-errors', new Blob([payload], { type: 'application/json' }));
      if (sent) return;
    }
  } catch {
    /* 退回 fetch */
  }
  fetch('/api/client-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => {});
}
