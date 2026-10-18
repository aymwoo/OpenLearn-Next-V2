/**
 * retention-policy.ts — 多类别数据保留与定期清理策略（Issue #145）。
 *
 * 规范各类业务与系统数据的保留期，支持按类别独立配置保留天数（0 表示禁用该类别清理）。
 * 系统在数据库初始化（启动）时自动执行保留期清理，并在控制台记录各类别的清理统计。
 *
 * 类别与默认保留窗口：
 * - events (总线事件): 90 天
 * - attendance (考勤记录): 365 天
 * - student_read_notifications (已读通知标记): 30 天
 * - student_rollcalls (课堂点名流水): 180 天
 * - client_sessions (客户端会话): 30 天
 *
 * @module
 */

import type Database from 'better-sqlite3';

export const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_RETENTION_DAYS = Object.freeze({
  events: 90,
  attendance: 365,
  notifications: 30,
  rollcalls: 180,
  sessions: 30,
});

export interface RetentionDecision {
  disabled: boolean;
  days: number;
  cutoffMs: number | null;
  invalidRaw: boolean;
}

export interface PurgeCategoryResult {
  category: string;
  deleted: number;
  disabled: boolean;
  days: number;
  cutoffMs: number | null;
}

export interface RetentionPolicyLogger {
  info(message: string): void;
  warn(message: string): void;
  error?(message: string, err?: unknown): void;
}

const defaultLogger: RetentionPolicyLogger = {
  info: (msg) => console.info(msg),
  warn: (msg) => console.warn(msg),
  error: (msg, err) => console.error(msg, err),
};

/**
 * 解析某类别的保留天数配置。
 *
 * @param raw 原始字符串或数值配置
 * @param defaultDays 默认天数
 * @param now 基准时间戳
 */
export function resolveRetentionDecision(
  raw: string | number | undefined | null,
  defaultDays: number,
  now = Date.now(),
): RetentionDecision {
  const fallback = (): RetentionDecision => ({
    disabled: false,
    days: defaultDays,
    cutoffMs: now - defaultDays * DAY_MS,
    invalidRaw: true,
  });

  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return {
      disabled: false,
      days: defaultDays,
      cutoffMs: now - defaultDays * DAY_MS,
      invalidRaw: false,
    };
  }

  const str = String(raw).trim();
  if (!/^\d+$/.test(str)) return fallback();

  const days = Number(str);
  if (!Number.isSafeInteger(days) || days > Math.floor(Number.MAX_SAFE_INTEGER / DAY_MS)) {
    return fallback();
  }
  if (days === 0) {
    return { disabled: true, days: 0, cutoffMs: null, invalidRaw: false };
  }
  return { disabled: false, days, cutoffMs: now - days * DAY_MS, invalidRaw: false };
}

export interface PurgeCategoryOptions {
  now?: number;
  retentionRaw?: string | number | null;
  log?: RetentionPolicyLogger;
}

/**
 * 清理过期总线事件 (events)。
 */
export function purgeExpiredEvents(
  db: Database.Database,
  options?: PurgeCategoryOptions,
): PurgeCategoryResult {
  const raw =
    options && 'retentionRaw' in options
      ? options.retentionRaw
      : process.env.OPENLEARN_EVENT_RETENTION_DAYS || process.env.RETENTION_EVENTS_DAYS;
  const decision = resolveRetentionDecision(raw, DEFAULT_RETENTION_DAYS.events, options?.now ?? Date.now());
  const log = options?.log ?? defaultLogger;

  if (decision.invalidRaw) {
    log.warn(`[Retention] 非法的 events 保留天数配置 "${raw}"，已回退到默认 ${DEFAULT_RETENTION_DAYS.events} 天。`);
  }
  if (decision.disabled || decision.cutoffMs === null) {
    return { category: 'events', deleted: 0, disabled: true, days: 0, cutoffMs: null };
  }

  try {
    const info = db.prepare('DELETE FROM events WHERE timestamp < ?').run(decision.cutoffMs);
    if (info.changes > 0) {
      log.info(`[Retention] 已清理 ${info.changes} 条超过 ${decision.days} 天的 events 数据。`);
    }
    return {
      category: 'events',
      deleted: info.changes,
      disabled: false,
      days: decision.days,
      cutoffMs: decision.cutoffMs,
    };
  } catch (err) {
    log.warn(`[Retention] 清理 events 数据时出错: ${err instanceof Error ? err.message : String(err)}`);
    return { category: 'events', deleted: 0, disabled: false, days: decision.days, cutoffMs: decision.cutoffMs };
  }
}

/**
 * 清理过期考勤记录 (attendance)。
 */
export function purgeExpiredAttendance(
  db: Database.Database,
  options?: PurgeCategoryOptions,
): PurgeCategoryResult {
  const raw =
    options && 'retentionRaw' in options
      ? options.retentionRaw
      : process.env.OPENLEARN_ATTENDANCE_RETENTION_DAYS || process.env.RETENTION_ATTENDANCE_DAYS;
  const decision = resolveRetentionDecision(raw, DEFAULT_RETENTION_DAYS.attendance, options?.now ?? Date.now());
  const log = options?.log ?? defaultLogger;

  if (decision.invalidRaw) {
    log.warn(
      `[Retention] 非法的 attendance 保留天数配置 "${raw}"，已回退到默认 ${DEFAULT_RETENTION_DAYS.attendance} 天。`,
    );
  }
  if (decision.disabled || decision.cutoffMs === null) {
    return { category: 'attendance', deleted: 0, disabled: true, days: 0, cutoffMs: null };
  }

  try {
    const info = db.prepare('DELETE FROM attendance WHERE recorded_at < ?').run(decision.cutoffMs);
    if (info.changes > 0) {
      log.info(`[Retention] 已清理 ${info.changes} 条超过 ${decision.days} 天的 attendance 数据。`);
    }
    return {
      category: 'attendance',
      deleted: info.changes,
      disabled: false,
      days: decision.days,
      cutoffMs: decision.cutoffMs,
    };
  } catch (err) {
    log.warn(`[Retention] 清理 attendance 数据时出错: ${err instanceof Error ? err.message : String(err)}`);
    return { category: 'attendance', deleted: 0, disabled: false, days: decision.days, cutoffMs: decision.cutoffMs };
  }
}

/**
 * 清理过期已读通知标记 (student_read_notifications)。
 */
export function purgeExpiredNotifications(
  db: Database.Database,
  options?: PurgeCategoryOptions,
): PurgeCategoryResult {
  const raw =
    options && 'retentionRaw' in options
      ? options.retentionRaw
      : process.env.OPENLEARN_NOTIFICATIONS_RETENTION_DAYS || process.env.RETENTION_NOTIFICATIONS_DAYS;
  const decision = resolveRetentionDecision(raw, DEFAULT_RETENTION_DAYS.notifications, options?.now ?? Date.now());
  const log = options?.log ?? defaultLogger;

  if (decision.invalidRaw) {
    log.warn(
      `[Retention] 非法的 notifications 保留天数配置 "${raw}"，已回退到默认 ${DEFAULT_RETENTION_DAYS.notifications} 天。`,
    );
  }
  if (decision.disabled || decision.cutoffMs === null) {
    return { category: 'notifications', deleted: 0, disabled: true, days: 0, cutoffMs: null };
  }

  try {
    // 检查表是否存在 created_at 列
    const cols = db.prepare("PRAGMA table_info('student_read_notifications')").all() as Array<{ name: string }>;
    const hasCreatedAt = cols.some((c) => c.name === 'created_at');
    if (!hasCreatedAt) {
      return { category: 'notifications', deleted: 0, disabled: false, days: decision.days, cutoffMs: decision.cutoffMs };
    }

    const info = db
      .prepare('DELETE FROM student_read_notifications WHERE created_at IS NOT NULL AND created_at < ?')
      .run(decision.cutoffMs);
    if (info.changes > 0) {
      log.info(`[Retention] 已清理 ${info.changes} 条超过 ${decision.days} 天的 student_read_notifications 数据。`);
    }
    return {
      category: 'notifications',
      deleted: info.changes,
      disabled: false,
      days: decision.days,
      cutoffMs: decision.cutoffMs,
    };
  } catch (err) {
    log.warn(`[Retention] 清理 student_read_notifications 数据时出错: ${err instanceof Error ? err.message : String(err)}`);
    return { category: 'notifications', deleted: 0, disabled: false, days: decision.days, cutoffMs: decision.cutoffMs };
  }
}

/**
 * 清理过期点名记录 (student_rollcalls)。
 */
export function purgeExpiredRollcalls(
  db: Database.Database,
  options?: PurgeCategoryOptions,
): PurgeCategoryResult {
  const raw =
    options && 'retentionRaw' in options
      ? options.retentionRaw
      : process.env.OPENLEARN_ROLLCALLS_RETENTION_DAYS || process.env.RETENTION_ROLLCALLS_DAYS;
  const decision = resolveRetentionDecision(raw, DEFAULT_RETENTION_DAYS.rollcalls, options?.now ?? Date.now());
  const log = options?.log ?? defaultLogger;

  if (decision.invalidRaw) {
    log.warn(
      `[Retention] 非法的 rollcalls 保留天数配置 "${raw}"，已回退到默认 ${DEFAULT_RETENTION_DAYS.rollcalls} 天。`,
    );
  }
  if (decision.disabled || decision.cutoffMs === null) {
    return { category: 'rollcalls', deleted: 0, disabled: true, days: 0, cutoffMs: null };
  }

  try {
    const info = db.prepare('DELETE FROM student_rollcalls WHERE picked_time < ?').run(decision.cutoffMs);
    if (info.changes > 0) {
      log.info(`[Retention] 已清理 ${info.changes} 条超过 ${decision.days} 天的 student_rollcalls 数据。`);
    }
    return {
      category: 'rollcalls',
      deleted: info.changes,
      disabled: false,
      days: decision.days,
      cutoffMs: decision.cutoffMs,
    };
  } catch (err) {
    log.warn(`[Retention] 清理 student_rollcalls 数据时出错: ${err instanceof Error ? err.message : String(err)}`);
    return { category: 'rollcalls', deleted: 0, disabled: false, days: decision.days, cutoffMs: decision.cutoffMs };
  }
}

/**
 * 清理过期客户端会话 (client_sessions)。
 */
export function purgeExpiredSessions(
  db: Database.Database,
  options?: PurgeCategoryOptions,
): PurgeCategoryResult {
  const raw =
    options && 'retentionRaw' in options
      ? options.retentionRaw
      : process.env.OPENLEARN_SESSIONS_RETENTION_DAYS || process.env.RETENTION_SESSIONS_DAYS;
  const decision = resolveRetentionDecision(raw, DEFAULT_RETENTION_DAYS.sessions, options?.now ?? Date.now());
  const log = options?.log ?? defaultLogger;

  if (decision.invalidRaw) {
    log.warn(
      `[Retention] 非法的 sessions 保留天数配置 "${raw}"，已回退到默认 ${DEFAULT_RETENTION_DAYS.sessions} 天。`,
    );
  }
  if (decision.disabled || decision.cutoffMs === null) {
    return { category: 'sessions', deleted: 0, disabled: true, days: 0, cutoffMs: null };
  }

  try {
    const info = db
      .prepare('DELETE FROM client_sessions WHERE (expires_at IS NOT NULL AND expires_at < ?) OR updated_at < ?')
      .run(decision.cutoffMs, decision.cutoffMs);
    if (info.changes > 0) {
      log.info(`[Retention] 已清理 ${info.changes} 条超过 ${decision.days} 天的 client_sessions 数据。`);
    }
    return {
      category: 'sessions',
      deleted: info.changes,
      disabled: false,
      days: decision.days,
      cutoffMs: decision.cutoffMs,
    };
  } catch (err) {
    log.warn(`[Retention] 清理 client_sessions 数据时出错: ${err instanceof Error ? err.message : String(err)}`);
    return { category: 'sessions', deleted: 0, disabled: false, days: decision.days, cutoffMs: decision.cutoffMs };
  }
}

export interface PurgeAllOptions {
  now?: number;
  config?: {
    eventsDays?: number | string | null;
    attendanceDays?: number | string | null;
    notificationsDays?: number | string | null;
    rollcallsDays?: number | string | null;
    sessionsDays?: number | string | null;
  };
  log?: RetentionPolicyLogger;
}

/**
 * 组装单类别清理选项。
 *
 * `retentionRaw` 必须**省略**而不是显式传 `undefined`：各 purge 函数用
 * `'retentionRaw' in options` 判定「调用方是否显式指定过保留期」——
 * 显式传 `undefined`（哪怕值是 undefined）属性即算「已指定」，会**绕过环境变量回退**
 * 直接按默认天数清理。于是 `initializeDatabase` 无参调用本函数时，
 * `OPENLEARN_EVENT_RETENTION_DAYS=0` 等禁用开关全部失效（Issue #170 CI 实测：
 * 禁用 events 清理后过期事件仍被删）。config 里没给的类别一律不传该属性，
 * 走各函数自己的 env 回退；显式给了（含 null）才透传。
 */
function categoryOptions(
  opts: PurgeAllOptions,
  key: 'eventsDays' | 'attendanceDays' | 'notificationsDays' | 'rollcallsDays' | 'sessionsDays',
): PurgeCategoryOptions {
  const options: PurgeCategoryOptions = { now: opts.now, log: opts.log };
  if (opts.config && key in opts.config) {
    options.retentionRaw = opts.config[key];
  }
  return options;
}

/**
 * 启动时一键清理所有支持保留策略的数据类别。
 */
export function purgeAllExpiredData(
  db: Database.Database,
  options?: PurgeAllOptions,
): Record<string, PurgeCategoryResult> {
  const results: Record<string, PurgeCategoryResult> = {};
  const opts = options ?? {};

  results.events = purgeExpiredEvents(db, categoryOptions(opts, 'eventsDays'));
  results.attendance = purgeExpiredAttendance(db, categoryOptions(opts, 'attendanceDays'));
  results.notifications = purgeExpiredNotifications(db, categoryOptions(opts, 'notificationsDays'));
  results.rollcalls = purgeExpiredRollcalls(db, categoryOptions(opts, 'rollcallsDays'));
  results.sessions = purgeExpiredSessions(db, categoryOptions(opts, 'sessionsDays'));

  return results;
}
