import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerLessonActivityRoutes } from '../routes/lesson-activities.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { v7 as uuidv7 } from 'uuid';

describe('学案活动 API（IKVO15 P0）', () => {
  let server: Server;
  let baseUrl: string;
  const db = kernelContainer.db;

  const suffix = uuidv7().slice(0, 8);
  const teacherId = `usr_lact_t_${suffix}`;
  const otherTeacherId = `usr_lact_ot_${suffix}`;
  const studentId = `stu_lact_s_${suffix}`;
  const teacherToken = `tok_lact_t_${suffix}`;
  const otherTeacherToken = `tok_lact_ot_${suffix}`;
  const studentToken = `tok_lact_s_${suffix}`;
  const lessonId = `les_lact_${suffix}`;
  const classId = `cls_lact_${suffix}`;

  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

  const cleanup = () => {
    db.prepare(
      'DELETE FROM activity_progress WHERE activity_id IN (SELECT id FROM lesson_activities WHERE lesson_id = ?)',
    ).run(lessonId);
    db.prepare('DELETE FROM lesson_activities WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM lesson_activity_blocks WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM student_lesson_progress WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM schedules WHERE class_id = ?').run(classId);
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
    db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?)').run(teacherToken, otherTeacherToken, studentToken);
    db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(teacherId, otherTeacherId);
  };

  beforeAll(async () => {
    cleanup();
    const now = Date.now();
    const exp = now + 3600_000;
    db.prepare('INSERT INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      teacherId,
      `lact_t_${suffix}`,
      'hash',
      'teacher',
      '编排教师',
      now,
    );
    db.prepare('INSERT INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      otherTeacherId,
      `lact_ot_${suffix}`,
      'hash',
      'teacher',
      '其他教师',
      now,
    );
    db.prepare('INSERT INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)').run(
      studentId,
      `S${suffix}`,
      '学案学生',
      '',
      now,
    );
    db.prepare('INSERT INTO classes (id, name, description, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)').run(
      classId,
      '学案班',
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
    ).run(lessonId, 'API 学案课', teacherId, now, now);
    // 让学生能看见该课：挂一条排课
    db.prepare(
      `INSERT INTO schedules (id, class_id, lesson_id, scheduled_date, time_slot, status, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `sch_lact_${suffix}`,
      classId,
      lessonId,
      new Date().toISOString().slice(0, 10),
      '09:00-10:00',
      'scheduled',
      '',
      now,
    );

    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: `lact_t_${suffix}` }),
      now,
      exp,
    );
    insertSession.run(
      otherTeacherToken,
      JSON.stringify({ userId: otherTeacherId, role: 'teacher', username: `lact_ot_${suffix}` }),
      now,
      exp,
    );
    insertSession.run(
      studentToken,
      JSON.stringify({ userId: studentId, studentId, role: 'student', username: `lact_s_${suffix}` }),
      now,
      exp,
    );

    const app = express();
    app.use(express.json());
    registerLessonActivityRoutes({ app } as any);
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
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('教师可创建并发布阅读活动，学生自报后 verified 仍为 false', async () => {
    const created = await fetch(`${baseUrl}/api/lessons/${lessonId}/activities`, {
      method: 'POST',
      headers: { ...cookie(teacherToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'reading',
        title: '阅读任务',
        config: { body: '请阅读全文' },
        visible: true,
        required: true,
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    const activityId = createdBody.activity.id as string;

    const studentPack = await fetch(`${baseUrl}/api/lessons/${lessonId}/activity-pack`, {
      headers: cookie(studentToken),
    });
    expect(studentPack.status).toBe(200);
    const packBody = await studentPack.json();
    expect(packBody.role).toBe('student');
    expect(packBody.pack.activities.some((item: { id: string }) => item.id === activityId)).toBe(true);

    const reported = await fetch(`${baseUrl}/api/lessons/${lessonId}/activities/${activityId}/self-report`, {
      method: 'POST',
      headers: cookie(studentToken),
    });
    expect(reported.status).toBe(200);
    const reportedBody = await reported.json();
    expect(reportedBody.progress.status).toBe('submitted');
    expect(reportedBody.progress.verified).toBe(false);

    const otherTeacher = await fetch(`${baseUrl}/api/lessons/${lessonId}/activities`, {
      method: 'POST',
      headers: { ...cookie(otherTeacherToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'reading', title: '越权写入' }),
    });
    expect(otherTeacher.status).toBeGreaterThanOrEqual(403);
  });

  it('未登录无法读取学案包', async () => {
    const res = await fetch(`${baseUrl}/api/lessons/${lessonId}/activity-pack`);
    expect(res.status).toBe(401);
  });
});
