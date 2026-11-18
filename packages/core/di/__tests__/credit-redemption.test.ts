import { describe, it, expect, beforeEach } from 'vitest';
import betterSqlite3 from 'better-sqlite3';
import { PointsLedgerService } from '../points-ledger-service.js';
import { CreditRedemptionService, DEFAULT_REDEEM_DIMENSION } from '../credit-redemption-service.js';

describe('CreditRedemptionService — 学分兑换扣减事务', () => {
  let db: betterSqlite3.Database;
  let ledger: PointsLedgerService;
  let service: CreditRedemptionService;

  beforeEach(() => {
    db = betterSqlite3(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS student_point_logs (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        class_id TEXT NOT NULL,
        dimension_id TEXT NOT NULL,
        plugin_id TEXT,
        delta_points REAL NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reward_redemptions (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        class_id TEXT NOT NULL,
        reward_id TEXT NOT NULL,
        reward_name TEXT,
        cost_points REAL NOT NULL,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed',
        point_log_id TEXT,
        balance_before REAL NOT NULL,
        balance_after REAL NOT NULL,
        actor_id TEXT,
        reason TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_reward_redemption_idem
        ON reward_redemptions(student_id, idempotency_key);
    `);
    ledger = new PointsLedgerService(db);
    service = new CreditRedemptionService(db, ledger);
  });

  const grant = (studentId: string, classId: string, amount: number, dim = DEFAULT_REDEEM_DIMENSION) =>
    ledger.addPointsSync(studentId, classId, dim, amount, 'earn:test');

  it('成功扣减：写负流水 + 兑换记录，余额正确', () => {
    grant('stu-1', 'cls-1', 100);
    const r = service.redeem({
      studentId: 'stu-1',
      classId: 'cls-1',
      rewardId: 'free-activity-1',
      costPoints: 30,
      idempotencyKey: 'fa1:session-1',
      actorId: 'user:stu-1:student',
    });

    expect(r.ok).toBe(true);
    expect(r.balanceBefore).toBe(100);
    expect(r.balanceAfter).toBe(70);
    expect(r.pointLogId).toBeTruthy();
    expect(service.getBalance('stu-1', 'cls-1')).toBe(70);

    const log = db
      .prepare('SELECT delta_points, reason, plugin_id FROM student_point_logs WHERE id = ?')
      .get(r.pointLogId) as { delta_points: number; reason: string; plugin_id: string };
    expect(log.delta_points).toBe(-30);
    expect(log.reason).toBe('redeem:free-activity-1');

    const redemption = db.prepare('SELECT * FROM reward_redemptions WHERE id = ?').get(r.redemptionId) as {
      balance_before: number;
      balance_after: number;
      status: string;
    };
    expect(redemption.balance_before).toBe(100);
    expect(redemption.balance_after).toBe(70);
    expect(redemption.status).toBe('completed');
  });

  it('余额不足：拒绝兑换且不写任何流水/记录', () => {
    grant('stu-2', 'cls-1', 10);
    const r = service.redeem({
      studentId: 'stu-2',
      classId: 'cls-1',
      rewardId: 'free-activity-2',
      costPoints: 50,
      idempotencyKey: 'fa2:session-1',
    });

    expect(r.ok).toBe(false);
    expect(r.code).toBe('INSUFFICIENT_CREDITS');
    expect(r.balanceBefore).toBe(10);
    expect(service.getBalance('stu-2', 'cls-1')).toBe(10);
    const count = (db.prepare('SELECT COUNT(*) AS n FROM reward_redemptions').get() as { n: number }).n;
    expect(count).toBe(0);
  });

  it('幂等：同一 idempotencyKey 重复兑换只扣一次', () => {
    grant('stu-3', 'cls-1', 100);
    const input = {
      studentId: 'stu-3',
      classId: 'cls-1',
      rewardId: 'free-activity-3',
      costPoints: 20,
      idempotencyKey: 'fa3:session-1',
    };
    const r1 = service.redeem(input);
    const r2 = service.redeem(input);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r2.idempotentHit).toBe(true);
    expect(r2.redemptionId).toBe(r1.redemptionId);
    expect(service.getBalance('stu-3', 'cls-1')).toBe(80);
    const logs = (
      db.prepare('SELECT COUNT(*) AS n FROM student_point_logs WHERE delta_points < 0').get() as { n: number }
    ).n;
    expect(logs).toBe(1);
  });

  it('不同 idempotencyKey 可多次兑换，余额累加扣减', () => {
    grant('stu-4', 'cls-1', 100);
    service.redeem({
      studentId: 'stu-4',
      classId: 'cls-1',
      rewardId: 'free-activity-4',
      costPoints: 25,
      idempotencyKey: 'fa4:session-1',
    });
    service.redeem({
      studentId: 'stu-4',
      classId: 'cls-1',
      rewardId: 'free-activity-4',
      costPoints: 25,
      idempotencyKey: 'fa4:session-2',
    });
    expect(service.getBalance('stu-4', 'cls-1')).toBe(50);
  });

  it('维度隔离：只扣指定维度的学分，不影响其他维度', async () => {
    grant('stu-5', 'cls-1', 60, 'attendance');
    grant('stu-5', 'cls-1', 40, DEFAULT_REDEEM_DIMENSION);
    const r = service.redeem({
      studentId: 'stu-5',
      classId: 'cls-1',
      rewardId: 'free-activity-5',
      costPoints: 30,
      idempotencyKey: 'fa5:session-1',
    });
    expect(r.ok).toBe(true);
    await expect(ledger.getStudentTotalByDimension('stu-5', 'cls-1', 'attendance')).resolves.toBe(60);
    expect(service.getBalance('stu-5', 'cls-1')).toBe(10);
  });

  it('非法输入：costPoints <= 0 或字段缺失被拒绝', () => {
    const base = {
      studentId: 'stu-6',
      classId: 'cls-1',
      rewardId: 'r',
      costPoints: 10,
      idempotencyKey: 'k',
    };
    expect(service.redeem({ ...base, costPoints: 0 }).code).toBe('INVALID_INPUT');
    expect(service.redeem({ ...base, costPoints: -5 }).code).toBe('INVALID_INPUT');
    expect(service.redeem({ ...base, studentId: '' }).code).toBe('INVALID_INPUT');
    expect(service.redeem({ ...base, idempotencyKey: '' }).code).toBe('INVALID_INPUT');
  });
});
