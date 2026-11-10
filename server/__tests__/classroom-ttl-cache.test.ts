/**
 * 课堂高频统计与报表聚合只读缓存集成测试 (TTL Read Cache Integration Tests - Issue #409)
 *
 * 验证：
 * 1. 课堂卓越榜 (top-performers) 命中短期只读缓存，随堂测答卷提交主动失效；
 * 2. 节奏晴雨表 (pacing-summary) 命中只读聚合缓存，新节奏信号提交主动失效；
 * 3. 结课通票汇总 (exit-ticket-summary) 命中只读缓存，新通票提交主动失效；
 * 4. 大屏公开脱敏数据接口 (stage/:lessonId/data) 与全景学情简报 (panoramic-report) 读写一致性与缓存失效。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerClassroomRoutes, classroomReadCache } from '../routes/classroom.js';
import { ClassroomRuntimeService } from '../services/classroom-runtime-service.js';
import { diagnosticService } from '../services/diagnostic-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ensureTestSchema } from './helpers/test-schema.js';
import type { Server as SocketIOServer } from 'socket.io';

const teacherToken = 'tok-cache-teacher';
const teacherId = 'usr-cache-teacher';
const studentToken = 'tok-cache-student';
const studentId = 'stu-cache-001';
const classId = 'cls-cache-001';
const lessonId = 'les-cache-001';

let app: express.Express;
let server: Server;
let baseUrl: string;

const teacherHeaders = { Cookie: `edu_os_token=${teacherToken}`, 'Content-Type': 'application/json' };
const studentHeaders = { Cookie: `edu_os_token=${studentToken}`, 'Content-Type': 'application/json' };

beforeAll(async () => {
  ensureTestSchema();
  const db = kernelContainer.db;
  const now = Date.now();

  db.prepare(
    'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(
    teacherToken,
    JSON.stringify({ userId: teacherId, role: 'teacher', username: 'cache_teacher' }),
    now,
    now + 3600_000,
  );
  db.prepare(
    'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(
    studentToken,
    JSON.stringify({ userId: studentId, studentId, role: 'student', username: 'cache_stu' }),
    now,
    now + 3600_000,
  );
  db.prepare(
    'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(classId, '缓存测试班', 'ttl cache test', 'passcode', now);
  db.prepare(
    'INSERT OR REPLACE INTO lessons (id, title, content, progress_mode, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(lessonId, '缓存测试课', null, 'manual', teacherId, now, now);

  db.prepare('INSERT OR REPLACE INTO students (id, name, created_at) VALUES (?, ?, ?)').run(studentId, '测试生A', now);
  db.prepare('INSERT OR IGNORE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
    classId,
    studentId,
    now,
  );

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const token = req.headers.cookie?.match?.(/edu_os_token=([^;]+)/)?.[1];
    if (token === teacherToken) {
      (req as any).session = { userId: teacherId, role: 'teacher', username: 'cache_teacher' };
    } else if (token === studentToken) {
      (req as any).session = { userId: studentId, studentId, role: 'student', username: 'cache_stu' };
    }
    next();
  });

  const runtime = new ClassroomRuntimeService(db, {
    emit: () => {},
    to: () => ({ emit: () => {} }),
  } as unknown as SocketIOServer);
  registerClassroomRoutes({ app, io: { emit: () => {}, to: () => ({ emit: () => {} }) } } as any, runtime);

  await new Promise<void>((resolve) => {
    server = createServer(app);
    server.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  classroomReadCache.clear();
  classroomReadCache.resetStats();
  diagnosticService.clearCache();
  diagnosticService.resetCacheStats();
});

async function startSession(stage = 'IN_CLASS_TEACHING'): Promise<string> {
  const db = kernelContainer.db;
  const now = Date.now();
  const sessionId = `sess-cache-${now}`;
  db.prepare(
    `INSERT OR REPLACE INTO classroom_sessions
       (id, lesson_id, class_id, teacher_id, stage, checkin_code, created_at, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(sessionId, lessonId, classId, teacherId, stage, '4821', now, now);
  return sessionId;
}

describe('课堂高频聚合只读缓存与写事件失效测试 (Issue #409)', () => {
  it('1. top-performers 榜单连续查询命中缓存并在学生答题后立即主动失效', async () => {
    await startSession();
    const db = kernelContainer.db;
    const now = Date.now();

    // 预填一条测验题目与初始答卷
    db.prepare(
      'INSERT OR REPLACE INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('quiz_cache_1', lessonId, 'quiz', JSON.stringify({ question: 'Cache Test Q1', options: ['A', 'B'] }), now);

    db.prepare(
      `INSERT OR REPLACE INTO lesson_quiz_submissions
       (id, lesson_id, element_id, student_id, student_name, answer, score, is_correct, time_spent_ms, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('sub_init', lessonId, 'quiz_cache_1', studentId, '测试生A', 'A', 90, 1, 1000, now);

    // 第一次查询：冷启动未命中
    const res1 = await fetch(`${baseUrl}/api/classroom/sessions/${lessonId}/top-performers`, {
      headers: teacherHeaders,
    });
    const data1 = (await res1.json()) as any;
    expect(res1.status).toBe(200);
    expect(data1.topPerformers.length).toBe(1);
    expect(data1.topPerformers[0].cumulativeScore).toBe(90);

    // 第二次查询：命中缓存
    const res2 = await fetch(`${baseUrl}/api/classroom/sessions/${lessonId}/top-performers`, {
      headers: teacherHeaders,
    });
    const data2 = (await res2.json()) as any;
    expect(data2).toEqual(data1);

    const statsWarm = diagnosticService.getCacheStats();
    expect(statsWarm.hits).toBeGreaterThanOrEqual(1);

    // 学生提交新作答
    const newStudentId = `stu-top-${Date.now()}`;
    db.prepare('INSERT OR REPLACE INTO students (id, name, created_at) VALUES (?, ?, ?)').run(
      newStudentId,
      '黑马学生',
      now,
    );
    await diagnosticService.submitQuiz({
      lessonId,
      elementId: 'quiz_cache_1',
      studentId: newStudentId,
      studentName: '黑马学生',
      answer: 'A',
      timeSpentMs: 800,
    });

    // 提交后缓存主动失效，再次查询立即返回最新榜单（包含 2 名学生）
    const res3 = await fetch(`${baseUrl}/api/classroom/sessions/${lessonId}/top-performers`, {
      headers: teacherHeaders,
    });
    const data3 = (await res3.json()) as any;
    expect(data3.topPerformers.length).toBe(2);
    expect(data3.topPerformers.some((p: any) => p.studentId === newStudentId)).toBe(true);
  });

  it('2. pacing-summary 节奏晴雨表聚合命中缓存并在提交节奏信号后立即主动失效', async () => {
    await startSession();

    // 第一次获取节奏汇总（冷启动）
    const res1 = await fetch(`${baseUrl}/api/classroom/sessions/${lessonId}/pacing-summary`, {
      headers: teacherHeaders,
    });
    const data1 = (await res1.json()) as any;
    expect(res1.status).toBe(200);
    expect(data1.overallSummary.TOO_FAST).toBe(0);

    // 第二次获取：从 classroomReadCache 命中
    const res2 = await fetch(`${baseUrl}/api/classroom/sessions/${lessonId}/pacing-summary`, {
      headers: teacherHeaders,
    });
    const data2 = (await res2.json()) as any;
    expect(data2).toEqual(data1);
    expect(classroomReadCache.getStats().hits).toBeGreaterThanOrEqual(1);

    // 学生提交节奏信号：TOO_FAST
    const postRes = await fetch(`${baseUrl}/api/classroom/sessions/${lessonId}/pacing`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({ signal: 'TOO_FAST' }),
    });
    expect(postRes.status).toBe(200);

    // 写事件触发主动失效，再次获取应立即体现 TOO_FAST = 1
    const res3 = await fetch(`${baseUrl}/api/classroom/sessions/${lessonId}/pacing-summary`, {
      headers: teacherHeaders,
    });
    const data3 = (await res3.json()) as any;
    expect(data3.overallSummary.TOO_FAST).toBe(1);
  });

  it('3. exit-ticket-summary 结课通票汇总命中缓存并在提交通票后立即主动失效', async () => {
    await startSession();

    // 第一次获取：0 人提交
    const res1 = await fetch(`${baseUrl}/api/classroom/sessions/${lessonId}/exit-ticket-summary`, {
      headers: teacherHeaders,
    });
    const data1 = (await res1.json()) as any;
    expect(res1.status).toBe(200);
    expect(data1.totalCount).toBe(0);

    // 第二次获取：从只读缓存返回
    const res2 = await fetch(`${baseUrl}/api/classroom/sessions/${lessonId}/exit-ticket-summary`, {
      headers: teacherHeaders,
    });
    const data2 = (await res2.json()) as any;
    expect(data2).toEqual(data1);
    expect(classroomReadCache.getStats().hits).toBeGreaterThanOrEqual(1);

    // 学生提交通票
    const ticketRes = await fetch(`${baseUrl}/api/classroom/sessions/${lessonId}/exit-ticket`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({
        rating: 5,
        puzzledConcept: '角动量守恒',
        feedbackNotes: '讲得很清楚',
        coreAnswer: 'L=r*p',
        challengeAnswer: 'done',
      }),
    });
    expect(ticketRes.status).toBe(200);

    // 提交后缓存立即失效，查询总数应为 1
    const res3 = await fetch(`${baseUrl}/api/classroom/sessions/${lessonId}/exit-ticket-summary`, {
      headers: teacherHeaders,
    });
    const data3 = (await res3.json()) as any;
    expect(data3.totalCount).toBe(1);
    expect(data3.puzzledConcepts).toContain('角动量守恒');
  });

  it('4. stage/:lessonId/data 大屏接口只读聚合缓存与投票/签到一致性', async () => {
    await startSession();

    // 第一次拉取大屏数据
    const res1 = await fetch(`${baseUrl}/api/classroom/stage/${lessonId}/data`, { headers: teacherHeaders });
    const data1 = (await res1.json()) as any;
    expect(res1.status).toBe(200);

    // 第二次拉取：命中缓存
    const res2 = await fetch(`${baseUrl}/api/classroom/stage/${lessonId}/data`, { headers: teacherHeaders });
    const data2 = (await res2.json()) as any;
    expect(data2.activePoll).toEqual(data1.activePoll);
    expect(classroomReadCache.getStats().hits).toBeGreaterThanOrEqual(1);

    // 发起极速投票并投票
    const pollRes = await fetch(`${baseUrl}/api/classroom/sessions/${lessonId}/quick-poll`, {
      method: 'POST',
      headers: teacherHeaders,
      body: JSON.stringify({ title: '理解了吗', options: ['A.懂了', 'B.迷糊'] }),
    });
    const pollData = (await pollRes.json()) as any;
    const pollId = pollData.poll.id;

    // 学生投票
    const voteRes = await fetch(`${baseUrl}/api/classroom/sessions/${lessonId}/quick-poll/${pollId}/vote`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({ lessonId, option: 'A.懂了' }),
    });
    expect(voteRes.status).toBe(200);

    // 投票后缓存失效，大屏数据应立即包含更新后的投票分布
    const res3 = await fetch(`${baseUrl}/api/classroom/stage/${lessonId}/data`, { headers: teacherHeaders });
    const data3 = (await res3.json()) as any;
    expect(data3.activePoll).not.toBeNull();
    expect(data3.activePoll.distribution['A.懂了']).toBe(1);
  });

  it('5. panoramic-report 全景学情简报只读缓存与主动失效', async () => {
    await startSession();

    // 第一次拉取全景报告
    const res1 = await fetch(`${baseUrl}/api/classroom/sessions/${lessonId}/panoramic-report`, {
      headers: teacherHeaders,
    });
    const data1 = (await res1.json()) as any;
    expect(res1.status).toBe(200);
    expect(data1.success).toBe(true);

    // 第二次拉取：命中只读缓存
    const res2 = await fetch(`${baseUrl}/api/classroom/sessions/${lessonId}/panoramic-report`, {
      headers: teacherHeaders,
    });
    const data2 = (await res2.json()) as any;
    expect(data2).toEqual(data1);
    expect(classroomReadCache.getStats().hits).toBeGreaterThanOrEqual(1);
  });
});
