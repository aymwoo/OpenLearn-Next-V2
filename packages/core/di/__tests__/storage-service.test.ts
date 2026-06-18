/**
 * Unit tests for StorageService — kernel-level persistent key-value storage.
 *
 * Covers IStorageService CRUD operations:
 * - get() returns null for non-existent key
 * - set() + get() round-trip
 * - set() overwrites existing value
 * - delete() removes existing value
 * - delete() is a no-op for non-existent key
 *
 * Uses in-memory SQLite (:memory:) for test isolation — no external
 * database file dependency.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { StorageService } from '../storage-service.js';

describe('StorageService', () => {
  let db: Database.Database;
  let storage: StorageService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE IF NOT EXISTS plugin_storage (
      plugin_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (plugin_id, key)
    )`);
    storage = new StorageService(db);
  });

  afterEach(() => {
    db.close();
  });

  it('get 应在 key 不存在时返回 null', async () => {
    const result = await storage.get('nonexistent');
    expect(result).toBeNull();
  });

  it('set 后 get 应返回相同的值', async () => {
    await storage.set('key1', { hello: 'world' });
    const result = await storage.get('key1');
    expect(result).toEqual({ hello: 'world' });
  });

  it('set 应能覆盖已有 key', async () => {
    await storage.set('key1', 'old');
    await storage.set('key1', 'new');
    const result = await storage.get('key1');
    expect(result).toBe('new');
  });

  it('delete 后 get 应返回 null', async () => {
    await storage.set('key1', 'value');
    await storage.delete('key1');
    const result = await storage.get('key1');
    expect(result).toBeNull();
  });

  it('delete 不存在的 key 不应抛异常', async () => {
    await expect(storage.delete('nonexistent')).resolves.toBeUndefined();
  });
});
