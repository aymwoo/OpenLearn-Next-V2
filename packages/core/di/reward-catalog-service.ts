/**
 * 奖励/自由活动目录服务（设计 Q7=B）。
 *
 * 目录是兑换价格、库存、上下架、资格、有效期的唯一权威。兑换时由服务端从
 * 目录读取这些字段，不接受客户端自报价格，防止「自报 1 分兑换高价奖品」。
 *
 * 库存扣减与余额扣减必须在同一事务内（否则会超卖），因此consumeStock()
 * 只提供「在外部事务内执行」的同步操作，由 CreditRedemptionService 调用。
 */
import type { Database } from 'better-sqlite3';

export interface RewardEligibility {
  /** 兑换者在该学分维度的最低余额 */
  minPoints?: number;
  /** 允许兑换的角色（actor role，如 teacher/student）；空表示不限 */
  roles?: string[];
  /** 允许兑换的班级 id；空表示不限 */
  classIds?: string[];
}

export interface RewardItem {
  id: string;
  name: string;
  nameEn: string | null;
  description: string | null;
  icon: string | null;
  color: string | null;
  costPoints: number;
  stock: number | null;
  redeemedCount: number;
  status: 'active' | 'inactive';
  eligibility: RewardEligibility | null;
  availableFrom: number | null;
  availableUntil: number | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateRewardInput {
  id: string;
  name: string;
  nameEn?: string | null;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  costPoints: number;
  stock?: number | null;
  eligibility?: RewardEligibility | null;
  availableFrom?: number | null;
  availableUntil?: number | null;
  sortOrder?: number;
}

export type ResolveFailureCode =
  'REWARD_NOT_FOUND' | 'REWARD_INACTIVE' | 'REWARD_EXPIRED' | 'REWARD_NOT_STARTED' | 'OUT_OF_STOCK' | 'NOT_ELIGIBLE';

export interface ResolveResult {
  ok: boolean;
  code?: ResolveFailureCode;
  message?: string;
  /** 权威价格（来自目录，非客户端） */
  costPoints?: number;
  item?: RewardItem;
}

export interface ResolveContext {
  classId: string;
  /** 兑换者角色（用于 roles 资格判定） */
  role?: string | null;
  /** 兑换者在学分维度的当前余额（用于 minPoints 资格判定） */
  balance: number;
  now?: number;
}

export class RewardCatalogService {
  constructor(private db: Database) {}

  create(input: CreateRewardInput): RewardItem {
    if (!input.id || !input.name || !Number.isFinite(input.costPoints) || input.costPoints <= 0) {
      throw new Error('id, name 必填，costPoints 必须为正数');
    }
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO reward_catalog (
           id, name, name_en, description, icon, color, cost_points, stock,
           redeemed_count, status, eligibility_json, available_from, available_until,
           sort_order, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.name,
        input.nameEn ?? null,
        input.description ?? null,
        input.icon ?? null,
        input.color ?? null,
        input.costPoints,
        input.stock ?? null,
        input.eligibility ? JSON.stringify(input.eligibility) : null,
        input.availableFrom ?? null,
        input.availableUntil ?? null,
        input.sortOrder ?? 100,
        now,
        now,
      );
    return this.getById(input.id)!;
  }

  getById(id: string): RewardItem | null {
    const row = this.db.prepare('SELECT * FROM reward_catalog WHERE id = ?').get(id) as
      Record<string, unknown> | undefined;
    return row ? this.map(row) : null;
  }

  /** 仅上架且有效期内的目录项（裸列表，不做资格判定） */
  listAvailable(now = Date.now()): RewardItem[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM reward_catalog
          WHERE status = 'active'
            AND (available_from IS NULL OR available_from <= ?)
            AND (available_until IS NULL OR available_until >= ?)
          ORDER BY sort_order ASC, created_at ASC`,
      )
      .all(now, now) as Record<string, unknown>[];
    return rows.map((r) => this.map(r));
  }

  setStatus(id: string, status: 'active' | 'inactive'): boolean {
    const info = this.db
      .prepare('UPDATE reward_catalog SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, Date.now(), id);
    return info.changes > 0;
  }

  /**
   * 兑换前校验并返回权威价格。供 CreditRedemptionService 在同一事务内调用。
   * 不做库存扣减（由 consumeStock 负责），但在此校验库存 > 0。
   */
  resolveForRedeem(rewardId: string, ctx: ResolveContext): ResolveResult {
    const item = this.getById(rewardId);
    if (!item) return { ok: false, code: 'REWARD_NOT_FOUND', message: `奖励 "${rewardId}" 不存在` };
    if (item.status !== 'active') return { ok: false, code: 'REWARD_INACTIVE', message: '奖励已下架' };

    const now = ctx.now ?? Date.now();
    if (item.availableFrom && now < item.availableFrom) {
      return { ok: false, code: 'REWARD_NOT_STARTED', message: '兑换尚未开始' };
    }
    if (item.availableUntil && now > item.availableUntil) {
      return { ok: false, code: 'REWARD_EXPIRED', message: '兑换已结束' };
    }
    if (item.stock !== null && item.stock <= 0) {
      return { ok: false, code: 'OUT_OF_STOCK', message: '库存不足' };
    }

    if (item.eligibility) {
      const e = item.eligibility;
      if (e.minPoints !== undefined && ctx.balance < e.minPoints) {
        return { ok: false, code: 'NOT_ELIGIBLE', message: `需要至少 ${e.minPoints} 学分方可兑换` };
      }
      if (e.roles && e.roles.length > 0 && (!ctx.role || !e.roles.includes(ctx.role))) {
        return { ok: false, code: 'NOT_ELIGIBLE', message: '当前角色不可兑换' };
      }
      if (e.classIds && e.classIds.length > 0 && !e.classIds.includes(ctx.classId)) {
        return { ok: false, code: 'NOT_ELIGIBLE', message: '当前班级不可兑换' };
      }
    }

    return { ok: true, costPoints: item.costPoints, item };
  }

  /** 在外部事务内扣减库存 + 累加已兑换数。返回是否仍有库存。 */
  consumeStock(rewardId: string): boolean {
    const item = this.getById(rewardId);
    if (!item) return false;
    if (item.stock !== null && item.stock <= 0) return false;
    if (item.stock !== null) {
      this.db
        .prepare(
          'UPDATE reward_catalog SET stock = stock - 1, redeemed_count = redeemed_count + 1, updated_at = ? WHERE id = ?',
        )
        .run(Date.now(), rewardId);
    } else {
      this.db
        .prepare('UPDATE reward_catalog SET redeemed_count = redeemed_count + 1, updated_at = ? WHERE id = ?')
        .run(Date.now(), rewardId);
    }
    return true;
  }

  private map(r: Record<string, unknown>): RewardItem {
    let eligibility: RewardEligibility | null = null;
    if (typeof r.eligibility_json === 'string') {
      try {
        eligibility = JSON.parse(r.eligibility_json) as RewardEligibility;
      } catch {
        eligibility = null;
      }
    }
    return {
      id: r.id as string,
      name: r.name as string,
      nameEn: (r.name_en as string | null) ?? null,
      description: (r.description as string | null) ?? null,
      icon: (r.icon as string | null) ?? null,
      color: (r.color as string | null) ?? null,
      costPoints: r.cost_points as number,
      stock: (r.stock as number | null) ?? null,
      redeemedCount: (r.redeemed_count as number) ?? 0,
      status: (r.status as 'active' | 'inactive') ?? 'active',
      eligibility,
      availableFrom: (r.available_from as number | null) ?? null,
      availableUntil: (r.available_until as number | null) ?? null,
      sortOrder: (r.sort_order as number) ?? 100,
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number,
    };
  }
}
