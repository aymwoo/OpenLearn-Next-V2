/**
 * 学分兑换扣减事务（设计 Q6=A / Q3=B / Q7=B 的产物）。
 *
 * 账户模型：不建"学分账户表"，余额由 student_point_logs 的 SUM(delta_points)
 * 推导。兑换 = 一条负 delta 流水 + 一条兑换记录，两者在**同一事务**内原子写入。
 *
 * 价格/库存权威（Q7=B）：传入 RewardCatalogService 时，价格由目录给出（不接受
 * 客户端自报），库存扣减、余额扣减、兑换记录在同一事务内完成，避免超卖/超支。
 * 不传 catalog 时退化为直接 costPoints 模式（兼容早期调用方与单测）。
 *
 * 并发安全：所有校验与写入放在 better-sqlite3 的 db.transaction() 中。
 * SQLite 单写者模型保证事务串行，不存在两个事务读到同一余额/库存的窗口。
 *
 * 幂等：唯一索引 (student_id, idempotency_key) + 事务内先查后写。重复兑换
 * 返回既有记录，不重复扣分（Q5 前端去重的后端对应保障）。
 */
import type { Database } from 'better-sqlite3';
import { v7 as uuidv7 } from 'uuid';
import { PointsLedgerService } from './points-ledger-service.js';
import { RewardCatalogService, type ResolveFailureCode } from './reward-catalog-service.js';
import type { CreditEventPublisher, SideEffectEnqueuer } from './credit-award-service.js';

/** 兑换扣减使用的默认学分维度；可被构造参数覆盖。 */
export const DEFAULT_REDEEM_DIMENSION = 'reward_credit';

export interface RedeemCreditInput {
  studentId: string;
  classId: string;
  /** 被兑换的自由活动/奖励 id */
  rewardId: string;
  /**
   * 兑换所需学分。传入 catalog 时**忽略此值**，以目录价格为准；
   * 未传 catalog 时必填且必须 > 0。
   */
  costPoints?: number;
  /** 幂等键：同一学生同一业务动作只扣一次（如 rewardId + 场次） */
  idempotencyKey: string;
  /** 操作者（学生本人或代操作的管理员），仅审计用 */
  actorId?: string | null;
  /** 兑换者角色，用于目录的 roles 资格判定 */
  role?: string | null;
  /** 兑换原因/备注 */
  reason?: string | null;
  /** 学分维度，默认 reward_credit */
  dimensionId?: string;
}

export type RedeemFailureCode = 'INVALID_INPUT' | 'INSUFFICIENT_CREDITS' | ResolveFailureCode;

export interface RedeemResult {
  ok: boolean;
  /** 失败码（ok=false 时必有） */
  code?: RedeemFailureCode;
  message?: string;
  /** 成功时返回 */
  redemptionId?: string;
  pointLogId?: string;
  balanceBefore?: number;
  balanceAfter?: number;
  /** 实际扣减学分（来自目录或入参） */
  costPoints?: number;
  /** 命中幂等键、返回既有记录时为 true */
  idempotentHit?: boolean;
}

interface RedemptionRow {
  id: string;
  balance_before: number;
  balance_after: number;
  cost_points: number;
  point_log_id: string | null;
}

export class CreditRedemptionService {
  private db: Database;
  private ledger: PointsLedgerService;
  private catalog?: RewardCatalogService;
  private defaultDimension: string;
  private eventPublisher?: CreditEventPublisher;
  private enqueuer?: SideEffectEnqueuer;

  constructor(
    db: Database,
    ledger: PointsLedgerService,
    defaultDimension = DEFAULT_REDEEM_DIMENSION,
    catalog?: RewardCatalogService,
    deps?: { eventPublisher?: CreditEventPublisher; sideEffectEnqueuer?: SideEffectEnqueuer },
  ) {
    this.db = db;
    this.ledger = ledger;
    this.defaultDimension = defaultDimension;
    this.catalog = catalog;
    this.eventPublisher = deps?.eventPublisher;
    this.enqueuer = deps?.sideEffectEnqueuer;
  }

  /**
   * 兑换扣减。同步执行（better-sqlite3 事务为同步）；外层门面可用 async 包装。
   */
  redeem(input: RedeemCreditInput): RedeemResult {
    const dim = input.dimensionId || this.defaultDimension;

    if (!input.studentId || !input.classId || !input.rewardId || !input.idempotencyKey) {
      return { ok: false, code: 'INVALID_INPUT', message: 'studentId, classId, rewardId, idempotencyKey 必填' };
    }
    // 无目录时，costPoints 必须由调用方给出且为正
    if (!this.catalog && (!Number.isFinite(input.costPoints) || (input.costPoints ?? 0) <= 0)) {
      return { ok: false, code: 'INVALID_INPUT', message: '未配置目录时 costPoints 必填且必须为正数' };
    }

    const now = Date.now();
    const redemptionId = `red_${uuidv7()}`;

    // 事务：幂等 → 余额/目录校验 → 负流水 → 兑换记录 → 库存扣减，全成或全败。
    const tx = this.db.transaction((): RedeemResult => {
      // 1. 幂等：同键已兑换则直接返回既有记录
      const existing = this.db
        .prepare(
          `SELECT id, balance_before, balance_after, cost_points, point_log_id
             FROM reward_redemptions WHERE student_id = ? AND idempotency_key = ?`,
        )
        .get(input.studentId, input.idempotencyKey) as RedemptionRow | undefined;
      if (existing) {
        return {
          ok: true,
          idempotentHit: true,
          redemptionId: existing.id,
          pointLogId: existing.point_log_id ?? undefined,
          balanceBefore: existing.balance_before,
          balanceAfter: existing.balance_after,
          costPoints: existing.cost_points,
        };
      }

      // 2. 读余额（同一事务内，单写者模型下无超支窗口）
      const balanceRow = this.db
        .prepare(
          `SELECT COALESCE(SUM(delta_points), 0) AS balance
             FROM student_point_logs
            WHERE student_id = ? AND class_id = ? AND dimension_id = ?`,
        )
        .get(input.studentId, input.classId, dim) as { balance: number };
      const balanceBefore = balanceRow.balance;

      // 3. 目录校验 + 权威定价（库存校验也在此，库存扣减在步骤 5）
      let costPoints = input.costPoints!;
      let rewardName = input.rewardId;
      if (this.catalog) {
        const resolved = this.catalog.resolveForRedeem(input.rewardId, {
          classId: input.classId,
          role: input.role ?? null,
          balance: balanceBefore,
          now,
        });
        if (!resolved.ok) {
          return { ok: false, code: resolved.code, message: resolved.message, balanceBefore };
        }
        costPoints = resolved.costPoints!;
        rewardName = resolved.item?.name ?? input.rewardId;
      }

      if (balanceBefore < costPoints) {
        return {
          ok: false,
          code: 'INSUFFICIENT_CREDITS',
          message: `学分不足：余额 ${balanceBefore}，需要 ${costPoints}`,
          balanceBefore,
        };
      }

      // 4. 写负 delta 流水（复用 ledger 的同步写入器，含 pt_ 前缀与审计字段）
      const logItem = this.ledger.addPointsSync(
        input.studentId,
        input.classId,
        dim,
        -costPoints,
        `redeem:${input.rewardId}`,
        'classroomflowserver',
      );
      const balanceAfter = balanceBefore - costPoints;

      // 5. 写兑换记录（含前后余额快照，便于争议追溯）
      this.db
        .prepare(
          `INSERT INTO reward_redemptions (
             id, student_id, class_id, reward_id, reward_name, cost_points,
             idempotency_key, status, point_log_id, balance_before, balance_after,
             actor_id, reason, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          redemptionId,
          input.studentId,
          input.classId,
          input.rewardId,
          rewardName,
          costPoints,
          input.idempotencyKey,
          logItem.id,
          balanceBefore,
          balanceAfter,
          input.actorId ?? null,
          input.reason ?? null,
          now,
        );

      // 6. 库存扣减（同一事务内，与余额扣减同成同败，杜绝超卖）
      if (this.catalog && !this.catalog.consumeStock(input.rewardId)) {
        // 理论上步骤 3 已校验库存；此处兜底（如并发下另一连接刚扣空）
        throw new Error(`[CreditRedemption] 库存扣减失败：${input.rewardId}`);
      }

      return {
        ok: true,
        redemptionId,
        pointLogId: logItem.id,
        balanceBefore,
        balanceAfter,
        costPoints,
      };
    });

    const result = tx();
    if (!result.ok || result.idempotentHit || !this.eventPublisher) return result;

    const event = {
      id: result.redemptionId!,
      type: 'reward.redeemed',
      source: 'classroomflowserver',
      payload: {
        redemptionId: result.redemptionId,
        studentId: input.studentId,
        classId: input.classId,
        rewardId: input.rewardId,
        costPoints: result.costPoints,
        balanceAfter: result.balanceAfter,
      },
      timestamp: now,
    };
    void this.eventPublisher.publish(event).catch(() => {
      if (this.enqueuer) {
        void this.enqueuer.enqueue({
          source: 'reward.redeemed',
          op: 'emitEvent',
          bizKey: `reward.redeemed:${result.redemptionId}`,
          payload: event,
          correlationId: result.redemptionId!,
        });
      }
    });
    return result;
  }

  /** 查询某学生当前可用余额（供门面 credits/summary 复用） */
  getBalance(studentId: string, classId: string, dimensionId?: string): number {
    const dim = dimensionId || this.defaultDimension;
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(delta_points), 0) AS balance
           FROM student_point_logs
          WHERE student_id = ? AND class_id = ? AND dimension_id = ?`,
      )
      .get(studentId, classId, dim) as { balance: number };
    return row.balance;
  }
}
