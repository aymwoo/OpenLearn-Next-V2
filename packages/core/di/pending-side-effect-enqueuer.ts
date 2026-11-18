/**
 * pending_side_effects 的 DB 入队器（设计 Q4）。
 * 实现 CreditAwardService 的 SideEffectEnqueuer 端口：主写入成功但事件发布
 * 失败时，把副作用快照落表，待 SideEffectWorker/管理端重试。
 *
 * 幂等：uq(source, op, biz_key) 唯一索引，重复入队用 INSERT OR IGNORE 吞掉。
 */
import type { Database } from 'better-sqlite3';
import { v7 as uuidv7 } from 'uuid';
import type { SideEffectEnqueuer } from './credit-award-service.js';

export class DbSideEffectEnqueuer implements SideEffectEnqueuer {
  constructor(private db: Database) {}

  enqueue(effect: {
    op: 'emitEvent';
    bizKey: string;
    payload: unknown;
    correlationId: string;
    originActorId?: string | null;
  }): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO pending_side_effects (
           id, source, op, biz_key, payload, status, attempts, max_attempts,
           next_retry_at, origin_actor_id, correlation_id, created_at, updated_at
         ) VALUES (?, 'credit_award', ?, ?, ?, 'pending', 0, 5, ?, ?, ?, ?, ?)`,
      )
      .run(
        `se_${uuidv7()}`,
        effect.op,
        effect.bizKey,
        JSON.stringify(effect.payload),
        now + 1000, // 退避起点 1s
        effect.originActorId ?? null,
        effect.correlationId,
        now,
        now,
      );
  }
}
