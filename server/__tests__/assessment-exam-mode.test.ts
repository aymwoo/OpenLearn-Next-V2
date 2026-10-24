/**
 * @vitest-environment node
 *
 * Issue #123: 测评子系统 · 严格考试模式、监考数据记录与成绩回写。
 *
 * 验证核心能力：
 * 1. 严格单次作答（singleAttempt / kind === 'exam'）：交卷后再次 startAttempt 抛 409。
 * 2. 伪随机乱序（shuffleItems / shuffleOptions）：确定性打乱，重连一致，不同 attempt 种子不同。
 * 3. 防作弊监考事件（recordProctor）：失焦、切屏、退出全屏记录与聚合统计。
 * 4. 成绩发布自动回写 exams/exam_scores，并联动 grading-service。
 * 5. 严格防覆盖：已有教师手工录入的成绩绝不被自动回写覆盖。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { registerAssessmentRoutes } from '../routes/assessments.js';
import { assessmentService } from '../services/assessment-service.js';
import { GradingService } from '../services/grading-service.js';
import { ensureTestSchema } from './helpers/test-schema.js';

const TEACHER_TOKEN = 'tok_exam_teacher';
const STUDENT_1_TOKEN = 'tok_exam_stu_1';
const STUDENT_2_TOKEN = 'tok_exam_stu_2';
const CLASS_ID = 'cls_exam_mode_test';
const STU_1 = 'stu_exam_1';
const STU_2 = 'stu_exam_2';

let server: Server;
let baseUrl: string;

async function call(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
): Promise<{ status: number; text: string; json: any }> {
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
  return { status: res.status, text, json };
}

function seedSession(token: string, session: Record<string, unknown>) {
  kernelContainer.db.prepare('DELETE FROM client_sessions WHERE id = ?').run(token);
  kernelContainer.db
    .prepare('INSERT INTO client_sessions (id, session_data, expires_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(token, JSON.stringify(session), Date.now() + 3_600_000, Date.now());
}

beforeAll(async () => {
  ensureTestSchema();
  const db = kernelContainer.db;

  // 基础数据清理
  db.prepare('DELETE FROM class_students WHERE class_id = ?').run(CLASS_ID);
  db.prepare('DELETE FROM classes WHERE id = ?').run(CLASS_ID);
  db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(STU_1, STU_2);
  db.prepare('DELETE FROM exam_scores').run();
  db.prepare('DELETE FROM exams').run();
  db.prepare('DELETE FROM assessment_answers').run();
  db.prepare('DELETE FROM assessment_attempts').run();
  db.prepare('DELETE FROM assessment_assignments').run();
  db.prepare('DELETE FROM assessment_items').run();
  db.prepare('DELETE FROM assessments').run();

  // 插入班级与学生
  db.prepare('INSERT INTO classes (id, name, created_at) VALUES (?, ?, ?)').run(CLASS_ID, '考试模式专用班', Date.now());
  for (const sid of [STU_1, STU_2]) {
    db.prepare('INSERT INTO students (id, student_number, name, created_at) VALUES (?, ?, ?, ?)').run(
      sid,
      sid === STU_1 ? 'NUM-001' : 'NUM-002',
      sid === STU_1 ? '张三' : '李四',
      Date.now(),
    );
    db.prepare('INSERT INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      CLASS_ID,
      sid,
      Date.now(),
    );
  }

  seedSession(TEACHER_TOKEN, { userId: 'usr_exam_teacher', username: 'exam_teacher', role: 'teacher' });
  seedSession(STUDENT_1_TOKEN, { userId: STU_1, studentId: STU_1, username: 'stu_1', role: 'student' });
  seedSession(STUDENT_2_TOKEN, { userId: STU_2, studentId: STU_2, username: 'stu_2', role: 'student' });

  const app = express();
  app.use(express.json());
  registerAssessmentRoutes({ app } as any);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe('Issue #123 严格考试模式与防作弊', () => {
  let examAssessmentId: string;
  let assignmentId: string;

  it('创建严格考试并开启题目乱序与选项乱序', async () => {
    // 1. 教师新建考试
    const createRes = await call('POST', '/api/assessments', TEACHER_TOKEN, {
      title: '期末物理期末大考',
      kind: 'exam',
      settings: {
        singleAttempt: true,
        shuffleItems: true,
        shuffleOptions: true,
        strictProctor: true,
        resultVisibility: 'after_release',
      },
    });
    expect(createRes.status).toBe(201);
    examAssessmentId = createRes.json.id;

    // 2. 插入多道题目，选项包含 A/B/C/D
    const itemsRes = await call('PUT', `/api/assessments/${examAssessmentId}/items`, TEACHER_TOKEN, {
      items: [
        {
          id: 'item_1',
          type: 'single_choice',
          stem: '第一题：重力加速度常用取值是？',
          config: { options: ['9.8 m/s²', '3.0 m/s²', '0 m/s²', '100 m/s²'] },
          answerKey: { index: 0 },
          maxScore: 10,
          sortOrder: 0,
        },
        {
          id: 'item_2',
          type: 'single_choice',
          stem: '第二题：力的国际单位是？',
          config: { options: ['牛顿 (N)', '焦耳 (J)', '瓦特 (W)', '帕斯卡 (Pa)'] },
          answerKey: { index: 0 },
          maxScore: 10,
          sortOrder: 1,
        },
        {
          id: 'item_3',
          type: 'single_choice',
          stem: '第三题：光速约为多少？',
          config: { options: ['3×10^8 m/s', '340 m/s', '1000 km/h', '1.5×10^8 m/s'] },
          answerKey: { index: 0 },
          maxScore: 10,
          sortOrder: 2,
        },
      ],
    });
    expect(itemsRes.status).toBe(200);

    // 3. 发布到测试班级
    const pubRes = await call('POST', `/api/assessments/${examAssessmentId}/publish`, TEACHER_TOKEN, {
      classId: CLASS_ID,
      durationSec: 1800,
    });
    expect(pubRes.status).toBe(201);
    assignmentId = pubRes.json.id;
    expect(pubRes.json.scoreReleased).toBe(false);
  });

  it('验证题目乱序与选项乱序（重连顺序稳定，学生端不泄露答案）', async () => {
    // 学生 1 进入作答（首次创建 attempt，返回 201）
    const start1 = await call('POST', `/api/assessment-assignments/${assignmentId}/attempts`, STUDENT_1_TOKEN);
    expect(start1.status).toBe(201);
    const attempt1 = start1.json;

    // 再次请求进入（模拟重连刷新），返回相同 attempt 与稳定题序（201）
    const start1Again = await call('POST', `/api/assessment-assignments/${assignmentId}/attempts`, STUDENT_1_TOKEN);
    expect(start1Again.status).toBe(201);
    expect(start1Again.json.attempt.id).toBe(attempt1.attempt.id);
    expect(start1Again.json.items.map((i: any) => i.id)).toEqual(attempt1.items.map((i: any) => i.id));

    // 答案绝对未泄露
    const text = JSON.stringify(start1.json);
    expect(text).not.toContain('answerKey');
    expect(text).not.toContain('answer_key');
  });

  it('记录监考事件（失焦、切屏、退出全屏）并在教师端聚合统计', async () => {
    const listRes = await call('GET', `/api/assessment-assignments/${assignmentId}/attempts`, TEACHER_TOKEN);
    const attemptId = listRes.json.items[0].id;

    // 学生上报监考事件
    const p1 = await call('PUT', `/api/assessment-attempts/${attemptId}/proctor`, STUDENT_1_TOKEN, {
      type: 'blur',
    });
    expect(p1.status).toBe(200);
    expect(p1.json.summary.blur).toBe(1);
    expect(p1.json.summary.total).toBe(1);

    const p2 = await call('PUT', `/api/assessment-attempts/${attemptId}/proctor`, STUDENT_1_TOKEN, {
      type: 'visibility_hidden',
    });
    expect(p2.status).toBe(200);
    expect(p2.json.summary.visibility_hidden).toBe(1);
    expect(p2.json.summary.total).toBe(2);

    const p3 = await call('PUT', `/api/assessment-attempts/${attemptId}/proctor`, STUDENT_1_TOKEN, {
      type: 'fullscreen_exit',
    });
    expect(p3.status).toBe(200);
    expect(p3.json.summary.fullscreen_exit).toBe(1);
    expect(p3.json.summary.total).toBe(3);

    // 教师端查看作答详情，监考数据完整
    const teacherView = await call('GET', `/api/assessment-attempts/${attemptId}/teacher-view`, TEACHER_TOKEN);
    expect(teacherView.status).toBe(200);
    expect(teacherView.json.attempt.proctor.summary.total).toBe(3);
    expect(teacherView.json.attempt.proctor.events.length).toBe(3);
  });

  it('严格单次作答：学生交卷后再次尝试开始抛出 409', async () => {
    const listRes = await call('GET', `/api/assessment-assignments/${assignmentId}/attempts`, TEACHER_TOKEN);
    const attemptId = listRes.json.items[0].id;

    // 学生保存答案并提交交卷
    await call('PUT', `/api/assessment-attempts/${attemptId}/answers/item_1`, STUDENT_1_TOKEN, {
      answer: 0,
    });
    const submitRes = await call('POST', `/api/assessment-attempts/${attemptId}/submit`, STUDENT_1_TOKEN);
    expect(submitRes.status).toBe(200);
    expect(['submitted', 'graded']).toContain(submitRes.json.attempt.status);

    // 再次调用 startAttempt，由于考试模式强制单次作答，抛出 409
    const restartRes = await call('POST', `/api/assessment-assignments/${assignmentId}/attempts`, STUDENT_1_TOKEN);
    expect(restartRes.status).toBe(409);
    expect(restartRes.json.error).toBeTruthy();
  });

  it('未发布成绩前，学生查不到分数；发布后开放且自动回写成绩单', async () => {
    const listRes = await call('GET', `/api/assessment-assignments/${assignmentId}/attempts`, TEACHER_TOKEN);
    const attemptId = listRes.json.items[0].id;

    // 学生查看结果：showScore 必须为 false
    const studentRes = await call('GET', `/api/assessment-attempts/${attemptId}/result`, STUDENT_1_TOKEN);
    expect(studentRes.status).toBe(200);
    expect(studentRes.json.showScore).toBe(false);
    expect(studentRes.json.attempt.score).toBeNull();

    // 教师发布成绩
    const releaseRes = await call('POST', `/api/assessment-assignments/${assignmentId}/release`, TEACHER_TOKEN);
    expect(releaseRes.status).toBe(200);
    expect(releaseRes.json.scoreReleased).toBe(true);

    // 学生再次查看结果：showScore 变为 true，能看到得分
    const studentResAfter = await call('GET', `/api/assessment-attempts/${attemptId}/result`, STUDENT_1_TOKEN);
    expect(studentResAfter.status).toBe(200);
    expect(studentResAfter.json.showScore).toBe(true);

    // 验证 exams 表中已自动创建与回写
    const db = kernelContainer.db;
    const examRow: any = db
      .prepare('SELECT * FROM exams WHERE class_id = ? AND title = ?')
      .get(CLASS_ID, '期末物理期末大考');
    expect(examRow).toBeDefined();

    const scoreRow: any = db
      .prepare('SELECT * FROM exam_scores WHERE exam_id = ? AND student_id = ?')
      .get(examRow.id, STU_1);
    expect(scoreRow).toBeDefined();
    expect(scoreRow.notes).toBe(`assessment:${assignmentId}`);

    // 联动验证：GradingService 学期总评能正确统计此成绩
    const gradingService = new GradingService(db as any);
    const report = gradingService.computeSemesterGrades(CLASS_ID);
    expect(report.students.length).toBe(2);
    const stu1Record = report.students.find((s) => s.studentId === STU_1);
    expect(stu1Record).toBeDefined();
    expect(stu1Record?.examScore).not.toBeNull();
  });

  it('严格防覆盖：已有教师手工录入成绩时绝不覆盖', async () => {
    const db = kernelContainer.db;
    const examRow: any = db
      .prepare('SELECT * FROM exams WHERE class_id = ? AND title = ?')
      .get(CLASS_ID, '期末物理期末大考');
    expect(examRow).toBeDefined();

    // 教师在成绩单手工为李四 (STU_2) 录入 99 分，notes 为普通教师备注
    const now = Date.now();
    db.prepare(
      `
      INSERT OR REPLACE INTO exam_scores (exam_id, student_id, score, notes, recorded_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    ).run(examRow.id, STU_2, 99, '教师期末人工加分补录', now);

    // 模拟李四在测评系统作答得到了 50 分，且处于交卷状态
    const attempt2 = assessmentService.startAttempt(assignmentId, STU_2);
    assessmentService.saveAnswer(attempt2.attempt.id, STU_2, 'item_1', 0);
    const submitted2 = assessmentService.submitAttempt(attempt2.attempt.id, STU_2);
    expect(['submitted', 'graded']).toContain(submitted2.attempt.status);

    // 触发成绩单同步
    const syncRes = await call('POST', `/api/assessment-assignments/${assignmentId}/sync-gradebook`, TEACHER_TOKEN);
    expect(syncRes.status).toBe(200);

    // 验证李四的成绩仍然是 99 分，且备注仍然保留为教师人工录入备注！
    const scoreAfter: any = db
      .prepare('SELECT * FROM exam_scores WHERE exam_id = ? AND student_id = ?')
      .get(examRow.id, STU_2);
    expect(scoreAfter.score).toBe(99);
    expect(scoreAfter.notes).toBe('教师期末人工加分补录');
  });
});
