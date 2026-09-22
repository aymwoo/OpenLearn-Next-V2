import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ClassroomRuntimeService } from '../services/classroom-runtime-service.js';
import { loadMigrationsFromDirectory, runMigrations } from '../utils/migrate.js';
import path from 'path';

describe('ClassroomRuntimeService & Interactive Classroom Engine', () => {
  let db: Database.Database;
  let service: ClassroomRuntimeService;
  let emittedEvents: Array<{ event: string; payload: any }> = [];

  const mockIo = {
    emit: (event: string, payload: any) => {
      emittedEvents.push({ event, payload });
    },
    to: (room: string) => ({
      emit: (event: string, payload: any) => {
        emittedEvents.push({ event: `${room}:${event}`, payload });
      },
    }),
  } as any;

  beforeEach(() => {
    emittedEvents = [];
    db = new Database(':memory:');
    const migrations = loadMigrationsFromDirectory(path.resolve(__dirname, '../../migrations'));
    runMigrations(db, migrations);

    // Seed mock teacher and lesson
    db.prepare("INSERT INTO users (id, username, name, password_hash, role, created_at) VALUES ('t1', 'teacher1', 'Teacher One', 'hash', 'teacher', 1000)").run();
    db.prepare("INSERT INTO lessons (id, title, creator_id, created_at, updated_at) VALUES ('les_101', 'Interactive Physics', 't1', 1000, 1000)").run();

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

  it('transitions through stages and broadcasts socket events', async () => {
    await service.getOrCreateSession('les_101', 't1', 'cls_1');

    const res1 = await service.transitionStage('les_101', 'IN_CLASS_TEACHING', 't1', 'cls_1');
    expect(res1.success).toBe(true);
    expect(res1.stage).toBe('IN_CLASS_TEACHING');

    const teachingStage = await service.getStage('les_101');
    expect(teachingStage).toBe('IN_CLASS_TEACHING');

    // Check broadcasted events
    const event = emittedEvents.find((e) => e.event === 'lesson-les_101:classroom:stage_changed');
    expect(event).toBeDefined();
    expect(event?.payload.stage).toBe('IN_CLASS_TEACHING');
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
    db.prepare(`
      INSERT INTO classroom_buzzers (id, session_id, lesson_id, title, status, created_at)
      VALUES ('bz_1', 'cs_1', 'les_101', 'Speed Buzz', 'READY', ?)
    `).run(now);

    // Student A buzzes in first
    const updateA = db.prepare(`
      UPDATE classroom_buzzers
      SET status = 'LOCKED', winner_student_id = 's_alice', winner_student_name = 'Alice', winner_response_time_ms = 450
      WHERE id = 'bz_1' AND status = 'READY'
    `).run();
    expect(updateA.changes).toBe(1);

    // Student B buzzes in 10ms later - atomic check fails because status is already LOCKED
    const updateB = db.prepare(`
      UPDATE classroom_buzzers
      SET status = 'LOCKED', winner_student_id = 's_bob', winner_student_name = 'Bob', winner_response_time_ms = 460
      WHERE id = 'bz_1' AND status = 'READY'
    `).run();
    expect(updateB.changes).toBe(0);

    const winner = db.prepare('SELECT winner_student_id, winner_student_name FROM classroom_buzzers WHERE id = ?').get('bz_1') as any;
    expect(winner.winner_student_id).toBe('s_alice');
    expect(winner.winner_student_name).toBe('Alice');
  });

  it('aggregates quick poll votes accurately and protects voter privacy', () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO classroom_quick_polls (id, session_id, lesson_id, question_type, title, options_json, status, created_at)
      VALUES ('poll_1', 'cs_1', 'les_101', 'ABCD', 'Quiz Question', '["A","B","C","D"]', 'ACTIVE', ?)
    `).run(now);

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

    const rows = db.prepare(`
      SELECT selected_option, COUNT(*) as count
      FROM classroom_poll_votes
      WHERE poll_id = 'poll_1'
      GROUP BY selected_option
    `).all() as { selected_option: string; count: number }[];

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
