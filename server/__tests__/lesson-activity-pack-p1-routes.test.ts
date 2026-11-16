import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { v7 as uuidv7 } from 'uuid';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { registerLessonActivityRoutes } from '../routes/lesson-activities.js';
import { registerLessonActivityPackP1Routes } from '../routes/lesson-activity-pack-p1.js';
import { LessonActivityService } from '../services/lesson-activity-service.js';

describe('学案包 P1 路由', () => {
  let server: Server;
  let baseUrl: string;
  const db = kernelContainer.db;
  const suffix = uuidv7().slice(0, 8);
  const teacherId = `usr_p1r_t_${suffix}`;
  const studentId = `stu_p1r_s_${suffix}`;
  const teacherToken = `tok_p1r_t_${suffix}`;
  const studentToken = `tok_p1r_s_${suffix}`;
  const lessonId = `les_p1r_${suffix}`;
  const classId = `cls_p1r_${suffix}`;
  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

  const cleanup = () => {
    db.prepare('DELETE FROM activity_nudges WHERE lesson_id = ?').run(lessonId);
    db.prepare(
      'DELETE FROM activity_progress WHERE activity_id IN (SELECT id FROM lesson_activities WHERE lesson_id = ?)',
    ).run(lessonId);
    db.prepare('DELETE FROM lesson_activities WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM schedules WHERE class_id = ?').run(classId);
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
    db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?)').run(teacherToken, studentToken);
    db.prepare('DELETE FROM users WHERE id = ?').run(teacherId);
  };

  beforeAll(async () => {
    cleanup();
    const now = Date.now();
    const exp = now + 3600_000;
    db.prepare('INSERT INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      teacherId,
      `p1r_t_${suffix}`,
      'hash',
      'teacher',
      '教师',
      now,
    );
    db.prepare('INSERT INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)').run(
      studentId,
      `S${suffix}`,
      '学生',
      '',
      now,
    );
    db.prepare('INSERT INTO classes (id, name, description, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)').run(
      classId,
      '班',
      '',
      teacherId,
      now,
    );
    db.prepare('INSERT INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      classId,
      studentId,
      now,
    );
    db.prepare(
      `INSERT INTO lessons (id, title, content, timeline, progress_mode, creator_id, created_at, updated_at)
       VALUES (?, ?, '', '[]', 'manual', ?, ?, ?)`,
    ).run(lessonId, 'P1 路由课', teacherId, now, now);
    db.prepare(
      `INSERT INTO schedules (id, class_id, lesson_id, scheduled_date, time_slot, status, notes, created_at)
       VALUES (?, ?, ?, ?, '09:00-10:00', 'scheduled', '', ?)`,
    ).run(`sch_${suffix}`, classId, lessonId, '2026-11-16', now);
    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: `p1r_t_${suffix}` }),
      now,
      exp,
    );
    insertSession.run(
      studentToken,
      JSON.stringify({ userId: studentId, studentId, role: 'student', username: `p1r_s_${suffix}` }),
      now,
      exp,
    );

    new LessonActivityService(db).createActivity(lessonId, {
      type: 'reading',
      title: '阅读',
      config: { body: '正文' },
      visible: true,
      required: true,
    });

    const app = express();
    app.use(express.json({ limit: '4mb' }));
    registerLessonActivityRoutes({ app } as any);
    registerLessonActivityPackP1Routes({ app } as any);
    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    cleanup();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it('教师可获取预览包且不会写入 preview 进度', async () => {
    const res = await fetch(`${baseUrl}/api/lessons/${lessonId}/activity-pack/preview`, {
      headers: cookie(teacherToken),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pack.preview).toBe(true);
    expect(body.pack.previewKind).toBe('activity-pack-student');
    const count = db.prepare("SELECT COUNT(*) AS n FROM activity_progress WHERE student_id = 'preview'").get() as {
      n: number;
    };
    expect(count.n).toBe(0);
  });

  it('学生不能访问教师预览接口', async () => {
    const res = await fetch(`${baseUrl}/api/lessons/${lessonId}/activity-pack/preview`, {
      headers: cookie(studentToken),
    });
    expect(res.status).toBe(403);
  });

  it('教师可导出学案包 zip', async () => {
    const res = await fetch(`${baseUrl}/api/lessons/${lessonId}/activity-pack/export`, {
      headers: cookie(teacherToken),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/zip');
  });
});
