import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerLearningSurfaceRoutes } from '../routes/learning-surfaces.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

/**
 * LearningSurface 阶段 1 路由回归测试。
 *
 * 覆盖：
 *  1. 渲染器目录包含内置渲染器；
 *  2. Surface 按容器 upsert、内容引用校验与教师授权；
 *  3. attempt 懒创建 / 续用、进度快照、幂等提交、教师评分覆盖；
 *  4. maxAttempts 上限下的只读返回与显式新建拒绝；
 *  5. 软删 Surface 后 attempt 仍可追溯，但不再允许新建 attempt；
 *  6. 学生之间、教师之间的对象级隔离。
 */
let server: Server;
let baseUrl: string;

const studentA = 'stu-ls-a';
const studentB = 'stu-ls-b';
const teacherId = 'usr-ls-teacher';
const otherTeacherId = 'usr-ls-other-teacher';
const tokenA = 'tok-ls-a';
const tokenB = 'tok-ls-b';
const teacherToken = 'tok-ls-teacher';
const otherTeacherToken = 'tok-ls-other-teacher';
const lessonId = 'les-ls-0001';

const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

interface ApiResult {
  status: number;
  body: any;
}

async function api(path: string, init: RequestInit = {}): Promise<ApiResult> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

const contentRef = (title: string, maxAttempts?: number) => ({
  rendererId: 'html_courseware',
  source: { kind: 'courseware', id: 'cw-ls-0001' },
  config: { title, ...(maxAttempts ? { maxAttempts } : {}) },
});

async function createSurface(
  token: string,
  input: { ownerId: string; lesson?: string; title?: string; maxAttempts?: number } = { ownerId: 'owner-default' },
): Promise<ApiResult> {
  return api('/api/learning-surfaces', {
    method: 'POST',
    headers: cookie(token),
    body: JSON.stringify({
      lessonId: input.lesson ?? lessonId,
      kind: 'whiteboard_element',
      ownerId: input.ownerId,
      contentRef: contentRef(input.title ?? '示例内容', input.maxAttempts),
    }),
  });
}

describe('learning-surface 路由（阶段 1 状态底座）', () => {
  beforeAll(async () => {
    const now = Date.now();
    const db = kernelContainer.db;

    const insertUser = db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertUser.run(studentA, 'ls_student_a', 'placeholder', 'student', 'Surface 学生 A', now);
    insertUser.run(studentB, 'ls_student_b', 'placeholder', 'student', 'Surface 学生 B', now);
    insertUser.run(teacherId, 'ls_teacher', 'placeholder', 'teacher', 'Surface 教师', now);
    insertUser.run(otherTeacherId, 'ls_other_teacher', 'placeholder', 'teacher', 'Surface 其他教师', now);

    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    const expiresAt = now + 60 * 60 * 1000;
    insertSession.run(
      tokenA,
      JSON.stringify({ userId: studentA, role: 'student', username: 'ls_student_a' }),
      now,
      expiresAt,
    );
    insertSession.run(
      tokenB,
      JSON.stringify({ userId: studentB, role: 'student', username: 'ls_student_b' }),
      now,
      expiresAt,
    );
    insertSession.run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'ls_teacher' }),
      now,
      expiresAt,
    );
    insertSession.run(
      otherTeacherToken,
      JSON.stringify({ userId: otherTeacherId, role: 'teacher', username: 'ls_other_teacher' }),
      now,
      expiresAt,
    );

    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(lessonId, 'LearningSurface 测试课', teacherId, now, now);

    const app = express();
    app.use(express.json());
    registerLearningSurfaceRoutes({ app } as never);

    await new Promise<void>((resolve) => {
      server = createServer(app);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    const db = kernelContainer.db;
    db.prepare('DELETE FROM student_lesson_progress WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM learning_surface_attempts WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM learning_surfaces WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?, ?)').run(
      tokenA,
      tokenB,
      teacherToken,
      otherTeacherToken,
    );
    db.prepare('DELETE FROM users WHERE id IN (?, ?, ?, ?)').run(studentA, studentB, teacherId, otherTeacherId);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('渲染器目录包含内置渲染器', async () => {
    const result = await api('/api/learning-surface-renderers', { headers: cookie(tokenA) });
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    const ids = (result.body.data as Array<{ id: string }>).map((renderer) => renderer.id);
    expect(ids).toEqual(expect.arrayContaining(['presentation', 'html_courseware', 'assignment_submission']));
  });

  it('教师按容器创建 / 更新 Surface，学生无权创建', async () => {
    const created = await createSurface(teacherToken, { ownerId: 'wb-el-0001' });
    expect(created.status).toBe(201);
    expect(created.body.created).toBe(true);
    expect(JSON.parse(created.body.content_ref_json).config.title).toBe('示例内容');

    const updated = await createSurface(teacherToken, { ownerId: 'wb-el-0001', title: '更新后的标题' });
    expect(updated.status).toBe(200);
    expect(updated.body.created).toBe(false);
    expect(updated.body.id).toBe(created.body.id);
    expect(JSON.parse(updated.body.content_ref_json).config.title).toBe('更新后的标题');

    const forbidden = await createSurface(tokenA, { ownerId: 'wb-el-0002' });
    expect(forbidden.status).toBe(403);

    const invalid = await api('/api/learning-surfaces', {
      method: 'POST',
      headers: cookie(teacherToken),
      body: JSON.stringify({
        lessonId,
        kind: 'whiteboard_element',
        ownerId: 'wb-el-invalid',
        contentRef: { rendererId: 'html_courseware', source: { kind: 'courseware' } },
      }),
    });
    expect(invalid.status).toBe(400);
  });

  it('attempt 懒创建、续用、提交幂等与教师评分覆盖', async () => {
    const surface = await createSurface(teacherToken, { ownerId: 'wb-el-lifecycle', title: '生命周期' });
    const surfaceId = surface.body.id as string;

    const created = await api('/api/learning-surface-attempts', {
      method: 'POST',
      headers: cookie(tokenA),
      body: JSON.stringify({ surfaceId, lessonId }),
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('in_progress');
    expect(created.body.attempt_no).toBe(1);
    expect(created.body.is_preview).toBe(0);
    const attemptId = created.body.id as string;

    const resumed = await api('/api/learning-surface-attempts', {
      method: 'POST',
      headers: cookie(tokenA),
      body: JSON.stringify({ surfaceId }),
    });
    expect(resumed.status).toBe(200);
    expect(resumed.body.id).toBe(attemptId);
    expect(resumed.body.created).toBe(false);

    const progress = await api(`/api/learning-surface-attempts/${attemptId}`, {
      method: 'PATCH',
      headers: cookie(tokenA),
      body: JSON.stringify({ state: { slide: 3 }, completion: 0.4 }),
    });
    expect(progress.status).toBe(200);
    expect(progress.body.completion).toBeCloseTo(0.4);
    expect(JSON.parse(progress.body.state_json)).toEqual({ slide: 3 });

    const crossStudent = await api(`/api/learning-surface-attempts/${attemptId}`, {
      method: 'PATCH',
      headers: cookie(tokenB),
      body: JSON.stringify({ state: { slide: 9 } }),
    });
    expect(crossStudent.status).toBe(403);

    const submitted = await api(`/api/learning-surface-attempts/${attemptId}/submit`, {
      method: 'POST',
      headers: cookie(tokenA),
      body: JSON.stringify({ autoScore: 80, maxScore: 100, payload: { answers: ['A'] } }),
    });
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe('submitted');
    expect(submitted.body.auto_score).toBe(80);
    expect(submitted.body.completion).toBe(1);
    expect(JSON.parse(submitted.body.state_json).submission).toEqual({ answers: ['A'] });

    const repeated = await api(`/api/learning-surface-attempts/${attemptId}/submit`, {
      method: 'POST',
      headers: cookie(tokenA),
      body: JSON.stringify({ autoScore: 10 }),
    });
    expect(repeated.status).toBe(200);
    expect(repeated.body.auto_score).toBe(80);

    const patchAfterSubmit = await api(`/api/learning-surface-attempts/${attemptId}`, {
      method: 'PATCH',
      headers: cookie(tokenA),
      body: JSON.stringify({ completion: 0.9 }),
    });
    expect(patchAfterSubmit.status).toBe(409);

    const mine = await api(`/api/learning-surface-attempts/mine?lessonId=${lessonId}`, { headers: cookie(tokenA) });
    expect(mine.status).toBe(200);
    expect((mine.body as Array<{ id: string }>).some((row) => row.id === attemptId)).toBe(true);

    const graded = await api(`/api/learning-surface-attempts/${attemptId}`, {
      method: 'PATCH',
      headers: cookie(teacherToken),
      body: JSON.stringify({ score: 95 }),
    });
    expect(graded.status).toBe(200);
    expect(graded.body.status).toBe('graded');
    expect(graded.body.score).toBe(95);
    expect(graded.body.graded_by).toBe(teacherId);

    const lessonAttempts = await api(`/api/lessons/${lessonId}/learning-surface-attempts`, {
      headers: cookie(teacherToken),
    });
    expect(lessonAttempts.status).toBe(200);
    expect((lessonAttempts.body as Array<{ id: string }>).some((row) => row.id === attemptId)).toBe(true);

    const otherTeacherView = await api(`/api/lessons/${lessonId}/learning-surface-attempts`, {
      headers: cookie(otherTeacherToken),
    });
    expect(otherTeacherView.status).toBe(403);
  });

  it('教师预览写入 is_preview 且默认不出现在全班列表', async () => {
    const surface = await createSurface(teacherToken, { ownerId: 'wb-el-preview' });
    const preview = await api('/api/learning-surface-attempts', {
      method: 'POST',
      headers: cookie(teacherToken),
      body: JSON.stringify({ surfaceId: surface.body.id }),
    });
    expect(preview.status).toBe(201);
    expect(preview.body.is_preview).toBe(1);

    const studentView = await api(`/api/learning-surface-attempts/mine?lessonId=${lessonId}`, {
      headers: cookie(tokenA),
    });
    expect((studentView.body as Array<{ id: string }>).some((row) => row.id === preview.body.id)).toBe(false);

    const withoutPreview = await api(`/api/lessons/${lessonId}/learning-surface-attempts`, {
      headers: cookie(teacherToken),
    });
    expect((withoutPreview.body as Array<{ id: string }>).some((row) => row.id === preview.body.id)).toBe(false);

    const withPreview = await api(`/api/lessons/${lessonId}/learning-surface-attempts?includePreview=1`, {
      headers: cookie(teacherToken),
    });
    expect((withPreview.body as Array<{ id: string }>).some((row) => row.id === preview.body.id)).toBe(true);
  });

  it('maxAttempts 达到上限后只读返回，显式新建被拒绝', async () => {
    const surface = await createSurface(teacherToken, { ownerId: 'wb-el-max', maxAttempts: 1 });
    const surfaceId = surface.body.id as string;

    const created = await api('/api/learning-surface-attempts', {
      method: 'POST',
      headers: cookie(tokenB),
      body: JSON.stringify({ surfaceId }),
    });
    expect(created.status).toBe(201);

    await api(`/api/learning-surface-attempts/${created.body.id}/submit`, {
      method: 'POST',
      headers: cookie(tokenB),
      body: JSON.stringify({ autoScore: 60, maxScore: 100 }),
    });

    const readOnly = await api('/api/learning-surface-attempts', {
      method: 'POST',
      headers: cookie(tokenB),
      body: JSON.stringify({ surfaceId }),
    });
    expect(readOnly.status).toBe(200);
    expect(readOnly.body.id).toBe(created.body.id);
    expect(readOnly.body.readOnly).toBe(true);
    expect(readOnly.body.created).toBe(false);

    const next = await api(`/api/learning-surface-attempts/${created.body.id}/attempts`, {
      method: 'POST',
      headers: cookie(tokenB),
      body: JSON.stringify({}),
    });
    expect(next.status).toBe(409);
  });

  it('软删 Surface 后 attempt 仍可追溯，但不能再新建 attempt', async () => {
    const surface = await createSurface(teacherToken, { ownerId: 'wb-el-soft-delete' });
    const surfaceId = surface.body.id as string;

    const created = await api('/api/learning-surface-attempts', {
      method: 'POST',
      headers: cookie(tokenB),
      body: JSON.stringify({ surfaceId }),
    });
    expect(created.status).toBe(201);

    const deleted = await api(`/api/learning-surfaces/${surfaceId}`, {
      method: 'DELETE',
      headers: cookie(teacherToken),
    });
    expect(deleted.status).toBe(200);

    const lessonAttempts = await api(`/api/lessons/${lessonId}/learning-surface-attempts`, {
      headers: cookie(teacherToken),
    });
    const row = (lessonAttempts.body as Array<{ id: string; surface_deleted_at: number | null }>).find(
      (item) => item.id === created.body.id,
    );
    expect(row).toBeDefined();
    expect(row?.surface_deleted_at).not.toBeNull();

    const recreate = await api('/api/learning-surface-attempts', {
      method: 'POST',
      headers: cookie(tokenB),
      body: JSON.stringify({ surfaceId }),
    });
    expect(recreate.status).toBe(404);
  });

  it('课时级 Surface 汇总：排除预览、取最新 attempt、按满分归一并列出未交名单', async () => {
    const db = kernelContainer.db;

    const insertProgress = db.prepare(
      'INSERT OR REPLACE INTO student_lesson_progress (student_id, lesson_id, completed, progress_percent, assigned_at) VALUES (?, ?, ?, ?, ?)',
    );
    insertProgress.run(studentA, lessonId, 0, 0, Date.now());
    insertProgress.run(studentB, lessonId, 0, 0, Date.now());

    const surface = await createSurface(teacherToken, { ownerId: 'wb-el-summary', title: '课中汇总' });
    expect(surface.status).toBe(201);
    const surfaceId = surface.body.id as string;

    db.prepare(
      "INSERT OR REPLACE INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, 'learning_surface', ?, ?)",
    ).run(
      'wb-el-summary',
      lessonId,
      JSON.stringify({ surfaceId, segmentId: 'seg-summary', x: 0, y: 0, width: 400, height: 300 }),
      Date.now(),
    );

    // 学生 A：提交并带自动分；学生 B：只开始未提交。
    const attemptA = await api('/api/learning-surface-attempts', {
      method: 'POST',
      headers: cookie(tokenA),
      body: JSON.stringify({ surfaceId }),
    });
    await api(`/api/learning-surface-attempts/${attemptA.body.id}`, {
      method: 'PATCH',
      headers: cookie(tokenA),
      body: JSON.stringify({ completion: 0.8, autoScore: 8, maxScore: 10 }),
    });
    await api(`/api/learning-surface-attempts/${attemptA.body.id}/submit`, {
      method: 'POST',
      headers: cookie(tokenA),
      body: JSON.stringify({ autoScore: 8, maxScore: 10 }),
    });

    const attemptB = await api('/api/learning-surface-attempts', {
      method: 'POST',
      headers: cookie(tokenB),
      body: JSON.stringify({ surfaceId }),
    });
    await api(`/api/learning-surface-attempts/${attemptB.body.id}`, {
      method: 'PATCH',
      headers: cookie(tokenB),
      body: JSON.stringify({ completion: 0.4 }),
    });

    const summary = await api(`/api/lessons/${lessonId}/learning-surface-summary`, {
      headers: cookie(teacherToken),
    });
    expect(summary.status).toBe(200);
    const row = (summary.body.surfaces as Array<Record<string, any>>).find((item) => item.surfaceId === surfaceId);
    expect(row).toBeDefined();
    expect(row?.title).toBe('课中汇总');
    expect(row?.segmentId).toBe('seg-summary');
    expect(row?.rosterCount).toBe(2);
    expect(row?.startedCount).toBe(2);
    expect(row?.submittedCount).toBe(1);
    // 提交后 completion 归 1；B 停留在 0.4，均值 0.7。
    expect(row?.avgCompletion).toBeCloseTo(0.7, 5);
    expect(row?.avgScorePercent).toBeCloseTo(80, 5);
    expect((row?.pendingStudents as Array<{ studentId: string }>).map((item) => item.studentId)).toEqual([studentB]);

    const forbidden = await api(`/api/lessons/${lessonId}/learning-surface-summary`, {
      headers: cookie(tokenA),
    });
    expect(forbidden.status).toBe(403);
  });
});
