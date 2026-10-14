import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { assignClassOwners, listClasses } from '../backfill-class-owners.mjs';
import { backupSite } from '../site-backup.mjs';
import { restoreSite } from '../site-restore.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

function makeDb(file: string) {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT,
      role TEXT
    );
    CREATE TABLE classes (
      id TEXT PRIMARY KEY,
      name TEXT,
      owner_user_id TEXT,
      created_at INTEGER
    );
    CREATE TABLE lessons (id TEXT PRIMARY KEY, title TEXT);
  `);
  db.prepare('INSERT INTO users (id, username, role) VALUES (?, ?, ?)').run('usr_teacher', 'teacher', 'teacher');
  db.prepare('INSERT INTO classes (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)').run(
    'cls_orphan',
    '无归属班',
    null,
    1,
  );
  db.prepare('INSERT INTO classes (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)').run(
    'cls_owned',
    '已归属班',
    'usr_other',
    2,
  );
  db.prepare('INSERT INTO lessons (id, title) VALUES (?, ?)').run('les_1', '保留课');
  db.close();
}

describe('班级归属回填', () => {
  it('只回填空归属，已有归属的班级保持不变', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-backfill-'));
    const file = path.join(dir, 'educational_os.db');
    makeDb(file);
    const db = new Database(file);
    try {
      const result = assignClassOwners(db, 'teacher');
      expect(result.updated).toBe(1);
      expect(result.classIds).toEqual(['cls_orphan']);
      const rows = listClasses(db);
      expect(rows.find((row: { id: string }) => row.id === 'cls_orphan')?.owner_user_id).toBe('usr_teacher');
      expect(rows.find((row: { id: string }) => row.id === 'cls_owned')?.owner_user_id).toBe('usr_other');
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('站点备份与恢复', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('备份数据库和 storage，清空后可以恢复', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-site-'));
    dirs.push(root);
    const dataDir = path.join(root, 'data');
    const backupDir = path.join(root, 'backups');
    const restoreDir = path.join(root, 'restored');
    fs.mkdirSync(path.join(dataDir, 'storage', 'courseware'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'storage', 'courseware', 'note.txt'), '课件正文');
    const dbFile = path.join(dataDir, 'educational_os.db');
    makeDb(dbFile);

    const env = { OPENLEARN_DATA_DIR: dataDir, OPENLEARN_DB_PATH: dbFile, BACKUP_DIR: backupDir };
    const manifest = backupSite({ env, backupDir });
    expect(fs.existsSync(manifest.dbFile)).toBe(true);
    expect(fs.existsSync(manifest.filesArchive)).toBe(true);

    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(restoreDir, { recursive: true });
    const restoredDb = path.join(restoreDir, 'educational_os.db');
    const result = restoreSite({
      dbFile: manifest.dbFile,
      filesArchive: manifest.filesArchive,
      env: { OPENLEARN_DATA_DIR: restoreDir, OPENLEARN_DB_PATH: restoredDb },
    });
    expect(result.extracted).toBe(true);
    expect(fs.readFileSync(path.join(restoreDir, 'storage', 'courseware', 'note.txt'), 'utf8')).toBe('课件正文');
    const db = new Database(restoredDb, { readonly: true });
    try {
      const lesson = db.prepare('SELECT title FROM lessons WHERE id = ?').get('les_1') as { title: string };
      expect(lesson.title).toBe('保留课');
    } finally {
      db.close();
    }
  });

  it('备份库保留班级口令密文，且不把 encryption-key 打进文件包', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-site-'));
    dirs.push(root);
    const dataDir = path.join(root, 'data');
    const backupDir = path.join(root, 'backups');
    fs.mkdirSync(path.join(dataDir, 'storage', 'courseware'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'storage', 'courseware', 'note.txt'), '课件正文');
    const keyMaterial = 'offline-key-material-should-stay-out';
    fs.writeFileSync(path.join(dataDir, 'storage', 'encryption-key'), `${keyMaterial}\n`, { mode: 0o600 });
    const dbFile = path.join(dataDir, 'educational_os.db');
    makeDb(dbFile);
    const cipher = `olenc1:${'ab'.repeat(16)}:${'cd'.repeat(16)}:ef`;
    const db = new Database(dbFile);
    db.exec('ALTER TABLE classes ADD COLUMN class_passcode TEXT');
    db.prepare('UPDATE classes SET class_passcode = ? WHERE id = ?').run(cipher, 'cls_owned');
    db.close();

    const manifest = backupSite({
      env: { OPENLEARN_DATA_DIR: dataDir, OPENLEARN_DB_PATH: dbFile, BACKUP_DIR: backupDir },
      backupDir,
    });
    expect(manifest.encryptionKeyReminder).toContain('单独离线备份');
    expect(manifest.encryptionKeyExcluded).toBe('storage/encryption-key');
    expect(JSON.stringify(manifest)).not.toContain(keyMaterial);

    const listing = spawnSync('tar', ['tzf', manifest.filesArchive], { encoding: 'utf8' });
    expect(listing.status).toBe(0);
    expect(listing.stdout).toContain('storage/courseware/note.txt');
    expect(listing.stdout).not.toContain('encryption-key');

    const backed = new Database(manifest.dbFile, { readonly: true });
    try {
      const row = backed.prepare('SELECT class_passcode FROM classes WHERE id = ?').get('cls_owned') as {
        class_passcode: string;
      };
      expect(row.class_passcode).toBe(cipher);
      expect(row.class_passcode).not.toContain('8899');
    } finally {
      backed.close();
    }
  });
});
