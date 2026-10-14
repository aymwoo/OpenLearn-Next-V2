import type Database from 'better-sqlite3';

/**
 * 总线事件表（`events`）启动时按保留天数清理。
 *
 * `initAuditLog` 只插入、从不删除。`idx_events_timestamp` 已经存在，
 * 因此这里的谓词必须是裸的 `timestamp < ?`，不能对列套函数。
 * 安全审计文件 `audit.log` 不在这张表里，不受本次删除影响。
 */
export const DEFAULT_EVENT_RETENTION_DAYS = 90;
export const EVENT_RETENTION_ENV = 'OPENLEARN_EVENT_RETENTION_DAYS';

/** 只比较 timestamp 列，便于走到 idx_events_timestamp。 */
export const DELETE_EVENTS_OLDER_THAN_SQL = 'DELETE FROM events WHERE timestamp < ?';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface EventRetentionDecision {
  disabled: boolean;
  days: number;
  /** 未禁用时，timestamp 严格小于该毫秒值的行会被删除。 */
  cutoffMs: number | null;
  invalidRaw: boolean;
}

export interface EventRetentionLogger {
  info(message: string): void;
  warn(message: string): void;
}

const defaultLogger: EventRetentionLogger = {
  info: (message) => console.info(message),
  warn: (message) => console.warn(message),
};

/**
 * 解析保留天数。
 * 未设置或空白：90 天。
 * `0`：关闭删除。
 * 其他非负整数字符串：按该天数。
 * 无法解析：视为非法，调用方应警告并回落到 90 天。
 */
export function resolveEventRetention(raw: string | undefined | null, now = Date.now()): EventRetentionDecision {
  const fallback = (): EventRetentionDecision => ({
    disabled: false,
    days: DEFAULT_EVENT_RETENTION_DAYS,
    cutoffMs: now - DEFAULT_EVENT_RETENTION_DAYS * DAY_MS,
    invalidRaw: true,
  });

  if (raw == null || raw.trim() === '') {
    return {
      disabled: false,
      days: DEFAULT_EVENT_RETENTION_DAYS,
      cutoffMs: now - DEFAULT_EVENT_RETENTION_DAYS * DAY_MS,
      invalidRaw: false,
    };
  }

  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return fallback();

  const days = Number(trimmed);
  if (!Number.isSafeInteger(days) || days > Math.floor(Number.MAX_SAFE_INTEGER / DAY_MS)) {
    return fallback();
  }
  if (days === 0) {
    return { disabled: true, days: 0, cutoffMs: null, invalidRaw: false };
  }
  return { disabled: false, days, cutoffMs: now - days * DAY_MS, invalidRaw: false };
}

export interface PurgeExpiredEventsResult {
  deleted: number;
  disabled: boolean;
  days: number;
}

export interface PurgeExpiredEventsOptions {
  now?: number;
  /**
   * 显式传入时不再读环境变量（含 `undefined`，表示使用默认 90 天）。
   * 省略该字段时读取 `OPENLEARN_EVENT_RETENTION_DAYS`。
   */
  retentionRaw?: string | null;
  log?: EventRetentionLogger;
}

/**
 * 删除早于保留窗口的总线事件。每个进程在数据库初始化末尾调用一次，不挂在插入路径上。
 * 日志只记删除条数和天数，不记 payload。
 */
export function purgeExpiredEvents(
  db: Database.Database,
  options?: PurgeExpiredEventsOptions,
): PurgeExpiredEventsResult {
  const raw = options && 'retentionRaw' in options ? options.retentionRaw : process.env[EVENT_RETENTION_ENV];
  const decision = resolveEventRetention(raw, options?.now ?? Date.now());
  const log = options?.log ?? defaultLogger;

  if (decision.invalidRaw) {
    log.warn(`[events] ${EVENT_RETENTION_ENV} 不是非负整数，改用默认 ${DEFAULT_EVENT_RETENTION_DAYS} 天`);
  }

  if (decision.disabled || decision.cutoffMs == null) {
    log.info(`[events] ${EVENT_RETENTION_ENV}=0，跳过 events 清理`);
    return { deleted: 0, disabled: true, days: 0 };
  }

  const deleted = db.prepare(DELETE_EVENTS_OLDER_THAN_SQL).run(decision.cutoffMs).changes;
  log.info(`[events] 已删除 ${deleted} 条早于 ${decision.days} 天的总线事件`);
  return { deleted, disabled: false, days: decision.days };
}
