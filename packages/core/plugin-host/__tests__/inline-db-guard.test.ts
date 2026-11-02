/**
 * inline SQL 守卫（Issue #367）
 *
 * 目标：`OPENLEARN_SQL_GUARD_ALL_MODES=1` 时，inline 插件经 `ctx.resolve(IDatabaseToken)`
 * 拿到的原始句柄与 worker / process 同一口径 —— 核心表直查、裸 DDL、PRAGMA 全部拒绝，
 * 插件作者不必等切执行模式才发现违规。
 */
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createGuardedPluginDatabase, isSqlGuardAllModesEnabled } from '../inline-db-guard.js';

describe('isSqlGuardAllModesEnabled', () => {
  it('只认 1 / true / on / yes（大小写与空白无关）', () => {
    for (const v of ['1', 'true', 'TRUE', ' on ', 'yes']) {
      expect(isSqlGuardAllModesEnabled({ OPENLEARN_SQL_GUARD_ALL_MODES: v })).toBe(true);
    }
    for (const v of ['0', 'false', 'off', '', 'enabled']) {
      expect(isSqlGuardAllModesEnabled({ OPENLEARN_SQL_GUARD_ALL_MODES: v })).toBe(false);
    }
    expect(isSqlGuardAllModesEnabled({})).toBe(false);
  });
});

describe('createGuardedPluginDatabase', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE whiteboard_elements (id TEXT PRIMARY KEY, lesson_id TEXT);
      CREATE TABLE students (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE plugin_ext_demo_notes (id TEXT PRIMARY KEY, body TEXT);
    `);
  });

  afterEach(() => db.close());

  const guarded = () => createGuardedPluginDatabase(db, 'ext-demo', 'ext-demo');

  it('允许访问插件自己的表', () => {
    const g = guarded();
    expect(() => g.prepare('SELECT * FROM plugin_ext_demo_notes').all()).not.toThrow();
    expect(() => g.exec('CREATE TABLE plugin_ext_demo_more (id TEXT)')).not.toThrow();
  });

  it('核心表直查被拒绝（与 worker 同口径）', () => {
    const g = guarded();
    expect(() => g.prepare('SELECT * FROM whiteboard_elements')).toThrow(/SQL 被拒绝/);
    expect(() => g.prepare('DELETE FROM students')).toThrow(/SQL 被拒绝/);
    try {
      g.prepare('SELECT * FROM whiteboard_elements');
    } catch (err) {
      expect((err as Error & { code?: string }).code).toBe('PLUGIN_SQL_REJECTED');
    }
  });

  it('裸 DDL 与 PRAGMA 被拒绝', () => {
    const g = guarded();
    expect(() => g.exec('DROP TABLE whiteboard_elements')).toThrow(/SQL 被拒绝/);
    expect(() => g.pragma('table_info(whiteboard_elements)')).toThrow(/SQL 被拒绝/);
  });

  it('事务等其它方法原样透传', () => {
    const g = guarded();
    const insert = g.transaction((id: string) => {
      g.prepare('INSERT INTO plugin_ext_demo_notes (id, body) VALUES (?, ?)').run(id, 'x');
    });
    insert('n1');
    expect((g.prepare('SELECT COUNT(*) AS c FROM plugin_ext_demo_notes').get() as { c: number }).c).toBe(1);
  });
});
