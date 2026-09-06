import type { Response } from 'express';

/**
 * 安全响应错误工具函数：
 * - 生产环境 (NODE_ENV === 'production')：向客户端屏蔽底层详细异常堆栈、SQL 语句及文件路径，返回通用错误提示；
 * - 开发与测试环境：保留 e.message 以便敏捷排查与自动化测试断言；
 * - 统一在服务端控制台记录详细错误日志。
 */
export function sendSafeError(
  res: Response,
  err: unknown,
  status = 500,
  fallbackMessage = 'Internal server error',
): Response {
  const message = err instanceof Error ? err.message : String(err);
  if (process.env.NODE_ENV !== 'test') {
    console.error(`[API Error ${status}]:`, err);
  }
  const isProd = process.env.NODE_ENV === 'production';
  const exposedMessage = isProd ? fallbackMessage : message;
  return res.status(status).json({ success: false, error: exposedMessage });
}
