import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerCoursewareRoutes } from '../routes/courseware.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

/**
 * 回归测试 —— `/api/courseware/attempts/:attemptId/submit` 的 actorId 归一化。
 *
 * 历史缺陷（学生端 HTTP 500）：
 *   路由把 `session.userId`（裸 UUID）直接当作 actorId 传给 `courseware.submit_attempt`，
 *   而 CapabilityGuard 的角色兜底依赖 `user:<id>:<role>` 的 `:role` 后缀（见
 *   packages/core/capability-system/index.ts 的 actorId.endsWith(':student')），
 *   于是学生真实提交、教师课件预览提交都被判为缺少 `student:write` 而失败。
 *
 * 本用例**刻意不手工 grant 能力**（与 courseware-e2e-flow.test.ts 的规避写法相反），
 * 只通过 Cookie 会话走真实生产路径，从而锁死该回归。
 *
 * 同时覆盖 `GET /api/courseware/attempts/:attemptId/raw` 的鉴权（修复前无 requireAuth
 * 且 actorId 硬编码 'teacher-demo'，任何人凭 attemptId 即可读取学生原始作答）。
 */describe('courseware /submit actorId 归一化（Cookie 会话 + 角色兜底）', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const studentId = 'stu-actor-0001';
  const teacherId = 'usr-actor-teacher-0001';
  const otherStudentId = 'stu-actor-0002';
  const coursewareId = 'cw-actor-0001';
  const coursewareUuid = 'cw-actor-uuid-0001';
  const studentAttemptId = 'att-actor-student-0001';
  const otherAttemptId = 'att-actor-other-0001';
  const teacherAttemptId = 'att-actor-teacher-preview-0001';
  const studentToken = 'tok-actor-student-0001';
  const teacherToken = 'tok-actor-teacher-0001';

  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

  beforeAll(async () => {
    const now = Date.now();

    kernelContainer.db
      .prepare(
        'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(studentId, 'actor_student', 'placeholder', 'student', 'Actor 学生', now);
    kernelContainer.db
      .prepare(
        'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(teacherId, 'actor_teacher', 'placeholder', 'teacher', 'Actor 教师', now);
    kernelContainer.db
      .prepare('INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(studentId, 'stu-actor-0001-num', 'Actor 学生', 'actor@test', now);

    kernelContainer.db
      .prepare('INSERT OR REPLACE INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(coursewareId, coursewareUuid, 'Actor 测试课件', 'html', 'index.html', now);

    const insertAttempt = kernelContainer.db.prepare(
      'INSERT OR REPLACE INTO courseware_attempt (id, courseware_id, student_id, started_at, status) VALUES (?, ?, ?, ?, ?)',
    );
    insertAttempt.run(studentAttemptId, coursewareId, studentId, now, 'active');
    insertAttempt.run(otherAttemptId, coursewareId, otherStudentId, now, 'active');
    insertAttempt.run(teacherAttemptId, coursewareId, 'teacher_preview', now, 'active');

    // 真实会话行：getValidSession(token) 读 client_sessions.session_data
    const insertSession = kernelContainer.db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(
      studentToken,
      JSON.stringify({ userId: studentId, role: 'student', username: 'actor_student' }),
      now,
      now + 60 * 60 * 1000,
    );
    insertSession.run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'actor_teacher' }),
      now,
      now + 60 * 60 * 1000,
    );

    app = express();
    app.use(express.json()); // 不注入 (req as any).session —— 必须走 Cookie → getValidSession 路径
    const ctx: any = { app, io: { emit: () => undefined } };
    registerCoursewareRoutes(ctx);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    kernelContainer.db.prepare('DELETE FROM courseware_attempt WHERE id IN (?, ?, ?)').run(
      studentAttemptId,
      otherAttemptId,
      teacherAttemptId,
    );
    kernelContainer.db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?)').run(studentToken, teacherToken);
    kernelContainer.db.prepare('DELETE FROM submission_raw WHERE attempt_id IN (?, ?, ?)').run(
      studentAttemptId,
      otherAttemptId,
      teacherAttemptId,
    );
    kernelContainer.db.prepare('DELETE FROM submission_result WHERE attempt_id IN (?, ?, ?)').run(
      studentAttemptId,
      otherAttemptId,
      teacherAttemptId,
    );
  });

  it('学生用 Cookie 会话提交自己的 attempt → 200 并落库（不再 500）', async () => {
    const res = await fetch(`${baseUrl}/api/courseware/attempts/${studentAttemptId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(studentToken) },
      body: JSON.stringify({ score: 88, completion: 100, status: 'completed', extra: { q1: 'B' } }),
    });
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);

    const raw = kernelContainer.db
      .prepare('SELECT COUNT(*) as c FROM submission_raw WHERE attempt_id = ?')
      .get(studentAttemptId) as { c: number };
    expect(raw.c).toBeGreaterThan(0);
  });

  it('学生不能提交他人 attempt → 403', async () => {
    const res = await fetch(`${baseUrl}/api/courseware/attempts/${otherAttemptId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(studentToken) },
      body: JSON.stringify({ score: 100 }),
    });
    expect(res.status).toBe(403);
  });

  it('教师预览（attempt.student_id = teacher_preview）提交 → 200', async () => {
    const res = await fetch(`${baseUrl}/api/courseware/attempts/${teacherAttemptId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify({ score: 42, status: 'completed' }),
    });
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
  });

  it('无会话提交 → 401', async () => {
    const res = await fetch(`${baseUrl}/api/courseware/attempts/${studentAttemptId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score: 60 }),
    });
    expect(res.status).toBe(401);
  });

  it('原始作答数据 /raw：无会话 401、学生读自己 200、学生读他人 403、教师读任意 200', async () => {
    const own = `${baseUrl}/api/courseware/attempts/${studentAttemptId}/raw`;
    const other = `${baseUrl}/api/courseware/attempts/${otherAttemptId}/raw`;

    expect((await fetch(own)).status).toBe(401);

    const asStudentOwn = await fetch(own, { headers: cookie(studentToken) });
    expect(asStudentOwn.status, await asStudentOwn.text()).toBe(200);

    const asStudentOther = await fetch(other, { headers: cookie(studentToken) });
    expect(asStudentOther.status).toBe(403);

    const asTeacher = await fetch(other, { headers: cookie(teacherToken) });
    expect(asTeacher.status, await asTeacher.text()).toBe(200);
  });

  it('CapabilityGuard：角色后缀兜底授予 student:write，裸 UUID 不授予（缺陷根因）', () => {
    const guard = kernelContainer.capabilityGuard;
    expect(guard.check(`user:${studentId}:student`, 'student:write')).toBe(true);
    expect(guard.check(`user:${teacherId}:teacher`, 'student:write')).toBe(true);
    expect(guard.check(studentId, 'student:write')).toBe(false);
  });
});
