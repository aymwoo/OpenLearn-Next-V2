/**
 * 统一学分发放接口（设计 Q8=B / Q3=B 的产物）。
 *
 * 所有学分获取都走本服务的 award()：校验来源白名单 + 学生班级归属 +
 * 幂等键，事务内写积分流水 + 发放记录，事务成功后发 points.awarded 事件。
 *
 * - 来源白名单：防止任意调用方伪造来源刷分。内置来源固定集合，
 *   插件来源须形如 `plugin:<id>`（且 id 只能字母数字/点/短横）。
 * - 幂等：唯一 (student_id, idempotency_key)，重放返回原流水，不重复加分。
 * - 事件失败不回滚主写入：改为投递 pending_side_effects（由调用方注入 enqueue），
 *   对应 Q3=B 的"主成功即返回 + 补偿队列"。未注入 enqueue 时仅记日志。
 */
import type { Database } from 'better-sqlite3';
import { v7 as uuidv7 } from 'uuid';
import { PointsLedgerService } from './points-ledger-service.js';

/** 内置合法来源白名单。插件来源另走 `plugin:<id>` 规则。 */
export const BUILTIN_AWARD_SOURCES = Object.freeze([
  'attendance',
  'assignment',
  'quiz',
  'interaction',
  'courseware',
  'ai_practice',
  'manual',
  'system',
  'reward_refund',
] as const);

const PLUGIN_SOURCE_RE = /^plugin:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface AwardCreditInput {
  studentId: string;
  classId: string;
  dimensionId: string;
  /** 学分增量：正数发放、负数扣回；不可为 0 */
  deltaPoints: number;
  /** 来源标识（须在白名单或 plugin:<id>） */
  source: string;
  /** 业务幂等键（如 attendance:class-1:20261118） */
  idempotencyKey: string;
  reason: string;
  /** 操作者 actorId，仅审计 */
  actorId?: string | null;
}

export type AwardFailureCode = 'INVALID_INPUT' | 'INVALID_SOURCE' | 'STUDENT_NOT_ENROLLED' | 'DUPLICATE_AWARD';

export interface AwardResult {
  ok: boolean;
  code?: AwardFailureCode;
  message?: string;
  pointLogId?: string;
  awardId?: string;
  deltaPoints?: number;
  balanceAfter?: number;
  /** 命中幂等键、返回既有发放记录时为 true */
  idempotentHit?: boolean;
}

/** 事件总线投递端口（与内核 EventBus 的 publish 同形，便于注入/测试）。 */
export interface CreditEventPublisher {
  publish(event: { id: string; type: string; source: string; payload: unknown; timestamp: number }): Promise<void>;
}

/** 副作用入队端口：事件发布失败时投递补偿队列（pending_side_effects）。 */
export interface SideEffectEnqueuer {
  enqueue(effect: {
    source: string;
    op: 'emitEvent';
    bizKey: string;
    payload: unknown;
    correlationId: string;
  }): void | Promise<void>;
}

interface AwardRow {
  id: string;
  point_log_id: string;
  delta_points: number;
}

export class CreditAwardService {
  private db: Database;
  private ledger: PointsLedgerService;
  private eventPublisher?: CreditEventPublisher;
  private enqueuer?: SideEffectEnqueuer;

  constructor(
    db: Database,
    ledger: PointsLedgerService,
    deps?: { eventPublisher?: CreditEventPublisher; sideEffectEnqueuer?: SideEffectEnqueuer },
  ) {
    this.db = db;
    this.ledger = ledger;
    this.eventPublisher = deps?.eventPublisher;
    this.enqueuer = deps?.sideEffectEnqueuer;
  }

  /** 来源是否合法（白名单或 plugin:<id>） */
  static isValidSource(source: string): boolean {
    return (BUILTIN_AWARD_SOURCES as readonly string[]).includes(source) || PLUGIN_SOURCE_RE.test(source);
  }

  /**
   * 统一发放。同步执行主写入事务并立即返回（Q3=B：主成功即返回）；
   * 随后 fire-and-forget 发布事件，失败进补偿队列。事件投递结果不阻塞主流程。
   */
  award(input: AwardCreditInput): AwardResult {
    if (
      !input.studentId ||
      !input.classId ||
      !input.dimensionId ||
      !input.idempotencyKey ||
      !input.reason ||
      !Number.isFinite(input.deltaPoints) ||
      input.deltaPoints === 0
    ) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        message: 'studentId/classId/dimensionId/idempotencyKey/reason 必填，deltaPoints 必须为非零有限数',
      };
    }
    if (!CreditAwardService.isValidSource(input.source)) {
      return { ok: false, code: 'INVALID_SOURCE', message: `非法学分来源：${input.source}` };
    }

    // 学生班级归属校验
    const enrolled = this.db
      .prepare('SELECT 1 FROM class_students WHERE class_id = ? AND student_id = ? LIMIT 1')
      .get(input.classId, input.studentId);
    if (!enrolled) {
      return {
        ok: false,
        code: 'STUDENT_NOT_ENROLLED',
        message: '学生不在该班级，拒绝发放学分',
      };
    }

    const now = Date.now();
    const awardId = `aw_${uuidv7()}`;

    // 主写入事务：幂等 → 流水 → 发放记录
    const tx = this.db.transaction((): AwardResult => {
      const existing = this.db
        .prepare(
          `SELECT id, point_log_id, delta_points FROM credit_awards
            WHERE student_id = ? AND idempotency_key = ?`,
        )
        .get(input.studentId, input.idempotencyKey) as AwardRow | undefined;
      if (existing) {
        return {
          ok: true,
          idempotentHit: true,
          awardId: existing.id,
          pointLogId: existing.point_log_id,
          deltaPoints: existing.delta_points,
        };
      }

      const logItem = this.ledger.addPointsSync(
        input.studentId,
        input.classId,
        input.dimensionId,
        input.deltaPoints,
        input.reason,
        input.source.startsWith('plugin:') ? input.source.slice(7) : undefined,
      );

      this.db
        .prepare(
          `INSERT INTO credit_awards (
             id, student_id, class_id, dimension_id, delta_points, source,
             reason, idempotency_key, point_log_id, actor_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          awardId,
          input.studentId,
          input.classId,
          input.dimensionId,
          input.deltaPoints,
          input.source,
          input.reason,
          input.idempotencyKey,
          logItem.id,
          input.actorId ?? null,
          now,
        );

      const balanceRow = this.db
        .prepare(
          `SELECT COALESCE(SUM(delta_points), 0) AS balance FROM student_point_logs
            WHERE student_id = ? AND class_id = ? AND dimension_id = ?`,
        )
        .get(input.studentId, input.classId, input.dimensionId) as { balance: number };

      return {
        ok: true,
        awardId,
        pointLogId: logItem.id,
        deltaPoints: input.deltaPoints,
        balanceAfter: balanceRow.balance,
      };
    });

    const result = tx();
    // 幂等命中不重复发布事件（与主写入不重复加分一致）
    if (!result.ok || result.idempotentHit || !this.eventPublisher) return result;

    // 事件发布（事务后 fire-and-forget，不阻塞主写入）；失败进补偿队列（Q3=B）
    const event = {
      id: result.pointLogId!,
      type: 'points.awarded',
      source: input.source,
      payload: {
        studentId: input.studentId,
        classId: input.classId,
        dimensionId: input.dimensionId,
        deltaPoints: input.deltaPoints,
        balanceAfter: result.balanceAfter,
        pointLogId: result.pointLogId,
        source: input.source,
      },
      timestamp: now,
    };
    void this.eventPublisher.publish(event).catch(() => {
      if (this.enqueuer) {
        void this.enqueuer.enqueue({
          source: 'points.awarded',
          op: 'emitEvent',
          bizKey: `points.awarded:${result.pointLogId}`,
          payload: event,
          correlationId: result.pointLogId!,
        });
      }
    });

    return result;
  }
}
