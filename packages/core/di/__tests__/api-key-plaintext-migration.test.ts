import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { decryptApiKey, encryptStoredPlaintextApiKeys, looksLikeCiphertext } from '../api-key-crypto.js';
import { initializeDatabase } from '../../db/index.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-apikey-'));
  dirs.push(dir);
  return dir;
}

function memoryProviders() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE ai_providers (
    id TEXT PRIMARY KEY,
    api_key TEXT
  )`);
  return db;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('明文 AI Key 启动加密', () => {
  it('明文行变成三段十六进制并能还原，空字符串保持为空', () => {
    const db = memoryProviders();
    db.prepare('INSERT INTO ai_providers (id, api_key) VALUES (?, ?)').run('plain', 'sk-legacy-plaintext');
    db.prepare('INSERT INTO ai_providers (id, api_key) VALUES (?, ?)').run('empty', '');
    db.prepare('INSERT INTO ai_providers (id, api_key) VALUES (?, ?)').run('missing', null);

    const first = encryptStoredPlaintextApiKeys(db);
    expect(first.updated).toBe(1);
    expect(first.skipped).toBe(0);

    const plain = db.prepare('SELECT api_key FROM ai_providers WHERE id = ?').get('plain') as { api_key: string };
    const parts = plain.api_key.split(':');
    expect(parts).toHaveLength(3);
    expect(parts.every((part) => /^[0-9a-fA-F]+$/.test(part))).toBe(true);
    expect(looksLikeCiphertext(plain.api_key)).toBe(true);
    expect(plain.api_key).not.toBe('sk-legacy-plaintext');
    expect(decryptApiKey(plain.api_key)).toBe('sk-legacy-plaintext');

    const empty = db.prepare('SELECT api_key FROM ai_providers WHERE id = ?').get('empty') as { api_key: string };
    const missing = db.prepare('SELECT api_key FROM ai_providers WHERE id = ?').get('missing') as {
      api_key: string | null;
    };
    expect(empty.api_key).toBe('');
    expect(missing.api_key).toBeNull();
    expect(decryptApiKey('')).toBe('');
    db.close();
  });

  it('第二次执行不改写已有密文', () => {
    const db = memoryProviders();
    db.prepare('INSERT INTO ai_providers (id, api_key) VALUES (?, ?)').run('plain', 'sk-legacy-plaintext');
    encryptStoredPlaintextApiKeys(db);
    const snapshot = (db.prepare('SELECT api_key FROM ai_providers WHERE id = ?').get('plain') as { api_key: string })
      .api_key;

    const second = encryptStoredPlaintextApiKeys(db);
    expect(second.updated).toBe(0);
    expect(second.skipped).toBe(1);
    const again = db.prepare('SELECT api_key FROM ai_providers WHERE id = ?').get('plain') as { api_key: string };
    expect(again.api_key).toBe(snapshot);
    db.close();
  });

  it('迁移助手之后，非密文解密直接失败', () => {
    const db = memoryProviders();
    db.prepare('INSERT INTO ai_providers (id, api_key) VALUES (?, ?)').run('plain', 'sk-legacy-plaintext');
    encryptStoredPlaintextApiKeys(db);

    let caught: unknown;
    try {
      decryptApiKey('sk-still-plaintext');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const error = caught as Error & { status?: number };
    expect(error.message).toContain('not ciphertext');
    expect(error.status).toBe(500);
    expect(error.message).not.toContain('sk-still-plaintext');
    db.close();
  });

  it('没有 ai_providers 表时不报错', () => {
    const db = new Database(':memory:');
    expect(encryptStoredPlaintextApiKeys(db)).toEqual({ updated: 0, skipped: 0 });
    db.close();
  });

  it('initializeDatabase 在库就绪后加密明文，再次启动不改写', () => {
    const file = path.join(tempDir(), 'boot.db');
    const db = new Database(file);
    initializeDatabase(db);
    db.prepare(
      'INSERT INTO ai_providers (id, name, api_url, api_key, model_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('prov_legacy', 'Legacy', 'https://example.com/v1', 'sk-legacy-plaintext', 'm', 1, 1);
    db.prepare(
      'INSERT INTO ai_providers (id, name, api_url, api_key, model_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('prov_empty', 'Empty', 'https://example.com/v1', '', 'm', 1, 1);

    initializeDatabase(db);

    const plain = db.prepare('SELECT api_key FROM ai_providers WHERE id = ?').get('prov_legacy') as {
      api_key: string;
    };
    const empty = db.prepare('SELECT api_key FROM ai_providers WHERE id = ?').get('prov_empty') as {
      api_key: string;
    };
    expect(plain.api_key.split(':')).toHaveLength(3);
    expect(decryptApiKey(plain.api_key)).toBe('sk-legacy-plaintext');
    expect(empty.api_key).toBe('');

    const snapshot = plain.api_key;
    initializeDatabase(db);
    const again = db.prepare('SELECT api_key FROM ai_providers WHERE id = ?').get('prov_legacy') as {
      api_key: string;
    };
    expect(again.api_key).toBe(snapshot);
    db.close();
  });
});
