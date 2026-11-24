import { describe, it, expect, beforeEach } from 'vitest';
import betterSqlite3 from 'better-sqlite3';
import { PointsLedgerService } from '../points-ledger-service.js';
import { RewardCatalogService } from '../reward-catalog-service.js';
import { CreditRedemptionService, DEFAULT_REDEEM_DIMENSION } from '../credit-redemption-service.js';

describe('RewardCatalogService + 目录驱动兑换', () => {
  let db: betterSqlite3.Database;
  let ledger: PointsLedgerService;
  let catalog: RewardCatalogService;
  let service: CreditRedemptionService;

  beforeEach(() => {
    db = betterSqlite3(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS student_point_logs (
        id TEXT PRIMARY KEY, student_id TEXT NOT NULL, class_id TEXT NOT NULL,
        dimension_id TEXT NOT NULL, plugin_id TEXT, delta_points REAL NOT NULL,
        reason TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reward_redemptions (
        id TEXT PRIMARY KEY, student_id TEXT NOT NULL, class_id TEXT NOT NULL,
        reward_id TEXT NOT NULL, reward_name TEXT, cost_points REAL NOT NULL,
        idempotency_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'completed',
        point_log_id TEXT, balance_before REAL NOT NULL, balance_after REAL NOT NULL,
        actor_id TEXT, reason TEXT, created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_reward_redemption_idem
        ON reward_redemptions(student_id, idempotency_key);
      CREATE TABLE IF NOT EXISTS reward_catalog (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, name_en TEXT, description TEXT,
        icon TEXT, color TEXT, cost_points REAL NOT NULL, stock INTEGER,
        redeemed_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
        eligibility_json TEXT, available_from INTEGER, available_until INTEGER,
        sort_order INTEGER NOT NULL DEFAULT 100, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reward_catalog_listing ON reward_catalog(status, sort_order, created_at);
    `);
    ledger = new PointsLedgerService(db);
    catalog = new RewardCatalogService(db);
    service = new CreditRedemptionService(db, ledger, DEFAULT_REDEEM_DIMENSION, catalog);
  });

  const grant = (studentId: string, classId: string, amount: number) =>
    ledger.addPointsSync(studentId, classId, DEFAULT_REDEEM_DIMENSION, amount, 'earn:test');

  it('目录 CRUD：创建、按 id 取、上架列表、下架', () => {
    catalog.create({ id: 'free-lunch', name: '免费午餐券', costPoints: 50, sortOrder: 10 });
    catalog.create({ id: 'game-time', name: '自由游戏 30 分钟', costPoints: 20, sortOrder: 20 });
    expect(catalog.getById('free-lunch')?.costPoints).toBe(50);
    expect(catalog.listAvailable().map((r) => r.id)).toEqual(['free-lunch', 'game-time']);

    catalog.setStatus('free-lunch', 'inactive');
    expect(catalog.listAvailable().map((r) => r.id)).toEqual(['game-time']);
    expect(catalog.getById('free-lunch')?.status).toBe('inactive');
  });

  it('目录字段非法值在入口拒绝：NaN 库存/有效期不会被当成“无限制”', () => {
    expect(() => catalog.create({ id: 'bad-stock', name: 'x', costPoints: 1, stock: Number.NaN })).toThrow(/stock/);
    expect(() => catalog.create({ id: 'bad-from', name: 'x', costPoints: 1, availableFrom: Number.NaN })).toThrow(
      /availableFrom/,
    );
    expect(() =>
      catalog.create({ id: 'bad-range', name: 'x', costPoints: 1, availableFrom: 2, availableUntil: 1 }),
    ).toThrow(/availableUntil/);
  });

  it('权威定价：忽略客户端自报 costPoints，按目录价格扣减', () => {
    catalog.create({ id: 'reward-a', name: '奖励A', costPoints: 40 });
    grant('stu-1', 'cls-1', 100);
    const r = service.redeem({
      studentId: 'stu-1',
      classId: 'cls-1',
      rewardId: 'reward-a',
      costPoints: 1, // 自报 1 分，应被忽略
      idempotencyKey: 'k1',
    });
    expect(r.ok).toBe(true);
    expect(r.costPoints).toBe(40);
    expect(r.balanceAfter).toBe(60);
  });

  it('库存：扣减成功时 -1；售罄拒绝兑换', () => {
    catalog.create({ id: 'limited', name: '限量奖励', costPoints: 10, stock: 1 });
    grant('stu-2', 'cls-1', 100);
    const r1 = service.redeem({
      studentId: 'stu-2',
      classId: 'cls-1',
      rewardId: 'limited',
      idempotencyKey: 'k2-1',
    });
    expect(r1.ok).toBe(true);
    expect(catalog.getById('limited')?.stock).toBe(0);
    expect(catalog.getById('limited')?.redeemedCount).toBe(1);

    const r2 = service.redeem({
      studentId: 'stu-2',
      classId: 'cls-1',
      rewardId: 'limited',
      idempotencyKey: 'k2-2',
    });
    expect(r2.ok).toBe(false);
    expect(r2.code).toBe('OUT_OF_STOCK');
    expect(catalog.getById('limited')?.stock).toBe(0);
  });

  it('资格：角色/班级/最低学分不满足时拒绝', () => {
    catalog.create({
      id: 'gated',
      name: '资格奖励',
      costPoints: 10,
      eligibility: { minPoints: 80, roles: ['student'], classIds: ['cls-1'] },
    });

    // 余额 50 < minPoints 80
    grant('stu-3', 'cls-1', 50);
    const low = service.redeem({
      studentId: 'stu-3',
      classId: 'cls-1',
      rewardId: 'gated',
      role: 'student',
      idempotencyKey: 'k3-1',
    });
    expect(low.ok).toBe(false);
    expect(low.code).toBe('NOT_ELIGIBLE');

    // 补足到 100 仍满足 minPoints，但角色错误
    grant('stu-3', 'cls-1', 50);
    const wrongRole = service.redeem({
      studentId: 'stu-3',
      classId: 'cls-1',
      rewardId: 'gated',
      role: 'teacher',
      idempotencyKey: 'k3-2',
    });
    expect(wrongRole.ok).toBe(false);
    expect(wrongRole.code).toBe('NOT_ELIGIBLE');

    // 班级不符
    grant('stu-3', 'cls-2', 100);
    const wrongClass = service.redeem({
      studentId: 'stu-3',
      classId: 'cls-2',
      rewardId: 'gated',
      role: 'student',
      idempotencyKey: 'k3-3',
    });
    expect(wrongClass.ok).toBe(false);
    expect(wrongClass.code).toBe('NOT_ELIGIBLE');
  });

  it('有效期：未开始/已过期拒绝', () => {
    const now = Date.now();
    catalog.create({
      id: 'future',
      name: '未来奖励',
      costPoints: 10,
      availableFrom: now + 100_000,
    });
    catalog.create({ id: 'past', name: '过期奖励', costPoints: 10, availableUntil: now - 1000 });
    grant('stu-4', 'cls-1', 100);

    expect(
      service.redeem({ studentId: 'stu-4', classId: 'cls-1', rewardId: 'future', idempotencyKey: 'k4-1' }).code,
    ).toBe('REWARD_NOT_STARTED');
    expect(
      service.redeem({ studentId: 'stu-4', classId: 'cls-1', rewardId: 'past', idempotencyKey: 'k4-2' }).code,
    ).toBe('REWARD_EXPIRED');
  });

  it('下架奖励不可兑换', () => {
    catalog.create({ id: 'off', name: '下架奖励', costPoints: 10 });
    catalog.setStatus('off', 'inactive');
    grant('stu-5', 'cls-1', 100);
    expect(service.redeem({ studentId: 'stu-5', classId: 'cls-1', rewardId: 'off', idempotencyKey: 'k5' }).code).toBe(
      'REWARD_INACTIVE',
    );
  });

  it('目录缺失时拒绝兑换', () => {
    grant('stu-6', 'cls-1', 100);
    expect(service.redeem({ studentId: 'stu-6', classId: 'cls-1', rewardId: 'ghost', idempotencyKey: 'k6' }).code).toBe(
      'REWARD_NOT_FOUND',
    );
  });
});
