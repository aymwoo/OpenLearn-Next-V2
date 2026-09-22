import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerClassroomRoutes } from '../routes/classroom.js';
import { ClassroomRuntimeService } from '../services/classroom-runtime-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { loadMigrationsFromDirectory, runMigrations } from '../utils/migrate.js';
import path from 'path';

/**
 * 互动课堂路由的**请求契约**回归测试。
 *
 * 背景：学生端 `StudentInteractiveOverlay.tsx` 早期发送的字段名
 * （`selectedOption` / `signalType` / `feedbackNotes`）与服务端契约
 * （`option` / `signal` / `feedback`）不一致，导致：
 *   - 投票全部落库为字符串 `"undefined"`（分布图与课堂简报失真）；
 *   - 节奏信号 400 且被前端静默吞掉（"听懂反馈晴雨表"永不生效）；
 *   - 结课通票的文字反馈被丢弃。
 * 本测试锁死「两种字段名都能被接受」与「非法选项被拒绝」，防止再次失配。
 */
describe('互动课堂路由请求契约（投票 / 节奏信号 / 结课通票）', () => {
  let server: Server;
  let baseUrl: string;
  let classroomService: ClassroomRuntimeService;

  const lessonId = 'les-room-contract-0001';
  const teacherId = 'usr-room-teacher-0001';
  const studentId = 'stu-room-0001';
  const teacherToken = 'tok-room-teacher-0001';
  const studentToken = 'tok-room-student-0001';

  const db = kernelContainer.db as any;
  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });
  const jsonHeaders = (token: string) => ({ 'Content-Type': 'application/json', ...cookie(token) });

  const post = (path: string, token: string, body?: Record<string, unknown>) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify(body ?? {}),
    });

  /** 教师发起一次投票，返回 pollId（每个用例独立造数据，避免相互污染） */
  const createPoll = async (options: string[] = ['A', 'B', 'C', 'D']) => {
    const res = await post(`/api/classroom/sessions/${lessonId}/quick-poll`, teacherToken, {
      title: '契约测试投票',
      questionType: 'ABCD',
      options,
    });
    const body = await res.text();
    expect(res.status, body).toBe(200);
    const json: any = JSON.parse(body);
    expect(typeof json.poll.id).toBe('string');
    return json.poll.id as string;
  };

  const votesOf = (pollId: string) =>
    db.prepare('SELECT selected_option FROM classroom_poll_votes WHERE poll_id = ? ORDER BY selected_option').all(pollId) as {
      selected_option: string;
    }[];

  beforeAll(async () => {
    // 测试用内核库不一定已应用课堂迁移，显式补齐（runMigrations 幂等，按 _migrations 记账）
    runMigrations(
      db,
      loadMigrationsFromDirectory(path.resolve(__dirname, '../../migrations')),
    );

    const app = express();
    app.use(express.json());
    classroomService = new ClassroomRuntimeService(db);
    registerClassroomRoutes({ app, io: undefined } as any, classroomService);

    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const now = Date.now();
    db.prepare(
      "INSERT OR REPLACE INTO users (id, username, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(teacherId, 'room_teacher', '课堂契约教师', 'hash', 'teacher', now);
    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(lessonId, '契约测试课节', teacherId, now, now);

    const sessionData = (userId: string, role: string, name: string) =>
      JSON.stringify({ userId, role, username: name, name });
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(teacherToken, sessionData(teacherId, 'teacher', '课堂契约教师'), now, now + 86400000);
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(studentToken, sessionData(studentId, 'student', '课堂契约学生'), now, now + 86400000);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    db.prepare('DELETE FROM classroom_poll_votes WHERE poll_id IN (SELECT id FROM classroom_quick_polls WHERE lesson_id = ?)').run(lessonId);
    // classroom_pacing_signals 只有 session_id（经由会话间接关联课节）
    db.prepare(
      'DELETE FROM classroom_pacing_signals WHERE session_id IN (SELECT id FROM classroom_sessions WHERE lesson_id = ?)',
    ).run(lessonId);
    for (const table of [
      'classroom_quick_polls',
      'classroom_buzzers',
      'classroom_exit_tickets',
      'classroom_sessions',
      'lesson_quiz_submissions',
    ]) {
      db.prepare(`DELETE FROM ${table} WHERE lesson_id = ?`).run(lessonId);
    }
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?)').run(teacherToken, studentToken);
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    db.prepare('DELETE FROM users WHERE id = ?').run(teacherId);
  });

  describe('投票字段名与选项校验', () => {
    it('接受契约字段 option，并只落库合法选项', async () => {
      const pollId = await createPoll(['A', 'B']);
      const res = await post(`/api/classroom/sessions/${lessonId}/quick-poll/${pollId}/vote`, studentToken, {
        option: 'A',
      });
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.distribution).toEqual({ A: 1 });
      expect(votesOf(pollId).map((v) => v.selected_option)).toEqual(['A']);
    });

    it('兼容旧字段 selectedOption（学生端旧包体不再写成 "undefined"）', async () => {
      const pollId = await createPoll(['A', 'B']);
      const res = await post(`/api/classroom/sessions/${lessonId}/quick-poll/${pollId}/vote`, studentToken, {
        selectedOption: 'B',
      });
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.distribution).toEqual({ B: 1 });
      expect(votesOf(pollId).map((v) => v.selected_option)).toEqual(['B']);
    });

    it('拒绝不在本次投票可选项内的答案（防脏值）', async () => {
      const pollId = await createPoll(['A', 'B']);
      const res = await post(`/api/classroom/sessions/${lessonId}/quick-poll/${pollId}/vote`, studentToken, {
        option: 'Z',
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Invalid vote option');
      expect(votesOf(pollId)).toHaveLength(0);
    });

    it('缺少选项字段时返回 400 而不是落库 "undefined"', async () => {
      const pollId = await createPoll(['A', 'B']);
      const res = await post(`/api/classroom/sessions/${lessonId}/quick-poll/${pollId}/vote`, studentToken, {
        studentName: '课堂契约学生',
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Missing vote option');
      expect(votesOf(pollId)).toHaveLength(0);
    });

    it('投票关闭后拒绝继续投票', async () => {
      const pollId = await createPoll(['A', 'B']);
      await post(`/api/classroom/sessions/${lessonId}/quick-poll/${pollId}/close`, teacherToken);
      const res = await post(`/api/classroom/sessions/${lessonId}/quick-poll/${pollId}/vote`, studentToken, {
        option: 'A',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('节奏信号字段名', () => {
    const summaryOf = (json: any) => json.summary;

    it('接受契约字段 signal 并写入数据库', async () => {
      const res = await post(`/api/classroom/sessions/${lessonId}/pacing`, studentToken, { signal: 'CONFUSED' });
      expect(res.status).toBe(200);
      expect(summaryOf(await res.json()).CONFUSED).toBeGreaterThanOrEqual(1);
    });

    it('兼容旧字段 signalType（既往前端体不再 400）', async () => {
      const res = await post(`/api/classroom/sessions/${lessonId}/pacing`, studentToken, { signalType: 'TOO_FAST' });
      expect(res.status).toBe(200);
      expect(summaryOf(await res.json()).TOO_FAST).toBeGreaterThanOrEqual(1);
    });

    it('非法信号类型仍然 400', async () => {
      const res = await post(`/api/classroom/sessions/${lessonId}/pacing`, studentToken, { signal: 'NONSENSE' });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Invalid pacing signal');
    });
  });

  describe('结课通票文字反馈字段名', () => {
    it('兼容旧字段 feedbackNotes，反馈不再被丢弃', async () => {
      const res = await post(`/api/classroom/sessions/${lessonId}/exit-ticket`, studentToken, {
        rating: 4,
        puzzledConcept: '熵增',
        feedbackNotes: '希望再讲一遍热力学第二定律',
      });
      expect(res.status).toBe(200);

      const row = db
        .prepare('SELECT rating, puzzled_concept, feedback FROM classroom_exit_tickets WHERE student_id = ?')
        .get(studentId) as { rating: number; puzzled_concept: string; feedback: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.rating).toBe(4);
      expect(row!.puzzled_concept).toBe('熵增');
      expect(row!.feedback).toBe('希望再讲一遍热力学第二定律');
    });
  });

  describe('大屏展台数据接口鉴权', () => {
    it('未登录不能取走签到码', async () => {
      const res = await fetch(`${baseUrl}/api/classroom/stage/${lessonId}/data`);
      expect(res.status).toBe(401);
    });

    it('教师登录后可取到课堂阶段与签到码', async () => {
      const res = await fetch(`${baseUrl}/api/classroom/stage/${lessonId}/data`, { headers: cookie(teacherToken) });
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.lessonId).toBe(lessonId);
      expect(typeof json.stage).toBe('string');
    });
  });
});
