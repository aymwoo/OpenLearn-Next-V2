import type { Response } from 'express';

/**
 * 安全响应错误工具函数：
 * - 生产环境 (NODE_ENV === 'production')：向客户端屏蔽底层详细异常堆栈、SQL 语句及文件路径，返回通用错误提示；
 * - 开发与测试环境：保留 e.message 以便敏捷排查与自动化测试断言；
 * - 统一在服务端控制台记录详细错误日志。
 *
 * ## 状态码透传（2026-10-04）
 *
 * service 层用 `err.status = 404` 表达业务错误，但此前只有少数路由在 catch 里写
 * `if (e.status) return res.status(e.status)...`；其余一律落到默认的 500，
 * **状态码在最后一跳被丢弃** —— 重构前是 `return res.status(404).json({error:'...'})`。
 *
 * 现在改为在工具函数内部统一透传：
 * - `err.status` 是 4xx/5xx 的合法数字时**优先采用**；
 * - `err.status` 缺失或非法时回落到传入的 `status`（默认 500）。
 *
 * **优先级不能反**：全仓 235 处调用中有 44 处显式传 `sendSafeError(res, e, 500)`。
 * 若让显式参数优先，这 44 处会把 service 声明的业务状态码重新压回 500，修复形同虚设。
 *
 * 这样 4xx 不再依赖"每个 catch 都记得写那一行"，也不依赖 service 里的错误文案
 * —— 此前 roster/assignments/grading 用 `e.message?.includes('not found')` 字符串
 * 嗅探来推断状态码，service 里改个错别字就会静默翻成 500。
 */
export function sendSafeError(
  res: Response,
  err: unknown,
  status = 500,
  fallbackMessage = 'Internal server error',
): Response {
  const message = err instanceof Error ? err.message : String(err);

  // 透传 service 层显式声明的业务状态码（仅接受合法 HTTP 错误码）
  const declared =
    err && typeof err === 'object' && typeof (err as { status?: unknown }).status === 'number'
      ? (err as { status: number }).status
      : undefined;
  const effectiveStatus =
    declared !== undefined && declared >= 400 && declared <= 599 ? declared : status;

  if (process.env.NODE_ENV !== 'test') {
    console.error(`[API Error ${effectiveStatus}]:`, err);
  }
  const isProd = process.env.NODE_ENV === 'production';
  // 生产环境对 4xx 仍透传 message —— 4xx 是业务语义（如「班级不存在」）而非内部故障，
  // 全量替换成 "Internal server error" 会让前端无法区分「用户填错了」与「服务器坏了」。
  const exposedMessage = isProd && effectiveStatus >= 500 ? fallbackMessage : message;
  return res.status(effectiveStatus).json({ success: false, error: exposedMessage });
}
