import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerLessonsRoutes } from '../routes/lessons.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { v7 as uuidv7 } from 'uuid';

describe('Lesson routes & API 404 gate integration test', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const teacherId = `usr_teach_${uuidv7().slice(0, 8)}`;
  const teacherToken = `tok_teach_${uuidv7().slice(0, 8)}`;
  const testLessonId = `les_route_${uuidv7().slice(0, 8)}`;

  const teacherCookie = { Cookie: `edu_os_token=${teacherToken}` };

  beforeAll(async () => {
    const now = Date.now();
    const expiresAt = now + 60 * 60 * 1000;
    const db = kernelContainer.db;

    // 1. 预置教师用户与 Session
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(teacherId, 'teacher_route_test', 'hash', 'teacher', '测试教师', now);

    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(teacherToken, JSON.stringify({ userId: teacherId, role: 'teacher', username: 'teacher_route_test' }), now, expiresAt);

    // 2. 预置课节数据
    const timelineData = JSON.stringify([
      { id: 'seg-1', title: '环节一：课前破冰', duration: '5m', type: 'intro' },
      { id: 'seg-2', title: '环节二：核心精讲', duration: '15m', type: 'lecture' },
    ]);
    db.prepare(
      `INSERT INTO lessons (id, title, content, timeline, progress_mode, creator_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'manual', ?, ?, ?)`,
    ).run(testLessonId, '高一物理：圆周运动', '### 教学重点\n向心力与向心加速度', timelineData, teacherId, now, now);

    // 3. 构建微型 Express 实例并挂载 lessons 路由和 /api/* 404 兜底
    app = express();
    app.use(express.json());

    registerLessonsRoutes({ app } as any);

    // 挂载 API 404 快速失败门禁（模拟 server.ts 行为）
    app.all('/api/*', (req, res) => {
      res.status(404).json({
        success: false,
        error: `API route not found: ${req.method} ${req.path}`,
      });
    });

    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    const db = kernelContainer.db;
    db.prepare('DELETE FROM lessons WHERE id = ?').run(testLessonId);
    db.prepare('DELETE FROM client_sessions WHERE id = ?').run(teacherToken);
    db.prepare('DELETE FROM users WHERE id = ?').run(teacherId);

    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('GET /api/lessons/:id: 鉴权用户可正常获取课节详情（包含 timeline）', async () => {
    const res = await fetch(`${baseUrl}/api/lessons/${testLessonId}`, {
      headers: teacherCookie,
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.id).toBe(testLessonId);
    expect(data.title).toBe('高一物理：圆周运动');
    expect(data.timeline).toContain('环节一：课前破冰');
  });

  it('GET /api/lessons/:id: 未认证访问应被阻断为 401 Unauthorized', async () => {
    const res = await fetch(`${baseUrl}/api/lessons/${testLessonId}`);
    expect(res.status).toBe(401);
  });

  it('GET /api/lessons/:id: 查询不存在的课节应返回 404 Lesson not found', async () => {
    const res = await fetch(`${baseUrl}/api/lessons/nonexistent-lesson-999`, {
      headers: teacherCookie,
    });
    expect(res.status).toBe(404);

    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Lesson not found');
  });

  it('API 404 门禁: 未匹配的 /api/* 路由应瞬时返回标准 404 JSON 而非挂起或 500', async () => {
    const start = Date.now();
    const res = await fetch(`${baseUrl}/api/nonexistent-route-endpoint`, {
      headers: teacherCookie,
    });
    const duration = Date.now() - start;

    expect(res.status).toBe(404);
    expect(duration).toBeLessThan(100); // 必须在 100ms 内快速失败返回

    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('API route not found');
  });
});
