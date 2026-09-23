import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerClassroomExtrasRoutes } from '../routes/classroom-extras.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

/**
 * 上课流程扩展端点契约测试（家校通知 / AI 学情预测）。
 *
 * 锁死四件事：
 *   1. 鉴权：匿名 401、学生 403、教师/管理员放行；
 *   2. 参数校验：缺 studentReports / studentSnapshots 返回 400；
 *   3. 家校通知：AI 成功 → 班级 Markdown + 逐生通知；AI 抛错 → 逐生降级为模板（不整体失败）；
 *   4. AI 预测：AI 返回合法 JSON → aiSucceeded=true；AI 返回垃圾 → 降级为启发式且 aiSucceeded=false。
 */
describe('上课流程扩展端点（classroom-extras）', () => {
  let server: Server;
  let baseUrl: string;

  const db = kernelContainer.db as any;
  const lessonId = 'les-extras-0001';
  const teacherId = 'usr-extras-teacher';
  const studentId = 'usr-extras-student';
  const teacherToken = 'tok-extras-teacher';
  const studentToken = 'tok-extras-student';

  const call = (method: string, urlPath: string, token: string | null, body?: unknown) =>
    fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: token
        ? { 'Content-Type': 'application/json', Cookie: `edu_os_token=${token}` }
        : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const baseSummary = {
    lessonTitle: 'Python 循环与算法',
    className: '高一 (3) 班',
    startTimeMs: 1_700_000_000_000,
    endTimeMs: 1_700_002_700_000,
    totalStudents: 32,
    onlineCount: 30,
    highlights: ['全场抢答 24 人', '互评完成率 88%'],
    stages: [{ stageName: '导入', plannedMin: 5, actualMin: 6 }],
    studentReports: [
      {
        studentId: 'stu-1',
        studentName: '张子豪',
        online: true,
        participationScore: 92,
        quizScore: 88,
        behaviorTags: ['积极举手'],
        note: '',
      },
      {
        studentId: 'stu-2',
        studentName: '李晓彤',
        online: true,
        participationScore: 61,
        behaviorTags: ['专注度 76%'],
      },
    ],
  };

  const baseSnapshot = {
    lessonTitle: 'Python 循环与算法',
    currentStageName: 'IN_CLASS_TEACHING',
    elapsedMin: 20,
    plannedTotalMin: 45,
    studentSnapshots: [
      {
        studentId: 'stu-1',
        studentName: '张子豪',
        participationScore: 92,
        quizScore: 88,
        paceIndicator: 'on-track',
        behaviorSignals: ['主动提问'],
      },
      {
        studentId: 'stu-2',
        studentName: '李晓彤',
        participationScore: 22,
        paceIndicator: 'stalled',
        behaviorSignals: ['长时间无操作'],
      },
    ],
  };

  beforeAll(async () => {
    const now = Date.now();
    const insertUser = db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertUser.run(teacherId, 'extras_teacher', 'placeholder', 'teacher', '扩展教师', now);
    insertUser.run(studentId, 'extras_student', 'placeholder', 'student', '扩展学生', now);

    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    const expiresAt = now + 60 * 60 * 1000;
    insertSession.run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'extras_teacher' }),
      now,
      expiresAt,
    );
    insertSession.run(
      studentToken,
      JSON.stringify({ userId: studentId, role: 'student', username: 'extras_student' }),
      now,
      expiresAt,
    );

    db.prepare('INSERT OR REPLACE INTO lessons (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      lessonId,
      '扩展端点测试课节',
      now,
      now,
    );

    const app = express();
    app.use(express.json());
    registerClassroomExtrasRoutes(app as any);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?)').run(teacherToken, studentToken);
    db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(teacherId, studentId);
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // ── 鉴权 ───────────────────────────────────────────────────────────
  describe('鉴权', () => {
    it('匿名不可调用家校通知', async () => {
      const res = await call('POST', `/api/classroom/${lessonId}/parent-notification`, null, baseSummary);
      expect(res.status).toBe(401);
    });

    it('学生不可调用家校通知（403）', async () => {
      const res = await call('POST', `/api/classroom/${lessonId}/parent-notification`, studentToken, baseSummary);
      expect(res.status).toBe(403);
    });

    it('匿名不可调用学情预测', async () => {
      const res = await call('POST', `/api/classroom/${lessonId}/predict-mastery`, null, baseSnapshot);
      expect(res.status).toBe(401);
    });

    it('学生不可调用学情预测（403）', async () => {
      const res = await call('POST', `/api/classroom/${lessonId}/predict-mastery`, studentToken, baseSnapshot);
      expect(res.status).toBe(403);
    });
  });

  // ── 参数校验 ────────────────────────────────────────────────────────
  describe('参数校验', () => {
    it('缺少 studentReports 返回 400', async () => {
      const res = await call('POST', `/api/classroom/${lessonId}/parent-notification`, teacherToken, {
        lessonTitle: 'x',
      });
      expect(res.status).toBe(400);
    });

    it('缺少 studentSnapshots 返回 400', async () => {
      const res = await call('POST', `/api/classroom/${lessonId}/predict-mastery`, teacherToken, {
        lessonTitle: 'x',
      });
      expect(res.status).toBe(400);
    });
  });

  // ── 家校通知 ────────────────────────────────────────────────────────
  describe('家校通知生成器', () => {
    it('AI 成功：返回班级 Markdown + 逐生通知', async () => {
      const spy = vi.spyOn(kernelContainer.aiService, 'generateText').mockImplementation(async (prompt: string) => {
        if (prompt.includes('学生家长')) return `**张子豪** 今天表现出色，建议保持。`;
        return '本节课堂节奏良好，全班参与度较高。';
      });

      const res = await call('POST', `/api/classroom/${lessonId}/parent-notification`, teacherToken, baseSummary);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.lessonId).toBe(lessonId);
      expect(typeof body.classMarkdown).toBe('string');
      expect(body.classMarkdown).toContain('班级学情简报');
      expect(body.studentNotifications).toHaveLength(2);
      expect(body.studentNotifications[0]).toMatchObject({
        studentId: 'stu-1',
        studentName: '张子豪',
      });
      expect(body.studentNotifications[0].markdown).toContain('表现出色');
      expect(body.counts).toMatchObject({ students: 2, online: 30, highlights: 2 });
      spy.mockRestore();
    });

    it('AI 抛错：逐生降级为模板，整体仍 200', async () => {
      const spy = vi
        .spyOn(kernelContainer.aiService, 'generateText')
        .mockRejectedValue(new Error('upstream 500'));

      const res = await call('POST', `/api/classroom/${lessonId}/parent-notification`, teacherToken, baseSummary);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.studentNotifications).toHaveLength(2);
      // 降级模板带「致 xxx 家长」
      expect(body.studentNotifications[0].markdown).toContain('家长');
      // 班级 Markdown 也降级为模板（非 AI 文案）
      expect(body.classMarkdown).toContain('课堂总评');
      spy.mockRestore();
    });
  });

  // ── AI 学情预测 ─────────────────────────────────────────────────────
  describe('AI 实时学情预测', () => {
    it('AI 返回合法 JSON：aiSucceeded=true 且逐生返回 5 维预测', async () => {
      const aiPayload = JSON.stringify([
        {
          studentId: 'stu-1',
          studentName: '张子豪',
          prediction: { algorithmic: 88, engineering: 85, creativity: 90, collaboration: 92, focus: 95 },
          risk: 'low',
          note: '表现优秀',
        },
        {
          studentId: 'stu-2',
          studentName: '李晓彤',
          prediction: { algorithmic: 45, engineering: 40, creativity: 50, collaboration: 55, focus: 30 },
          risk: 'high',
          note: '建议单独辅导',
        },
      ]);
      const spy = vi.spyOn(kernelContainer.aiService, 'generateText').mockResolvedValue('```json\n' + aiPayload + '\n```');

      const res = await call('POST', `/api/classroom/${lessonId}/predict-mastery`, teacherToken, baseSnapshot);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.aiSucceeded).toBe(true);
      expect(body.predictions).toHaveLength(2);
      expect(body.predictions[0].prediction).toHaveProperty('algorithmic');
      expect(body.predictions[1].risk).toBe('high');
      spy.mockRestore();
    });

    it('AI 返回垃圾：降级为启发式且 aiSucceeded=false', async () => {
      const spy = vi.spyOn(kernelContainer.aiService, 'generateText').mockResolvedValue('not-json-at-all');

      const res = await call('POST', `/api/classroom/${lessonId}/predict-mastery`, teacherToken, baseSnapshot);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.aiSucceeded).toBe(false);
      expect(body.predictions).toHaveLength(2);
      // stalled 学生应为高风险
      const stalled = body.predictions.find((p: any) => p.studentId === 'stu-2');
      expect(stalled.risk).toBe('high');
      // 高参与度学生应为低风险
      const good = body.predictions.find((p: any) => p.studentId === 'stu-1');
      expect(good.risk).toBe('low');
      spy.mockRestore();
    });
  });
});
