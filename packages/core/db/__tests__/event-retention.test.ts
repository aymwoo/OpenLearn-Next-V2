import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, initializeDatabase } from '../index.js';
import {
  DEFAULT_EVENT_RETENTION_DAYS,
  DELETE_EVENTS_OLDER_THAN_SQL,
  EVENT_RETENTION_ENV,
  purgeExpiredEvents,
  resolveEventRetention,
} from '../event-retention.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function memoryEventsDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      payload TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX idx_events_timestamp ON events(timestamp);
  `);
  return db;
}

function insertEvent(db: Database.Database, id: string, timestamp: number, payload = '{}') {
  db.prepare('INSERT INTO events (id, type, source, payload, timestamp) VALUES (?, ?, ?, ?, ?)').run(
    id,
    'test.event',
    'test',
    payload,
    timestamp,
  );
}

function ids(db: Database.Database): string[] {
  return (db.prepare('SELECT id FROM events ORDER BY id').all() as { id: string }[]).map((row) => row.id);
}

describe('events 保留期清理', () => {
  const prevRetention = process.env[EVENT_RETENTION_ENV];

  afterEach(() => {
    if (prevRetention === undefined) delete process.env[EVENT_RETENTION_ENV];
    else process.env[EVENT_RETENTION_ENV] = prevRetention;
  });

  it('谓词只比较 timestamp，并能用 idx_events_timestamp', () => {
    expect(DELETE_EVENTS_OLDER_THAN_SQL).toBe('DELETE FROM events WHERE timestamp < ?');
    expect(DELETE_EVENTS_OLDER_THAN_SQL).not.toMatch(/datetime|julianday|strftime|date\s*\(/i);

    const sourcePath = path.join(process.cwd(), 'packages/core/db/event-retention.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const deletes = source.match(/DELETE FROM events[^`'"]*/g) ?? [];
    expect(deletes).toEqual(['DELETE FROM events WHERE timestamp < ?']);

    const db = memoryEventsDb();
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${DELETE_EVENTS_OLDER_THAN_SQL}`).all(NOW) as { detail: string }[];
    const detail = plan.map((row) => row.detail).join('\n');
    expect(detail).toMatch(/idx_events_timestamp/);
    expect(detail).toMatch(/timestamp\s*</);
    db.close();
  });

  it('默认 90 天：更早的行删除，窗口内和恰好等于截止点的行保留', () => {
    const db = memoryEventsDb();
    const decision = resolveEventRetention(undefined, NOW);
    expect(decision.days).toBe(DEFAULT_EVENT_RETENTION_DAYS);
    expect(decision.disabled).toBe(false);
    expect(decision.cutoffMs).toBe(NOW - 90 * DAY_MS);

    insertEvent(db, 'old', decision.cutoffMs! - 1, 'payload-old-secret');
    insertEvent(db, 'cutoff', decision.cutoffMs!, 'payload-cutoff');
    insertEvent(db, 'fresh', NOW, 'payload-fresh-secret');

    const logs: string[] = [];
    const result = purgeExpiredEvents(db, {
      now: NOW,
      retentionRaw: undefined,
      log: {
        info: (message) => logs.push(message),
        warn: (message) => logs.push(message),
      },
    });

    expect(result).toEqual({ deleted: 1, disabled: false, days: 90 });
    expect(ids(db)).toEqual(['cutoff', 'fresh']);
    const text = logs.join('\n');
    expect(text).toContain('已删除 1 条');
    expect(text).not.toContain('payload-old-secret');
    expect(text).not.toContain('payload-fresh-secret');
    db.close();
  });

  it('OPENLEARN_EVENT_RETENTION_DAYS=0 时旧行和新行都保留', () => {
    const db = memoryEventsDb();
    insertEvent(db, 'old', NOW - 365 * DAY_MS, 'keep-me');
    insertEvent(db, 'fresh', NOW, 'keep-me-too');

    const logs: string[] = [];
    const result = purgeExpiredEvents(db, {
      now: NOW,
      retentionRaw: '0',
      log: {
        info: (message) => logs.push(message),
        warn: (message) => logs.push(message),
      },
    });

    expect(result).toEqual({ deleted: 0, disabled: true, days: 0 });
    expect(ids(db)).toEqual(['fresh', 'old']);
    expect(logs.join('\n')).toContain('跳过');
    expect(logs.join('\n')).not.toContain('keep-me');
    db.close();
  });

  it('空白视为默认 90 天，非法值回落并警告，正整数按给定天数', () => {
    expect(resolveEventRetention('  30  ', NOW).days).toBe(30);
    expect(resolveEventRetention('  0  ', NOW).disabled).toBe(true);
    expect(resolveEventRetention('', NOW)).toMatchObject({ days: 90, invalidRaw: false, disabled: false });
    expect(resolveEventRetention('ninety', NOW)).toMatchObject({ days: 90, invalidRaw: true });
    expect(resolveEventRetention('-1', NOW).invalidRaw).toBe(true);

    const db = memoryEventsDb();
    const cutoff = NOW - 10 * DAY_MS;
    insertEvent(db, 'older-than-10', cutoff - 1);
    insertEvent(db, 'within-10', NOW - 9 * DAY_MS);
    const result = purgeExpiredEvents(db, { now: NOW, retentionRaw: '10', log: { info() {}, warn() {} } });
    expect(result.days).toBe(10);
    expect(ids(db)).toEqual(['within-10']);
    db.close();
  });

  it('未传入 retentionRaw 时读取环境变量', () => {
    process.env[EVENT_RETENTION_ENV] = '0';
    const db = memoryEventsDb();
    insertEvent(db, 'old', 1);
    const result = purgeExpiredEvents(db, { now: NOW, log: { info() {}, warn() {} } });
    expect(result.disabled).toBe(true);
    expect(ids(db)).toEqual(['old']);
    db.close();
  });

  it('initializeDatabase 在初始化末尾执行清理', () => {
    delete process.env[EVENT_RETENTION_ENV];
    const tempDbPath = path.join(
      os.tmpdir(),
      `openlearn_event_retention_${Date.now()}_${Math.random().toString(16).slice(2)}.db`,
    );
    const db = createDatabase(tempDbPath);
    try {
      const cutoff = Date.now() - DEFAULT_EVENT_RETENTION_DAYS * DAY_MS;
      insertEvent(db, 'stale', cutoff - 1, 'stale-payload');
      insertEvent(db, 'recent', Date.now(), 'recent-payload');
      initializeDatabase(db);
      expect(ids(db)).toEqual(['recent']);

      insertEvent(db, 'stale-again', cutoff - 1);
      insertEvent(db, 'recent-again', Date.now());
      process.env[EVENT_RETENTION_ENV] = '0';
      initializeDatabase(db);
      expect(ids(db).sort()).toEqual(['recent', 'recent-again', 'stale-again']);
    } finally {
      db.close();
      for (const suffix of ['', '-wal', '-shm']) {
        const file = `${tempDbPath}${suffix}`;
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
    }
  });
});
