/**
 * 浏览器运行时错误入口。不要求登录，便于改密门和未登录页上报。
 * 响应恒为 204，不回显上报内容。
 */
import type { Express, Request } from 'express';
import { captureError, type ErrorSource } from '../../packages/core/observability/error-reporter.js';

const MAX_BODY_BYTES = 16 * 1024;
const SOURCES = new Set<ErrorSource>(['client', 'runtime', 'promise']);

export function registerClientErrorRoute(app: Express): void {
  app.post('/api/client-errors', (req, res) => {
    res.status(204).end();
    const declared = Number(req.headers['content-length'] || 0);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return;
    const body = req.body;
    if (!body || typeof body !== 'object') return;
    const raw = body as { source?: unknown; message?: unknown; stack?: unknown; path?: unknown };
    if (typeof raw.message !== 'string' || !raw.message.trim()) return;
    const source: ErrorSource =
      typeof raw.source === 'string' && SOURCES.has(raw.source as ErrorSource) ? (raw.source as ErrorSource) : 'client';
    const requestId = (req as Request & { requestId?: string }).requestId;
    captureError({
      source,
      message: raw.message,
      stack: typeof raw.stack === 'string' ? raw.stack : undefined,
      path: typeof raw.path === 'string' ? raw.path : undefined,
      requestId,
      platform: 'javascript',
    });
  });
}
