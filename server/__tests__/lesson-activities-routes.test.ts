/**
 * Issue IKVO15 · P0 学案式课时包路由集成测试。
 * 用微型 Express + kernelContainer + client_sessions 模拟真实服务。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { registerLessonActivitiesRoutes } from '../../server/routes/lesson-activities.js';
import { assessmentService } from '../services/assessment-service.js';
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
  let quizAssessmentId: string;
  let emptyAssessmentId: string;
  let otherTeacherId: string;
  let otherTeacherToken: string;
  let otherTeacherCookie: Record<string, string>;

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
    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, class_passcode, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(classId, '测试班', '1234', teacherId, now);
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

    // 用于「引用试卷」活动的试卷与越权教师
    otherTeacherId = rid('teach2');
    otherTeacherToken = rid('tok_t2');
    otherTeacherCookie = { Cookie: `edu_os_token=${otherTeacherToken}` };
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(otherTeacherId, `teacher_${otherTeacherId.slice(-6)}`, 'hash', 'teacher', '其他教师', now);
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      otherTeacherToken,
      JSON.stringify({ userId: otherTeacherId, role: 'teacher', username: 't2' }),
      now,
      expiresAt,
    );

    const created = assessmentService.createAssessment({
      ownerId: teacherId,
      kind: 'quiz',
      title: '随堂小测',
    });
    quizAssessmentId = created.id;
    assessmentService.replaceItems(quizAssessmentId, teacherId, [
      {
        type: 'single_choice',
        stem: '1 + 1 = ?',
        config: { options: ['1', '2', '3'] },
        answerKey: { index: 1 },
        maxScore: 5,
      },
    ]);
    emptyAssessmentId = assessmentService.createAssessment({
      ownerId: teacherId,
      kind: 'quiz',
      title: '空试卷',
    }).id;

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
    db.prepare(
      'DELETE FROM assessment_attempts WHERE assignment_id IN (SELECT id FROM assessment_assignments WHERE lesson_id = ?)',
    ).run(lessonId);
    db.prepare('DELETE FROM assessment_assignments WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM assessment_items WHERE assessment_id IN (?, ?)').run(quizAssessmentId, emptyAssessmentId);
    db.prepare('DELETE FROM assessments WHERE id IN (?, ?)').run(quizAssessmentId, emptyAssessmentId);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?)').run(teacherToken, studentToken, otherTeacherToken);
    db.prepare('DELETE FROM users WHERE id IN (?, ?, ?)').run(teacherId, studentId, otherTeacherId);
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

    it('旧路径 307 到 /api/lesson-activities/:id，新路径 200', async () => {
      const legacy = await fetch(`${baseUrl}/api/activities/${activityId}`, {
        method: 'PUT',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({ title: '旧路径别名' }),
      });
      expect(legacy.status).toBe(307);
      expect(legacy.headers.get('location')).toBe(`/api/lesson-activities/${activityId}`);

      const canonical = await fetchJson(`${baseUrl}/api/lesson-activities/${activityId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({ title: '新路径' }),
      });
      expect(canonical.status).toBe(200);
      expect(canonical.body.title).toBe('新路径');
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

  // ── 学案活动类型目录 ───────────────────────────────────────────────
  describe('学案活动类型目录', () => {
    it('教师可读取内置活动类型', async () => {
      const res = await fetchJson<Array<{ id: string; label: string; source: string }>>(
        `${baseUrl}/api/xuean/activity-types`,
        { headers: teacherCookie },
      );
      expect(res.status).toBe(200);
      expect(res.body.find((item) => item.id === 'reading')?.source).toBe('builtin');
      expect(res.body.some((item) => item.id === 'quiz')).toBe(true);
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

    it('互动课件块只接受内容源描述并规范化落库', async () => {
      const res = await fetchJson<TestRow>(`${baseUrl}/api/lessons/${lessonId}/blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({
          blockType: 'interactive_courseware',
          content: { coursewareUuid: ' cw_demo ', title: ' 分数演示 ', script: '<script>alert(1)</script>' },
        }),
      });
      expect(res.status).toBe(201);
      expect(JSON.parse(String(res.body.content_json))).toEqual({
        coursewareUuid: 'cw_demo',
        resourceId: null,
        title: '分数演示',
      });
      await fetch(`${baseUrl}/api/blocks/${res.body.id}`, { method: 'DELETE', headers: teacherCookie });
    });

    it('互动课件块缺少内容源时拒绝', async () => {
      const res = await fetchJson(`${baseUrl}/api/lessons/${lessonId}/blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({ blockType: 'interactive_courseware', content: { title: '空' } }),
      });
      expect(res.status).toBe(400);
    });

    it('学案首页块只保留简介与上传背景图', async () => {
      const res = await fetchJson<TestRow>(`${baseUrl}/api/lessons/${lessonId}/blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({
          blockType: 'xuean_home',
          content: { intro: ' 本节课简介 ', backgroundImage: '/api/files/cover-1', extra: 'ignored' },
        }),
      });
      expect(res.status).toBe(201);
      expect(JSON.parse(String(res.body.content_json))).toEqual({
        intro: '本节课简介',
        backgroundImage: '/api/files/cover-1',
      });
      await fetch(`${baseUrl}/api/blocks/${res.body.id}`, { method: 'DELETE', headers: teacherCookie });

      const rejected = await fetchJson(`${baseUrl}/api/lessons/${lessonId}/blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({ blockType: 'xuean_home', content: { backgroundImage: 'javascript:alert(1)' } }),
      });
      expect(rejected.status).toBe(400);
    });

    it('教师可批量重排首页块，未知 id 被拒绝', async () => {
      const list = await fetchJson<TestRow[]>(`${baseUrl}/api/lessons/${lessonId}/blocks`, { headers: teacherCookie });
      const ids = list.body.map((row) => String(row.id)).reverse();
      const reordered = await fetchJson<TestRow[]>(`${baseUrl}/api/lessons/${lessonId}/blocks/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({ ids }),
      });
      expect(reordered.status).toBe(200);
      expect(reordered.body.map((row) => row.id)).toEqual(ids);

      const rejected = await fetchJson(`${baseUrl}/api/lessons/${lessonId}/blocks/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({ ids: ['not-a-block'] }),
      });
      expect(rejected.status).toBe(400);
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
      const publishSpy = vi.spyOn(kernelContainer.eventBus, 'publish');
      const res = await fetchJson(`${baseUrl}/api/activities/${first.id}/progress/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({ studentId, status: 'graded', score: 95 }),
      });
      expect(res.status).toBe(200);
      expect(res.body.verified).toBe(1);
      expect(res.body.status).toBe('graded');
      expect(res.body.score).toBe(95);

      const completed = publishSpy.mock.calls
        .map(([event]) => event as any)
        .filter((event) => event.type === 'activity.completed');
      expect(
        completed.some(
          (event) => event.payload.source === 'lesson-activity' && event.payload.activityId === `xuean:${first.id}`,
        ),
      ).toBe(true);
      publishSpy.mockRestore();
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

  // ── 试题活动（引用现有试卷）──────────────────────────────────────────
  describe('试题活动', () => {
    let firstAssignmentId = '';

    it('返回课时关联班级', async () => {
      const res = await fetchJson<Array<{ id: string; name: string }>>(
        `${baseUrl}/api/lessons/${lessonId}/linked-classes`,
        { headers: teacherCookie },
      );
      expect(res.status).toBe(200);
      expect(res.body.some((row) => row.id === classId)).toBe(true);
    });

    it('引用试卷创建活动并发布 assignment', async () => {
      const res = await fetchJson<{
        success: boolean;
        activity: TestRow;
        assignment: { id: string; assessmentId: string };
        reused: boolean;
      }>(`${baseUrl}/api/lessons/${lessonId}/activities/assessment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({ assessmentId: quizAssessmentId, classId, title: '随堂小测' }),
      });

      expect(res.status).toBe(201);
      expect(res.body.reused).toBe(false);
      expect(res.body.activity.type).toBe('quiz');
      expect(res.body.assignment.assessmentId).toBe(quizAssessmentId);
      const config = JSON.parse(String(res.body.activity.config_json));
      expect(config).toMatchObject({
        assessmentId: quizAssessmentId,
        classId,
        assignmentId: res.body.assignment.id,
      });
      firstAssignmentId = res.body.assignment.id;
    });

    it('相同 assessment + class 再次绑定复用 open assignment', async () => {
      const res = await fetchJson<{ assignment: { id: string }; reused: boolean }>(
        `${baseUrl}/api/lessons/${lessonId}/activities/assessment`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...teacherCookie },
          body: JSON.stringify({ assessmentId: quizAssessmentId, classId }),
        },
      );
      expect(res.status).toBe(201);
      expect(res.body.reused).toBe(true);
      expect(res.body.assignment.id).toBe(firstAssignmentId);
    });

    it('班级不属于该课时时返回 400', async () => {
      const otherClassId = rid('cls_other');
      const res = await fetchJson(`${baseUrl}/api/lessons/${lessonId}/activities/assessment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({ assessmentId: quizAssessmentId, classId: otherClassId }),
      });
      expect(res.status).toBe(400);
    });

    it('没有题目的试卷不能发布', async () => {
      const res = await fetchJson(`${baseUrl}/api/lessons/${lessonId}/activities/assessment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({ assessmentId: emptyAssessmentId, classId }),
      });
      expect(res.status).toBe(409);
    });

    it('其他教师不能引用非本人试卷', async () => {
      const res = await fetchJson(`${baseUrl}/api/lessons/${lessonId}/activities/assessment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...otherTeacherCookie },
        body: JSON.stringify({ assessmentId: quizAssessmentId, classId }),
      });
      expect([403, 404]).toContain(res.status);
    });
  });
});
