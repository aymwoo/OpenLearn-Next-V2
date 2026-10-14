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
const QUIET_PATHS = new Set(['/health', '/health/ready']);

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
      const quiet = QUIET_PATHS.has(req.path) && status < 400;
      if (!quiet) {
        logger.info(
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
