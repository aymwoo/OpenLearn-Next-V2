import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerClassroomRoutes } from '../routes/classroom.js';
import { ClassroomRuntimeService } from '../services/classroom-runtime-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ensureTestSchema } from './helpers/test-schema.js';

/**
 * Issue #109: 学生端「当前进行中的课堂会话」接口 `GET /api/student/active-session`。
 *
 * 锁死四件事：
 *   1. 学生只能看到自己所在班级的会话（跨班会话不可见）；
 *   2. 已归档（ARCHIVED_REPORT）的会话不算「进行中」；
 *   3. 学生身份强制使用会话内的 studentId —— 客户端传 ?studentId= 不能越权；
 *   4. 教师/管理员可传 studentId 用于模拟学生视角。
 */
describe('学生端进行中课堂会话接口（Issue #109）', () => {
  let server: Server;
  let baseUrl: string;
  const db = kernelContainer.db as any;

  const lessonId = 'les-stu-active-0001';
  const otherLessonId = 'les-stu-active-0002';
  const classId = 'cls-stu-active-0001';
  const otherClassId = 'cls-stu-active-0002';
  const teacherId = 'usr-stu-active-teacher';
  const studentId = 'stu-active-0001';
  const otherStudentId = 'stu-active-0002';
  const studentToken = 'tok-stu-active-0001';
  const otherStudentToken = 'tok-stu-active-0002';
  const teacherToken = 'tok-stu-active-teacher';

  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

  const getActive = (token?: string, query = '') =>
    fetch(`${baseUrl}/api/student/active-session${query}`, {
      headers: token ? cookie(token) : {},
    });

  beforeAll(async () => {
    ensureTestSchema();

    const app = express();
    app.use(express.json());
    const classroomService = new ClassroomRuntimeService(db);
    registerClassroomRoutes({ app, io: undefined } as any, classroomService);

    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const now = Date.now();
    const insUser = db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insUser.run(teacherId, 'stu_active_teacher', 'x', 'teacher', '会话接口教师', now);

    const insSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    const exp = now + 3600_000;
    insSession.run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'stu_active_teacher' }),
      now,
      exp,
    );
    insSession.run(
      studentToken,
      JSON.stringify({ userId: studentId, studentId, role: 'student', username: 'stu_active_1' }),
      now,
      exp,
    );
    insSession.run(
      otherStudentToken,
      JSON.stringify({ userId: otherStudentId, studentId: otherStudentId, role: 'student', username: 'stu_active_2' }),
      now,
      exp,
    );

    db.prepare('INSERT OR REPLACE INTO classes (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)').run(
      classId,
      '会话接口班',
      teacherId,
      now,
    );
    db.prepare('INSERT OR REPLACE INTO classes (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)').run(
      otherClassId,
      '另一个班',
      teacherId,
      now,
    );
    db.prepare('INSERT OR REPLACE INTO lessons (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      lessonId,
      '进行中的课',
      now,
      now,
    );
    db.prepare('INSERT OR REPLACE INTO lessons (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      otherLessonId,
      '别的班的课',
      now,
      now,
    );

    for (const [id, num] of [
      [studentId, 'STU_ACTIVE_1'],
      [otherStudentId, 'STU_ACTIVE_2'],
    ] as const) {
      db.prepare('INSERT OR REPLACE INTO students (id, name, student_number, created_at) VALUES (?, ?, ?, ?)').run(
        id,
        id,
        num,
        now,
      );
    }
    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      classId,
      studentId,
      now,
    );
    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      otherClassId,
      otherStudentId,
      now,
    );

    db.prepare('DELETE FROM classroom_sessions WHERE lesson_id IN (?, ?)').run(lessonId, otherLessonId);
    const insClassroomSession = db.prepare(
      `INSERT INTO classroom_sessions (id, lesson_id, class_id, teacher_id, stage, started_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    // 本班进行中
    insClassroomSession.run('sess-stu-active-1', lessonId, classId, teacherId, 'IN_CLASS_TEACHING', now, now);
    // 异班进行中（本班学生不可见）
    insClassroomSession.run(
      'sess-stu-active-other',
      otherLessonId,
      otherClassId,
      teacherId,
      'IN_CLASS_TEACHING',
      now,
      now,
    );
  });

  afterAll(async () => {
    db.prepare('DELETE FROM classroom_sessions WHERE lesson_id IN (?, ?)').run(lessonId, otherLessonId);
    db.prepare('DELETE FROM class_students WHERE student_id IN (?, ?)').run(studentId, otherStudentId);
    db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(studentId, otherStudentId);
    db.prepare('DELETE FROM lessons WHERE id IN (?, ?)').run(lessonId, otherLessonId);
    db.prepare('DELETE FROM classes WHERE id IN (?, ?)').run(classId, otherClassId);
    db.prepare('DELETE FROM users WHERE id = ?').run(teacherId);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?)').run(studentToken, otherStudentToken, teacherToken);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('学生只能看到自己班级进行中的会话（含课程名/班级/阶段）', async () => {
    const res = await getActive(studentToken);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.activeSession).toMatchObject({
      lessonId,
      lessonTitle: '进行中的课',
      classId,
      className: '会话接口班',
      stage: 'IN_CLASS_TEACHING',
    });
    // 异班会话不可见
    expect(body.activeSession.lessonId).not.toBe(otherLessonId);
  });

  it('学生身份忽略客户端 ?studentId= 越权参数', async () => {
    // 学生甲试图查询学生乙（异班）的会话 → 仍只返回自己的
    const res = await getActive(studentToken, `?studentId=${encodeURIComponent(otherStudentId)}`);
    const body: any = await res.json();
    expect(body.activeSession.lessonId).toBe(lessonId);
    expect(body.activeSession.classId).toBe(classId);
  });

  it('异班学生看不到本班会话', async () => {
    const res = await getActive(otherStudentToken);
    const body: any = await res.json();
    expect(body.activeSession.lessonId).toBe(otherLessonId);
    expect(body.activeSession.classId).toBe(otherClassId);
  });

  it('会话归档后不再返回（进行中入口自动消失）', async () => {
    db.prepare("UPDATE classroom_sessions SET stage = 'ARCHIVED_REPORT' WHERE id = ?").run('sess-stu-active-1');
    try {
      const res = await getActive(studentToken);
      const body: any = await res.json();
      expect(body.activeSession).toBeNull();
    } finally {
      db.prepare("UPDATE classroom_sessions SET stage = 'IN_CLASS_TEACHING' WHERE id = ?").run('sess-stu-active-1');
    }
  });

  it('教师可传 studentId 模拟学生视角查询', async () => {
    const res = await getActive(teacherToken, `?studentId=${encodeURIComponent(otherStudentId)}`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.activeSession.classId).toBe(otherClassId);
  });

  it('未登录返回 401；无 studentId 的教师请求返回 400', async () => {
    const anon = await getActive();
    expect(anon.status).toBe(401);

    const teacherNoId = await getActive(teacherToken);
    expect(teacherNoId.status).toBe(400);
  });
});
