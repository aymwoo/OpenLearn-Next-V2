import { describe, it, expect } from 'vitest';
import {
  db,
  readPool,
  getReadDb,
  queryRead,
  queryReadOne,
  checkpoint,
  batchExecute,
  createDatabase,
} from '../index.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

describe('Database WAL & Connection Pool (P1-1)', () => {
  it('applies high-concurrency PRAGMAs to primary database instance', () => {
    const journalMode = db.pragma('journal_mode', { simple: true });
    expect(journalMode).toBe('wal');

    const busyTimeout = db.pragma('busy_timeout', { simple: true });
    expect(busyTimeout).toBe(5000);

    const foreignKeys = db.pragma('foreign_keys', { simple: true });
    expect(foreignKeys).toBe(1);

    const cacheSize = db.pragma('cache_size', { simple: true });
    expect(cacheSize).toBe(-64000);

    // SQLite temp_store: 0 = DEFAULT, 1 = FILE, 2 = MEMORY
    const tempStore = db.pragma('temp_store', { simple: true });
    expect(tempStore).toBe(2);
  });

  it('provides a functional readonly connection pool', () => {
    const readDb = getReadDb();
    expect(readDb).toBeDefined();

    // Verify readonly mode prevents writes
    expect(() => {
      readDb.prepare("INSERT INTO events (id, type, source, payload, timestamp) VALUES ('fake', 'test', 'test', '{}', 1)").run();
    }).toThrow(/readonly|attempt to write a readonly database/i);

    // Verify readonly query works
    const count = readDb.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
    expect(count.cnt).toBeGreaterThanOrEqual(1);

    // Verify pool capacity and reuse
    const conn1 = getReadDb();
    const conn2 = getReadDb();
    expect(conn1).toBeDefined();
    expect(conn2).toBeDefined();
    expect(readPool.capacity).toBeGreaterThanOrEqual(2);
  });

  it('supports queryRead and queryReadOne utility functions', () => {
    const users = queryRead<{ username: string }>('SELECT username FROM users ORDER BY created_at ASC');
    expect(Array.isArray(users)).toBe(true);
    expect(users.length).toBeGreaterThan(0);

    const admin = queryReadOne<{ username: string }>('SELECT username FROM users WHERE username = ?', 'admin');
    expect(admin).toBeDefined();
    expect(admin?.username).toBe('admin');

    const nonExistent = queryReadOne('SELECT username FROM users WHERE username = ?', 'does_not_exist_xyz');
    expect(nonExistent).toBeUndefined();
  });

  it('allows non-blocking concurrent reads while a write transaction is open (WAL concurrency)', () => {
    const testId = `evt_concurrency_${Date.now()}`;

    // 在主写连接上开启事务，写入记录但先不提交
    const tx = db.transaction(() => {
      db.prepare(
        'INSERT INTO events (id, type, source, payload, timestamp) VALUES (?, ?, ?, ?, ?)',
      ).run(testId, 'test.concurrency', 'test', '{}', Date.now());

      // 在写事务内部，使用只读池并发查询：由于事务未提交，只读连接不应该被锁死（不会抛出 SQLITE_BUSY）
      const readResult = queryReadOne('SELECT id FROM events WHERE id = ?', testId);
      // WAL 隔离级别下，未提交的数据对外部只读连接不可见或不影响读
      expect(readResult === undefined || readResult.id === testId).toBe(true);
    });

    expect(() => tx()).not.toThrow();

    // 事务完成后立即对只读池可见
    const committedRow = queryReadOne('SELECT id FROM events WHERE id = ?', testId);
    expect(committedRow).toBeDefined();

    // 清理测试数据
    db.prepare('DELETE FROM events WHERE id = ?').run(testId);
  });

  it('executes WAL checkpoint without errors', () => {
    const res = checkpoint('PASSIVE');
    expect(res).toBeDefined();
    expect(typeof res.busy).toBe('number');
    expect(typeof res.log).toBe('number');
    expect(typeof res.checkpointed).toBe('number');
    expect(res.busy).toBe(0);
  });

  it('slices large operations using batchExecute with micro-batching', async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const processedBatches: number[][] = [];

    const results = await batchExecute(
      items,
      3, // batchSize = 3
      (batch) => {
        processedBatches.push(batch);
        return batch.length;
      },
      1, // 1ms delay
    );

    expect(results).toEqual([3, 3, 3, 1]);
    expect(processedBatches.length).toBe(4);
    expect(processedBatches[0]).toEqual([1, 2, 3]);
    expect(processedBatches[3]).toEqual([10]);
  });

  it('createDatabase helper sets standard WAL pragmas on custom path', () => {
    const tempDbPath = path.join(os.tmpdir(), `test_custom_db_${Date.now()}.db`);
    try {
      const customDb = createDatabase(tempDbPath);
      expect(customDb.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(customDb.pragma('busy_timeout', { simple: true })).toBe(5000);
      expect(customDb.pragma('cache_size', { simple: true })).toBe(-64000);
      customDb.close();
    } finally {
      if (fs.existsSync(tempDbPath)) {
        try {
          fs.unlinkSync(tempDbPath);
        } catch {}
      }
    }
  });
});
