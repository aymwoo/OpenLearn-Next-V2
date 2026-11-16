/**
 * Issue IKVO15 · P0 学案式课时包路由集成测试。
 * 用微型 Express + kernelContainer + client_sessions 模拟真实服务。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { registerLessonActivitiesRoutes } from '../../server/routes/lesson-activities.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

type TestRow = { id: string; [key: string]: unknown };
type XueanResponse = {
  lessonId: string;
  blocks: TestRow[];
  activities: TestRow[];
  progressByActivity: Record<string, TestRow>;
};
type ProgressPanelResponse = {
  totalStudents: number;
  activities: { students: TestRow[]; summary: { total: number } }[];
};

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

describe('学案式课时包路由 (IKVO15 · P0)', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const db = kernelContainer.db;
  let teacherId: string;
  let teacherToken: string;
  let teacherCookie: Record<string, string>;
  let studentId: string;
  let studentToken: string;
  let studentCookie: Record<string, string>;
  let lessonId: string;
  let classId: string;

  beforeAll(async () => {
    const now = Date.now();
    const expiresAt = now + 60 * 60 * 1000;

    // 用户
    teacherId = rid('teach');
    teacherToken = rid('tok_t');
    studentId = rid('stu');
    studentToken = rid('tok_s');
    classId = rid('cls');
    lessonId = rid('les');
    teacherCookie = { Cookie: `edu_os_token=${teacherToken}` };
    studentCookie = { Cookie: `edu_os_token=${studentToken}` };

    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(teacherId, `teacher_${teacherId.slice(-6)}`, 'hash', 'teacher', '测试教师', now);
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(studentId, `student_${studentId.slice(-6)}`, 'hash', 'student', '测试学生', now);
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(teacherToken, JSON.stringify({ userId: teacherId, role: 'teacher', username: 't' }), now, expiresAt);
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      studentToken,
      JSON.stringify({ userId: studentId, role: 'student', username: 's', studentId }),
      now,
      expiresAt,
    );

    // 班级 + 课时 + 排课（让进度面板能找到学生）
    db.prepare('INSERT OR REPLACE INTO classes (id, name, class_passcode, created_at) VALUES (?, ?, ?, ?)').run(
      classId,
      '测试班',
      '1234',
      now,
    );
    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      classId,
      studentId,
      now,
    );
    db.prepare(
      'INSERT INTO lessons (id, title, content, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(lessonId, '学案测试课时', 'content', teacherId, now, now);
    db.prepare(
      'INSERT OR REPLACE INTO schedules (id, class_id, lesson_id, scheduled_date, time_slot, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(rid('sch'), classId, lessonId, '2026-11-16', 'period1', now);

    app = express();
    app.use(express.json());
    registerLessonActivitiesRoutes({ app } as Parameters<typeof registerLessonActivitiesRoutes>[0]);
    app.all('/api/*', (_req, res) => res.status(404).json({ error: 'not found' }));

    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    db.prepare('DELETE FROM lesson_activities WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM lesson_activity_blocks WHERE lesson_id = ?').run(lessonId);
    db.prepare(
      'DELETE FROM activity_progress WHERE activity_id IN (SELECT id FROM lesson_activities WHERE lesson_id = ?)',
    ).run(lessonId);
    db.prepare('DELETE FROM schedules WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
    db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?)').run(teacherToken, studentToken);
    db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(teacherId, studentId);
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  // ── 活动 CRUD ──────────────────────────────────────────────────────
  describe('活动 CRUD', () => {
    it('教师新增活动成功', async () => {
      const res = await fetchJson(`${baseUrl}/api/lessons/${lessonId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({ type: 'reading', title: '读课文', config: { page: 5 }, required: true }),
      });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeTruthy();
      expect(res.body.lesson_id).toBe(lessonId);
      expect(res.body.order_index).toBe(0);
      expect(res.body.type).toBe('reading');
    });

    let activityId: string;
    it('教师再新增一个活动，order_index 自动 +1', async () => {
      const res = await fetchJson(`${baseUrl}/api/lessons/${lessonId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({ type: 'submission', title: '提交作品', submissionType: 'file' }),
      });
      expect(res.status).toBe(201);
      activityId = res.body.id;
      expect(res.body.order_index).toBe(1);
    });

    it('教师更新活动', async () => {
      const res = await fetchJson(`${baseUrl}/api/activities/${activityId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({ title: '提交最终作品', dueAt: 9999 }),
      });
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('提交最终作品');
      expect(res.body.due_at).toBe(9999);
    });

    it('批量重排', async () => {
      const list = await fetchJson<TestRow[]>(`${baseUrl}/api/lessons/${lessonId}/activities`, {
        headers: teacherCookie,
      });
      expect(list.status).toBe(200);
      const ids = list.body.map((a) => a.id);
      const reversed = [...ids].reverse();
      const res = await fetchJson<TestRow[]>(`${baseUrl}/api/lessons/${lessonId}/activities/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({ ids: reversed }),
      });
      expect(res.status).toBe(200);
      expect(res.body.map((r) => r.id)).toEqual(reversed);
    });

    it('非法 type 被拒', async () => {
      const res = await fetchJson(`${baseUrl}/api/lessons/${lessonId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({ type: 'bogus', title: 'X' }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ── 学案首页块 ─────────────────────────────────────────────────────
  describe('学案首页 blocks', () => {
    it('教师新增 learning_goals 块', async () => {
      const res = await fetchJson(`${baseUrl}/api/lessons/${lessonId}/blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({ blockType: 'learning_goals', content: { goals: ['G1'] } }),
      });
      expect(res.status).toBe(201);
      expect(res.body.block_type).toBe('learning_goals');
    });

    it('新增 free_html 块', async () => {
      const res = await fetchJson(`${baseUrl}/api/lessons/${lessonId}/blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({ blockType: 'free_html', content: '<p>自由内容</p>' }),
      });
      expect(res.status).toBe(201);
      expect(res.body.order_index).toBe(1);
    });

    it('学生可读', async () => {
      const res = await fetchJson<TestRow[]>(`${baseUrl}/api/lessons/${lessonId}/blocks`, { headers: studentCookie });
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
    });
  });

  // ── 学生学案聚合 ───────────────────────────────────────────────────
  describe('学生学案聚合 + 进度上报', () => {
    it('学生能读到学案聚合', async () => {
      const res = await fetchJson<XueanResponse>(`${baseUrl}/api/lessons/${lessonId}/xuean`, {
        headers: studentCookie,
      });
      expect(res.status).toBe(200);
      expect(res.body.lessonId).toBe(lessonId);
      expect(res.body.blocks.length).toBeGreaterThan(0);
      expect(res.body.activities.length).toBeGreaterThan(0);
      expect(res.body.progressByActivity).toBeTruthy();
    });

    it('学生自报进度', async () => {
      const list = await fetchJson<TestRow[]>(`${baseUrl}/api/lessons/${lessonId}/activities`, {
        headers: teacherCookie,
      });
      const first = list.body[0];
      const res = await fetchJson(`${baseUrl}/api/activities/${first.id}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...studentCookie },
        body: JSON.stringify({ status: 'in_progress', progressPercent: 50 }),
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('in_progress');
      expect(res.body.progress_percent).toBe(50);
      expect(res.body.verified).toBe(0);
    });

    it('学生提交作业内容写入 submission_json', async () => {
      const list = await fetchJson<TestRow[]>(`${baseUrl}/api/lessons/${lessonId}/activities`, {
        headers: teacherCookie,
      });
      const first = list.body[0];
      const res = await fetchJson(`${baseUrl}/api/activities/${first.id}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...studentCookie },
        body: JSON.stringify({ status: 'submitted', submission: { type: 'text', content: '我完成了第一章阅读' } }),
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('submitted');
      expect(res.body.submission_json).toBeTruthy();
      const parsed = JSON.parse(res.body.submission_json as string);
      expect(parsed.content).toBe('我完成了第一章阅读');
      expect(parsed.type).toBe('text');
    });

    it('学生提交 string 类型也能写入 submission_json', async () => {
      const list = await fetchJson<TestRow[]>(`${baseUrl}/api/lessons/${lessonId}/activities`, {
        headers: teacherCookie,
      });
      const second = list.body[1] ?? list.body[0];
      const res = await fetchJson(`${baseUrl}/api/activities/${second.id}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...studentCookie },
        body: JSON.stringify({ status: 'submitted', submission: '纯文本提交内容' }),
      });
      expect(res.status).toBe(200);
      expect(res.body.submission_json).toBeTruthy();
      const parsed = JSON.parse(res.body.submission_json as string);
      expect(parsed).toBe('纯文本提交内容');
    });

    it('学生不能写别人的进度', async () => {
      const list = await fetchJson<TestRow[]>(`${baseUrl}/api/lessons/${lessonId}/activities`, {
        headers: teacherCookie,
      });
      const first = list.body[0];
      const res = await fetchJson(`${baseUrl}/api/activities/${first.id}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...studentCookie },
        body: JSON.stringify({ studentId: 'totally_other', status: 'submitted' }),
      });
      expect(res.status).toBe(403);
    });
  });

  // ── 教师批阅 + 进度面板 ────────────────────────────────────────────
  describe('教师批阅 + 进度面板', () => {
    it('教师批阅置 verified=1', async () => {
      const list = await fetchJson<TestRow[]>(`${baseUrl}/api/lessons/${lessonId}/activities`, {
        headers: teacherCookie,
      });
      const first = list.body[0];
      const res = await fetchJson(`${baseUrl}/api/activities/${first.id}/progress/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({ studentId, status: 'graded', score: 95 }),
      });
      expect(res.status).toBe(200);
      expect(res.body.verified).toBe(1);
      expect(res.body.status).toBe('graded');
      expect(res.body.score).toBe(95);
    });

    it('进度面板聚合到活动 × 学生', async () => {
      const res = await fetchJson<ProgressPanelResponse>(`${baseUrl}/api/lessons/${lessonId}/activity-progress`, {
        headers: teacherCookie,
      });
      expect(res.status).toBe(200);
      expect(res.body.activities.length).toBeGreaterThan(0);
      const first = res.body.activities[0];
      expect(first.students.length).toBe(res.body.totalStudents);
      expect(first.summary.total).toBe(first.students.length);
    });

    it('学生不能访问教师进度面板', async () => {
      const res = await fetchJson(`${baseUrl}/api/lessons/${lessonId}/activity-progress`, { headers: studentCookie });
      expect([401, 403]).toContain(res.status);
    });
  });
});
