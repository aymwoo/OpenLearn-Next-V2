import { describe, it, expect, vi } from 'vitest';
import betterSqlite3 from 'better-sqlite3';
import { SideEffectWorker } from '../side-effect-worker.js';

describe('SideEffectWorker', () => {
  it('重投到期的 emitEvent，成功后标为 resolved', async () => {
    const db = betterSqlite3(':memory:');
    db.exec(`
      CREATE TABLE pending_side_effects (
        id TEXT PRIMARY KEY, source TEXT NOT NULL, op TEXT NOT NULL, biz_key TEXT NOT NULL,
        payload TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL, next_retry_at INTEGER NOT NULL, last_error TEXT,
        origin_actor_id TEXT, correlation_id TEXT, created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL, resolved_at INTEGER
      );
    `);
    const event = {
      id: 'm1',
      type: 'classroom.message',
      source: 'test',
      payload: { messageId: 'm1' },
      timestamp: 1,
    };
    db.prepare(
      `INSERT INTO pending_side_effects (
         id, source, op, biz_key, payload, status, attempts, max_attempts, next_retry_at,
         correlation_id, created_at, updated_at
       ) VALUES ('se1', 'classroom.message', 'emitEvent', 'k', ?, 'pending', 0, 5, 0, 'm1', 0, 0)`,
    ).run(JSON.stringify(event));

    const publish = vi.fn(async () => {});
    const n = await new SideEffectWorker(db, { publish }).tick(10);
    expect(n).toBe(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'classroom.message' }));
    const row = db.prepare('SELECT status FROM pending_side_effects WHERE id = ?').get('se1') as { status: string };
    expect(row.status).toBe('resolved');
  });
});
