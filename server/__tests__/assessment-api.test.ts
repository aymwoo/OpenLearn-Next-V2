/**
 * @vitest-environment node
 *
 * Issue #100 / 子 issue #120：测评子系统 REST API 全链路。
 *
 * 覆盖验收标准里的硬要求：
 * - 5 种内置题型可组卷、可判分（含多选部分得分、简答进人工队列）
 * - **标准答案不出现在任何学生端响应**（哨兵字符串全量断言）
 * - 组卷即快照：改题库不影响已组卷内容
 * - 客观题自动判分 + 简答人工批改；人工改过的分不被 regrade 覆盖（幂等）
 * - 匿名问卷：HMAC 去重防重复提交、教师端不含身份、管理员反查写审计
 * - 考试：交卷后不公布，教师 release 后才可见
 * - 惰性超时结算
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { setAuditSinkForTests } from '../../packages/core/observability/audit-log.js';
import { registerAssessmentRoutes } from '../routes/assessments.js';
import { ensureTestSchema } from './helpers/test-schema.js';

/** 哨兵：任何学生端响应里出现它就等于答案泄漏 */
const SENTINEL = 'ANSWER-KEY-SENTINEL-107';

const TEACHER_TOKEN = 'tok_assess_teacher';
const STUDENT_TOKEN = 'tok_assess_student';
const OTHER_STUDENT_TOKEN = 'tok_assess_student_2';
const ADMIN_TOKEN = 'tok_assess_admin';
const CLASS_ID = 'cls_assess_1';
const STUDENT_ID = 'stu_assess_1';
const OTHER_STUDENT_ID = 'stu_assess_2';

let server: Server;
let baseUrl: string;

async function call(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
): Promise<{ status: number; text: string; json: any; headers: Headers }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { cookie: `edu_os_token=${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, text, json, headers: res.headers };
}

function seedSession(token: string, session: Record<string, unknown>) {
  kernelContainer.db.prepare('DELETE FROM client_sessions WHERE id = ?').run(token);
  kernelContainer.db
    .prepare('INSERT INTO client_sessions (id, session_data, expires_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(token, JSON.stringify(session), Date.now() + 3_600_000, Date.now());
}

/** 断言一段文本里没有任何答案字段泄漏 */
function expectNoAnswerLeak(text: string, label: string) {
  expect(text, `${label} 泄漏了标准答案`).not.toContain(SENTINEL);
  expect(text, `${label} 出现了 answerKey 字段`).not.toContain('answerKey');
  expect(text, `${label} 出现了 answer_key 字段`).not.toContain('answer_key');
}

beforeAll(async () => {
  ensureTestSchema();

  // 干净的测试数据
  const db = kernelContainer.db;
  db.prepare('DELETE FROM class_students WHERE class_id = ?').run(CLASS_ID);
  db.prepare('DELETE FROM classes WHERE id = ?').run(CLASS_ID);
  db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(STUDENT_ID, OTHER_STUDENT_ID);
  db.prepare('DELETE FROM assessment_answers').run();
  db.prepare('DELETE FROM assessment_attempts').run();
  db.prepare('DELETE FROM assessment_assignments').run();
  db.prepare('DELETE FROM assessment_items').run();
  db.prepare('DELETE FROM question_bank_items').run();
  db.prepare('DELETE FROM assessments').run();

  db.prepare('INSERT INTO classes (id, name, created_at) VALUES (?, ?, ?)').run(CLASS_ID, '测评测试班', Date.now());
  for (const sid of [STUDENT_ID, OTHER_STUDENT_ID]) {
    db.prepare('INSERT INTO students (id, student_number, name, created_at) VALUES (?, ?, ?, ?)').run(
      sid,
      sid === STUDENT_ID ? 'STU-A-1' : 'STU-A-2',
      sid === STUDENT_ID ? '测评学生一' : '测评学生二',
      Date.now(),
    );
    db.prepare('INSERT INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      CLASS_ID,
      sid,
      Date.now(),
    );
  }

  seedSession(TEACHER_TOKEN, { userId: 'usr_assess_teacher', username: 'assess_teacher', role: 'teacher' });
  seedSession(ADMIN_TOKEN, { userId: 'usr_admin', username: 'admin', role: 'administrator' });
  seedSession(STUDENT_TOKEN, { userId: STUDENT_ID, studentId: STUDENT_ID, role: 'student', username: 'stu_a1' });
  seedSession(OTHER_STUDENT_TOKEN, { userId: OTHER_STUDENT_ID, studentId: OTHER_STUDENT_ID, role: 'student' });

  const app = express();
  app.use(express.json());
  registerAssessmentRoutes({ app } as any);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  setAuditSinkForTests(null);
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

const ITEMS = [
  {
    type: 'single_choice',
    stem: '单选：1+1=?',
    config: { options: ['1', '2', '3'] },
    answerKey: { index: 1 },
    maxScore: 10,
    sortOrder: 0,
  },
  {
    type: 'multiple_choice',
    stem: '多选：偶数有哪些',
    config: { options: ['1', '2', '3', '4'] },
    answerKey: { indexes: [1, 3] },
    maxScore: 10,
    sortOrder: 1,
  },
  {
    type: 'fill_blank',
    stem: '填空：植物的能量来源是？',
    config: { blanks: [{ id: 'b1' }] },
    answerKey: { blanks: [[SENTINEL]] },
    maxScore: 10,
    sortOrder: 2,
  },
  {
    type: 'short_answer',
    stem: '简答：说说你的理解',
    config: { maxLength: 200 },
    answerKey: null,
    maxScore: 20,
    sortOrder: 3,
  },
];

describe('Issue #120 · 测评 API', () => {
  describe('题库与组卷（组卷即快照）', () => {
    it('题库条目可建、可查；组卷后改题库不影响已组卷内容', async () => {
      const bank = await call('POST', '/api/question-bank', TEACHER_TOKEN, {
        type: 'single_choice',
        stem: '题库题：首都是？',
        config: { options: ['北京', '上海'] },
        answerKey: { index: 0 },
        maxScore: 5,
      });
      expect(bank.status).toBe(201);
      const bankId = bank.json.id;

      const created = await call('POST', '/api/assessments', TEACHER_TOKEN, {
        kind: 'quiz',
        title: '快照验证',
        settings: { maxAttempts: 1 },
      });
      expect(created.status).toBe(201);

      const withItem = await call('PUT', `/api/assessments/${created.json.id}/items`, TEACHER_TOKEN, {
        items: [
          {
            bankItemId: bankId,
            type: 'single_choice',
            stem: '题库题：首都是？',
            config: { options: ['北京', '上海'] },
            answerKey: { index: 0 },
            maxScore: 5,
          },
        ],
      });
      expect(withItem.status).toBe(200);
      expect(withItem.json.items).toHaveLength(1);
      expect(withItem.json.items[0].answerKey).toEqual({ index: 0 });

      // 删掉题库条目后，试卷快照仍在
      const del = await call('DELETE', `/api/question-bank/${bankId}`, TEACHER_TOKEN);
      expect(del.status).toBe(200);
      const after = await call('GET', `/api/assessments/${created.json.id}`, TEACHER_TOKEN);
      expect(after.json.items).toHaveLength(1);
      expect(after.json.items[0].stem).toContain('题库题');
      expect(after.json.items[0].bankItemId).toBe(bankId);
    });

    it('非法题型 / 非法答案格式被拒（400）', async () => {
      const created = await call('POST', '/api/assessments', TEACHER_TOKEN, { kind: 'quiz', title: '校验' });
      const bad = await call('PUT', `/api/assessments/${created.json.id}/items`, TEACHER_TOKEN, {
        items: [{ type: 'no_such_type', stem: 'x', config: {}, maxScore: 1 }],
      });
      expect(bad.status).toBe(400);
      const badKey = await call('PUT', `/api/assessments/${created.json.id}/items`, TEACHER_TOKEN, {
        items: [
          { type: 'single_choice', stem: 'x', config: { options: ['a', 'b'] }, answerKey: { index: 9 }, maxScore: 1 },
        ],
      });
      expect(badKey.status).toBe(400);
    });

    it('空试卷不能发布（409）', async () => {
      const created = await call('POST', '/api/assessments', TEACHER_TOKEN, { kind: 'quiz', title: '空卷' });
      const res = await call('POST', `/api/assessments/${created.json.id}/publish`, TEACHER_TOKEN, {
        classId: CLASS_ID,
      });
      expect(res.status).toBe(409);
    });
  });

  describe('quiz 全链路：自动判分 + 人工批改 + 幂等', () => {
    let assessmentId = '';
    let assignmentId = '';
    let attemptId = '';
    let itemIds: string[] = [];

    it('教师创建 → 组卷 → 发布', async () => {
      const created = await call('POST', '/api/assessments', TEACHER_TOKEN, {
        kind: 'quiz',
        title: '单元小测',
        settings: { maxAttempts: 3, scorePolicy: 'highest', resultVisibility: 'immediate', showItemAnalysis: true },
      });
      expect(created.status).toBe(201);
      assessmentId = created.json.id;

      const withItems = await call('PUT', `/api/assessments/${assessmentId}/items`, TEACHER_TOKEN, { items: ITEMS });
      expect(withItems.status).toBe(200);
      itemIds = withItems.json.items.map((i: any) => i.id);
      expect(itemIds).toHaveLength(4);

      const published = await call('POST', `/api/assessments/${assessmentId}/publish`, TEACHER_TOKEN, {
        classId: CLASS_ID,
        durationSec: 3600,
      });
      expect(published.status).toBe(201);
      assignmentId = published.json.id;
      expect(published.json.academicYear).toBeTruthy();
    });

    it('学生列表能看到待完成测评', async () => {
      const res = await call('GET', '/api/me/assessments', STUDENT_TOKEN);
      expect(res.status).toBe(200);
      const entry = res.json.items.find((i: any) => i.assignmentId === assignmentId);
      expect(entry).toBeDefined();
      expect(entry.completed).toBe(false);
      expect(entry.windowState).toBe('open');
    });

    it('开始作答：学生端题目不含答案字段（哨兵断言）', async () => {
      const res = await call('POST', `/api/assessment-assignments/${assignmentId}/attempts`, STUDENT_TOKEN);
      expect(res.status).toBe(201);
      expectNoAnswerLeak(res.text, '开始作答响应');
      expect(res.json.items).toHaveLength(4);
      expect(res.json.attempt.remainingSeconds).toBeGreaterThan(0);
      attemptId = res.json.attempt.id;
    });

    it('自动保存单题作答，且响应不含答案', async () => {
      const res = await call('PUT', `/api/assessment-attempts/${attemptId}/answers/${itemIds[0]}`, STUDENT_TOKEN, {
        answer: 1,
      });
      expect(res.status).toBe(200);
      expectNoAnswerLeak(res.text, '自动保存响应');
    });

    it('交卷：客观题自动判分、简答进人工队列、多选部分得分', async () => {
      await call('PUT', `/api/assessment-attempts/${attemptId}/answers/${itemIds[1]}`, STUDENT_TOKEN, { answer: [1] });
      await call('PUT', `/api/assessment-attempts/${attemptId}/answers/${itemIds[2]}`, STUDENT_TOKEN, {
        answer: SENTINEL,
      });
      await call('PUT', `/api/assessment-attempts/${attemptId}/answers/${itemIds[3]}`, STUDENT_TOKEN, {
        answer: '这是我的理解',
      });

      const res = await call('POST', `/api/assessment-attempts/${attemptId}/submit`, STUDENT_TOKEN);
      expect(res.status).toBe(200);
      // 单选 10 + 多选少选 5(一半) + 填空 10 + 简答待批 → 25
      expect(res.json.attempt.score).toBe(25);
      expect(res.json.attempt.maxScore).toBe(50);
      expect(res.json.attempt.needsManualReview).toBe(true);
      // 交了卷且 immediate + showItemAnalysis → 允许看解析（含标准答案）
      expect(res.json.showAnalysis).toBe(true);
      expect(res.text).toContain(SENTINEL);
    });

    it('重复交卷幂等：分数不变', async () => {
      const again = await call('POST', `/api/assessment-attempts/${attemptId}/submit`, STUDENT_TOKEN);
      expect(again.status).toBe(200);
      expect(again.json.attempt.score).toBe(25);
    });

    it('教师批改简答题 → 总分重算、人工队列清空', async () => {
      const graded = await call(
        'PUT',
        `/api/assessment-attempts/${attemptId}/answers/${itemIds[3]}/grade`,
        TEACHER_TOKEN,
        { score: 16, feedback: '思路清晰' },
      );
      expect(graded.status).toBe(200);
      expect(graded.json.attempt.score).toBe(41);
      expect(graded.json.attempt.needsManualReview).toBe(false);
    });

    it('人工改过的分不被 regrade 覆盖（幂等 + manual_override）', async () => {
      const regraded = await call('POST', `/api/assessment-attempts/${attemptId}/regrade`, TEACHER_TOKEN);
      expect(regraded.status).toBe(200);
      // 简答仍是 16（不是自动判分能给出的值），其余题重算后仍是 25
      expect(regraded.json.attempt.score).toBe(41);
    });

    it('教师统计与导出 CSV', async () => {
      const stats = await call('GET', `/api/assessment-assignments/${assignmentId}/stats`, TEACHER_TOKEN);
      expect(stats.status).toBe(200);
      expect(stats.json.attemptCount).toBe(1);
      expect(stats.json.submittedCount).toBe(1);
      expect(stats.json.items).toHaveLength(4);
      expect(stats.json.items[0].maxScore).toBeGreaterThan(0);

      const csv = await call('GET', `/api/assessment-assignments/${assignmentId}/export?format=csv`, TEACHER_TOKEN);
      expect(csv.status).toBe(200);
      expect(csv.headers.get('content-type')).toContain('text/csv');
      expect(csv.text).toContain('身份');
      expect(csv.text).toContain(STUDENT_ID);
    });

    it('非 owner 教师不能访问别人的试卷（403）', async () => {
      seedSession('tok_assess_other_teacher', {
        userId: 'usr_other_teacher',
        username: 'other_teacher',
        role: 'teacher',
      });
      const res = await call('GET', `/api/assessments/${assessmentId}`, 'tok_assess_other_teacher');
      expect(res.status).toBe(403);
    });

    it('学生不能读取教师接口（403）', async () => {
      const res = await call('GET', `/api/assessments/${assessmentId}`, STUDENT_TOKEN);
      expect(res.status).toBe(403);
    });
  });

  describe('教师端 UI 依赖的两个端点（Issue #121）', () => {
    let assessmentId = '';
    let assignmentId = '';
    let attemptId = '';
    let shortAnswerItemId = '';

    it('GET /api/assessments/:id/assignments 返回班级名与交卷进度', async () => {
      const created = await call('POST', '/api/assessments', TEACHER_TOKEN, { kind: 'quiz', title: 'UI 用布置列表' });
      assessmentId = created.json.id;
      const withItems = await call('PUT', `/api/assessments/${assessmentId}/items`, TEACHER_TOKEN, { items: ITEMS });
      shortAnswerItemId = withItems.json.items.find((i: any) => i.type === 'short_answer').id;
      const published = await call('POST', `/api/assessments/${assessmentId}/publish`, TEACHER_TOKEN, {
        classId: CLASS_ID,
      });
      assignmentId = published.json.id;

      const list = await call('GET', `/api/assessments/${assessmentId}/assignments`, TEACHER_TOKEN);
      expect(list.status).toBe(200);
      expect(list.json.items).toHaveLength(1);
      expect(list.json.items[0]).toMatchObject({
        id: assignmentId,
        classId: CLASS_ID,
        className: '测评测试班',
        status: 'open',
        attemptCount: 0,
        submittedCount: 0,
        pendingReviewCount: 0,
      });
    });

    it('GET /api/assessment-attempts/:id/teacher-view 返回逐题作答与标准答案', async () => {
      const started = await call('POST', `/api/assessment-assignments/${assignmentId}/attempts`, STUDENT_TOKEN);
      attemptId = started.json.attempt.id;
      // 用真实 itemId 提交两道题（单选取对、简答留待批改）
      const detail = await call('GET', `/api/assessments/${assessmentId}`, TEACHER_TOKEN);
      const singleId = detail.json.items.find((i: any) => i.type === 'single_choice').id;
      const shortId = detail.json.items.find((i: any) => i.type === 'short_answer').id;
      shortAnswerItemId = shortId;
      await call('PUT', `/api/assessment-attempts/${attemptId}/answers/${singleId}`, STUDENT_TOKEN, { answer: 1 });
      await call('PUT', `/api/assessment-attempts/${attemptId}/answers/${shortId}`, STUDENT_TOKEN, {
        answer: '我的简答',
      });
      const submitted = await call('POST', `/api/assessment-attempts/${attemptId}/submit`, STUDENT_TOKEN);
      expect(submitted.status).toBe(200);

      const view = await call('GET', `/api/assessment-attempts/${attemptId}/teacher-view`, TEACHER_TOKEN);
      expect(view.status).toBe(200);
      expect(view.json.attempt.studentId).toBe(STUDENT_ID);
      const single = view.json.items.find((i: any) => i.type === 'single_choice');
      const short = view.json.items.find((i: any) => i.type === 'short_answer');
      // 教师视角始终带标准答案
      expect(single.answerKey).toEqual({ index: 1 });
      expect(single.score).toBe(10);
      // 简答：作答原文在、分数为空、待人工批改
      expect(short.answer).toBe('我的简答');
      expect(short.score).toBeNull();
      expect(short.needsManualReview).toBe(true);
    });

    it('非 owner 教师访问这两个端点都是 403', async () => {
      seedSession('tok_assess_other_teacher2', {
        userId: 'usr_other_teacher2',
        username: 'other_teacher2',
        role: 'teacher',
      });
      const a = await call('GET', `/api/assessments/${assessmentId}/assignments`, 'tok_assess_other_teacher2');
      expect(a.status).toBe(403);
      const b = await call('GET', `/api/assessment-attempts/${attemptId}/teacher-view`, 'tok_assess_other_teacher2');
      expect(b.status).toBe(403);
    });
  });

  describe('考试模式：交卷后不公布，release 后可见', () => {
    let assignmentId = '';
    let attemptId = '';
    let itemId = '';

    it('exam 强制 after_release：未发布时学生看不到分数', async () => {
      const created = await call('POST', '/api/assessments', TEACHER_TOKEN, {
        kind: 'exam',
        title: '期中考试',
        settings: { resultVisibility: 'immediate' }, // 会被强制改成 after_release
      });
      const assessmentId = created.json.id;
      const withItems = await call('PUT', `/api/assessments/${assessmentId}/items`, TEACHER_TOKEN, {
        items: [ITEMS[0]],
      });
      itemId = withItems.json.items[0].id;
      const published = await call('POST', `/api/assessments/${assessmentId}/publish`, TEACHER_TOKEN, {
        classId: CLASS_ID,
      });
      assignmentId = published.json.id;

      const started = await call('POST', `/api/assessment-assignments/${assignmentId}/attempts`, STUDENT_TOKEN);
      expect(started.status).toBe(201);
      expect(started.json.assignment.settings.resultVisibility).toBe('after_release');
      attemptId = started.json.attempt.id;

      await call('PUT', `/api/assessment-attempts/${attemptId}/answers/${itemId}`, STUDENT_TOKEN, { answer: 1 });
      const submitted = await call('POST', `/api/assessment-attempts/${attemptId}/submit`, STUDENT_TOKEN);
      expect(submitted.status).toBe(200);
      expect(submitted.json.attempt.score).toBeNull();
      expect(submitted.json.showAnalysis).toBe(false);
      expectNoAnswerLeak(submitted.text, '考试交卷响应（未发布成绩）');
    });

    it('教师发布成绩后学生才看到分数与答案', async () => {
      const released = await call('POST', `/api/assessment-assignments/${assignmentId}/release`, TEACHER_TOKEN);
      expect(released.status).toBe(200);

      const result = await call('GET', `/api/assessment-attempts/${attemptId}/result`, STUDENT_TOKEN);
      expect(result.status).toBe(200);
      expect(result.json.attempt.score).toBe(10);
      expect(result.json.showAnalysis).toBe(true);
      // 发布后才允许看解析 → 该题的 answerKey 出现（本题是单选，key 是索引）
      expect(result.json.items[0].answerKey).toEqual({ index: 1 });
    });
  });

  describe('匿名问卷：去重 / 隐私 / 管理员反查', () => {
    let assignmentId = '';
    let attemptId = '';

    it('匿名作答：教师端看不到身份，学生不能重复提交', async () => {
      const created = await call('POST', '/api/assessments', TEACHER_TOKEN, {
        kind: 'survey',
        title: '课堂反馈问卷',
        settings: { anonymous: true },
      });
      const assessmentId = created.json.id;
      await call('PUT', `/api/assessments/${assessmentId}/items`, TEACHER_TOKEN, {
        items: [
          {
            type: 'single_choice',
            stem: '你满意吗',
            config: { options: ['满意', '一般', '不满意'] },
            maxScore: 1,
            sortOrder: 0,
          },
        ],
      });
      const published = await call('POST', `/api/assessments/${assessmentId}/publish`, TEACHER_TOKEN, {
        classId: CLASS_ID,
      });
      assignmentId = published.json.id;

      const started = await call('POST', `/api/assessment-assignments/${assignmentId}/attempts`, STUDENT_TOKEN);
      expect(started.status).toBe(201);
      attemptId = started.json.attempt.id;

      const submitted = await call('POST', `/api/assessment-attempts/${attemptId}/submit`, STUDENT_TOKEN);
      expect(submitted.status).toBe(200);

      // 同一学生再次开始 → 409（问卷 maxAttempts 恒为 1）
      const again = await call('POST', `/api/assessment-assignments/${assignmentId}/attempts`, STUDENT_TOKEN);
      expect(again.status).toBe(409);

      // 教师端列表：没有 studentId / anonKey，只有匿名编号
      const attempts = await call('GET', `/api/assessment-assignments/${assignmentId}/attempts`, TEACHER_TOKEN);
      expect(attempts.status).toBe(200);
      expect(attempts.json.items).toHaveLength(1);
      expect(attempts.json.items[0].studentId).toBeNull();
      expect(attempts.json.items[0].anonymousLabel).toContain('匿名');
      expect(attempts.text).not.toContain(STUDENT_ID);
      expect(attempts.text).not.toContain('anonKey');

      // 统计里也不能出现学号
      const stats = await call('GET', `/api/assessment-assignments/${assignmentId}/stats`, TEACHER_TOKEN);
      expect(stats.text).not.toContain(STUDENT_ID);

      // 导出 CSV 同样是匿名编号
      const csv = await call('GET', `/api/assessment-assignments/${assignmentId}/export`, TEACHER_TOKEN);
      expect(csv.text).toContain('匿名');
      expect(csv.text).not.toContain(STUDENT_ID);
    });

    it('管理员反查会返回学号并写审计；普通教师无权', async () => {
      const audits: any[] = [];
      setAuditSinkForTests((record) => audits.push(record));

      const denied = await call('POST', `/api/assessment-attempts/${attemptId}/reveal-identity`, TEACHER_TOKEN);
      expect(denied.status).toBe(403);

      const ok = await call('POST', `/api/assessment-attempts/${attemptId}/reveal-identity`, ADMIN_TOKEN);
      expect(ok.status).toBe(200);
      expect(ok.json.studentId).toBe(STUDENT_ID);
      expect(audits.some((a) => a.event === 'assessment.anonymous_identity_revealed')).toBe(true);
      setAuditSinkForTests(null);
    });
  });

  describe('惰性超时结算', () => {
    it('deadline 已过的作答在任意读取时结算为 submitted 并判分', async () => {
      const created = await call('POST', '/api/assessments', TEACHER_TOKEN, {
        kind: 'quiz',
        title: '超时结算',
        settings: { resultVisibility: 'immediate' },
      });
      const assessmentId = created.json.id;
      const withItems = await call('PUT', `/api/assessments/${assessmentId}/items`, TEACHER_TOKEN, {
        items: [ITEMS[0]],
      });
      const itemId = withItems.json.items[0].id;
      const published = await call('POST', `/api/assessments/${assessmentId}/publish`, TEACHER_TOKEN, {
        classId: CLASS_ID,
      });
      const assignmentId = published.json.id;

      const started = await call('POST', `/api/assessment-assignments/${assignmentId}/attempts`, OTHER_STUDENT_TOKEN);
      const attemptId = started.json.attempt.id;
      await call('PUT', `/api/assessment-attempts/${attemptId}/answers/${itemId}`, OTHER_STUDENT_TOKEN, { answer: 1 });

      // 手工把 deadline 拨到过去（模拟超时），再读一次
      kernelContainer.db
        .prepare('UPDATE assessment_attempts SET deadline_at = ?, status = ? WHERE id = ?')
        .run(Date.now() - 1000, 'in_progress', attemptId);

      const result = await call('GET', `/api/assessment-attempts/${attemptId}/result`, OTHER_STUDENT_TOKEN);
      expect(result.status).toBe(200);
      // 超时结算后立即自动判分：全部题都判完 → status 直接从 in_progress 到 graded
      expect(['submitted', 'graded']).toContain(result.json.attempt.status);
      expect(result.json.attempt.score).toBe(10);
    });
  });

  describe('题型清单接口', () => {
    it('返回 5 种内置题型，供出题页与 manifest 校验', async () => {
      const res = await call('GET', '/api/assessment-question-types', TEACHER_TOKEN);
      expect(res.status).toBe(200);
      const types = res.json.questionTypes.map((t: any) => t.type);
      expect(types).toEqual(
        expect.arrayContaining(['single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'short_answer']),
      );
      const shortAnswer = res.json.questionTypes.find((t: any) => t.type === 'short_answer');
      expect(shortAnswer.autoGradable).toBe(false);
    });
  });
});
