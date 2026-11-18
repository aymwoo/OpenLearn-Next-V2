/**
 * 消费 pending_side_effects：主写入已经成功、事件发布失败的补偿重试。
 * 由 server 启动时按间隔调用 tick()。单测直接调 tick()，不挂定时器。
 */
import type { Database } from 'better-sqlite3';
import type { PlatformEvent } from '../event-bus/index.js';

export interface SideEffectPublisher {
  publish(event: PlatformEvent): Promise<void>;
}

interface SideEffectRow {
  id: string;
  op: string;
  payload: string;
  attempts: number;
  max_attempts: number;
}

export class SideEffectWorker {
  constructor(
    private db: Database,
    private publisher: SideEffectPublisher,
  ) {}

  /** 处理到期的 pending 行。返回本次成功重投的条数。 */
  async tick(now = Date.now()): Promise<number> {
    const rows = this.db
      .prepare(
        `SELECT id, op, payload, attempts, max_attempts
           FROM pending_side_effects
          WHERE status = 'pending' AND next_retry_at <= ?
          ORDER BY next_retry_at ASC
          LIMIT 20`,
      )
      .all(now) as SideEffectRow[];

    let resolved = 0;
    for (const row of rows) {
      try {
        if (row.op !== 'emitEvent') throw new Error(`unsupported side effect op: ${row.op}`);
        const event = JSON.parse(row.payload) as PlatformEvent;
        await this.publisher.publish(event);
        this.db
          .prepare(
            `UPDATE pending_side_effects
                SET status = 'resolved', resolved_at = ?, updated_at = ?, last_error = NULL
              WHERE id = ?`,
          )
          .run(now, now, row.id);
        resolved += 1;
      } catch (err) {
        const attempts = row.attempts + 1;
        const dead = attempts >= row.max_attempts;
        const backoffMs = Math.min(60_000, 1000 * 2 ** attempts);
        this.db
          .prepare(
            `UPDATE pending_side_effects
                SET status = ?, attempts = ?, next_retry_at = ?, last_error = ?, updated_at = ?
              WHERE id = ?`,
          )
          .run(
            dead ? 'dead' : 'pending',
            attempts,
            now + backoffMs,
            err instanceof Error ? err.message : String(err),
            now,
            row.id,
          );
      }
    }
    return resolved;
  }
}

/** 在进程内周期重试。返回停止函数。测试不要调用本函数。 */
export function startSideEffectWorker(db: Database, publisher: SideEffectPublisher, intervalMs = 5000): () => void {
  const worker = new SideEffectWorker(db, publisher);
  const timer = setInterval(() => {
    void worker.tick().catch(() => {});
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
