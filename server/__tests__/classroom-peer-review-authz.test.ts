import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerClassroomPeerReviewRoutes } from '../routes/classroom-peer-review.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ensureTestSchema } from './helpers/test-schema.js';

/**
 * 回归测试 —— 课中互评的班级归属授权（Issue #221）。
 *
 * 背景：`server/routes/classroom-peer-review.ts` 的 7 个路由**全部只做角色校验**，
 * 没有任何班级 / 课节归属判断。任意登录用户凭任意 lessonId 就能：
 *   - GET 互评展示 → 读到别人班的互评匹配矩阵（谁评了谁、量规得分、评语）
 *   - POST 弹幕 → 往别人课堂刷屏
 *   - POST 勋章 / 提名 → 污染别人课堂的勋章流与提名榜
 *
 * 修复后：教师须是该课堂的任课教师，学生须属于该课堂所在班级；管理员不受限。
 */
describe('课中互评的班级归属授权（#221）', () => {
  let server: Server;
  let baseUrl: string;
  const db = kernelContainer.db;

  const classA = 'cls-prauth-a';
  const classB = 'cls-prauth-b';
  const lessonA = 'les-prauth-a';
  const lessonB = 'les-prauth-b';
  const sessionA = 'sess-prauth-a';
  const sessionB = 'sess-prauth-b';

  const teacherA = 'usr-prauth-ta';
  const teacherB = 'usr-prauth-tb';
  const studentA = 'stu-prauth-a';
  const outsider = 'stu-prauth-outsider';

  const teacherAToken = 'tok-prauth-ta';
  const teacherBToken = 'tok-prauth-tb';
  const studentAToken = 'tok-prauth-sa';
  const outsiderToken = 'tok-prauth-out';

  const call = (method: string, path: string, token: string, body?: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { Cookie: `edu_os_token=${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  beforeAll(async () => {
    ensureTestSchema();

    const app = express();
    app.use(express.json());
    registerClassroomPeerReviewRoutes(app);

    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const now = Date.now();
    const exp = now + 3600_000;
    const insUser = db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insUser.run(teacherA, 'prauth_ta', 'x', 'teacher', '教师A', now);
    insUser.run(teacherB, 'prauth_tb', 'x', 'teacher', '教师B', now);
    insUser.run(studentA, 'prauth_sa', 'x', 'student', '学生A', now);
    insUser.run(outsider, 'prauth_out', 'x', 'student', '旁观学生', now);

    const insSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insSession.run(
      teacherAToken,
      JSON.stringify({ userId: teacherA, role: 'teacher', username: 'prauth_ta' }),
      now,
      exp,
    );
    insSession.run(
      teacherBToken,
      JSON.stringify({ userId: teacherB, role: 'teacher', username: 'prauth_tb' }),
      now,
      exp,
    );
    insSession.run(
      studentAToken,
      JSON.stringify({ userId: studentA, role: 'student', username: 'prauth_sa' }),
      now,
      exp,
    );
    insSession.run(
      outsiderToken,
      JSON.stringify({ userId: outsider, role: 'student', username: 'prauth_out' }),
      now,
      exp,
    );

    db.prepare('INSERT OR REPLACE INTO classes (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)').run(
      classA,
      '互评A班',
      teacherA,
      now,
    );
    db.prepare('INSERT OR REPLACE INTO classes (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)').run(
      classB,
      '互评B班',
      teacherB,
      now,
    );
    db.prepare('INSERT OR REPLACE INTO lessons (id, title, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      lessonA,
      '互评A课节',
      teacherA,
      now,
      now,
    );
    db.prepare('INSERT OR REPLACE INTO lessons (id, title, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      lessonB,
      '互评B课节',
      teacherB,
      now,
      now,
    );

    for (const [id, name] of [
      [studentA, '学生A'],
      [outsider, '旁观学生'],
    ] as const) {
      db.prepare('INSERT OR REPLACE INTO students (id, name, student_number, created_at) VALUES (?, ?, ?, ?)').run(
        id,
        name,
        name,
        now,
      );
    }
    // 只有学生A 在 A 班；旁观学生不在任何班
    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      classA,
      studentA,
      now,
    );

    db.prepare('DELETE FROM classroom_sessions WHERE id IN (?, ?)').run(sessionA, sessionB);
    db.prepare(
      `INSERT INTO classroom_sessions (id, lesson_id, class_id, teacher_id, stage, started_at, created_at)
       VALUES (?, ?, ?, ?, 'IN_CLASS_TEACHING', ?, ?)`,
    ).run(sessionA, lessonA, classA, teacherA, now, now);
    db.prepare(
      `INSERT INTO classroom_sessions (id, lesson_id, class_id, teacher_id, stage, started_at, created_at)
       VALUES (?, ?, ?, ?, 'IN_CLASS_TEACHING', ?, ?)`,
    ).run(sessionB, lessonB, classB, teacherB, now, now);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    db.prepare('DELETE FROM classroom_danmaku WHERE lesson_id IN (?, ?)').run(lessonA, lessonB);
    db.prepare('DELETE FROM classroom_peer_badges WHERE lesson_id IN (?, ?)').run(lessonA, lessonB);
    db.prepare('DELETE FROM classroom_peer_review_tasks WHERE session_id IN (?, ?)').run(sessionA, sessionB);
    db.prepare('DELETE FROM classroom_sessions WHERE id IN (?, ?)').run(sessionA, sessionB);
    db.prepare('DELETE FROM class_students WHERE class_id IN (?, ?)').run(classA, classB);
    db.prepare('DELETE FROM classes WHERE id IN (?, ?)').run(classA, classB);
    db.prepare('DELETE FROM lessons WHERE id IN (?, ?)').run(lessonA, lessonB);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?, ?)').run(
      teacherAToken,
      teacherBToken,
      studentAToken,
      outsiderToken,
    );
    db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(studentA, outsider);
    db.prepare('DELETE FROM users WHERE id IN (?, ?, ?, ?)').run(teacherA, teacherB, studentA, outsider);
  });

  it('课节所属教师可以读取本班的互评展示', async () => {
    const res = await call('GET', `/api/classroom/sessions/${lessonA}/peer-review`, teacherAToken);
    expect(res.status).toBe(200);
  });

  it('其他教师读取他人课堂的互评展示被拒', async () => {
    const res = await call('GET', `/api/classroom/sessions/${lessonA}/peer-review`, teacherBToken);
    expect(res.status).toBe(403);
  });

  it('不在该班的学生读取互评展示被拒', async () => {
    const res = await call('GET', `/api/classroom/sessions/${lessonA}/peer-review`, outsiderToken);
    expect(res.status).toBe(403);
  });

  it('本班学生可以读取互评展示', async () => {
    const res = await call('GET', `/api/classroom/sessions/${lessonA}/peer-review`, studentAToken);
    expect(res.status).toBe(200);
  });

  it('其他教师在他班课堂分配互评任务被拒', async () => {
    const res = await call('POST', `/api/classroom/sessions/${lessonA}/peer-review/auto-assign`, teacherBToken, {
      perStudent: 2,
    });
    expect(res.status).toBe(403);
  });

  it('不在该班的学生发弹幕被拒，且未落库', async () => {
    const res = await call('POST', `/api/classroom/sessions/${lessonA}/danmaku`, outsiderToken, { text: '越权弹幕' });
    expect(res.status).toBe(403);
    const rows = db.prepare('SELECT id FROM classroom_danmaku WHERE lesson_id = ? AND text = ?').all(lessonA, '越权弹幕');
    expect(rows).toHaveLength(0);
  });

  it('不在该班的学生发勋章被拒，且未落库', async () => {
    const res = await call('POST', `/api/classroom/sessions/${lessonA}/peer-review/badges`, outsiderToken, {
      receiverId: studentA,
      badgeKey: 'praise',
    });
    expect(res.status).toBe(403);
    const rows = db.prepare('SELECT id FROM classroom_peer_badges WHERE lesson_id = ?').all(lessonA);
    expect(rows).toHaveLength(0);
  });

  it('本班学生发弹幕正常放行（修复未误伤正常路径）', async () => {
    const res = await call('POST', `/api/classroom/sessions/${lessonA}/danmaku`, studentAToken, { text: '本班弹幕' });
    expect(res.status).toBe(200);
    const rows = db.prepare('SELECT id FROM classroom_danmaku WHERE lesson_id = ? AND text = ?').all(lessonA, '本班弹幕');
    expect(rows).toHaveLength(1);
  });
});
