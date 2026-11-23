/**
 * P0-3：学案活动成绩同步到平台成绩册。
 *
 * 覆盖：单条同步、批量同步、幂等、越权拒绝、非本班学生跳过、审计 actor。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { registerLessonActivitiesRoutes } from '../../server/routes/lesson-activities.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import {
  createXueanSubmissionAdapter,
  ISubmissionRegistryToken,
  XUEAN_SUBMISSION_ADAPTER_ID,
} from '../../packages/core/submission-adapter/index.js';
import { GradingService } from '../services/grading-service.js';

type TestRow = { id: string; [key: string]: unknown };

function rid(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

async function fetchJson<T = TestRow>(url: string, options?: RequestInit) {
  const r = await fetch(url, options);
  const text = await r.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: r.status, body: body as T };
}

describe('学案成绩同步到成绩册 (P0-3)', () => {
  const db = kernelContainer.db;
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  let teacherId: string;
  let teacherToken: string;
  let teacherCookie: Record<string, string>;
  let otherTeacherId: string;
  let otherTeacherToken: string;
  let otherTeacherCookie: Record<string, string>;
  let classId: string;
  let lessonId: string;
  let activityId: string;
  let activity2Id: string;
  let studentId: string;
  let outsiderId: string;
  const academicYear = '2025-2026';

  beforeAll(async () => {
    const now = Date.now();
    const expiresAt = now + 60 * 60 * 1000;

    teacherId = rid('teach');
    teacherToken = rid('tok_t');
    otherTeacherId = rid('teach_o');
    otherTeacherToken = rid('tok_o');
    classId = rid('cls');
    lessonId = rid('les');
    studentId = rid('stu');
    outsiderId = rid('stu_out');
    teacherCookie = { Cookie: `edu_os_token=${teacherToken}` };
    otherTeacherCookie = { Cookie: `edu_os_token=${otherTeacherToken}` };

    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(teacherId, `teacher_${teacherId.slice(-6)}`, 'hash', 'teacher', '同步测试教师', now);
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(otherTeacherId, `teacher_${otherTeacherId.slice(-6)}`, 'hash', 'teacher', '其他教师', now);
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(studentId, `student_${studentId.slice(-6)}`, 'hash', 'student', '同步测试学生', now);
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(outsiderId, `student_${outsiderId.slice(-6)}`, 'hash', 'student', '外班学生', now);
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(teacherToken, JSON.stringify({ userId: teacherId, role: 'teacher', username: 't' }), now, expiresAt);
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      otherTeacherToken,
      JSON.stringify({ userId: otherTeacherId, role: 'teacher', username: 'o' }),
      now,
      expiresAt,
    );

    db.prepare('INSERT OR REPLACE INTO classes (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)').run(
      classId,
      '同步测试班',
      teacherId,
      now,
    );
    // 学期总评从 students 表读学生档案，测试里补一条真实档案行。
    db.prepare('INSERT OR REPLACE INTO students (id, student_number, name, created_at) VALUES (?, ?, ?, ?)').run(
      studentId,
      `NO_${studentId.slice(-6)}`,
      '同步测试学生',
      now,
    );
    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      classId,
      studentId,
      now,
    );
    db.prepare(
      'INSERT INTO lessons (id, title, content, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(lessonId, '同步测试课时', 'content', teacherId, now, now);
    db.prepare(
      'INSERT OR REPLACE INTO schedules (id, class_id, lesson_id, scheduled_date, time_slot, created_at, academic_year) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(rid('sch'), classId, lessonId, '2026-11-24', 'period1', now, academicYear);

    // 确保 xuean 适配器已注册（插件恢复可能已注册，重复时忽略）。
    const registry = await kernelContainer.serviceRegistry.resolve(ISubmissionRegistryToken);
    const registered = registry.register(createXueanSubmissionAdapter(db));
    if (!registered.ok && registered.code !== 'ADAPTER_EXISTS') {
      throw new Error(`register xuean adapter failed: ${registered.message}`);
    }

    app = express();
    app.use(express.json());
    registerLessonActivitiesRoutes({ app } as Parameters<typeof registerLessonActivitiesRoutes>[0]);
    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });

    // 通过真实路由创建两个活动，避免依赖表结构细节。
    const a1 = await fetchJson(`${baseUrl}/api/lessons/${lessonId}/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...teacherCookie },
      body: JSON.stringify({ type: 'submission', title: '作品一' }),
    });
    const a2 = await fetchJson(`${baseUrl}/api/lessons/${lessonId}/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...teacherCookie },
      body: JSON.stringify({ type: 'reading', title: '阅读二' }),
    });
    activityId = a1.body.id;
    activity2Id = a2.body.id;

    const insertProgress = db.prepare(
      `INSERT OR REPLACE INTO activity_progress
        (activity_id, student_id, status, progress_percent, verified, score, graded_at, last_activity_at)
       VALUES (?, ?, 'graded', 100, 1, ?, ?, ?)`,
    );
    insertProgress.run(activityId, studentId, 80, now, now);
    insertProgress.run(activity2Id, studentId, 95, now, now);
    // 外班学生也有一条已批阅记录，但不应被写进本班成绩。
    insertProgress.run(activityId, outsiderId, 100, now, now);
  });

  afterAll(async () => {
    const assignmentIds = db
      .prepare("SELECT id FROM assignments WHERE id LIKE 'xuean-activity:%' AND lesson_id = ?")
      .all(lessonId) as Array<{ id: string }>;
    for (const a of assignmentIds) {
      db.prepare('DELETE FROM assignment_grade_history WHERE assignment_id = ?').run(a.id);
      db.prepare('DELETE FROM assignment_submissions WHERE assignment_id = ?').run(a.id);
      db.prepare('DELETE FROM assignments WHERE id = ?').run(a.id);
    }
    db.prepare('DELETE FROM activity_progress WHERE activity_id IN (?, ?)').run(activityId, activity2Id);
    db.prepare('DELETE FROM lesson_activities WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM schedules WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
    db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
    db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?)').run(teacherToken, otherTeacherToken);
    db.prepare('DELETE FROM users WHERE id IN (?, ?, ?, ?)').run(teacherId, otherTeacherId, studentId, outsiderId);
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  it('单条同步：写入 xuean-activity 成绩项，记录教师 actor，外班学生不写入', async () => {
    const res = await fetchJson(`${baseUrl}/api/lessons/${lessonId}/activities/${activityId}/sync-grade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...teacherCookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(res.body.synced).toBe(1);

    const assignmentId = `xuean-activity:${activityId}`;
    const assignment = db.prepare('SELECT academic_year FROM assignments WHERE id = ?').get(assignmentId) as TestRow;
    expect(assignment.academic_year).toBe(academicYear);

    const submission = db
      .prepare(
        'SELECT score, status, source, graded_by, academic_year FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?',
      )
      .get(assignmentId, studentId) as TestRow;
    expect(submission.score).toBe(80);
    expect(submission.status).toBe('graded');
    expect(submission.source).toBe('manual');
    expect(submission.graded_by).toBe(`user:${teacherId}:teacher`);
    expect(submission.academic_year).toBe(academicYear);

    const history = db
      .prepare(
        'SELECT actor_id, actor_role, new_score FROM assignment_grade_history WHERE assignment_id = ? AND student_id = ?',
      )
      .get(assignmentId, studentId) as TestRow;
    expect(history.actor_id).toBe(`user:${teacherId}:teacher`);
    expect(history.actor_role).toBe('teacher');
    expect(history.new_score).toBe(80);

    // 外班学生不在 class_students，不能被同步。
    const outsider = db
      .prepare('SELECT 1 FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
      .get(assignmentId, outsiderId);
    expect(outsider).toBeUndefined();
  });

  it('重复同步幂等：不新增成绩行，也不重复写审计历史', async () => {
    const assignmentId = `xuean-activity:${activityId}`;
    const before = db
      .prepare('SELECT COUNT(*) AS n FROM assignment_submissions WHERE assignment_id = ?')
      .get(assignmentId) as { n: number };
    const beforeHistory = db
      .prepare('SELECT COUNT(*) AS n FROM assignment_grade_history WHERE assignment_id = ?')
      .get(assignmentId) as { n: number };

    const res = await fetchJson(`${baseUrl}/api/lessons/${lessonId}/activities/${activityId}/sync-grade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...teacherCookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(res.body.synced).toBe(1);

    const after = db
      .prepare('SELECT COUNT(*) AS n FROM assignment_submissions WHERE assignment_id = ?')
      .get(assignmentId) as { n: number };
    const afterHistory = db
      .prepare('SELECT COUNT(*) AS n FROM assignment_grade_history WHERE assignment_id = ?')
      .get(assignmentId) as { n: number };
    expect(after.n).toBe(before.n);
    expect(afterHistory.n).toBe(beforeHistory.n);
  });

  it('批量同步：一次写入课节下所有已批阅活动', async () => {
    const res = await fetchJson(`${baseUrl}/api/lessons/${lessonId}/activity-grades/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...teacherCookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(res.body.synced).toBeGreaterThanOrEqual(2);

    const rows = db
      .prepare(
        `SELECT assignment_id, score FROM assignment_submissions
          WHERE student_id = ? AND assignment_id IN (?, ?)`,
      )
      .all(studentId, `xuean-activity:${activityId}`, `xuean-activity:${activity2Id}`) as TestRow[];
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.score).sort()).toEqual([80, 95]);
  });

  it('同步后的学案成绩进入按学年计算的学期作业分', () => {
    const grading = new GradingService(kernelContainer.db);
    const result = grading.computeSemesterGrades(classId, '2025 秋', academicYear);
    const row = result.students.find((s) => s.studentId === studentId);
    expect(row).toBeDefined();
    // 本学年 2 个学案作业：80 与 95 → (80 + 95) / 2 = 88（四舍五入）
    expect(row!.assignmentScore).toBe(88);
  });

  it('非课节教师不能同步', async () => {
    const res = await fetchJson(`${baseUrl}/api/lesson-activities/${activityId}/sync-grade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...otherTeacherCookie },
      body: JSON.stringify({ classId }),
    });
    expect(res.status).toBe(403);
  });
});
