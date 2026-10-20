/**
 * 从迁移 000–035 升级到 036（student_read_notifications 补齐 created_at）。
 *
 * 回归守卫：
 * SQLite 在已有存量行的表上执行 `ALTER TABLE ADD COLUMN ... DEFAULT (non_constant_expr)` 会抛出
 * `Cannot add a column with non-constant default` 异常。
 * 036 迁移必须支持在非空库上平滑执行，完整保留存量已读数据，补齐时间戳，且新插入记录享有默认值。
 */
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { loadMigrationsFromDirectory, runMigrations, splitSqlStatements } from '../migrator.js';

const migrationsDir = path.resolve(process.cwd(), 'migrations');

function migrationNumber(name: string): number {
  const match = /^(\d+)_/.exec(name);
  if (!match) throw new Error(`unexpected migration name ${name}`);
  return Number.parseInt(match[1], 10);
}

describe('从迁移 000–035 升级到 036（student_read_notifications 增加 created_at）', () => {
  const dbs: Database.Database[] = [];

  afterEach(() => {
    while (dbs.length > 0) {
      dbs.pop()?.close();
    }
  });

  function openMemory(): Database.Database {
    const db = new Database(':memory:');
    dbs.push(db);
    return db;
  }

  it('非空表升级：存量数据存在时顺利应用 036，回填 created_at 且不报非字面常量默认值错误', () => {
    const all = loadMigrationsFromDirectory(migrationsDir);
    const legacy = all.filter((m) => migrationNumber(m.name) <= 35);
    const m036 = all.find((m) => migrationNumber(m.name) === 36);
    expect(m036).toBeTruthy();

    const db = openMemory();
    runMigrations(db, legacy);

    // 确认 035 及以前的 student_read_notifications 只有两列且没有 created_at
    const colsBefore = db.prepare("PRAGMA table_info('student_read_notifications')").all() as Array<{ name: string }>;
    expect(colsBefore.map((c) => c.name)).toEqual(['student_id', 'notification_id']);

    // 写入存量记录（模拟线上环境老数据）
    const insertStmt = db.prepare('INSERT INTO student_read_notifications (student_id, notification_id) VALUES (?, ?)');
    insertStmt.run('stu_001', 'notif_welcome');
    insertStmt.run('stu_002', 'notif_assignment_1');

    // 应用 036 迁移（必须不能抛出 "Cannot add a column with non-constant default"）
    expect(() => runMigrations(db, [m036!])).not.toThrow();

    // 检查表结构：主键仍然有效，且新增了 created_at 列
    const colsAfter = db.prepare("PRAGMA table_info('student_read_notifications')").all() as Array<{
      name: string;
      pk: number;
      dflt_value: string | null;
    }>;
    expect(colsAfter.map((c) => c.name)).toEqual(['student_id', 'notification_id', 'created_at']);
    const pkCols = colsAfter
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name);
    expect(pkCols).toEqual(['student_id', 'notification_id']);

    // 存量数据原样保留，并且被赋予了非空的当前毫秒时间戳
    const rows = db.prepare('SELECT * FROM student_read_notifications ORDER BY student_id').all() as Array<{
      student_id: string;
      notification_id: string;
      created_at: number;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].student_id).toBe('stu_001');
    expect(rows[0].notification_id).toBe('notif_welcome');
    expect(typeof rows[0].created_at).toBe('number');
    expect(rows[0].created_at).toBeGreaterThan(1700000000000);

    expect(rows[1].student_id).toBe('stu_002');
    expect(rows[1].notification_id).toBe('notif_assignment_1');
    expect(typeof rows[1].created_at).toBe('number');
    expect(rows[1].created_at).toBeGreaterThan(1700000000000);

    // 新增记录测试：不传 created_at 时由 SQLite 原生默认值自动填充
    insertStmt.run('stu_003', 'notif_new');
    const newRow = db.prepare('SELECT * FROM student_read_notifications WHERE student_id = ?').get('stu_003') as {
      student_id: string;
      notification_id: string;
      created_at: number;
    };
    expect(newRow).toBeDefined();
    expect(newRow.created_at).toBeGreaterThan(1700000000000);

    // 主键联合去重约束依然生效
    expect(() => insertStmt.run('stu_003', 'notif_new')).toThrow(/UNIQUE constraint failed/);

    // 幂等：再次执行迁移为空操作
    expect(runMigrations(db, all)).toEqual([]);
  });

  it('回滚（DOWN）测试：执行 DOWN 脚本能够安全移除 created_at 列', () => {
    const all = loadMigrationsFromDirectory(migrationsDir);
    const m036 = all.find((m) => migrationNumber(m.name) === 36);
    expect(m036).toBeTruthy();

    const db = openMemory();
    runMigrations(db, all.filter((m) => migrationNumber(m.name) <= 36));

    // 执行 DOWN 回滚
    const downStatements = splitSqlStatements(m036!.down);
    for (const stmt of downStatements) {
      db.exec(stmt);
    }

    const colsReverted = db.prepare("PRAGMA table_info('student_read_notifications')").all() as Array<{ name: string }>;
    expect(colsReverted.map((c) => c.name)).toEqual(['student_id', 'notification_id']);
  });
});
