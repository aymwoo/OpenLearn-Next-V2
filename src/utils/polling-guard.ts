/** HTTP 状态码说明会话失效或无权访问；一旦命中，轮询应立即停止。 */
export function isTerminalAuthStatus(status: number): boolean {
  return status === 401 || status === 403;
}

/** 对课程/会话/大屏等特定资源，404 同样属于不可恢复的终止状态。 */
export function isTerminalResourceStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 404;
}
