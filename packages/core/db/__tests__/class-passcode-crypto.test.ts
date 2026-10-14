import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  classPasscodeMatches,
  encryptStoredClassPasscodes,
  isEncryptedClassPasscode,
  openClassPasscode,
  redactPasscodeMaterial,
  sealClassPasscode,
} from '../class-passcode-crypto.js';
import { parseMigrationSql, runMigrations } from '../migrator.js';
import { sanitizeValue } from '../../observability/sanitize.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

function memoryDb() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE classes (id TEXT PRIMARY KEY, name TEXT, class_passcode TEXT)');
  return db;
}

describe('班级临时口令加密', () => {
  it('密封后可还原，库里的值不是原文，也不会被再包一层', () => {
    const sealed = sealClassPasscode('6688');
    expect(sealed).toBeTruthy();
    expect(sealed).not.toBe('6688');
    expect(isEncryptedClassPasscode(sealed)).toBe(true);
    expect(openClassPasscode(sealed)).toBe('6688');
    expect(sealClassPasscode(sealed)).toBe(sealed);
    expect(sealClassPasscode(null)).toBeNull();
    expect(sealClassPasscode('')).toBeNull();
  });

  it('校验解密后做常量时间比较，兼容迁移前的明文', () => {
    const sealed = sealClassPasscode('8899');
    expect(classPasscodeMatches(sealed, '8899')).toBe(true);
    expect(classPasscodeMatches(sealed, '8898')).toBe(false);
    expect(classPasscodeMatches(sealed, '')).toBe(false);
    expect(classPasscodeMatches(' 1234 ', '1234')).toBe(true);
    expect(classPasscodeMatches(null, '1234')).toBe(false);
    expect(classPasscodeMatches('olenc1:' + 'ab'.repeat(16) + ':' + 'cd'.repeat(16) + ':ffff', 'ffff')).toBe(false);
  });

  it('迁移只加密明文，重复执行不改已有密文', () => {
    const db = memoryDb();
    const already = sealClassPasscode('1111');
    db.prepare('INSERT INTO classes (id, name, class_passcode) VALUES (?, ?, ?)').run('plain', '一班', '8899');
    db.prepare('INSERT INTO classes (id, name, class_passcode) VALUES (?, ?, ?)').run('sealed', '二班', already);
    db.prepare('INSERT INTO classes (id, name, class_passcode) VALUES (?, ?, ?)').run('empty', '三班', null);

    const first = encryptStoredClassPasscodes(db);
    expect(first.updated).toBe(1);
    expect(first.skipped).toBe(1);

    const plain = db.prepare('SELECT class_passcode FROM classes WHERE id = ?').get('plain') as {
      class_passcode: string;
    };
    const sealed = db.prepare('SELECT class_passcode FROM classes WHERE id = ?').get('sealed') as {
      class_passcode: string;
    };
    const empty = db.prepare('SELECT class_passcode FROM classes WHERE id = ?').get('empty') as {
      class_passcode: string | null;
    };
    expect(isEncryptedClassPasscode(plain.class_passcode)).toBe(true);
    expect(openClassPasscode(plain.class_passcode)).toBe('8899');
    expect(plain.class_passcode).not.toBe('8899');
    expect(sealed.class_passcode).toBe(already);
    expect(empty.class_passcode).toBeNull();

    const snapshot = plain.class_passcode;
    const second = encryptStoredClassPasscodes(db);
    expect(second.updated).toBe(0);
    expect(second.skipped).toBe(2);
    const again = db.prepare('SELECT class_passcode FROM classes WHERE id = ?').get('plain') as {
      class_passcode: string;
    };
    expect(again.class_passcode).toBe(snapshot);
    db.close();
  });

  it('023 迁移脚本可重复应用，本身不把口令写成明文', () => {
    const db = new Database(':memory:');
    const sql = fs.readFileSync(path.resolve(process.cwd(), 'migrations/023_encrypt_class_passcodes.sql'), 'utf8');
    const migration = parseMigrationSql('023_encrypt_class_passcodes', sql);
    expect(migration.up).not.toMatch(/UPDATE\s+classes/i);
    expect(migration.up).not.toMatch(/SET\s+class_passcode/i);
    expect(runMigrations(db, [migration])).toEqual([]);
    expect(runMigrations(db, [migration])).toEqual([]);
    const note = db.prepare('SELECT note FROM _class_passcode_encryption WHERE id = 1').get() as { note: string };
    expect(note.note).toContain('olenc1:');
    db.close();
  });

  it('审计载荷和自由文本里的口令、密文会被抹掉', () => {
    const sealed = sealClassPasscode('9988') as string;
    const redacted = redactPasscodeMaterial({
      class_passcode: '9988',
      nested: { classPasscode: sealed, note: `token ${sealed}` },
    }) as { class_passcode: string; nested: { classPasscode: string; note: string } };
    expect(redacted.class_passcode).toBe('***REDACTED***');
    expect(redacted.nested.classPasscode).toBe('***REDACTED***');
    expect(redacted.nested.note).not.toContain('olenc1:');
    expect(redacted.nested.note).not.toContain(sealed);

    const scrubbed = String(sanitizeValue(`passcode leaked ${sealed}`));
    expect(scrubbed).not.toContain(sealed);
    expect(scrubbed).not.toContain('9988');
  });
});
