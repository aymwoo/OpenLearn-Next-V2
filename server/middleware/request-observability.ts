/**
 * 请求访问日志：请求 ID、用户 ID、耗时、状态码。
 * 不记录查询串和请求体，避免口令、会话和作答进入访问日志。
 */
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getCookieToken, getValidSession } from './auth.js';
import { logger } from '../../packages/core/observability/logger.js';
import { requestLogContext } from '../../packages/core/observability/request-context.js';
import { recordSecurityAudit } from '../../packages/core/observability/audit-log.js';
import { recordHttpResponse } from '../../packages/core/observability/metrics.js';
import { captureError } from '../../packages/core/observability/error-reporter.js';

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,64}$/;
const QUIET_PATHS = new Set([
  '/health',
  '/health/ready',
  '/',
  '/index.html',
  '/favicon.ico',
  '/robots.txt',
]);

const DEV_QUIET_PREFIXES = [
  '/@vite/',
  '/@fs/',
  '/src/',
  '/node_modules/',
  '/@id/',
];

export type HttpAccessLogMode = 'off' | 'errors' | 'all';
export const DEFAULT_HTTP_SLOW_MS = 1000;

export function resolveHttpAccessLogMode(
  envAccessLog = process.env.HTTP_ACCESS_LOG,
  envLogLevel = process.env.LOG_LEVEL,
): HttpAccessLogMode {
  const normalized = envAccessLog?.trim().toLowerCase();
  if (normalized === 'off' || normalized === 'errors' || normalized === 'all') {
    return normalized;
  }
  const normalizedLevel = envLogLevel?.trim().toLowerCase();
  if (normalizedLevel === 'debug' || normalizedLevel === 'trace') {
    return 'all';
  }
  return 'errors';
}

export function resolveSlowRequestThresholdMs(envSlowMs = process.env.HTTP_SLOW_MS): number {
  if (!envSlowMs) return DEFAULT_HTTP_SLOW_MS;
  const parsed = Number.parseInt(envSlowMs.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HTTP_SLOW_MS;
}

export function resolveHttpAccessLogIgnorePrefixes(envIgnore = process.env.HTTP_ACCESS_LOG_IGNORE): string[] {
  if (!envIgnore) return [];
  return envIgnore
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * 判定请求是否静默（不打印 http.request 访问日志）：
 * - 正常探活（/health, /health/ready）与公共静态入口（/, /index.html, /favicon.ico, /robots.txt）在 <400 时静默；
 * - 开发环境下的 Vite 内部资源与源码加载（/@vite/, /src/ 等）在 <400 时静默；
 * - 命中 HTTP_ACCESS_LOG_IGNORE 前缀名单的正常请求在 <400 时静默；
 * - 任何 >=400 的异常响应（404, 500 等）严格保留日志与错误收集，绝不静默。
 */
export function isQuietRequest(
  reqPath: string,
  status: number,
  isProduction = process.env.NODE_ENV === 'production',
  customIgnorePrefixes?: string[],
): boolean {
  if (status >= 400) return false;
  if (QUIET_PATHS.has(reqPath)) return true;
  if (!isProduction) {
    for (const prefix of DEV_QUIET_PREFIXES) {
      if (reqPath.startsWith(prefix)) return true;
    }
  }
  const ignorePrefixes = customIgnorePrefixes ?? resolveHttpAccessLogIgnorePrefixes();
  for (const prefix of ignorePrefixes) {
    if (reqPath.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * 判定 HTTP 访问日志记录级别：
 * - mode === 'off': 彻底关闭访问日志（返回 null）；
 * - status >= 500: error；
 * - status >= 400 或耗时超过慢请求阈值: warn；
 * - 正常成功请求：mode === 'all' 时输出 debug，mode === 'errors' 时静默（返回 null）。
 */
export function resolveHttpAccessLogLevel(
  status: number,
  durationMs: number,
  mode = resolveHttpAccessLogMode(),
  slowThresholdMs = resolveSlowRequestThresholdMs(),
): 'error' | 'warn' | 'debug' | null {
  if (mode === 'off') return null;

  if (status >= 500) {
    return 'error';
  }
  if (status >= 400 || durationMs >= slowThresholdMs) {
    return 'warn';
  }
  if (mode === 'all') {
    return 'debug';
  }
  return null;
}

type RequestWithId = Request & {
  requestId?: string;
  session?: { userId?: string; studentId?: string };
};

export function resolveRequestId(header: string | undefined): string {
  if (header && REQUEST_ID_RE.test(header)) return header;
  return randomUUID();
}

export function resolveRequestUserId(req: Request): string {
  const attached = (req as RequestWithId).session;
  let userId = attached?.userId || attached?.studentId;
  if (!userId) {
    const token = getCookieToken(req);
    if (token) {
      const session = getValidSession(token);
      userId = session?.userId || session?.studentId;
    }
  }
  return userId ? String(userId).slice(0, 64) : 'anonymous';
}

export function requestObservability() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const requestId = resolveRequestId(req.header('x-request-id') || undefined);
    (req as RequestWithId).requestId = requestId;
    res.setHeader('x-request-id', requestId);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
      const status = res.statusCode;
      const userId = resolveRequestUserId(req);
      recordHttpResponse(status);
      const quiet = isQuietRequest(req.path, status);
      if (!quiet) {
        const logLevel = resolveHttpAccessLogLevel(status, durationMs);
        if (logLevel) {
          const effectiveLevel =
            logLevel === 'debug' && !logger.isLevelEnabled('debug') ? 'info' : logLevel;
          logger[effectiveLevel](
            {
              requestId,
              userId,
              method: req.method,
              path: req.path,
              status,
              durationMs,
            },
            'http.request',
          );
        }
      }
      if (status === 403 && req.path !== '/api/auth/login') {
        recordSecurityAudit('auth.forbidden', {
          requestId,
          userId,
          method: req.method,
          path: req.path,
        });
      }
      if (status === 429) {
        recordSecurityAudit('rate_limit.triggered', {
          requestId,
          userId,
          method: req.method,
          path: req.path,
        });
      }
      const locals = res.locals as { errorCaptured?: boolean };
      if (status >= 500 && !locals.errorCaptured) {
        captureError({
          source: 'http',
          message: `HTTP ${status} ${req.method} ${req.path}`,
          status,
          method: req.method,
          path: req.path,
          requestId,
          userId,
        });
      }
    });
    requestLogContext.run({ requestId }, () => next());
  };
}
