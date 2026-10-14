/**
 * 从 v0.6.1（迁移 000–020）升到当前迁移目录。
 * 021 只加空的 owner_user_id，022 建空的公开路由表，023 只留密文标记。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { encryptStoredClassPasscodes, isEncryptedClassPasscode, openClassPasscode } from '../class-passcode-crypto.js';
import { loadMigrationsFromDirectory, runMigrations, type Migration } from '../migrator.js';

const migrationsDir = path.resolve(process.cwd(), 'migrations');

function migrationNumber(name: string): number {
  const match = /^(\d+)_/.exec(name);
  if (!match) throw new Error(`unexpected migration name ${name}`);
  return Number.parseInt(match[1], 10);
}

function appliedNames(db: Database.Database): string[] {
  return (db.prepare('SELECT name FROM _migrations ORDER BY name').all() as { name: string }[]).map((row) => row.name);
}

describe('从 v0.6.1 升级', () => {
  const dbs: Database.Database[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    while (dbs.length > 0) {
      dbs.pop()?.close();
    }
  });

  function openMemory(): Database.Database {
    const db = new Database(':memory:');
    dbs.push(db);
    return db;
  }

  it('只含 000–020 的库跑当前迁移后含 021–023，再跑一次是空操作', () => {
    const all = loadMigrationsFromDirectory(migrationsDir);
    const legacy = all.filter((migration) => migrationNumber(migration.name) <= 20);
    const newer = all.filter((migration) => {
      const number = migrationNumber(migration.name);
      return number >= 21 && number <= 23;
    });

    expect(legacy).toHaveLength(21);
    expect(newer.map((migration) => migration.name)).toEqual([
      '021_class_owner_and_password_gate',
      '022_plugin_public_routes',
      '023_encrypt_class_passcodes',
    ]);
    expect(legacy.some((migration) => migrationNumber(migration.name) >= 21)).toBe(false);

    const db = openMemory();
    runMigrations(db, legacy);
    expect(appliedNames(db).some((name) => migrationNumber(name) >= 21)).toBe(false);

    db.prepare('INSERT INTO classes (id, name, class_passcode, created_at) VALUES (?, ?, ?, ?)').run(
      'c1',
      '一班',
      '8899',
      1,
    );

    expect(runMigrations(db, all)).toEqual([]);
    const names = appliedNames(db);
    expect(names).toEqual(expect.arrayContaining(newer.map((migration) => migration.name)));

    const columns = db.prepare('PRAGMA table_info(classes)').all() as { name: string }[];
    expect(columns.map((column) => column.name)).toContain('owner_user_id');
    const owner = db.prepare('SELECT owner_user_id FROM classes WHERE id = ?').get('c1') as {
      owner_user_id: string | null;
    };
    expect(owner.owner_user_id).toBeNull();

    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plugin_public_routes'").get(),
    ).toBeTruthy();
    expect((db.prepare('SELECT COUNT(*) AS n FROM plugin_public_routes').get() as { n: number }).n).toBe(0);

    const before = db.prepare('SELECT name, checksum, applied_at FROM _migrations ORDER BY name').all();
    expect(runMigrations(db, all)).toEqual([]);
    expect(db.prepare('SELECT name, checksum, applied_at FROM _migrations ORDER BY name').all()).toEqual(before);
  });

  it('明文班级口令加密一次后变成 olenc1:，再跑一次不改写', () => {
    const all = loadMigrationsFromDirectory(migrationsDir);
    const legacy = all.filter((migration) => migrationNumber(migration.name) <= 20);
    const db = openMemory();
    runMigrations(db, legacy);
    db.prepare('INSERT INTO classes (id, name, class_passcode, created_at) VALUES (?, ?, ?, ?)').run(
      'c1',
      '一班',
      '8899',
      1,
    );
    runMigrations(db, all);

    const first = encryptStoredClassPasscodes(db);
    expect(first.updated).toBe(1);
    const stored = (
      db.prepare('SELECT class_passcode FROM classes WHERE id = ?').get('c1') as { class_passcode: string }
    ).class_passcode;
    expect(stored.startsWith('olenc1:')).toBe(true);
    expect(stored).not.toBe('8899');
    expect(isEncryptedClassPasscode(stored)).toBe(true);
    expect(openClassPasscode(stored)).toBe('8899');

    const second = encryptStoredClassPasscodes(db);
    expect(second).toEqual({ updated: 0, skipped: 1 });
    const again = (
      db.prepare('SELECT class_passcode FROM classes WHERE id = ?').get('c1') as { class_passcode: string }
    ).class_passcode;
    expect(again).toBe(stored);
  });

  it('非 Vitest 进程里迁移前快照失败则中止且不执行 SQL', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-mig-abort-'));
    const diskDb = new Database(path.join(tempDir, 'active.db'));
    dbs.push(diskDb);
    diskDb.exec('CREATE TABLE dummy (id TEXT PRIMARY KEY);');
    const blocker = path.join(tempDir, 'not-a-directory');
    fs.writeFileSync(blocker, 'x');

    const previousVitest = process.env.VITEST;
    const previousBackup = process.env.BACKUP_DIR;
    const previousForce = process.env.FORCE_MIGRATION_SNAPSHOT;
    delete process.env.VITEST;
    delete process.env.FORCE_MIGRATION_SNAPSHOT;
    process.env.BACKUP_DIR = blocker;
    const pending: Migration = {
      name: '099_should_not_apply',
      up: 'CREATE TABLE snap_blocked (id TEXT);',
      down: '',
    };
    try {
      expect(() => runMigrations(diskDb, [pending])).toThrow(/迁移前快照失败/);
      expect(diskDb.prepare("SELECT name FROM sqlite_master WHERE name = 'snap_blocked'").get()).toBeFalsy();
      const meta = diskDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_migrations'").get();
      if (meta) {
        expect(diskDb.prepare('SELECT name FROM _migrations').all()).toEqual([]);
      }
    } finally {
      diskDb.close();
      const openIndex = dbs.indexOf(diskDb);
      if (openIndex >= 0) dbs.splice(openIndex, 1);
      if (previousVitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = previousVitest;
      if (previousBackup === undefined) delete process.env.BACKUP_DIR;
      else process.env.BACKUP_DIR = previousBackup;
      if (previousForce === undefined) delete process.env.FORCE_MIGRATION_SNAPSHOT;
      else process.env.FORCE_MIGRATION_SNAPSHOT = previousForce;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('Vitest 下快照失败只警告，待执行 SQL 仍会应用', () => {
    expect(process.env.VITEST).toBeTruthy();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-mig-warn-'));
    const diskDb = new Database(path.join(tempDir, 'active.db'));
    dbs.push(diskDb);
    const blocker = path.join(tempDir, 'not-a-directory');
    fs.writeFileSync(blocker, 'x');

    const previousBackup = process.env.BACKUP_DIR;
    const previousForce = process.env.FORCE_MIGRATION_SNAPSHOT;
    process.env.BACKUP_DIR = blocker;
    process.env.FORCE_MIGRATION_SNAPSHOT = 'true';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      runMigrations(diskDb, [{ name: '099_still_applies', up: 'CREATE TABLE snap_warned (id TEXT);', down: '' }]);
      expect(diskDb.prepare("SELECT name FROM sqlite_master WHERE name = 'snap_warned'").get()).toBeTruthy();
      expect(warn.mock.calls.some((call) => String(call[0]).includes('Could not create pre-migration snapshot'))).toBe(
        true,
      );
    } finally {
      diskDb.close();
      const openIndex = dbs.indexOf(diskDb);
      if (openIndex >= 0) dbs.splice(openIndex, 1);
      if (previousBackup === undefined) delete process.env.BACKUP_DIR;
      else process.env.BACKUP_DIR = previousBackup;
      if (previousForce === undefined) delete process.env.FORCE_MIGRATION_SNAPSHOT;
      else process.env.FORCE_MIGRATION_SNAPSHOT = previousForce;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
