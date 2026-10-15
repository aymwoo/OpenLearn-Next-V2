/**
 * 课节进度改为一次聚合后，JSON 字段与手算最高分一致。
 * 班级仪表盘的 performance 只保留已有提交，不再展开作业×学生空单元格。
 * 迁移 025 可重复执行。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { registerRosterRoutes } from '../routes/roster.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { loadMigrationsFromDirectory, runMigrations } from '../utils/migrate.js';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

describe('迁移 025 学生提交与课节索引', () => {
  it('在已有表上应用两次不报错，且两个索引都在', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE assignments (
        id TEXT PRIMARY KEY,
        class_id TEXT NOT NULL,
        lesson_id TEXT,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE assignment_submissions (
        assignment_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        content TEXT,
        score INTEGER,
        submitted_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'submitted',
        PRIMARY KEY (assignment_id, student_id)
      );
    `);
    const only = loadMigrationsFromDirectory(migrationsDir).filter((m) => m.name.startsWith('025_'));
    expect(only).toHaveLength(1);
    expect(() => runMigrations(db, only)).not.toThrow();
    expect(() => runMigrations(db, only)).not.toThrow();
    const names = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (?, ?) ORDER BY name`)
      .all('idx_assignment_submissions_student', 'idx_assignments_lesson') as { name: string }[];
    expect(names.map((row) => row.name)).toEqual(['idx_assignment_submissions_student', 'idx_assignments_lesson']);
    db.close();
  });
});

describe('课节进度聚合与班级仪表盘', () => {
  let server: Server;
  let baseUrl: string;
  const db = kernelContainer.db as any;

  const teacherId = 'usr-prog-teacher';
  const teacherToken = 'tok-prog-teacher';
  const classId = 'cls-prog-1';
  const lessonId = 'les-prog-1';
  const otherLessonId = 'les-prog-other';
  const studentA = 'stu-prog-a';
  const studentB = 'stu-prog-b';
  const asgLow = 'asg-prog-low';
  const asgHigh = 'asg-prog-high';
  const asgOther = 'asg-prog-other';
  const submittedAt = 1_700_000_000_000;
  const gradedAt = submittedAt + 2;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    registerRosterRoutes({
      app,
      io: undefined,
      loginLimiter: (_req: any, _res: any, next: any) => next(),
    } as any);
    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const now = Date.now();
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'prog_teacher' }),
      now,
      now + 60 * 60 * 1000,
    );
    db.prepare(
      `INSERT OR REPLACE INTO classes (id, name, description, created_at, owner_user_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(classId, '进度班', '', now, teacherId);
    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(lessonId, '第一节', '', now, now);
    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(otherLessonId, '另一节', '', now, now);
    const insertStudent = db.prepare(
      `INSERT OR REPLACE INTO students (id, student_number, name, email, password, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insertStudent.run(studentA, 'PROG-A', '甲', '', 'x', now);
    insertStudent.run(studentB, 'PROG-B', '乙', '', 'x', now);
    const enroll = db.prepare(
      'INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)',
    );
    enroll.run(classId, studentA, now);
    enroll.run(classId, studentB, now);
    const insertAsg = db.prepare(
      'INSERT OR REPLACE INTO assignments (id, class_id, lesson_id, title, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    insertAsg.run(asgLow, classId, lessonId, '小测低分', now);
    insertAsg.run(asgHigh, classId, lessonId, '小测高分', now + 1);
    insertAsg.run(asgOther, classId, otherLessonId, '另一课', now + 2);
    const insertSub = db.prepare(
      `INSERT OR REPLACE INTO assignment_submissions
        (assignment_id, student_id, content, score, feedback, submitted_at, graded_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertSub.run(asgLow, studentA, 'a', 40, null, submittedAt, null, 'submitted');
    insertSub.run(asgHigh, studentA, 'b', 90, 'good', submittedAt + 1, gradedAt, 'graded');
    insertSub.run(asgOther, studentA, 'c', 100, null, submittedAt, null, 'graded');
    db.prepare(
      `INSERT OR REPLACE INTO student_lesson_progress
        (student_id, lesson_id, completed, progress_percent, completed_segments, assigned_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(studentA, lessonId, 1, 80, '["seg-a"]', now);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.prepare('DELETE FROM assignment_submissions WHERE student_id IN (?, ?)').run(studentA, studentB);
    db.prepare('DELETE FROM assignments WHERE id IN (?, ?, ?)').run(asgLow, asgHigh, asgOther);
    db.prepare('DELETE FROM student_lesson_progress WHERE student_id IN (?, ?)').run(studentA, studentB);
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
    db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(studentA, studentB);
    db.prepare('DELETE FROM lessons WHERE id IN (?, ?)').run(lessonId, otherLessonId);
    db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    db.prepare('DELETE FROM client_sessions WHERE id = ?').run(teacherToken);
  });

  const get = (url: string) =>
    fetch(`${baseUrl}${url}`, { headers: { Cookie: `edu_os_token=${teacherToken}` } });

  it('课节进度 JSON 与手算最高分一致，另一课的 100 分不计入', async () => {
    const res = await get(`/api/classes/${classId}/lessons/${lessonId}/progress`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    const byStudent = new Map(rows.map((row) => [row.student_id, row]));
    expect(byStudent.get(studentA)).toEqual({
      student_id: studentA,
      progress_percent: 80,
      completed: 1,
      completed_segments: '["seg-a"]',
      quiz_score: 90,
    });
    expect(byStudent.get(studentB)).toEqual({
      student_id: studentB,
      progress_percent: 0,
      completed: 0,
      completed_segments: null,
      quiz_score: null,
    });
    expect(rows).toHaveLength(2);
  });

  it('仪表盘 performance 只含已提交行，字段与提交内容一致', async () => {
    const res = await get(`/api/classes/${classId}/dashboard`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      assignments: Array<{ id: string }>;
      performance: Array<Record<string, unknown>>;
      recentSubmissions: unknown[];
      rollcallStats: unknown[];
    };
    expect(body.assignments.map((row) => row.id).sort()).toEqual([asgHigh, asgLow, asgOther].sort());
    expect(body.recentSubmissions).toHaveLength(3);
    expect(Array.isArray(body.rollcallStats)).toBe(true);
    // 3 份作业 × 2 名学生本应是 6 个空单元格；只留下 3 条真实提交。
    expect(body.performance).toHaveLength(3);
    const high = body.performance.find((row) => row.assignment_id === asgHigh);
    expect(high).toEqual({
      assignment_id: asgHigh,
      assignment_title: '小测高分',
      student_id: studentA,
      student_name: '甲',
      score: 90,
      submission_status: 'graded',
      submitted_at: submittedAt + 1,
      graded_at: gradedAt,
      feedback: 'good',
    });
    expect(body.performance.some((row) => row.student_id === studentB)).toBe(false);
    expect(body.performance.some((row) => row.assignment_id === asgLow && row.score === 40)).toBe(true);
  });
});
