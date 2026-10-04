/**
 * 迁移执行器的数据安全测试（2026-10-04）
 *
 * 覆盖两处修复：
 * 1. `checksum` 此前只写不读 —— 已执行迁移被事后篡改无法察觉
 * 2. UP 脚本此前不在事务内 —— 中途失败留下半应用状态，重启后重跑已执行语句
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, rollbackMigration, simpleChecksum, type Migration } from '../utils/migrate.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE widgets (id TEXT PRIMARY KEY, name TEXT);`);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.MIGRATION_CHECKSUM_STRICT;
});

const mig = (name: string, up: string, down?: string): Migration => ({ name, up, down });

describe('迁移 · checksum 校验', () => {
  it('未篡改时无漂移', () => {
    const m = mig('001_add', 'CREATE TABLE a (id TEXT);', 'DROP TABLE a;');
    runMigrations(db, [m]);
    expect(runMigrations(db, [m])).toEqual([]);
  });

  it('已执行迁移的 UP 被事后修改时检出漂移', () => {
    const original = mig('001_add', 'CREATE TABLE a (id TEXT);', 'DROP TABLE a;');
    runMigrations(db, [original]);

    // 同一名字，内容被改了
    const tampered = mig('001_add', 'CREATE TABLE a (id TEXT); DROP TABLE a;', 'DROP TABLE a;');
    const drift = runMigrations(db, [tampered]);

    expect(drift).toHaveLength(1);
    expect(drift[0]!.name).toBe('001_add');
    expect(drift[0]!.stored).not.toBe(drift[0]!.actual);
  });

  it('MIGRATION_CHECKSUM_STRICT=true 时漂移直接抛错', () => {
    runMigrations(db, [mig('001_add', 'CREATE TABLE a (id TEXT);')]);
    process.env.MIGRATION_CHECKSUM_STRICT = 'true';
    const tampered = mig('001_add', 'CREATE TABLE a (id TEXT); DROP TABLE a;');
    expect(() => runMigrations(db, [tampered])).toThrow(/被修改过/);
  });

  it('迁移文件已从磁盘移除时不误报', () => {
    runMigrations(db, [mig('001_add', 'CREATE TABLE a (id TEXT);')]);
    // 磁盘上已没有该迁移
    expect(runMigrations(db, [])).toEqual([]);
  });

  it('校验失败不影响后续新迁移的正常应用', () => {
    runMigrations(db, [mig('001_add', 'CREATE TABLE a (id TEXT);')]);
    // 001 被篡改 + 一条全新的 002
    const tampered = mig('001_add', 'CREATE TABLE a (id TEXT); -- 改过');
    const fresh = mig('002_fresh', 'CREATE TABLE b (id TEXT);');
    runMigrations(db, [tampered, fresh]); // 漂移但不抛（非 strict）
    // 002 仍应被正常应用
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name='b'`).get()).toBeTruthy();
  });
});

describe('迁移 · 逐条事务', () => {
  it('UP 中途失败时不留下半应用状态', () => {
    const broken = mig(
      '001_partial',
      'CREATE TABLE good_table (id TEXT);\nTHIS IS NOT VALID SQL;',
    );
    expect(() => runMigrations(db, [broken])).toThrow();

    // 第一条语句应当已被回滚
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name='good_table'`).get()).toBeFalsy();
  });

  it('失败后不写入 _migrations 记录', () => {
    const broken = mig('001_partial', 'CREATE TABLE a (id TEXT);\nTHIS IS NOT SQL;');
    expect(() => runMigrations(db, [broken])).toThrow();
    const rows = db.prepare('SELECT name FROM _migrations').all() as { name: string }[];
    expect(rows).toHaveLength(0);
  });

  it('失败修复后重跑可正常完成（不会残留半应用状态）', () => {
    const broken = mig('001_x', 'CREATE TABLE a (id TEXT);\nBROKEN SQL;');
    expect(() => runMigrations(db, [broken])).toThrow();
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name='a'`).get()).toBeFalsy();

    runMigrations(db, [mig('001_x', 'CREATE TABLE a (id TEXT);')]);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name='a'`).get()).toBeTruthy();
  });

  it('成功应用后写入 _migrations 并记录 checksum', () => {
    const m = mig('001_ok', 'CREATE TABLE a (id TEXT);');
    runMigrations(db, [m]);
    const row = db.prepare('SELECT name, checksum FROM _migrations').get() as {
      name: string;
      checksum: string;
    };
    expect(row.name).toBe('001_ok');
    expect(row.checksum).toBe(simpleChecksum(m.up));
  });
});

describe('迁移 · 回滚', () => {
  it('缺 DOWN 段时明确报错（而非静默跳过）', () => {
    expect(() => rollbackMigration(db, mig('001_x', 'CREATE TABLE a (id TEXT);'))).toThrow(
      /does not provide a DOWN/,
    );
  });

  it('有 DOWN 段时可回滚', () => {
    const m = mig('001_x', 'CREATE TABLE a (id TEXT);', 'DROP TABLE IF EXISTS a;');
    runMigrations(db, [m]);
    rollbackMigration(db, m);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name='a'`).get()).toBeFalsy();
  });
});

describe('迁移 · 全部迁移文件都有 DOWN 段', () => {
  it('migrations/ 下每个 .sql 都包含 -- DOWN 标记', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.resolve(process.cwd(), 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    const missing = files.filter((f) => !/^\s*--\s*DOWN\s*$/m.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    expect(missing).toEqual([]);
  });
});
