import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerClassroomRoutes } from '../routes/classroom.js';
import { ClassroomRuntimeService } from '../services/classroom-runtime-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ensureTestSchema } from './helpers/test-schema.js';

/**
 * 进行中课堂拒绝换班：init / stage / teaching-mode 都不能改掉已绑定班级。
 * 归档之后同一课节可以开一节新会话并绑定另一个班。
 */
describe('进行中课堂班级锁定', () => {
  let server: Server;
  let baseUrl: string;

  const lessonId = 'les-class-lock-http';
  const classA = 'cls-lock-a';
  const classB = 'cls-lock-b';
  const teacherId = 'usr-class-lock-teacher';
  const teacherToken = 'tok-class-lock-teacher';
  const db = kernelContainer.db;

  const cookie = { Cookie: `edu_os_token=${teacherToken}`, 'Content-Type': 'application/json' };
  const post = (path: string, body: Record<string, unknown>) =>
    fetch(`${baseUrl}${path}`, { method: 'POST', headers: cookie, body: JSON.stringify(body) });
  const put = (path: string, body: Record<string, unknown>) =>
    fetch(`${baseUrl}${path}`, { method: 'PUT', headers: cookie, body: JSON.stringify(body) });

  const boundClass = () =>
    (
      db
        .prepare(
          `SELECT class_id FROM classroom_sessions
           WHERE lesson_id = ? AND stage != 'ARCHIVED_REPORT'
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(lessonId) as { class_id: string } | undefined
    )?.class_id;

  beforeAll(async () => {
    ensureTestSchema();
    const app = express();
    app.use(express.json());
    registerClassroomRoutes({ app, io: undefined } as any, new ClassroomRuntimeService(db));
    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const now = Date.now();
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(teacherId, 'class_lock_teacher', '班级锁定教师', 'hash', 'teacher', now);
    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(lessonId, '班级锁定课节', teacherId, now, now);
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'class_lock_teacher', name: '班级锁定教师' }),
      now,
      now + 86400000,
    );
    for (const id of [classA, classB]) {
      db.prepare('INSERT OR REPLACE INTO classes (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)').run(
        id,
        id,
        teacherId,
        now,
      );
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM classes WHERE id IN (?, ?)').run(classA, classB);
    db.prepare('DELETE FROM client_sessions WHERE id = ?').run(teacherToken);
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    db.prepare('DELETE FROM users WHERE id = ?').run(teacherId);
  });

  it('init、阶段推进和教学模式接口都不能改掉进行中会话的班级', async () => {
    const initA = await post(`/api/classroom/sessions/${lessonId}/init`, { classId: classA });
    expect(initA.status).toBe(200);
    expect(boundClass()).toBe(classA);

    const preClassSwap = await post(`/api/classroom/sessions/${lessonId}/init`, { classId: classB });
    expect(preClassSwap.status).toBe(200);
    expect(boundClass()).toBe(classB);

    const back = await post(`/api/classroom/sessions/${lessonId}/init`, { classId: classA });
    expect(back.status).toBe(200);

    const start = await post(`/api/classroom/sessions/${lessonId}/stage`, {
      stage: 'IN_CLASS_TEACHING',
      classId: classA,
    });
    expect(start.status).toBe(200);

    const initSwap = await post(`/api/classroom/sessions/${lessonId}/init`, { classId: classB });
    expect(initSwap.status).toBe(409);
    const initBody = await initSwap.json();
    expect(String(initBody.error)).toContain('不能更换班级');
    expect(boundClass()).toBe(classA);

    const stageSwap = await post(`/api/classroom/sessions/${lessonId}/stage`, {
      stage: 'WRAP_UP_EXIT_TICKET',
      classId: classB,
    });
    expect(stageSwap.status).toBe(409);
    expect(boundClass()).toBe(classA);

    const modeSwap = await put(`/api/classroom/sessions/${lessonId}/teaching-mode`, {
      teachingModeId: 'lecture',
      classId: classB,
    });
    expect(modeSwap.status).toBe(409);
    expect(boundClass()).toBe(classA);

    const wrap = await post(`/api/classroom/sessions/${lessonId}/stage`, {
      stage: 'WRAP_UP_EXIT_TICKET',
      classId: classA,
    });
    expect(wrap.status).toBe(200);
    const archived = await post(`/api/classroom/sessions/${lessonId}/stage`, {
      stage: 'ARCHIVED_REPORT',
      classId: classA,
    });
    expect(archived.status).toBe(200);

    const next = await post(`/api/classroom/sessions/${lessonId}/init`, { classId: classB });
    expect(next.status).toBe(200);
    expect(boundClass()).toBe(classB);
  });
});
