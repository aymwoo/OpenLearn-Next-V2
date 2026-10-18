/**
 * `restore` 安全还原（Issue #150）。
 *
 * 关注点不是「能复制文件」，而是：
 * 1. 坏快照必须在动主库之前被拒绝；
 * 2. 快照来自更新版本（含当前代码不认识的迁移）默认拒绝，`force` 才放行；
 * 3. 恢复前用 VACUUM INTO 留下安全副本；
 * 4. 成功恢复后主库内容切换、WAL/SHM 被清理。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runRestore } from '../../cli-data.mjs';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeMigrationsDir(dir: string, names: string[]): string {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of names) fs.writeFileSync(path.join(dir, name), '-- noop\n');
  return dir;
}

function createDb(file: string, migrations: string[], marker?: string): void {
  const db = new Database(file);
  try {
    db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER, checksum TEXT);');
    const insert = db.prepare('INSERT OR REPLACE INTO _migrations (name, applied_at, checksum) VALUES (?, ?, ?)');
    for (const name of migrations) insert.run(name, Date.now(), 'sum');
    if (marker) {
      db.exec('CREATE TABLE marker (value TEXT);');
      db.prepare('INSERT INTO marker (value) VALUES (?)').run(marker);
    }
  } finally {
    db.close();
  }
}

function readMarker(file: string): string | undefined {
  const db = new Database(file, { readonly: true });
  try {
    return (db.prepare('SELECT value FROM marker').get() as { value: string } | undefined)?.value;
  } finally {
    db.close();
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe('restore · 安全还原', () => {
  it('恢复合法快照：切换主库内容、清理 WAL/SHM、留下安全副本', async () => {
    const work = makeTempDir('ol-restore-ok-');
    const migrationsDir = writeMigrationsDir(path.join(work, 'migrations'), ['001_a.sql']);
    const dbPath = path.join(work, 'data', 'educational_os.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    createDb(dbPath, ['001_a'], 'current');
    // 模拟崩溃残留的 WAL/SHM
    fs.writeFileSync(`${dbPath}-wal`, 'stale');
    fs.writeFileSync(`${dbPath}-shm`, 'stale');

    const snapshot = path.join(work, 'pre_migration_001.db');
    createDb(snapshot, ['001_a'], 'snapshot');

    const result = await runRestore(snapshot, {
      dbPath,
      migrationsDir,
      backupsDir: path.join(work, 'backups'),
      silent: true,
    });

    expect(result.ok, result.error).toBe(true);
    expect(readMarker(dbPath)).toBe('snapshot');
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(false);
    expect(fs.existsSync(`${dbPath}-shm`)).toBe(false);
    expect(result.safetyBackup && fs.existsSync(result.safetyBackup)).toBe(true);
    expect(readMarker(result.safetyBackup as string)).toBe('current');
  });

  it('拒绝非 SQLite 快照，且主库保持原样', async () => {
    const work = makeTempDir('ol-restore-bad-');
    const migrationsDir = writeMigrationsDir(path.join(work, 'migrations'), ['001_a.sql']);
    const dbPath = path.join(work, 'educational_os.db');
    createDb(dbPath, ['001_a'], 'current');

    const bad = path.join(work, 'not-a-db.db');
    fs.writeFileSync(bad, 'this is not sqlite');

    const result = await runRestore(bad, { dbPath, migrationsDir, silent: true });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/SQLite|备份/);
    expect(readMarker(dbPath)).toBe('current');
  });

  it('快照含当前代码不认识的迁移时默认拒绝，force 才放行', async () => {
    const work = makeTempDir('ol-restore-unknown-');
    const migrationsDir = writeMigrationsDir(path.join(work, 'migrations'), ['001_a.sql']);
    const dbPath = path.join(work, 'educational_os.db');
    createDb(dbPath, ['001_a'], 'current');

    const snapshot = path.join(work, 'future.db');
    createDb(snapshot, ['001_a', '999_from_future'], 'future');

    const refused = await runRestore(snapshot, { dbPath, migrationsDir, silent: true });
    expect(refused.ok).toBe(false);
    expect(refused.unknownMigrations).toEqual(['999_from_future']);
    expect(readMarker(dbPath)).toBe('current');

    const forced = await runRestore(snapshot, { dbPath, migrationsDir, silent: true, force: true });
    expect(forced.ok, forced.error).toBe(true);
    expect(readMarker(dbPath)).toBe('future');
  });

  it('快照缺少当前迁移时允许恢复，并报告待补齐条数', async () => {
    const work = makeTempDir('ol-restore-pending-');
    const migrationsDir = writeMigrationsDir(path.join(work, 'migrations'), ['001_a.sql', '002_b.sql']);
    const dbPath = path.join(work, 'educational_os.db');
    createDb(dbPath, ['001_a', '002_b'], 'current');

    const snapshot = path.join(work, 'older.db');
    createDb(snapshot, ['001_a'], 'older');

    const result = await runRestore(snapshot, { dbPath, migrationsDir, silent: true });

    expect(result.ok, result.error).toBe(true);
    expect(result.pendingMigrations).toBe(1);
    expect(readMarker(dbPath)).toBe('older');
  });
});
