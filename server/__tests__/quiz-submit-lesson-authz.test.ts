/**
 * 回归测试 —— 随堂测验提交的归属与答案防泄漏（Issue #223）。
 *
 * 背景：`POST /api/lessons/:id/quiz-submit` 此前只做了角色校验：
 *   1. 任意学生可以对**任意** lessonId 提交随堂测验 —— 既能读到该题的正确答案
 *      （提交后回传 correctIndex），又能在不属于自己的班级里留下成绩记录；
 *   2. 提交响应回传 correctIndex（提交后看答案解析是既有设计），而落库是 upsert 覆盖，
 *      于是「先错后对」重交一次即可把分数刷成满分；
 *   3. `whiteboard.quiz_answered` 事件投递给课节房间 + 班级房间，payload 里带着
 *      correctAnswer / correctIndex —— 全班学生只要等别人答完就拿到了答案。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerLessonsRoutes } from '../routes/lessons.js';
import type { ServerContext } from '../context.js';
import type { ClassroomEventType } from '../classroom-events.js';
import { DiagnosticService } from '../services/diagnostic-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ensureTestSchema } from './helpers/test-schema.js';

describe('随堂测验提交的归属与答案防泄漏（#223）', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const db = kernelContainer.db;

  const classA = 'cls-qauthz-a';
  const classB = 'cls-qauthz-b';
  const lessonB = 'les-qauthz-b';
  const elementB = 'el-qauthz-b';

  const teacherB = 'usr-qauthz-tb';
  const studentInB = 'stu-qauthz-in-b';
  const outsider = 'stu-qauthz-out';

  const studentInBToken = 'tok-qauthz-in-b';
  const outsiderToken = 'tok-qauthz-out';

  const post = (token: string, lessonId: string, elementId: string, answer: unknown) =>
    fetch(`${baseUrl}/api/lessons/${lessonId}/quiz-submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `edu_os_token=${token}` },
      body: JSON.stringify({ elementId, answer }),
    });

  beforeAll(async () => {
    ensureTestSchema();

    app = express();
    app.use(express.json());
    registerLessonsRoutes({
      app,
      io: { emit: () => {} },
      loginLimiter: null,
      aiLimiter: null,
      activityRegistry: null,
    } as unknown as ServerContext);

    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, '127.0.0.1', () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const now = Date.now();
    const exp = now + 3_600_000;
    const insUser = db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insUser.run(teacherB, 'qauthz_tb', 'x', 'teacher', 'B班教师', now);
    insUser.run(studentInB, 'qauthz_in_b', 'x', 'student', 'B班学生', now);
    insUser.run(outsider, 'qauthz_out', 'x', 'student', '别班学生', now);

    const insSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insSession.run(
      studentInBToken,
      JSON.stringify({ userId: studentInB, studentId: studentInB, role: 'student', username: 'qauthz_in_b' }),
      now,
      exp,
    );
    insSession.run(
      outsiderToken,
      JSON.stringify({ userId: outsider, studentId: outsider, role: 'student', username: 'qauthz_out' }),
      now,
      exp,
    );

    db.prepare('INSERT OR REPLACE INTO classes (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)').run(
      classA,
      'A班',
      'usr-qauthz-ta',
      now,
    );
    db.prepare('INSERT OR REPLACE INTO classes (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)').run(
      classB,
      'B班',
      teacherB,
      now,
    );
    for (const [id, name] of [
      [studentInB, 'B班学生'],
      [outsider, '别班学生'],
    ] as const) {
      db.prepare('INSERT OR REPLACE INTO students (id, name, student_number, created_at) VALUES (?, ?, ?, ?)').run(
        id,
        name,
        name,
        now,
      );
    }
    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      classB,
      studentInB,
      now,
    );
    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      classA,
      outsider,
      now,
    );

    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(lessonB, 'B班课节', teacherB, now, now);
    // 课节绑定班级 B
    db.prepare('DELETE FROM classroom_sessions WHERE id = ?').run('sess-qauthz-b');
    db.prepare(
      `INSERT INTO classroom_sessions (id, lesson_id, class_id, teacher_id, stage, started_at, created_at)
       VALUES (?, ?, ?, ?, 'IN_CLASS_TEACHING', ?, ?)`,
    ).run('sess-qauthz-b', lessonB, classB, teacherB, now, now);

    // 随堂测验元素：正确答案 B
    db.prepare('DELETE FROM whiteboard_elements WHERE id = ?').run(elementB);
    db.prepare('INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
      elementB,
      lessonB,
      'quiz',
      JSON.stringify({ question: '哪一项？', options: ['A', 'B', 'C', 'D'], correctIndex: 1 }),
      now,
    );
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    db.prepare('DELETE FROM lesson_quiz_submissions WHERE lesson_id = ?').run(lessonB);
    db.prepare('DELETE FROM whiteboard_elements WHERE id = ?').run(elementB);
    db.prepare('DELETE FROM classroom_sessions WHERE id = ?').run('sess-qauthz-b');
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonB);
    db.prepare('DELETE FROM class_students WHERE class_id IN (?, ?)').run(classA, classB);
    db.prepare('DELETE FROM classes WHERE id IN (?, ?)').run(classA, classB);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?)').run(studentInBToken, outsiderToken);
    db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(studentInB, outsider);
    db.prepare('DELETE FROM users WHERE id IN (?, ?, ?)').run(teacherB, studentInB, outsider);
  });

  it('别班学生对他班课节提交随堂测验被拒（403）', async () => {
    const res = await post(outsiderToken, lessonB, elementB, 0);
    expect(res.status).toBe(403);
    const rows = db
      .prepare('SELECT id FROM lesson_quiz_submissions WHERE lesson_id = ? AND student_id = ?')
      .all(lessonB, outsider);
    expect(rows).toHaveLength(0);
  });

  it('本班学生提交随堂测验正常放行', async () => {
    const res = await post(studentInBToken, lessonB, elementB, 1);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success?: boolean; isCorrect?: boolean; score?: number };
    expect(body.success).toBe(true);
    expect(body.isCorrect).toBe(true);
    expect(body.score).toBe(100);
  });

  it('重复提交不覆盖首次提交的成绩（首次提交即定分）', async () => {
    // 首次提交已记 100 分（上面用例答的是 B）
    const res = await post(studentInBToken, lessonB, elementB, 0);
    expect(res.status).toBe(200);
    const row = db
      .prepare(
        'SELECT score, is_correct FROM lesson_quiz_submissions WHERE lesson_id = ? AND element_id = ? AND student_id = ?',
      )
      .get(lessonB, elementB, studentInB) as { score: number; is_correct: number };
    // 分数仍是首次提交的 100 —— 否则学生可以「先错后对」用答案解析刷满分
    expect(row.score).toBe(100);
    expect(row.is_correct).toBe(1);
  });

  it('作答事件不再广播答案（correctAnswer / correctIndex）', async () => {
    const published: Array<{ type: string; payload: Record<string, unknown> }> = [];
    // 泛型签名与 publishClassroomEvent<T> 对齐，才能直接作为 DiagnosticService 的 publisher。
    const publisher = async <T>(type: ClassroomEventType, payload: T) => {
      published.push({ type, payload: payload as unknown as Record<string, unknown> });
    };
    const service = new DiagnosticService(kernelContainer.db, publisher);

    await service.submitQuiz({
      lessonId: lessonB,
      elementId: elementB,
      studentId: 'stu-qauthz-event',
      studentName: '事件学生',
      answer: 1,
      skipStageGuard: true,
    });

    expect(published).toHaveLength(1);
    const payload = published[0].payload;
    expect(payload.isCorrect).toBe(true);
    // 事件投递给课节房间 + 班级房间，全班学生都会收到 —— 里面不能带答案
    expect(payload.correctAnswer).toBeUndefined();
    expect(payload.correctIndex).toBeUndefined();
  });
});
