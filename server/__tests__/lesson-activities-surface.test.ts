/**
 * 阶段 3「宿主与放置」：学案活动 ↔ LearningSurface 的集成测试。
 *
 * 覆盖：
 *   - 创建活动时带 `surface` → 建 kind='lesson_activity' 的 Surface 并写回 surface_id；
 *   - 更新活动复用同一个 Surface（内容引用被替换）；
 *   - `surface: null` 解绑 → Surface 软删、surface_id 清空；
 *   - 删除活动 → Surface 软删，attempt 侧可继续追溯；
 *   - 宿主读取接口 GET /api/learning-surfaces/:id 的教师 / 学生权限。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { registerLessonActivitiesRoutes } from '../routes/lesson-activities.js';
import { registerLearningSurfaceRoutes } from '../routes/learning-surfaces.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

function rid(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

async function fetchJson<T = Record<string, unknown>>(url: string, options?: RequestInit) {
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

describe('学案活动 LearningSurface 放置（阶段 3）', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const db = kernelContainer.db;
  let teacherCookie: Record<string, string>;
  let studentCookie: Record<string, string>;
  let lessonId: string;
  let classId: string;

  beforeAll(async () => {
    const now = Date.now();
    const expiresAt = now + 60 * 60 * 1000;

    const teacherId = rid('teach3');
    const studentId = rid('stu3');
    const teacherToken = rid('tok_t3');
    const studentToken = rid('tok_s3');
    classId = rid('cls3');
    lessonId = rid('les3');
    teacherCookie = { Cookie: `edu_os_token=${teacherToken}` };
    studentCookie = { Cookie: `edu_os_token=${studentToken}` };

    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(teacherId, `teacher_${teacherId.slice(-6)}`, 'hash', 'teacher', '教师', now);
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(studentId, `student_${studentId.slice(-6)}`, 'hash', 'student', '学生', now);
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

    db.prepare('INSERT OR REPLACE INTO classes (id, name, class_passcode, created_at) VALUES (?, ?, ?, ?)').run(
      classId,
      '学习面测试班',
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
    ).run(lessonId, '学习面测试课时', 'content', teacherId, now, now);
    db.prepare(
      'INSERT OR REPLACE INTO schedules (id, class_id, lesson_id, scheduled_date, time_slot, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(rid('sch3'), classId, lessonId, '2026-11-21', 'period1', now);

    app = express();
    app.use(express.json());
    registerLessonActivitiesRoutes({ app } as Parameters<typeof registerLessonActivitiesRoutes>[0]);
    registerLearningSurfaceRoutes({ app } as Parameters<typeof registerLearningSurfaceRoutes>[0]);
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const contentRef = (coursewareId: string) => ({
    rendererId: 'html_courseware',
    source: { kind: 'courseware', id: coursewareId },
    config: { title: '课件' },
  });

  it('创建活动时绑定 Surface，宿主可读取内容引用', async () => {
    const created = await fetchJson<{ id: string; surface_id: string | null }>(
      `${baseUrl}/api/lessons/${lessonId}/activities`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({ type: 'courseware', title: '课件活动', surface: contentRef('cw-1') }),
      },
    );
    expect(created.status).toBe(201);
    expect(created.body.surface_id).toBeTruthy();

    const surface = await fetchJson<{ id: string; kind: string; owner_id: string; content_ref_json: string }>(
      `${baseUrl}/api/learning-surfaces/${created.body.surface_id}`,
      { headers: teacherCookie },
    );
    expect(surface.status).toBe(200);
    expect(surface.body.kind).toBe('lesson_activity');
    expect(surface.body.owner_id).toBe(created.body.id);
    expect(JSON.parse(surface.body.content_ref_json)).toMatchObject({
      rendererId: 'html_courseware',
      source: { kind: 'courseware', id: 'cw-1' },
    });

    // 学生在本课时内也能读取宿主内容。
    const studentRead = await fetchJson(`${baseUrl}/api/learning-surfaces/${created.body.surface_id}`, {
      headers: studentCookie,
    });
    expect(studentRead.status).toBe(200);
  });

  it('更新活动复用同一 Surface，只替换内容引用', async () => {
    const created = await fetchJson<{ id: string; surface_id: string }>(
      `${baseUrl}/api/lessons/${lessonId}/activities`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({ type: 'courseware', title: '可更新活动', surface: contentRef('cw-old') }),
      },
    );
    const surfaceId = created.body.surface_id;

    const updated = await fetchJson<{ surface_id: string }>(`${baseUrl}/api/lesson-activities/${created.body.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...teacherCookie },
      body: JSON.stringify({ title: '可更新活动', surface: contentRef('cw-new') }),
    });
    expect(updated.status).toBe(200);
    expect(updated.body.surface_id).toBe(surfaceId);

    const surface = await fetchJson<{ content_ref_json: string }>(`${baseUrl}/api/learning-surfaces/${surfaceId}`, {
      headers: teacherCookie,
    });
    expect(JSON.parse(surface.body.content_ref_json)).toMatchObject({
      source: { kind: 'courseware', id: 'cw-new' },
    });
  });

  it('surface: null 解绑并软删 Surface', async () => {
    const created = await fetchJson<{ id: string; surface_id: string }>(
      `${baseUrl}/api/lessons/${lessonId}/activities`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({ type: 'courseware', title: '待解绑活动', surface: contentRef('cw-x') }),
      },
    );
    const surfaceId = created.body.surface_id;

    const updated = await fetchJson<{ surface_id: string | null }>(
      `${baseUrl}/api/lesson-activities/${created.body.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({ title: '待解绑活动', surface: null }),
      },
    );
    expect(updated.status).toBe(200);
    expect(updated.body.surface_id).toBeNull();

    const row = db.prepare('SELECT deleted_at FROM learning_surfaces WHERE id = ?').get(surfaceId) as
      { deleted_at: number | null } | undefined;
    expect(row?.deleted_at).toBeTruthy();
  });

  it('删除活动时软删 Surface，而不是物理删除', async () => {
    const created = await fetchJson<{ id: string; surface_id: string }>(
      `${baseUrl}/api/lessons/${lessonId}/activities`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({ type: 'courseware', title: '待删除活动', surface: contentRef('cw-del') }),
      },
    );
    const surfaceId = created.body.surface_id;

    const deleted = await fetchJson(`${baseUrl}/api/lesson-activities/${created.body.id}`, {
      method: 'DELETE',
      headers: teacherCookie,
    });
    expect(deleted.status).toBe(200);

    const row = db.prepare('SELECT deleted_at FROM learning_surfaces WHERE id = ?').get(surfaceId) as
      { deleted_at: number | null } | undefined;
    expect(row).toBeDefined();
    expect(row?.deleted_at).toBeTruthy();
  });

  it('互动课件首页块创建 / 更新同步 lesson_block Surface', async () => {
    const created = await fetchJson<{ id: string; surface_id: string | null }>(
      `${baseUrl}/api/lessons/${lessonId}/blocks`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...teacherCookie },
        body: JSON.stringify({
          blockType: 'interactive_courseware',
          content: { coursewareUuid: 'cw-block-1', title: '学案课件' },
        }),
      },
    );
    expect(created.status).toBe(201);
    expect(created.body.surface_id).toBeTruthy();

    const surface = await fetchJson<{ kind: string; owner_id: string; content_ref_json: string }>(
      `${baseUrl}/api/learning-surfaces/${created.body.surface_id}`,
      { headers: teacherCookie },
    );
    expect(surface.body.kind).toBe('lesson_block');
    expect(surface.body.owner_id).toBe(created.body.id);
    expect(JSON.parse(surface.body.content_ref_json)).toMatchObject({
      rendererId: 'html_courseware',
      source: { kind: 'courseware', id: 'cw-block-1' },
    });

    const updated = await fetchJson<{ surface_id: string | null }>(`${baseUrl}/api/blocks/${created.body.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...teacherCookie },
      body: JSON.stringify({
        blockType: 'interactive_courseware',
        content: { resourceId: 'res-block-2', title: '学案资源' },
      }),
    });
    expect(updated.status).toBe(200);
    expect(updated.body.surface_id).toBe(created.body.surface_id);

    const after = await fetchJson<{ content_ref_json: string }>(
      `${baseUrl}/api/learning-surfaces/${created.body.surface_id}`,
      { headers: teacherCookie },
    );
    expect(JSON.parse(after.body.content_ref_json)).toMatchObject({
      source: { kind: 'resource', id: 'res-block-2' },
    });
  });

  it('非法内容引用被拒绝，且不产生活动', async () => {
    const before = (
      db.prepare('SELECT COUNT(*) AS c FROM lesson_activities WHERE lesson_id = ?').get(lessonId) as {
        c: number;
      }
    ).c;

    const res = await fetchJson(`${baseUrl}/api/lessons/${lessonId}/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...teacherCookie },
      body: JSON.stringify({ type: 'courseware', title: '坏引用', surface: { rendererId: '', source: {} } }),
    });
    expect(res.status).toBe(400);

    const after = (
      db.prepare('SELECT COUNT(*) AS c FROM lesson_activities WHERE lesson_id = ?').get(lessonId) as {
        c: number;
      }
    ).c;
    expect(after).toBe(before);
  });
});
