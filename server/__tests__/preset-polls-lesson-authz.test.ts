import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerClassroomRoutes } from '../routes/classroom.js';
import type { ServerContext } from '../context.js';
import { ClassroomRuntimeService } from '../services/classroom-runtime-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ensureTestSchema } from './helpers/test-schema.js';

/**
 * 回归测试 —— 课节预设投票题的课节归属授权（Issue #220）。
 *
 * 背景：`/api/lessons/:lessonId/preset-polls` 的 4 个 CRUD 路由此前只做了角色校验
 * （`requireAuth('teacher','administrator')`），没有校验课节归属：
 *   - 任意教师可用任意 lessonId 读取他人课节的预设投票题，**含正确答案 correctOption**
 *   - 同一个 lessonId 还可用于新增 / 修改 / 删除他人的预设投票
 *
 * 修复后：课节创建者本人与管理员可访问；其他教师一律 403。
 */
describe('课节预设投票题的课节归属授权（#220）', () => {
  let server: Server;
  let baseUrl: string;

  const db = kernelContainer.db;

  const teacherA = 'usr-poll-ta';
  const teacherAToken = 'tok-poll-ta';
  const teacherB = 'usr-poll-tb';
  const teacherBToken = 'tok-poll-tb';
  const adminId = 'usr-poll-admin';
  const adminToken = 'tok-poll-admin';
  const studentId = 'stu-poll-s';
  const studentToken = 'tok-poll-s';

  const lessonA = 'les-poll-a';
  const lessonB = 'les-poll-b';

  const call = (method: string, path: string, token: string, body?: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Cookie: `edu_os_token=${token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let pollId = '';

  beforeAll(async () => {
    ensureTestSchema();

    const app = express();
    app.use(express.json());
    registerClassroomRoutes({ app, io: undefined } as unknown as ServerContext, new ClassroomRuntimeService(db));

    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const now = Date.now();
    const insertUser = db.prepare(
      'INSERT OR REPLACE INTO users (id, username, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertUser.run(teacherA, 'poll_ta', '教师A', 'hash', 'teacher', now);
    insertUser.run(teacherB, 'poll_tb', '教师B', 'hash', 'teacher', now);
    insertUser.run(adminId, 'poll_admin', '管理员', 'hash', 'administrator', now);
    insertUser.run(studentId, 'poll_stu', '学生', 'hash', 'student', now);

    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    const mkSession = (token: string, userId: string, role: string, username: string) =>
      insertSession.run(
        token,
        JSON.stringify({ userId, role, username, name: username, studentId: role === 'student' ? userId : undefined }),
        now,
        now + 86400000,
      );
    mkSession(teacherAToken, teacherA, 'teacher', 'poll_ta');
    mkSession(teacherBToken, teacherB, 'teacher', 'poll_tb');
    mkSession(adminToken, adminId, 'administrator', 'poll_admin');
    mkSession(studentToken, studentId, 'student', 'poll_stu');

    // 两个课节分别由两位教师创建
    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(lessonA, '教师A的课节', teacherA, now, now);
    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(lessonB, '教师B的课节', teacherB, now, now);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    db.prepare('DELETE FROM lesson_preset_polls WHERE lesson_id IN (?, ?)').run(lessonA, lessonB);
    db.prepare('DELETE FROM lessons WHERE id IN (?, ?)').run(lessonA, lessonB);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?, ?)').run(
      teacherAToken,
      teacherBToken,
      adminToken,
      studentToken,
    );
    db.prepare('DELETE FROM users WHERE id IN (?, ?, ?, ?)').run(teacherA, teacherB, adminId, studentId);
  });

  it('课节创建者可以新增并读取自己课节的预设投票题', async () => {
    const created = await call('POST', `/api/lessons/${lessonA}/preset-polls`, teacherAToken, {
      title: '教师A的预设题',
      options: ['A', 'B', 'C', 'D'],
      correctOption: 'B',
    });
    expect(created.status).toBe(200);
    const body = (await created.json()) as { preset?: { id?: string } };
    pollId = body.preset?.id;
    expect(pollId).toBeTruthy();

    const list = await call('GET', `/api/lessons/${lessonA}/preset-polls`, teacherAToken);
    expect(list.status).toBe(200);
    const rows = (await list.json()) as { presets?: Array<{ correctOption?: string }> };
    expect(rows.presets).toHaveLength(1);
    expect(rows.presets[0].correctOption).toBe('B');
  });

  it('其他教师读取他人课节的预设投票题被拒（此前会返回正确答案）', async () => {
    const res = await call('GET', `/api/lessons/${lessonA}/preset-polls`, teacherBToken);
    expect(res.status).toBe(403);
  });

  it('其他教师往他人课节新增预设投票题被拒', async () => {
    const res = await call('POST', `/api/lessons/${lessonA}/preset-polls`, teacherBToken, {
      title: '越权新增',
      options: ['A', 'B'],
      correctOption: 'A',
    });
    expect(res.status).toBe(403);
    const rows = db.prepare('SELECT id FROM lesson_preset_polls WHERE title = ?').all('越权新增');
    expect(rows).toHaveLength(0);
  });

  it('其他教师修改他人课节的预设投票题被拒', async () => {
    const res = await call('PUT', `/api/lessons/${lessonA}/preset-polls/${pollId}`, teacherBToken, {
      correctOption: 'D',
    });
    expect(res.status).toBe(403);
    const row = db.prepare('SELECT correct_option FROM lesson_preset_polls WHERE id = ?').get(pollId) as {
      correct_option: string;
    };
    expect(row.correct_option).toBe('B');
  });

  it('其他教师删除他人课节的预设投票题被拒', async () => {
    const res = await call('DELETE', `/api/lessons/${lessonA}/preset-polls/${pollId}`, teacherBToken);
    expect(res.status).toBe(403);
    const row = db.prepare('SELECT id FROM lesson_preset_polls WHERE id = ?').get(pollId);
    expect(row).toBeDefined();
  });

  it('管理员可访问任意课节的预设投票题', async () => {
    const res = await call('GET', `/api/lessons/${lessonA}/preset-polls`, adminToken);
    expect(res.status).toBe(200);
  });

  it('学生不得访问课节预设投票题', async () => {
    const res = await call('GET', `/api/lessons/${lessonA}/preset-polls`, studentToken);
    expect(res.status).toBe(403);
  });
});
