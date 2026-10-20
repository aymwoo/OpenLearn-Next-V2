/**
 * @vitest-environment node
 *
 * 学生自查花名册端点的数据范围（回归）。
 *
 * ## 背景
 *
 * 功能巡检（`pnpm sweep`）发现：学生端每次加载外壳都会请求
 * `GET /api/students?pageSize=all`，而该端点原先限定教师/管理员 → 学生恒定拿到
 * **403**，控制台每次刷一条错误。
 *
 * 但这不只是噪音：学生端要在本地执行「答题锁定 / 锁定课节」，判定依据是
 * **自己这一行**的 `locked_lesson_id` / `lock_mode` / `lock_target`
 * （见 `src/hooks/useStudentViewState.ts`）。花名册取不到 → `currentStudent`
 * 恒为 undefined → **教师锁了学生、学生端却不受约束**。
 *
 * 因此本文件固化三条契约：
 * 1. 学生访问 `GET /api/students` → 200，且**只含自己一条**；
 * 2. 这一条里**必须带**锁定字段（否则锁定功能又废了）；
 * 3. 这一条里**不得含**邮箱与教师私有备注（越权泄漏防护）。
 *
 * 另附：`/api/db-status` 仍然只开放给教师/管理员（端点契约不变，
 * 学生端不再调用它）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerRosterRoutes } from '../routes/roster.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('学生自查花名册端点的数据范围', () => {
  let server: Server;
  let baseUrl: string;
  const db = kernelContainer.db;

  const teacherId = 'usr-selfscope-teacher';
  const adminId = 'usr-selfscope-admin';
  const studentA = 'stu-selfscope-a';
  const studentB = 'stu-selfscope-b';

  const tokTeacher = 'tok-selfscope-teacher';
  const tokAdmin = 'tok-selfscope-admin';
  const tokStudentA = 'tok-selfscope-student-a';
  const tokStudentB = 'tok-selfscope-student-b';

  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });
  const get = (path: string, token: string) => fetch(`${baseUrl}${path}`, { headers: cookie(token) });

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    const noop = (_req: any, _res: any, next: any) => next();
    const io = { emit: () => undefined, to: () => ({ emit: () => undefined }) };
    registerRosterRoutes({ app, io, loginLimiter: noop } as any);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const now = Date.now();
    const exp = now + 3600_000;
    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(
      tokTeacher,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'selfscope_t' }),
      now,
      exp,
    );
    insertSession.run(
      tokAdmin,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'selfscope_a' }),
      now,
      exp,
    );
    insertSession.run(
      tokStudentA,
      JSON.stringify({ userId: studentA, studentId: studentA, role: 'student', username: 'selfscope_sa' }),
      now,
      exp,
    );
    insertSession.run(
      tokStudentB,
      JSON.stringify({ userId: studentB, studentId: studentB, role: 'student', username: 'selfscope_sb' }),
      now,
      exp,
    );

    const insertUser = db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertUser.run(teacherId, 'selfscope_t', 'x', 'teacher', '自查范围教师', now);
    insertUser.run(adminId, 'selfscope_a', 'x', 'administrator', '自查范围管理员', now);

    const insertStudent = db.prepare(
      `INSERT OR REPLACE INTO students
         (id, student_number, name, email, avatar, locked_lesson_id, lock_mode, lock_target, private_notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // A 被教师锁定在某个课节（full 模式 + 指定目标页签）
    insertStudent.run(
      studentA,
      'SELF-A',
      '自查学生甲',
      'a@example.com',
      null,
      'lesson-locked',
      'navigation',
      JSON.stringify({ tab: 'assignment' }),
      '教师私有备注：甲',
      now,
    );
    insertStudent.run(studentB, 'SELF-B', '自查学生乙', 'b@example.com', null, null, null, null, '教师私有备注：乙', now);

    // 教师拥有班级 cls-selfscope-a，学生甲在其中；学生乙不属于任何班级。
    // 于是 owner 范围下：教师看得到甲，看不到乙。
    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('cls-selfscope-a', '自查范围甲班', '', 'self-a', teacherId, now);
    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      'cls-selfscope-a',
      studentA,
      now,
    );
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run('cls-selfscope-a');
    db.prepare('DELETE FROM classes WHERE id = ?').run('cls-selfscope-a');
    db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(studentA, studentB);
    db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(teacherId, adminId);
    db.prepare('DELETE FROM client_sessions WHERE id LIKE ?').run('tok-selfscope-%');
  });

  it('学生访问花名册端点返回 200（不再是无谓的 403）', async () => {
    const res = await get('/api/students?pageSize=all', tokStudentA);
    expect(res.status).toBe(200);
  });

  it('学生只能拿到自己这一条，看不到同班其他学生', async () => {
    const res = await get('/api/students?pageSize=all', tokStudentA);
    const body = (await res.json()) as { data: any[]; total: number };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(studentA);
    expect(body.total).toBe(1);
    // 明确断言「拿不到别人」
    expect(body.data.some((s) => s.id === studentB)).toBe(false);
    expect(JSON.stringify(body)).not.toContain('自查学生乙');
  });

  it('自己这一条必须带锁定字段 —— 否则教师的「答题锁定」在学生端失效', async () => {
    const res = await get('/api/students?pageSize=all', tokStudentA);
    const body = (await res.json()) as { data: any[] };
    const me = body.data[0];
    expect(me.locked_lesson_id).toBe('lesson-locked');
    expect(me.lock_mode).toBe('navigation');
    expect(JSON.parse(me.lock_target)).toEqual({ tab: 'assignment' });
  });

  it('不下发邮箱与教师私有备注（越权泄漏防护）', async () => {
    const res = await get('/api/students?pageSize=all', tokStudentA);
    const body = (await res.json()) as { data: any[] };
    const me = body.data[0];
    expect(me.email).toBeUndefined();
    expect(me.private_notes).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('教师私有备注');
  });

  it('未锁定的学生拿到的是空锁定字段，而不是 403', async () => {
    const res = await get('/api/students?pageSize=all', tokStudentB);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(studentB);
    expect(body.data[0].locked_lesson_id ?? null).toBeNull();
  });

  it('教师与管理员的取数范围不受影响', async () => {
    const teacherRes = await get('/api/students?pageSize=all', tokTeacher);
    expect(teacherRes.status).toBe(200);
    const teacherBody = (await teacherRes.json()) as { data: any[] };
    // 教师是 owner 范围：能看到自己班上的学生甲，看不到不在自己班上的乙
    expect(teacherBody.data.some((s) => s.id === studentA)).toBe(true);
    expect(teacherBody.data.some((s) => s.id === studentB)).toBe(false);

    const adminRes = await get('/api/students?pageSize=all', tokAdmin);
    expect(adminRes.status).toBe(200);
    const adminBody = (await adminRes.json()) as { data: any[] };
    expect(adminBody.data.some((s) => s.id === studentA)).toBe(true);
    expect(adminBody.data.some((s) => s.id === studentB)).toBe(true);
    // 管理员才看得到教师私有备注
    expect(adminBody.data.find((s) => s.id === studentA)?.private_notes).toBe('教师私有备注：甲');
  });

  it('DB 状态端点仍然只开放给教师/管理员（端点契约不变）', async () => {
    expect((await get('/api/db-status', tokStudentA)).status).toBe(403);
    expect((await get('/api/db-status', tokTeacher)).status).toBe(200);
    expect((await get('/api/db-status', tokAdmin)).status).toBe(200);
  });
});
