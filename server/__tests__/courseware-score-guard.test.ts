import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerCoursewareRoutes } from '../routes/courseware.js';
import type { ServerContext } from '../context.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

/**
 * Issue IKYP8P 阶段 B：
 * - 提交分数必须落在 courseware_score_config.raw_full_score 内；
 * - completion 统一入库为 0~1（85 → 0.85），前端不再出现 8500%；
 * - 提交样本记录真实协议来源（adapters 自报优先，否则 official-lms）。
 */
describe('courseware score guard & completion normalization (Issue IKYP8P)', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const coursewareId = 'cw-guard-0001';
  const coursewareUuid = 'cw-guard-uuid-0001';
  const studentId = 'stu-guard-0001';
  const studentToken = 'tok-guard-student-0001';
  const attemptId = 'att-guard-student-0001';
  const narrowAttemptId = 'att-guard-narrow-0001';
  const logAttemptId = 'att-guard-log-0001';
  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}`, 'Content-Type': 'application/json' });

  beforeAll(async () => {
    const now = Date.now();
    const db = kernelContainer.db;

    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(studentId, 'guard_student', 'placeholder', 'student', 'Guard 学生', now);
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      studentToken,
      JSON.stringify({ userId: studentId, role: 'student', username: 'guard_student' }),
      now,
      now + 60 * 60 * 1000,
    );
    db.prepare(
      'INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(studentId, 'guard-0001', 'Guard 学生', 'guard@test', now);
    db.prepare(
      'INSERT OR REPLACE INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(coursewareId, coursewareUuid, 'Guard 测试课件', 'html', 'index.html', now);

    const insertAttempt = db.prepare(
      'INSERT OR REPLACE INTO courseware_attempt (id, courseware_id, student_id, started_at, status) VALUES (?, ?, ?, ?, ?)',
    );
    insertAttempt.run(attemptId, coursewareId, studentId, now, 'active');
    insertAttempt.run(narrowAttemptId, coursewareId, studentId, now, 'active');
    insertAttempt.run(logAttemptId, coursewareId, studentId, now, 'active');

    // courseware_score_config 属于独立迁移，测试库手工建表（与 004/012/013 对齐）
    db.exec(`CREATE TABLE IF NOT EXISTS courseware_score_config (
      courseware_id TEXT PRIMARY KEY,
      courseware_name TEXT,
      score_policy TEXT NOT NULL DEFAULT 'LATEST',
      score_fields TEXT NOT NULL DEFAULT '',
      raw_full_score REAL NOT NULL DEFAULT 100,
      target_full_score REAL NOT NULL DEFAULT 100,
      weight_percentage REAL NOT NULL DEFAULT 100,
      lesson_id TEXT,
      auto_record_enabled INTEGER DEFAULT 0,
      auto_record_min_completion REAL DEFAULT 0,
      auto_record_strategy TEXT DEFAULT 'latest',
      updated_at INTEGER NOT NULL DEFAULT 0
    )`);
    db.prepare(
      'INSERT OR REPLACE INTO courseware_score_config (courseware_id, courseware_name, score_policy, raw_full_score, target_full_score, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(coursewareId, 'Guard 测试课件', 'LATEST', 100, 100, now);

    app = express();
    app.use(express.json());
    registerCoursewareRoutes({ app, io: { emit: () => {} } } as unknown as ServerContext);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    const db = kernelContainer.db;
    for (const id of [attemptId, narrowAttemptId, logAttemptId]) {
      db.prepare('DELETE FROM submission_raw WHERE attempt_id = ?').run(id);
      db.prepare('DELETE FROM submission_result WHERE attempt_id = ?').run(id);
      db.prepare('DELETE FROM courseware_attempt WHERE id = ?').run(id);
    }
    db.prepare('DELETE FROM courseware_score_config WHERE courseware_id = ?').run(coursewareId);
    db.prepare('DELETE FROM courseware WHERE id = ?').run(coursewareId);
    db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
    db.prepare('DELETE FROM client_sessions WHERE id = ?').run(studentToken);
    db.prepare('DELETE FROM users WHERE id = ?').run(studentId);
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const submit = (targetAttemptId: string, body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/courseware/attempts/${targetAttemptId}/submit`, {
      method: 'POST',
      headers: cookie(studentToken),
      body: JSON.stringify(body),
    });

  it('超过 raw_full_score 的原始分被拒绝（400）', async () => {
    const res = await submit(attemptId, { score: 150, completion: 1, status: 'completed' });
    expect(res.status).toBe(400);
    const row = kernelContainer.db.prepare('SELECT id FROM submission_result WHERE attempt_id = ?').get(attemptId);
    expect(row).toBeUndefined();
  });

  it('合规分数提交成功，completion 85 归一化为 0.85，并记录 official-lms 来源', async () => {
    const res = await submit(attemptId, {
      score: 88,
      completion: 85,
      status: 'completed',
      comment: '完成测验',
    });
    expect(res.status).toBe(200);

    const row = kernelContainer.db
      .prepare('SELECT score, completion, extra_json FROM submission_result WHERE attempt_id = ?')
      .get(attemptId) as { score: number; completion: number; extra_json: string };
    expect(row.score).toBe(88);
    expect(row.completion).toBeCloseTo(0.85, 4);
    expect(JSON.parse(row.extra_json).protocol).toBe('official-lms');
  });

  it('raw_full_score 改小后，同一分数被拒绝', async () => {
    kernelContainer.db
      .prepare('UPDATE courseware_score_config SET raw_full_score = ? WHERE courseware_id = ?')
      .run(10, coursewareId);
    const res = await submit(narrowAttemptId, { score: 88, completion: 1, status: 'completed' });
    expect(res.status).toBe(400);
    // 恢复，避免影响后续用例
    kernelContainer.db
      .prepare('UPDATE courseware_score_config SET raw_full_score = ? WHERE courseware_id = ?')
      .run(100, coursewareId);
  });

  it('适配器自报的协议来源优先写入 extra_json', async () => {
    const res = await submit(narrowAttemptId, {
      score: 66,
      completion: 1,
      status: 'completed',
      extra: { protocol: 'scorm-12', scorm_lesson_status: 'completed' },
    });
    expect(res.status).toBe(200);
    const row = kernelContainer.db
      .prepare('SELECT extra_json FROM submission_result WHERE attempt_id = ?')
      .get(narrowAttemptId) as { extra_json: string };
    const extra = JSON.parse(row.extra_json);
    expect(extra.protocol).toBe('scorm-12');
    expect(extra.scorm_lesson_status).toBe('completed');
  });

  it('日志路径同样归一化 completion，且不会把 attempt 标为完成', async () => {
    const res = await fetch(`${baseUrl}/api/courseware/attempts/${logAttemptId}/log`, {
      method: 'POST',
      headers: cookie(studentToken),
      body: JSON.stringify({ eventType: 'progress', payload: { completion: 50 } }),
    });
    expect(res.status).toBe(200);

    const row = kernelContainer.db
      .prepare('SELECT completion FROM submission_result WHERE attempt_id = ?')
      .get(logAttemptId) as { completion: number };
    expect(row.completion).toBeCloseTo(0.5, 4);

    const attempt = kernelContainer.db
      .prepare('SELECT status FROM courseware_attempt WHERE id = ?')
      .get(logAttemptId) as { status: string };
    expect(attempt.status).toBe('active');
  });
});
