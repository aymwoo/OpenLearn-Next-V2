/**
 * 可选的错误收集。
 *
 * 未配置 DSN 时只把脱敏后的事件写入结构化日志，进程照常运行。
 * 配置 `SENTRY_DSN` 或 `OPENLEARN_ERROR_DSN` 后，额外向 Sentry 兼容的
 * Envelope 接口 POST（自建 Sentry / GlitchTip 均可）。上报失败被吞掉。
 */
import { randomBytes } from 'node:crypto';
import { logger } from './logger.js';
import { sanitizeValue, scrubString } from './sanitize.js';

export type ErrorSource = 'uncaught' | 'unhandledRejection' | 'http' | 'client' | 'runtime' | 'promise';

export interface ErrorReportInput {
  source: ErrorSource;
  message: string;
  name?: string;
  stack?: string;
  status?: number;
  method?: string;
  path?: string;
  requestId?: string;
  userId?: string;
  platform?: 'node' | 'javascript';
}

export interface SanitizedErrorReport {
  source: ErrorSource;
  message: string;
  name: string;
  stack?: string;
  status?: number;
  method?: string;
  path?: string;
  requestId?: string;
  userId?: string;
  platform: 'node' | 'javascript';
}

type ErrorSink = (report: SanitizedErrorReport) => void;
let testSink: ErrorSink | null = null;

/** 测试注入。生产路径不使用。 */
export function setErrorCaptureSinkForTests(sink: ErrorSink | null): void {
  testSink = sink;
}

export function configuredErrorDsn(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = (env.SENTRY_DSN || env.OPENLEARN_ERROR_DSN || '').trim();
  return raw || undefined;
}

export function sanitizeErrorReport(input: ErrorReportInput): SanitizedErrorReport {
  const pathOnly = input.path ? stripQuery(input.path) : undefined;
  return {
    source: input.source,
    message: scrubString(input.message || 'unknown error').slice(0, 2000),
    name: scrubString(input.name || 'Error').slice(0, 120),
    stack: input.stack ? scrubString(input.stack).slice(0, 8000) : undefined,
    status: typeof input.status === 'number' ? input.status : undefined,
    method: input.method ? input.method.slice(0, 16) : undefined,
    path: pathOnly ? pathOnly.slice(0, 300) : undefined,
    requestId: input.requestId ? input.requestId.slice(0, 64) : undefined,
    userId: input.userId ? input.userId.slice(0, 64) : undefined,
    platform: input.platform || (input.source === 'client' ? 'javascript' : 'node'),
  };
}

function stripQuery(value: string): string {
  const q = value.indexOf('?');
  return q === -1 ? value : value.slice(0, q);
}

export interface ParsedDsn {
  envelopeUrl: string;
  publicKey: string;
}

/** `https://<key>@<host>/<projectId>`，可选端口与路径前缀。解析失败返回 null。 */
export function parseSentryDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const publicKey = decodeURIComponent(url.username || '');
    if (!publicKey || !url.hostname) return null;
    const projectId = url.pathname.split('/').filter(Boolean).pop();
    if (!projectId || !/^\d+$/.test(projectId)) return null;
    const prefix = url.pathname.split('/').filter(Boolean).slice(0, -1).join('/');
    const path = prefix ? `/${prefix}` : '';
    const envelopeUrl = `${url.protocol}//${url.host}${path}/api/${projectId}/envelope/`;
    return { envelopeUrl, publicKey };
  } catch {
    return null;
  }
}

export function buildSentryEnvelope(report: SanitizedErrorReport, dsn: string): string | null {
  const safe = sanitizeErrorReport(report);
  const parsed = parseSentryDsn(dsn);
  if (!parsed) return null;
  const eventId = randomBytes(16).toString('hex');
  const header = JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn });
  const item = JSON.stringify({ type: 'event', content_type: 'application/json' });
  const event = {
    event_id: eventId,
    timestamp: new Date().toISOString(),
    platform: safe.platform,
    level: 'error',
    logger: 'openlearn',
    message: { formatted: safe.message },
    exception: {
      values: [
        {
          type: safe.name,
          value: safe.message,
          stacktrace: safe.stack ? { frames: [] } : undefined,
        },
      ],
    },
    extra: sanitizeValue({
      stack: safe.stack,
      status: safe.status,
      method: safe.method,
      path: safe.path,
      requestId: safe.requestId,
      userId: safe.userId,
    }),
    tags: { source: safe.source },
  };
  return `${header}\n${item}\n${JSON.stringify(event)}\n`;
}

export async function postSentryEnvelope(
  dsn: string,
  report: SanitizedErrorReport,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const parsed = parseSentryDsn(dsn);
  const body = buildSentryEnvelope(report, dsn);
  if (!parsed || !body) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    await fetchImpl(parsed.envelopeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=openlearn-error-reporter/1.0, sentry_key=${parsed.publicKey}`,
      },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function captureError(input: ErrorReportInput): void {
  const report = sanitizeErrorReport(input);
  testSink?.(report);
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return;
  logger.error({ errorReport: report }, 'error.captured');
  const dsn = configuredErrorDsn();
  if (!dsn) return;
  void postSentryEnvelope(dsn, report).catch(() => {
    /* 上报失败不影响请求 */
  });
}

export function captureUnknownError(
  source: ErrorSource,
  err: unknown,
  extra: Omit<ErrorReportInput, 'source' | 'message' | 'name' | 'stack'> = {},
): void {
  if (err instanceof Error) {
    captureError({ source, message: err.message, name: err.name, stack: err.stack, ...extra });
    return;
  }
  captureError({ source, message: typeof err === 'string' ? err : 'non-error rejection', ...extra });
}
