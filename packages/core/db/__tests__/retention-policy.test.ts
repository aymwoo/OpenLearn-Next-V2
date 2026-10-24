import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  DAY_MS,
  DEFAULT_RETENTION_DAYS,
  resolveRetentionDecision,
  purgeExpiredEvents,
  purgeExpiredAttendance,
  purgeExpiredNotifications,
  purgeExpiredRollcalls,
  purgeExpiredSessions,
  purgeExpiredPendingCommands,
  purgeAllExpiredData,
  type RetentionPolicyLogger,
} from '../retention-policy.js';

describe('Data Retention Policy & Regular Purge (Issue #145)', () => {
  describe('resolveRetentionDecision', () => {
    const fixedNow = 1700000000000;

    it('缺省配置应回退到默认天数', () => {
      const res1 = resolveRetentionDecision(undefined, 90, fixedNow);
      expect(res1).toEqual({
        disabled: false,
        days: 90,
        cutoffMs: fixedNow - 90 * DAY_MS,
        invalidRaw: false,
      });

      const res2 = resolveRetentionDecision(null, 30, fixedNow);
      expect(res2).toEqual({
        disabled: false,
        days: 30,
        cutoffMs: fixedNow - 30 * DAY_MS,
        invalidRaw: false,
      });

      const res3 = resolveRetentionDecision('  ', 365, fixedNow);
      expect(res3).toEqual({
        disabled: false,
        days: 365,
        cutoffMs: fixedNow - 365 * DAY_MS,
        invalidRaw: false,
      });
    });

    it('有效数值或数字字符串解析为指定保留天数', () => {
      const res1 = resolveRetentionDecision('15', 90, fixedNow);
      expect(res1).toEqual({
        disabled: false,
        days: 15,
        cutoffMs: fixedNow - 15 * DAY_MS,
        invalidRaw: false,
      });

      const res2 = resolveRetentionDecision(60, 90, fixedNow);
      expect(res2).toEqual({
        disabled: false,
        days: 60,
        cutoffMs: fixedNow - 60 * DAY_MS,
        invalidRaw: false,
      });
    });

    it('0 应解析为禁用清理', () => {
      const resStr = resolveRetentionDecision('0', 90, fixedNow);
      expect(resStr).toEqual({
        disabled: true,
        days: 0,
        cutoffMs: null,
        invalidRaw: false,
      });

      const resNum = resolveRetentionDecision(0, 90, fixedNow);
      expect(resNum).toEqual({
        disabled: true,
        days: 0,
        cutoffMs: null,
        invalidRaw: false,
      });
    });

    it('非法值（负数、非数字、浮点数、极大溢出值）应回退到默认天数并标记 invalidRaw: true', () => {
      expect(resolveRetentionDecision('-5', 90, fixedNow)).toEqual({
        disabled: false,
        days: 90,
        cutoffMs: fixedNow - 90 * DAY_MS,
        invalidRaw: true,
      });

      expect(resolveRetentionDecision('abc', 90, fixedNow)).toEqual({
        disabled: false,
        days: 90,
        cutoffMs: fixedNow - 90 * DAY_MS,
        invalidRaw: true,
      });

      expect(resolveRetentionDecision('12.34', 90, fixedNow)).toEqual({
        disabled: false,
        days: 90,
        cutoffMs: fixedNow - 90 * DAY_MS,
        invalidRaw: true,
      });

      expect(resolveRetentionDecision('99999999999999999999', 90, fixedNow)).toEqual({
        disabled: false,
        days: 90,
        cutoffMs: fixedNow - 90 * DAY_MS,
        invalidRaw: true,
      });
    });
  });

  describe('Database Purge Actions', () => {
    let db: Database.Database;
    const mockLog: RetentionPolicyLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const now = 1700000000000;

    beforeEach(() => {
      vi.clearAllMocks();
      db = new Database(':memory:');
      db.exec(`
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS attendance (
          schedule_id TEXT,
          student_id TEXT,
          recorded_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS student_read_notifications (
          student_id TEXT NOT NULL,
          notification_id TEXT NOT NULL,
          created_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS student_rollcalls (
          id TEXT PRIMARY KEY,
          picked_time INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS client_sessions (
          id TEXT PRIMARY KEY,
          expires_at INTEGER,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pending_commands (
          id TEXT PRIMARY KEY,
          command_type TEXT NOT NULL,
          payload TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
    });

    afterEach(() => {
      db.close();
    });

    it('purgeExpiredEvents: 清理超过指定天数的 events，保留近期数据', () => {
      const oldTime = now - 91 * DAY_MS;
      const recentTime = now - 30 * DAY_MS;
      db.prepare('INSERT INTO events (id, type, timestamp) VALUES (?, ?, ?)').run('e-old', 'test.old', oldTime);
      db.prepare('INSERT INTO events (id, type, timestamp) VALUES (?, ?, ?)').run('e-new', 'test.new', recentTime);

      const res = purgeExpiredEvents(db, { now, retentionRaw: 90, log: mockLog });

      expect(res.deleted).toBe(1);
      expect(res.category).toBe('events');
      expect(res.disabled).toBe(false);

      const remaining = db.prepare('SELECT id FROM events').all() as Array<{ id: string }>;
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('e-new');
    });

    it('purgeExpiredEvents: 当配置为 0 时禁用清理，不删除任何记录', () => {
      const oldTime = now - 1000 * DAY_MS;
      db.prepare('INSERT INTO events (id, type, timestamp) VALUES (?, ?, ?)').run('e-old', 'test.old', oldTime);

      const res = purgeExpiredEvents(db, { now, retentionRaw: 0, log: mockLog });

      expect(res.disabled).toBe(true);
      expect(res.deleted).toBe(0);

      const remaining = db.prepare('SELECT id FROM events').all();
      expect(remaining).toHaveLength(1);
    });

    it('purgeExpiredAttendance: 清理过期考勤记录', () => {
      const oldTime = now - 366 * DAY_MS;
      const recentTime = now - 100 * DAY_MS;
      db.prepare('INSERT INTO attendance (schedule_id, student_id, recorded_at) VALUES (?, ?, ?)').run(
        'sch-1',
        's-1',
        oldTime,
      );
      db.prepare('INSERT INTO attendance (schedule_id, student_id, recorded_at) VALUES (?, ?, ?)').run(
        'sch-2',
        's-2',
        recentTime,
      );

      const res = purgeExpiredAttendance(db, { now, retentionRaw: 365, log: mockLog });

      expect(res.deleted).toBe(1);
      const remaining = db.prepare('SELECT student_id FROM attendance').all() as Array<{ student_id: string }>;
      expect(remaining).toHaveLength(1);
      expect(remaining[0].student_id).toBe('s-2');
    });

    it('purgeExpiredNotifications: 清理过期 student_read_notifications 并优雅应对缺失 created_at 的旧库结构', () => {
      const oldTime = now - 35 * DAY_MS;
      const recentTime = now - 5 * DAY_MS;
      db.prepare(
        'INSERT INTO student_read_notifications (student_id, notification_id, created_at) VALUES (?, ?, ?)',
      ).run('s-1', 'n-1', oldTime);
      db.prepare(
        'INSERT INTO student_read_notifications (student_id, notification_id, created_at) VALUES (?, ?, ?)',
      ).run('s-2', 'n-2', recentTime);

      const res = purgeExpiredNotifications(db, { now, retentionRaw: 30, log: mockLog });
      expect(res.deleted).toBe(1);

      const remaining = db.prepare('SELECT notification_id FROM student_read_notifications').all() as Array<{
        notification_id: string;
      }>;
      expect(remaining).toHaveLength(1);
      expect(remaining[0].notification_id).toBe('n-2');

      // 降级场景：若表没有 created_at 列（旧表），应安全跳过而不抛异常
      const oldDb = new Database(':memory:');
      oldDb.exec('CREATE TABLE student_read_notifications (student_id TEXT, notification_id TEXT);');
      const fallbackRes = purgeExpiredNotifications(oldDb, { now, log: mockLog });
      expect(fallbackRes.deleted).toBe(0);
      oldDb.close();
    });

    it('purgeExpiredRollcalls: 清理过期课堂点名流水记录', () => {
      const oldTime = now - 200 * DAY_MS;
      const recentTime = now - 10 * DAY_MS;
      db.prepare('INSERT INTO student_rollcalls (id, picked_time) VALUES (?, ?)').run('rc-1', oldTime);
      db.prepare('INSERT INTO student_rollcalls (id, picked_time) VALUES (?, ?)').run('rc-2', recentTime);

      const res = purgeExpiredRollcalls(db, { now, retentionRaw: 180, log: mockLog });
      expect(res.deleted).toBe(1);

      const remaining = db.prepare('SELECT id FROM student_rollcalls').all() as Array<{ id: string }>;
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('rc-2');
    });

    it('purgeExpiredSessions: 清理过期客户端会话（根据 expires_at 或 updated_at）', () => {
      const oldTime = now - 40 * DAY_MS;
      const recentTime = now - 5 * DAY_MS;
      // 会话 1：expires_at 已超过
      db.prepare('INSERT INTO client_sessions (id, expires_at, updated_at) VALUES (?, ?, ?)').run(
        'sess-1',
        oldTime,
        recentTime,
      );
      // 会话 2：updated_at 过期但 expires_at 为 null
      db.prepare('INSERT INTO client_sessions (id, expires_at, updated_at) VALUES (?, ?, ?)').run(
        'sess-2',
        null,
        oldTime,
      );
      // 会话 3：未过期
      db.prepare('INSERT INTO client_sessions (id, expires_at, updated_at) VALUES (?, ?, ?)').run(
        'sess-3',
        now + 10 * DAY_MS,
        recentTime,
      );

      const res = purgeExpiredSessions(db, { now, retentionRaw: 30, log: mockLog });
      expect(res.deleted).toBe(2);

      const remaining = db.prepare('SELECT id FROM client_sessions').all() as Array<{ id: string }>;
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('sess-3');
    });

    it('purgeExpiredPendingCommands: 清理超期挂起指令，保留未超期的（Issue #195）', () => {
      const stale = now - 15 * DAY_MS; // > 默认 14 天
      const fresh = now - 3 * DAY_MS;
      db.prepare(
        'INSERT INTO pending_commands (id, command_type, payload, actor_id, created_at) VALUES (?,?,?,?,?)',
      ).run('pc-old', 'site.destroy', '{}', 'plugin:legacy', stale);
      db.prepare(
        'INSERT INTO pending_commands (id, command_type, payload, actor_id, created_at) VALUES (?,?,?,?,?)',
      ).run('pc-new', 'site.destroy', '{}', 'plugin:legacy', fresh);

      const res = purgeExpiredPendingCommands(db, { now, log: mockLog });

      expect(res.category).toBe('pendingCommands');
      expect(res.disabled).toBe(false);
      expect(res.days).toBe(DEFAULT_RETENTION_DAYS.pendingCommands);
      expect(res.deleted).toBe(1);
      const remaining = db.prepare('SELECT id FROM pending_commands').all() as Array<{ id: string }>;
      expect(remaining.map((r) => r.id)).toEqual(['pc-new']);
    });

    it('purgeExpiredPendingCommands: 配置为 0 时禁用清理（不删任何挂起指令）', () => {
      const ancient = now - 5000 * DAY_MS;
      db.prepare(
        'INSERT INTO pending_commands (id, command_type, payload, actor_id, created_at) VALUES (?,?,?,?,?)',
      ).run('pc-ancient', 'site.destroy', '{}', 'plugin:legacy', ancient);

      const res = purgeExpiredPendingCommands(db, { now, retentionRaw: 0, log: mockLog });

      expect(res.disabled).toBe(true);
      expect(res.deleted).toBe(0);
      expect(db.prepare('SELECT id FROM pending_commands').all()).toHaveLength(1);
    });

    it('purgeExpiredPendingCommands: 无 config 时按 OPENLEARN_RETENTION_PENDING_COMMANDS_DAYS 清理', () => {
      const oldTime = now - 4 * DAY_MS;
      db.prepare(
        'INSERT INTO pending_commands (id, command_type, payload, actor_id, created_at) VALUES (?,?,?,?,?)',
      ).run('pc-env', 'site.destroy', '{}', 'plugin:legacy', oldTime);

      const original = process.env.OPENLEARN_RETENTION_PENDING_COMMANDS_DAYS;
      process.env.OPENLEARN_RETENTION_PENDING_COMMANDS_DAYS = '3';
      try {
        const summary = purgeAllExpiredData(db, { now, log: mockLog });
        expect(summary.pendingCommands.disabled).toBe(false);
        expect(summary.pendingCommands.days).toBe(3);
        expect(summary.pendingCommands.deleted).toBe(1);
      } finally {
        if (original === undefined) delete process.env.OPENLEARN_RETENTION_PENDING_COMMANDS_DAYS;
        else process.env.OPENLEARN_RETENTION_PENDING_COMMANDS_DAYS = original;
      }
    });

    it('purgeAllExpiredData: 聚合清理所有 6 个类别并返回各类别明细', () => {
      const oldTime = now - 500 * DAY_MS;
      db.prepare('INSERT INTO events (id, type, timestamp) VALUES (?, ?, ?)').run('e-all', 'test', oldTime);
      db.prepare('INSERT INTO attendance (schedule_id, student_id, recorded_at) VALUES (?, ?, ?)').run(
        'sch',
        's',
        oldTime,
      );
      db.prepare(
        'INSERT INTO student_read_notifications (student_id, notification_id, created_at) VALUES (?, ?, ?)',
      ).run('s', 'n', oldTime);
      db.prepare('INSERT INTO student_rollcalls (id, picked_time) VALUES (?, ?)').run('rc', oldTime);
      db.prepare('INSERT INTO client_sessions (id, expires_at, updated_at) VALUES (?, ?, ?)').run(
        'sess',
        oldTime,
        oldTime,
      );
      db.prepare(
        'INSERT INTO pending_commands (id, command_type, payload, actor_id, created_at) VALUES (?,?,?,?,?)',
      ).run('pc-all', 'site.destroy', '{}', 'plugin:legacy', oldTime);

      const summary = purgeAllExpiredData(db, {
        now,
        config: {
          eventsDays: 90,
          attendanceDays: 365,
          notificationsDays: 30,
          rollcallsDays: 180,
          sessionsDays: 30,
          pendingCommandsDays: 14,
        },
        log: mockLog,
      });

      expect(summary.events.deleted).toBe(1);
      expect(summary.attendance.deleted).toBe(1);
      expect(summary.notifications.deleted).toBe(1);
      expect(summary.rollcalls.deleted).toBe(1);
      expect(summary.sessions.deleted).toBe(1);
      expect(summary.pendingCommands.deleted).toBe(1);
    });

    it('purgeAllExpiredData: 无 config 时遵守环境变量禁用开关（不得显式传 undefined 绕过 env）', () => {
      // 回归（Issue #170 CI 实测）：purgeAllExpiredData 曾给每个类别显式传
      // retentionRaw: undefined，触发 'retentionRaw' in options 短路，
      // OPENLEARN_EVENT_RETENTION_DAYS=0 的禁用开关失效，过期事件仍被删。
      const oldTime = now - 500 * DAY_MS;
      db.prepare('INSERT INTO events (id, type, timestamp) VALUES (?, ?, ?)').run('e-env-off', 'test', oldTime);

      const original = process.env.OPENLEARN_EVENT_RETENTION_DAYS;
      process.env.OPENLEARN_EVENT_RETENTION_DAYS = '0';
      try {
        const summary = purgeAllExpiredData(db, { now, log: mockLog });
        expect(summary.events.disabled).toBe(true);
        expect(summary.events.deleted).toBe(0);
        expect(db.prepare('SELECT id FROM events').all()).toHaveLength(1);
      } finally {
        if (original === undefined) delete process.env.OPENLEARN_EVENT_RETENTION_DAYS;
        else process.env.OPENLEARN_EVENT_RETENTION_DAYS = original;
      }
    });

    it('purgeAllExpiredData: 无 config 时按环境变量天数清理（env 回退完好）', () => {
      const oldTime = now - 100 * DAY_MS;
      const recentTime = now - 10 * DAY_MS;
      db.prepare('INSERT INTO events (id, type, timestamp) VALUES (?, ?, ?)').run('e-env-old', 'test', oldTime);
      db.prepare('INSERT INTO events (id, type, timestamp) VALUES (?, ?, ?)').run('e-env-new', 'test', recentTime);

      const original = process.env.OPENLEARN_EVENT_RETENTION_DAYS;
      process.env.OPENLEARN_EVENT_RETENTION_DAYS = '50';
      try {
        const summary = purgeAllExpiredData(db, { now, log: mockLog });
        expect(summary.events.disabled).toBe(false);
        expect(summary.events.days).toBe(50);
        expect(summary.events.deleted).toBe(1);
        expect(db.prepare('SELECT id FROM events').all()).toEqual([{ id: 'e-env-new' }]);
      } finally {
        if (original === undefined) delete process.env.OPENLEARN_EVENT_RETENTION_DAYS;
        else process.env.OPENLEARN_EVENT_RETENTION_DAYS = original;
      }
    });

    it('purgeAllExpiredData: config 显式给 0 时禁用对应类别（透传不被破坏）', () => {
      const oldTime = now - 500 * DAY_MS;
      db.prepare('INSERT INTO events (id, type, timestamp) VALUES (?, ?, ?)').run('e-cfg-off', 'test', oldTime);

      const summary = purgeAllExpiredData(db, { now, config: { eventsDays: 0 }, log: mockLog });
      expect(summary.events.disabled).toBe(true);
      expect(db.prepare('SELECT id FROM events').all()).toHaveLength(1);
    });
  });
});
