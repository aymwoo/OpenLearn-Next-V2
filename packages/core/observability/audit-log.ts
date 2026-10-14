/**
 * 安全审计日志。与访问日志分开轮转，便于单独保留。
 *
 * 文件：`$LOG_DIR/audit.log`（默认 `logs/audit.log`）。
 * 轮转：`AUDIT_LOG_MAX_SIZE_MB`（默认 20）× `AUDIT_LOG_MAX_FILES`（默认 20 份历史）。
 * 超出份数的最旧文件直接删除，没有按天切割，也没有外发。
 * 生产环境同时写 stdout，方便容器日志系统采集；目录不可写时只留 stdout。
 */
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { logger } from './logger.js';
import { requestLogContext } from './request-context.js';
import { sanitizeValue } from './sanitize.js';
import { resolveAuditRotationConfig, RotatingFileStream } from './rotating-file-stream.js';

export interface AuditRecord {
  audit: true;
  event: string;
  requestId?: string;
  [key: string]: unknown;
}

type AuditSink = (record: AuditRecord) => void;
let testSink: AuditSink | null = null;

export function setAuditSinkForTests(sink: AuditSink | null): void {
  testSink = sink;
}

function buildAuditLogger(): pino.Logger {
  const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
  const streams: Array<{ level: string; stream: NodeJS.WritableStream }> = [{ level: 'info', stream: process.stdout }];
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return pino({ level: 'silent' }, pino.destination(1));
  }
  const logDir = path.resolve(process.env.LOG_DIR || path.join(process.cwd(), 'logs'));
  try {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.accessSync(logDir, fs.constants.W_OK);
    const rotation = resolveAuditRotationConfig();
    streams.push({
      level: 'info',
      stream: new RotatingFileStream({
        filePath: path.join(logDir, 'audit.log'),
        maxBytes: rotation.maxBytes,
        maxFiles: rotation.maxFiles,
      }),
    });
  } catch (err) {
    console.warn(`[audit] 无法写入审计日志目录 ${logDir}，仅输出到 stdout。`, err instanceof Error ? err.message : err);
  }
  return pino({ level, base: { log: 'audit' } }, pino.multistream(streams));
}

const auditLogger = buildAuditLogger();

export function recordSecurityAudit(event: string, fields: Record<string, unknown> = {}): AuditRecord {
  const requestId = typeof fields.requestId === 'string' ? fields.requestId : requestLogContext.getStore()?.requestId;
  const record = sanitizeValue({
    audit: true,
    event,
    ...fields,
    ...(requestId ? { requestId } : {}),
  }) as AuditRecord;
  testSink?.(record);
  if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
    auditLogger.info(record, event);
    logger.info(record, event);
  }
  return record;
}
