/**
 * 通用考试课件得分采集 E2E 测试
 * ============================================================
 *
 * 目标：验证「与平台零耦合的通用考试课件」的得分如何被平台
 * 原生采集并记入「学习情况」与「学期成绩」：
 *
 *   通用课件 postMessage(LMS_SUBMIT / LMS_FINISH / LMS_SAVE_PROGRESS)
 *     → lms-bridge.ts 转译（inprogress / completed + adopt 认领）
 *       → POST /api/courseware/attempts/:id/submit
 *         → submission_raw 流水 + aggregateAttemptScore 策略聚合
 *           → submission_result.score（学习情况权威数据）
 *             → 教师端 /promote → assignment_submissions（作业成绩维度）
 *               → grading.ts semester-grades 聚合进 学期成绩
 *
 * fixtures：server/fixtures/demo-courseware/*.html（3 套通用考试课件）
 * 这些课件不依赖平台任何 API —— 只用「任意 LMS 都通用」的 postMessage 通道，
 * 确保测试测的是平台通用采集能力，而非为平台定制的课件。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import path from 'path';
import fs from 'fs';
import { registerCoursewareRoutes } from '../routes/courseware.js';
import { registerGradingRoutes } from '../routes/grading.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { extractScoreCommentCompletion } from '../utils/score-extract.js';
import {
  readLmsSubmitFromFixture,
  readLmsFinishFromFixture,
  readLmsSaveProgressFromFixture,
} from './helpers/fixture-messages.js';

const FIXTURES = path.resolve(process.cwd(), 'server/fixtures/demo-courseware');
const TEACHER_TOKEN = 'tok-capture-teacher-001';
const STUDENT_TOKEN = 'tok-capture-student-001';
const classId = 'cls-capture-001';
const semesterName = '2026年春季学期';

let app: express.Express;
let server: Server;
let baseUrl: string;
let lessonId: string;
let createdAssignments: string[] = [];

const createdAttemptIds: string[] = [];

beforeAll(async () => {
  const now = Date.now();
  const db = kernelContainer.db;

  db.prepare(
    'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('usr-capture-teacher', 'capture_teacher', 'x', 'teacher', '采集教师', now);
  db.prepare(
    'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(
    TEACHER_TOKEN,
    JSON.stringify({ userId: 'usr-capture-teacher', role: 'teacher', username: 'capture_teacher' }),
    now,
    now + 60 * 60 * 1000,
  );
  db.prepare(
    'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('stu-capture-001', 'capture_stu', 'x', 'student', '采集学生甲', now);
  db.prepare(
    'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(
    STUDENT_TOKEN,
    JSON.stringify({ userId: 'stu-capture-001', role: 'student', username: 'capture_stu' }),
    now,
    now + 60 * 60 * 1000,
  );
  db.prepare(
    'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(classId, '采集E2E班', '得分采集链路测试班', 'pass-capture', now);
  db.prepare(
    'INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run('stu-capture-001', 'cap-001', '采集学生甲', 'cap@test', now);
  db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
    classId,
    'stu-capture-001',
    now,
  );

  // 课件行 —— 3 套通用课件各自一行
  for (const name of ['simple-quiz', 'result-screen-quiz', 'fill-answers-quiz']) {
    db.prepare('INSERT OR REPLACE INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      `cw-cap-${name}`,
      `cw-cap-uuid-${name}`,
      `通用课件 · ${name}`,
      'html',
      'index.html',
      now,
    );
  }

  lessonId = `lesson-capture-${now}`;
  db.prepare(
    'INSERT OR REPLACE INTO lessons (id, title, content, timeline, progress_mode, progress_conditions, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(lessonId, '采集E2E课', null, null, 'manual', null, 'usr-capture-teacher', now, now);
  db.prepare(
    'INSERT OR REPLACE INTO schedules (id, class_id, lesson_id, scheduled_date, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(`sched-capture-${now}`, classId, lessonId, new Date(now).toISOString().slice(0, 10), now);

  // courseware_score_config 表来自 migrations/004，内核自身 schema 不含它。
  // 测试环境未运行 migrations，这里手工建表（对齐 migrations/004_courseware_score_config.sql）。
  const dbAny = db as any;
  dbAny.exec(`CREATE TABLE IF NOT EXISTS courseware_score_config (
    courseware_id TEXT PRIMARY KEY,
    courseware_name TEXT,
    score_policy TEXT NOT NULL DEFAULT 'LATEST',
    score_fields TEXT NOT NULL DEFAULT '',
    raw_full_score REAL NOT NULL DEFAULT 100,
    target_full_score REAL NOT NULL DEFAULT 100,
    weight_percentage REAL NOT NULL DEFAULT 100,
    lesson_id TEXT,
    updated_at INTEGER NOT NULL
  )`);

  app = express();
  app.use(express.json());
  // 注入「学生身份」sessions —— 通用课件 iframe 内部的上报最终都来自学生 session
  app.use((req, _res, next) => {
    const token = req.headers.cookie?.match?.(/edu_os_token=([^;]+)/)?.[1];
    if (token === STUDENT_TOKEN) {
      (req as any).session = { userId: 'stu-capture-001', role: 'student', username: 'capture_stu' };
    } else if (token === TEACHER_TOKEN) {
      (req as any).session = { userId: 'usr-capture-teacher', role: 'teacher', username: 'capture_teacher' };
    }
    next();
  });
  registerCoursewareRoutes({ app, io: { emit: () => {}, to: () => ({ emit: () => {} }) } } as any);
  registerGradingRoutes({ app, io: { emit: () => {}, to: () => ({ emit: () => {} }) } } as any);

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  const db = kernelContainer.db;
  db.prepare('DELETE FROM assignment_submissions WHERE assignment_id LIKE ?').run('ast-cw-%');
  db.prepare('DELETE FROM assignments WHERE title LIKE ?').run('互动课件:%');
  db.prepare('DELETE FROM student_lesson_progress WHERE lesson_id = ?').run(lessonId);
  db.prepare('DELETE FROM submission_result WHERE attempt_id LIKE ?').run('att-capture-%');
  db.prepare('DELETE FROM submission_raw WHERE attempt_id LIKE ?').run('att-capture-%');
  db.prepare('DELETE FROM courseware_attempt WHERE id LIKE ?').run('att-capture-%');
  db.prepare('DELETE FROM courseware_score_config WHERE courseware_id LIKE ?').run('cw-cap-%');
  db.prepare('DELETE FROM courseware WHERE id LIKE ?').run('cw-cap-%');
  db.prepare('DELETE FROM schedules WHERE class_id = ?').run(classId);
  db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
  db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
  db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
  db.prepare('DELETE FROM students WHERE id = ?').run('stu-capture-001');
  db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?)').run(TEACHER_TOKEN, STUDENT_TOKEN);
  db.prepare('DELETE FROM users WHERE id IN (?, ?)').run('usr-capture-teacher', 'stu-capture-001');
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

// —— lms-bridge 模拟：通用课件 postMessage 消息 → 平台 HTTP 提交 ——
// 复刻 src/services/lms-bridge.ts 的关键路由语义（isSubmit / isSaveProgress → status 映射），
// 以 HTTP 方式驱动真实路由（produce submission_result），等同于前端 bridge 的行为。
async function bridgeDeliver(
  attemptId: string,
  message: { type: string; payload: any },
): Promise<Response> {
  const isSubmit = message.type === 'LMS_SUBMIT' || message.type === 'LMS_FINISH';
  const status = isSubmit ? 'completed' : 'inprogress';
  const res = await fetch(`${baseUrl}/api/courseware/attempts/${attemptId}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `edu_os_token=${STUDENT_TOKEN}` },
    body: JSON.stringify({
      score: message.payload?.score,
      completion: message.payload?.completion ?? 1.0,
      status,
      extra: message.payload,
    }),
  });
  return res;
}

async function startAttempt(coursewareId: string, studentId = 'stu-capture-001'): Promise<string> {
  const attemptId = `att-capture-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  kernelContainer.db
    .prepare('INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, status) VALUES (?, ?, ?, ?, ?)')
    .run(attemptId, coursewareId, studentId, Date.now(), 'active');
  createdAttemptIds.push(attemptId);
  return attemptId;
}

function expectScoreRow(attemptId: string) {
  const row = kernelContainer.db
    .prepare('SELECT score FROM submission_result WHERE attempt_id = ?')
    .get(attemptId) as { score: number };
  expect(row).toBeTruthy();
  return row.score;
}

describe('通用考试课件得分采集 → 学习情况 / 学期成绩 全链路', () => {
  // ── FIXTURE #1：simple-quiz（LMS_SUBMIT 通道，90 分制）───────
  it('simple-quiz: window.LMS.submit 显式提交 60/90 → submission_result 保留原始分', async () => {
    const fixture = readFixture('simple-quiz.html');
    // 从通用课件中解析「学生点击提交按钮产生的 postMessage」
    const message = readLmsSubmitFromFixture(fixture, { score: 60, completion: 1.0 });
    const attempt = await startAttempt('cw-cap-simple-quiz');
    const res = await bridgeDeliver(attempt, message);
    expect(res.status).toBe(200);

    // 无显式策略配置的历史行为：每小时一次分数，原样保存（不缩放）
    expect(expectScoreRow(attempt)).toBe(60);

    // 学生端自己的日志通道：逐事件 log 不会破坏已有分数
    const logRes = await fetch(`${baseUrl}/api/courseware/attempts/${attempt}/log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `edu_os_token=${STUDENT_TOKEN}` },
      body: JSON.stringify({ eventType: 'view', payload: { foo: 'bar' } }),
    });
    expect(logRes.status).toBe(200);
    expect(expectScoreRow(attempt)).toBe(60); // 无分数 payload 不覆盖已有 result
  });

  // ── FIXTURE #2：result-screen-quiz（结算页 X/Y → 百分制）────
  it('result-screen-quiz: 结算页 4/5 → extractScoreCommentCompletion 识别为 4 → 保存', async () => {
    // 平台通用「结算页探测」: bridge SDK __lmsExtractResultScore 从 #correctCount 读取 4/5
    // 转成 80 分后调用 LMS.submit({score: 80})，payload = {score: 80, completion: 1}
    const fixture = readFixture('result-screen-quiz.html');
    const message = readLmsFinishFromFixture(fixture, { score: 80, completion: 1.0, comment: '结算页自动提取得分' });
    const attempt = await startAttempt('cw-cap-result-screen-quiz');
    const res = await bridgeDeliver(attempt, message);
    expect(res.status).toBe(200);

    // 终态 status='completed' → courseware_attempt.finished_at 落库
    const attemptRow = kernelContainer.db
      .prepare('SELECT status, finished_at FROM courseware_attempt WHERE id = ?')
      .get(attempt) as any;
    expect(['finished', 'completed']).toContain(attemptRow.status);
    expect(attemptRow.finished_at).not.toBeNull();
    expect(expectScoreRow(attempt)).toBe(80);
  });

  // ── FIXTURE #3：fill-answers-quiz（SAVE_PROGRESS 多样本 → AVERAGE）─
  it('fill-answers-quiz: LMS_SAVE_PROGRESS 3 次样本 + MAX 策略聚合 + promote', async () => {
    const fixture = readFixture('fill-answers-quiz.html');
    const attempt = await startAttempt('cw-cap-fill-answers-quiz');
    // 配置该课件使用 MAX 策略、原始满分 100、目标满分 100
    kernelContainer.db
      .prepare(
        `INSERT OR REPLACE INTO courseware_score_config
         (courseware_id, courseware_name, score_policy, score_fields, raw_full_score, target_full_score, weight_percentage, lesson_id, updated_at)
         VALUES ('cw-cap-fill-answers-quiz','填空测验课件','MAX','',100,100,100,NULL,?)`,
      )
      .run(Date.now());

    // 学生逐题作答产生的 3 次 SAVE_PROGRESS（0 → 40 → 70）
    for (const score of [0, 40, 70]) {
      const message = readLmsSaveProgressFromFixture(fixture, { score, completion: score / 100 });
      const res = await bridgeDeliver(attempt, message);
      expect(res.status).toBe(200);
    }
    // MAX 策略聚合 0/40/70 → 70，归一化（raw 100 → target 100）保持 70
    expect(expectScoreRow(attempt)).toBe(70);

    // 教师端「保存为作业成绩」→ promote 进学期成绩 assignment 维度
    const promote = await fetch(`${baseUrl}/api/courseware/attempts/${attempt}/promote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `edu_os_token=${TEACHER_TOKEN}` },
      body: JSON.stringify({ lessonId, classId }),
    });
    expect(promote.status).toBe(200);
    const pjson = (await promote.json()) as { assignmentId: string; score: number };
    expect(pjson.score).toBe(70);
    createdAssignments.push(pjson.assignmentId);
  });

  it('promote 后的成绩能被学期成绩接口（grading）按权重聚合可见', async () => {
    // 前面已经 promote 过一次（40 分）。这里直接查学期成绩看 assignment 维度
    const res = await fetch(`${baseUrl}/api/classes/${classId}/semester-grades?semesterName=${encodeURIComponent(semesterName)}`, {
      headers: { cookie: `edu_os_token=${TEACHER_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const student = body.students.find((s: any) => s.studentId === 'stu-capture-001');
    expect(student).toBeDefined();
    // 课件 promote 分 = 70 → 已计入 assignment_score（average 分 = 70）
    expect(student.assignmentScore).toBe(70);
  });

  // ── 覆盖 4 种聚合策略 ───────────────────────────────────────
  describe('courseware_score_config 策略聚合', () => {
    it('策略 = AVERAGE：多次上报取均值并缩放到目标满分', async () => {
      const attempt = await startAttempt('cw-cap-simple-quiz');
      kernelContainer.db
        .prepare(
          `INSERT OR REPLACE INTO courseware_score_config
           (courseware_id, courseware_name, score_policy, score_fields, raw_full_score, target_full_score, weight_percentage, lesson_id, updated_at)
           VALUES ('cw-cap-simple-quiz','simple-quiz 配置','AVERAGE','',90,100,100,NULL,?)`,
        )
        .run(Date.now());
      for (const s of [30, 60, 90]) {
        await bridgeDeliver(attempt, { type: 'LMS_SAVE_PROGRESS', payload: { score: s } });
      }
      // mean(30,60,90)=60, raw_full 90 → target_full 100 = 66.67 → round 66.67 → clamp 66.67
      expect(expectScoreRow(attempt)).toBeCloseTo(66.67, 1);
    });

    it('策略 = FIRST：首个样本生效', async () => {
      const attempt = await startAttempt('cw-cap-simple-quiz');
      kernelContainer.db
        .prepare(
          `INSERT OR REPLACE INTO courseware_score_config
           (courseware_id, courseware_name, score_policy, score_fields, raw_full_score, target_full_score, weight_percentage, lesson_id, updated_at)
           VALUES ('cw-cap-simple-quiz', 'simple-quiz', 'FIRST', '', 90, 100, 100, NULL, ?)`,
        )
        .run(Date.now());
      for (const s of [45, 75, 90]) {
        await bridgeDeliver(attempt, { type: 'LMS_SAVE_PROGRESS', payload: { score: s } });
      }
      // first = 45 → 缩放 45/90*100 = 50
      expect(expectScoreRow(attempt)).toBe(50);
    });

    it('策略 = LATEST（默认）保留最后一次', async () => {
      const attempt = await startAttempt('cw-cap-simple-quiz');
      kernelContainer.db
        .prepare(
          `INSERT OR REPLACE INTO courseware_score_config
           (courseware_id, courseware_name, score_policy, score_fields, raw_full_score, target_full_score, weight_percentage, lesson_id, updated_at)
           VALUES ('cw-cap-simple-quiz', 'simple-quiz config', 'LATEST', '', 90, 100, 100, NULL, ?)`,
        )
        .run(Date.now());
      for (const s of [9, 27, 81]) {
        await bridgeDeliver(attempt, { type: 'LMS_SAVE_PROGRESS', payload: { score: s } });
      }
      // 81/90*100 = 90
      expect(expectScoreRow(attempt)).toBe(90);
    });
  });

  // ── 通用课件的消息兼容性守护 ─────────────────────────────────
  it('extractScoreCommentCompletion 能从 3 套通用课件 payload 中提取出分数', () => {
    const samples = [
      { type: 'simple-quiz payload', payload: { score: 60, completion: 1.0, comment: 'simple-quiz 提交' } },
      { type: 'result-screen payload', payload: { score: 80, completion: 1.0, comment: '结算页自动提取得分' } },
      { type: 'fill-answers payload', payload: { score: 40, completion: 0.4 } },
    ];
    for (const { payload } of samples) {
      const extracted = extractScoreCommentCompletion(payload);
      expect(extracted.score).toBeDefined();
      expect(typeof extracted.score).toBe('number');
    }
  });
});

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}
