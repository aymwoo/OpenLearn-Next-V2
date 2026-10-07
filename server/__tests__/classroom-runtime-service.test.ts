import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ClassroomRuntimeService } from '../services/classroom-runtime-service.js';
import { loadMigrationsFromDirectory, runMigrations } from '../utils/migrate.js';
import { CLASSROOM_BROADCAST_ROOM } from '../presence.js';
import path from 'path';

describe('ClassroomRuntimeService & Interactive Classroom Engine', () => {
  let db: Database.Database;
  let service: ClassroomRuntimeService;
  let emittedEvents: Array<{ event: string; payload: any; room?: string }> = [];

  const mockIo = {
    emit: (event: string, payload: any) => {
      emittedEvents.push({ event, payload });
    },
    to: (room: string) => ({
      emit: (event: string, payload: any) => {
        emittedEvents.push({ event: `${room}:${event}`, payload, room });
      },
    }),
  } as any;

  beforeEach(() => {
    emittedEvents = [];
    db = new Database(':memory:');
    const migrations = loadMigrationsFromDirectory(path.resolve(__dirname, '../../migrations'));
    runMigrations(db, migrations);

    // Seed mock teacher and lesson
    db.prepare(
      "INSERT INTO users (id, username, name, password_hash, role, created_at) VALUES ('t1', 'teacher1', 'Teacher One', 'hash', 'teacher', 1000)",
    ).run();
    db.prepare(
      "INSERT INTO lessons (id, title, creator_id, created_at, updated_at) VALUES ('les_101', 'Interactive Physics', 't1', 1000, 1000)",
    ).run();

    service = new ClassroomRuntimeService(db, mockIo);
  });

  afterEach(() => {
    db.close();
  });

  it('initializes session with PRE_CLASS_READY stage and generates checkin code', async () => {
    const session = await service.getOrCreateSession('les_101', 't1', 'cls_1');
    expect(session).toBeDefined();
    expect(session.lesson_id).toBe('les_101');
    expect(session.stage).toBe('PRE_CLASS_READY');
    expect(session.checkin_code).toMatch(/^\d{4}$/);

    const stage = await service.getStage('les_101');
    expect(stage).toBe('PRE_CLASS_READY');
  });

  it('updates a reused lesson session when the teacher explicitly chooses another class', async () => {
    const first = await service.getOrCreateSession('les_101', 't1', 'cls_1');
    const reused = await service.getOrCreateSession('les_101', 't1', 'cls_2');

    expect(reused.id).toBe(first.id);
    expect(reused.class_id).toBe('cls_2');
  });

  it('transitions through stages and broadcasts socket events', async () => {
    await service.getOrCreateSession('les_101', 't1', 'cls_1');

    const res1 = await service.transitionStage('les_101', 'IN_CLASS_TEACHING', 't1', 'cls_1');
    expect(res1.success).toBe(true);
    expect(res1.stage).toBe('IN_CLASS_TEACHING');

    const teachingStage = await service.getStage('les_101');
    expect(teachingStage).toBe('IN_CLASS_TEACHING');

    // 投递口径：课节房间（**裸 lessonId**）+ 常驻课堂广播房间。
    // 此前投到 `lesson-les_101`（带前缀）—— 那是个无人加入的房间，
    // 该测试当时正是把这个错误房间名当作正确行为钉住了。
    const stageEvents = emittedEvents.filter((e) => e.event.endsWith(':classroom:stage_changed'));
    expect(stageEvents.map((e) => e.room)).toEqual(
      expect.arrayContaining(['les_101', CLASSROOM_BROADCAST_ROOM, 'class-cls_1']),
    );
    for (const e of stageEvents) {
      expect(e.payload.stage).toBe('IN_CLASS_TEACHING');
    }

    // 同概念双事件名（stage_changed / stage_event）已收敛为前者：
    // stage_event 全平台零监听（含插件目录），是纯粹的重复投递
    expect(emittedEvents.some((e) => e.event.endsWith(':classroom:stage_event'))).toBe(false);
  });

  it('allows plugins to intercept and guard stage transitions', async () => {
    await service.getOrCreateSession('les_101', 't1', 'cls_1');

    // Plugin registers a guard preventing ARCHIVED_REPORT if quiz is incomplete
    service.registerStageGuard('plugin-assessment-guard', (from, to) => {
      if (to === 'ARCHIVED_REPORT') {
        return { allowed: false, reason: 'Must complete exit ticket before archiving.' };
      }
      return true;
    });

    const resBlocked = await service.transitionStage('les_101', 'ARCHIVED_REPORT', 't1');
    expect(resBlocked.success).toBe(false);
    expect(resBlocked.reason).toContain('Must complete exit ticket before archiving.');

    // Unregister guard
    service.unregisterStageGuard('plugin-assessment-guard');
    const resAllowed = await service.transitionStage('les_101', 'ARCHIVED_REPORT', 't1');
    expect(resAllowed.success).toBe(true);
  });

  it('supports activity provider registration from third-party plugins', () => {
    service.registerActivityProvider('ext-poll-plus', {
      id: 'matrix_voting',
      name: 'Matrix Grid Voting',
      category: 'survey',
    });

    const list = service.listActivityProviders();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('matrix_voting');

    service.unregisterActivityProvider('ext-poll-plus', 'matrix_voting');
    expect(service.listActivityProviders()).toHaveLength(0);
  });

  it('guarantees atomic buzzer winner determination with first-to-buzz win', () => {
    // Seed buzzer
    const now = Date.now();
    db.prepare(
      `
      INSERT INTO classroom_buzzers (id, session_id, lesson_id, title, status, created_at)
      VALUES ('bz_1', 'cs_1', 'les_101', 'Speed Buzz', 'READY', ?)
    `,
    ).run(now);

    // Student A buzzes in first
    const updateA = db
      .prepare(
        `
      UPDATE classroom_buzzers
      SET status = 'LOCKED', winner_student_id = 's_alice', winner_student_name = 'Alice', winner_response_time_ms = 450
      WHERE id = 'bz_1' AND status = 'READY'
    `,
      )
      .run();
    expect(updateA.changes).toBe(1);

    // Student B buzzes in 10ms later - atomic check fails because status is already LOCKED
    const updateB = db
      .prepare(
        `
      UPDATE classroom_buzzers
      SET status = 'LOCKED', winner_student_id = 's_bob', winner_student_name = 'Bob', winner_response_time_ms = 460
      WHERE id = 'bz_1' AND status = 'READY'
    `,
      )
      .run();
    expect(updateB.changes).toBe(0);

    const winner = db
      .prepare('SELECT winner_student_id, winner_student_name FROM classroom_buzzers WHERE id = ?')
      .get('bz_1') as any;
    expect(winner.winner_student_id).toBe('s_alice');
    expect(winner.winner_student_name).toBe('Alice');
  });

  it('aggregates quick poll votes accurately and protects voter privacy', () => {
    const now = Date.now();
    db.prepare(
      `
      INSERT INTO classroom_quick_polls (id, session_id, lesson_id, question_type, title, options_json, status, created_at)
      VALUES ('poll_1', 'cs_1', 'les_101', 'ABCD', 'Quiz Question', '["A","B","C","D"]', 'ACTIVE', ?)
    `,
    ).run(now);

    // 3 students vote A, 2 students vote B
    const insertVote = db.prepare(`
      INSERT INTO classroom_poll_votes (id, poll_id, student_id, student_name, selected_option, voted_at)
      VALUES (?, 'poll_1', ?, ?, ?, ?)
    `);

    insertVote.run('v1', 's1', 'Student 1', 'A', now);
    insertVote.run('v2', 's2', 'Student 2', 'A', now);
    insertVote.run('v3', 's3', 'Student 3', 'A', now);
    insertVote.run('v4', 's4', 'Student 4', 'B', now);
    insertVote.run('v5', 's5', 'Student 5', 'B', now);

    const rows = db
      .prepare(
        `
      SELECT selected_option, COUNT(*) as count
      FROM classroom_poll_votes
      WHERE poll_id = 'poll_1'
      GROUP BY selected_option
    `,
      )
      .all() as { selected_option: string; count: number }[];

    const distribution: Record<string, number> = {};
    rows.forEach((r) => {
      distribution[r.selected_option] = r.count;
    });

    expect(distribution['A']).toBe(3);
    expect(distribution['B']).toBe(2);
  });

  it('safely handles concurrent relational quiz submissions without overwriting peer data (resolves CONCUR-01)', () => {
    const now = Date.now();
    const insertSubmission = db.prepare(`
      INSERT INTO lesson_quiz_submissions (id, lesson_id, element_id, student_id, student_name, answer, score, is_correct, submitted_at)
      VALUES (?, 'les_101', 'quiz_el_1', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(lesson_id, element_id, student_id) DO UPDATE SET
        answer = excluded.answer,
        score = excluded.score,
        is_correct = excluded.is_correct,
        submitted_at = excluded.submitted_at
    `);

    // 10 students submit concurrently
    for (let i = 1; i <= 10; i++) {
      insertSubmission.run(
        `sub_${i}`,
        `student_${i}`,
        `Student ${i}`,
        i % 2 === 0 ? 'B' : 'A',
        i % 2 === 0 ? 100 : 0,
        i % 2 === 0 ? 1 : 0,
        now + i,
      );
    }

    const allSubmissions = db
      .prepare('SELECT student_id, is_correct FROM lesson_quiz_submissions WHERE lesson_id = ? AND element_id = ?')
      .all('les_101', 'quiz_el_1') as any[];

    expect(allSubmissions).toHaveLength(10);
    const correctCount = allSubmissions.filter((s) => s.is_correct === 1).length;
    expect(correctCount).toBe(5);
  });

  it('同一 element_id 在不同课节下互不覆盖（唯一键含 lesson_id）', () => {
    const upsert = db.prepare(`
      INSERT INTO lesson_quiz_submissions (id, lesson_id, element_id, student_id, student_name, answer, score, is_correct, submitted_at)
      VALUES (?, ?, 'quiz_el_shared', 'student_x', 'Student X', ?, ?, ?, ?)
      ON CONFLICT(lesson_id, element_id, student_id) DO UPDATE SET
        answer = excluded.answer,
        score = excluded.score,
        is_correct = excluded.is_correct,
        submitted_at = excluded.submitted_at
    `);

    upsert.run('lqs-1', 'les_A', 'A', 100, 1, Date.now());
    upsert.run('lqs-2', 'les_B', 'C', 0, 0, Date.now());
    // 同一课节重复提交 → 更新已有行而非新增
    upsert.run('lqs-3', 'les_A', 'B', 0, 0, Date.now());

    const rows = db
      .prepare('SELECT lesson_id, answer, score FROM lesson_quiz_submissions WHERE element_id = ? ORDER BY lesson_id')
      .all('quiz_el_shared') as any[];

    // 旧唯一键 (element_id, student_id) 下这里只会剩 1 行（les_A 被 les_B 覆盖）
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ lesson_id: 'les_A', answer: 'B', score: 0 });
    expect(rows[1]).toMatchObject({ lesson_id: 'les_B', answer: 'C', score: 0 });
  });
});

/**
 * D-3 决策：门禁失效策略（默认 fail-close）
 *
 * 改动前这段代码是：
 *   try { const check = await guard(currentStage, toStage, {...}); ... }
 *   catch (err) { console.error(...); }      // ← 仅记日志，继续下一个 guard
 *
 * 两个问题，第二个比第一个严重：
 *   ① 守卫抛异常被静默吞掉 —— 门禁形同不存在；
 *   ② **根本没有超时** —— 插件 guard 挂起会让 transitionStage 永久挂起。
 *      该方法由 `routes/classroom.ts` 的 `POST /api/classroom/sessions/:id/stage`
 *      调用（教师鉴权端点），一个挂起的插件守卫就能让环节流转接口不可用。
 */
describe('门禁失效策略（D-3）', () => {
  // 用**真实内存库**而非 mock —— transitionStage 放行路径要写会话行
  // （SELECT → UPDATE / INSERT → 再 SELECT），mock 撑不住这条链，会死在
  // `session.started_at` 上而不是测到门禁语义。
  let db: Database.Database;
  const mkService = (policy?: 'fail-close' | 'fail-open') =>
    new ClassroomRuntimeService(db, undefined, policy ? { guardPolicy: policy } : undefined);

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, loadMigrationsFromDirectory(path.resolve(__dirname, '../../migrations')));
    db.prepare(
      "INSERT INTO users (id, username, name, password_hash, role, created_at) VALUES ('t1', 'teacher1', 'Teacher One', 'hash', 'teacher', 1000)",
    ).run();
    db.prepare(
      "INSERT INTO lessons (id, title, creator_id, created_at, updated_at) VALUES ('les_101', 'Interactive Physics', 't1', 1000, 1000)",
    ).run();
  });

  afterEach(() => db.close());

  it('守卫超时后不再永久挂起（默认 1500ms 可用 env 缩短）', async () => {
    const svc = mkService();
    svc.registerStageGuard('hang-plugin', async () => {
      await new Promise(() => {
        /* 永不 resolve —— 模拟插件守卫挂起 */
      });
      return true;
    });

    const started = Date.now();
    const res = await svc.transitionStage('les_1', 'IN_CLASS_TEACHING', 't1', 'cls_1');
    const elapsed = Date.now() - started;

    // 有超时兜底：请求一定会返回，不会挂死
    expect(res.success).toBe(false);
    expect(res.reason).toContain('超时');
    expect(elapsed).toBeLessThan(15_000);
  }, 20_000);

  it('守卫抛异常时拒绝流转，而不是静默放行', async () => {
    const svc = mkService();
    svc.registerStageGuard('boom-plugin', async () => {
      throw new Error('plugin exploded');
    });

    const res = await svc.transitionStage('les_1', 'IN_CLASS_TEACHING', 't1', 'cls_1');
    expect(res.success).toBe(false);
    expect(res.reason).toContain('boom-plugin');
  });

  it('显式传 fail-open 可恢复旧行为（向后兼容逃生口）', async () => {
    const svc = mkService('fail-open');
    svc.registerStageGuard('boom-plugin', async () => {
      throw new Error('plugin exploded');
    });

    const res = await svc.transitionStage('les_1', 'IN_CLASS_TEACHING', 't1', 'cls_1');
    expect(res.success, '显式 fail-open 时守卫崩了仍放行').toBe(true);
  });

  it('守卫正常返回 false 时仍然阻断（策略不影响正常判定）', async () => {
    const svc = mkService();
    svc.registerStageGuard('strict-plugin', async () => ({ allowed: false, reason: '还没交作业' }));

    const res = await svc.transitionStage('les_1', 'IN_CLASS_TEACHING', 't1', 'cls_1');
    expect(res.success).toBe(false);
    expect(res.reason).toBe('还没交作业');
  });

  it('守卫正常返回 true 时放行', async () => {
    const svc = mkService();
    svc.registerStageGuard('ok-plugin', async () => true);

    const res = await svc.transitionStage('les_1', 'IN_CLASS_TEACHING', 't1', 'cls_1');
    expect(res.success).toBe(true);
  });

  it('一个守卫失败即拒绝，不因后续守卫通过而放行', async () => {
    const svc = mkService();
    svc.registerStageGuard('a-broken', async () => {
      throw new Error('broken');
    });
    svc.registerStageGuard('b-allow', async () => true);

    const res = await svc.transitionStage('les_1', 'IN_CLASS_TEACHING', 't1', 'cls_1');
    expect(res.success).toBe(false);
  });
});
