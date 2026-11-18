import { describe, it, expect, beforeEach, vi } from 'vitest';
import betterSqlite3 from 'better-sqlite3';
import { PointsLedgerService } from '../points-ledger-service.js';
import {
  CreditAwardService,
  BUILTIN_AWARD_SOURCES,
  type CreditEventPublisher,
  type SideEffectEnqueuer,
} from '../credit-award-service.js';

describe('CreditAwardService — 统一学分发放接口', () => {
  let db: betterSqlite3.Database;
  let ledger: PointsLedgerService;
  let published: Array<{
    id: string;
    type: string;
    source: string;
    payload: Record<string, unknown>;
    timestamp: number;
  }>;
  let enqueued: Array<{ op: string; bizKey: string; payload: unknown; correlationId: string }>;
  let publisher: CreditEventPublisher;
  let enqueuer: SideEffectEnqueuer;
  let service: CreditAwardService;

  beforeEach(() => {
    db = betterSqlite3(':memory:');
    db.exec(`
      CREATE TABLE student_point_logs (
        id TEXT PRIMARY KEY, student_id TEXT NOT NULL, class_id TEXT NOT NULL,
        dimension_id TEXT NOT NULL, plugin_id TEXT, delta_points REAL NOT NULL,
        reason TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE credit_awards (
        id TEXT PRIMARY KEY, student_id TEXT NOT NULL, class_id TEXT NOT NULL,
        dimension_id TEXT NOT NULL, delta_points REAL NOT NULL, source TEXT NOT NULL,
        reason TEXT NOT NULL, idempotency_key TEXT NOT NULL, point_log_id TEXT NOT NULL,
        actor_id TEXT, created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX uq_credit_awards_idem ON credit_awards(student_id, idempotency_key);
      CREATE TABLE class_students (
        class_id TEXT NOT NULL, student_id TEXT NOT NULL, joined_at INTEGER NOT NULL,
        PRIMARY KEY (class_id, student_id)
      );
      INSERT INTO class_students VALUES ('cls-1', 'stu-1', 0), ('cls-1', 'stu-2', 0);
    `);
    ledger = new PointsLedgerService(db);
    published = [];
    enqueued = [];
    publisher = {
      publish: vi.fn(async (e) => {
        published.push(e);
      }),
    };
    enqueuer = {
      enqueue: vi.fn((e) => {
        enqueued.push(e);
      }),
    };
    service = new CreditAwardService(db, ledger, { eventPublisher: publisher, sideEffectEnqueuer: enqueuer });
  });

  const base = {
    studentId: 'stu-1',
    classId: 'cls-1',
    dimensionId: 'reward_credit',
    deltaPoints: 10,
    source: 'interaction',
    idempotencyKey: 'quiz:q1:stu-1',
    reason: '完成随堂互动',
  };

  it('来源白名单：内置来源与 plugin:<id> 合法，伪造来源被拒', () => {
    for (const s of BUILTIN_AWARD_SOURCES) expect(CreditAwardService.isValidSource(s)).toBe(true);
    expect(CreditAwardService.isValidSource('plugin:ext-quiz')).toBe(true);
    expect(CreditAwardService.isValidSource('evil:fake')).toBe(false);
    expect(CreditAwardService.isValidSource('interaction:hack')).toBe(false);

    expect(service.award({ ...base, source: 'evil:fake' }).code).toBe('INVALID_SOURCE');
  });

  it('成功发放：写流水 + 发放记录 + 发 points.awarded 事件', () => {
    const r = service.award(base);
    expect(r.ok).toBe(true);
    expect(r.deltaPoints).toBe(10);
    expect(r.balanceAfter).toBe(10);
    expect(r.pointLogId).toBeTruthy();

    const awardCount = (db.prepare('SELECT COUNT(*) AS n FROM credit_awards').get() as { n: number }).n;
    expect(awardCount).toBe(1);
    expect(published).toHaveLength(1);
    expect(published[0].type).toBe('points.awarded');
    expect(published[0].payload.studentId).toBe('stu-1');
    expect(published[0].payload.deltaPoints).toBe(10);
    // 事件 id = 流水 id，供下游按 id 去重（Q5/C）
    expect(published[0].id).toBe(r.pointLogId);
  });

  it('未注册学生发放被拒', () => {
    const r = service.award({ ...base, studentId: 'stu-ghost' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('STUDENT_NOT_ENROLLED');
  });

  it('幂等：同一 key 重放返回原记录，不重复加分、不重复发事件', async () => {
    const r1 = service.award(base);
    const r2 = service.award(base);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r2.idempotentHit).toBe(true);
    expect(r2.pointLogId).toBe(r1.pointLogId);
    expect(published).toHaveLength(1);
    await expect(ledger.getStudentTotalByDimension('stu-1', 'cls-1', 'reward_credit')).resolves.toBe(10);
  });

  it('负向发放（扣回）：deltaPoints 为负，余额相应减少', () => {
    service.award(base); // +10
    const r = service.award({
      ...base,
      idempotencyKey: 'revoke:q1:stu-1',
      deltaPoints: -4,
      source: 'reward_refund',
      reason: '撤销误发',
    });
    expect(r.ok).toBe(true);
    expect(r.balanceAfter).toBe(6);
  });

  it('deltaPoints=0 / 非法字段被拒', () => {
    expect(service.award({ ...base, deltaPoints: 0 }).code).toBe('INVALID_INPUT');
    expect(service.award({ ...base, idempotencyKey: '' }).code).toBe('INVALID_INPUT');
  });

  it('事件发布失败：主写入成功，副作用进补偿队列（Q3=B）', async () => {
    const failingPublisher: CreditEventPublisher = {
      publish: vi.fn(async () => {
        throw new Error('bus down');
      }),
    };
    const svc = new CreditAwardService(db, ledger, {
      eventPublisher: failingPublisher,
      sideEffectEnqueuer: enqueuer,
    });
    const r = svc.award(base);
    expect(r.ok).toBe(true);
    await expect(ledger.getStudentTotalByDimension('stu-1', 'cls-1', 'reward_credit')).resolves.toBe(10);
    // 等待 fire-and-forget 的 promise 链完成
    await new Promise((resolve) => setImmediate(resolve));
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].op).toBe('emitEvent');
    expect(enqueued[0].correlationId).toBe(r.pointLogId);
  });
});
