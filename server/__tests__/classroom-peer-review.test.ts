import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import path from 'path';
import { registerClassroomPeerReviewRoutes } from '../routes/classroom-peer-review.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { loadMigrationsFromDirectory, runMigrations } from '../utils/migrate.js';

/**
 * 课中互评 API 契约测试（Stitch 21e2dac1 全班大屏互评）。
 *
 * 锁死六件事：
 *   1. 鉴权：写操作需登录，教师专属操作学生不可调用；
 *   2. 分配：作品不足 2 份时拒绝；正常分配不产生「自己评自己」的任务；
 *   3. 展示：返回的数据全部来自真实表（无 mock 学生/作品）；
 *   4. 提交：越界分数 400；学生只能提交自己的任务（防代评）；重复提交走 UPDATE 不产生第二条；
 *   5. 徽章/提名：未知 badgeKey 400；不能提名自己；幂等（重复提交不重复计数）；
 *   6. 弹幕：空文本 400；超长截断到 120 字。
 */
describe('课中互评 API（classroom-peer-review）', () => {
  let server: Server;
  let baseUrl: string;
  const db = kernelContainer.db as any;

  const lessonId = 'les-pr-0001';
  const classId = 'cls-pr-0001';
  const teacherId = 'usr-pr-teacher';
  const studentA = 'stu-pr-a';
  const studentB = 'stu-pr-b';
  const studentC = 'stu-pr-c';
  const teacherToken = 'tok-pr-teacher';
  const tokenA = 'tok-pr-a';
  const tokenB = 'tok-pr-b';
  const tokenC = 'tok-pr-c';

  const cookie = (t: string) => ({ Cookie: `edu_os_token=${t}` });
  const call = (method: string, p: string, token: string | null, body?: unknown) =>
    fetch(`${baseUrl}${p}`, {
      method,
      headers: token
        ? { 'Content-Type': 'application/json', ...cookie(token) }
        : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  beforeAll(async () => {
    runMigrations(db, loadMigrationsFromDirectory(path.resolve(__dirname, '../../migrations')));

    const now = Date.now();
    const insUser = db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insUser.run(teacherId, 'pr_teacher', 'x', 'teacher', '互评教师', now);
    insUser.run(studentA, 'pr_a', 'x', 'student', '学生甲', now);
    insUser.run(studentB, 'pr_b', 'x', 'student', '学生乙', now);
    insUser.run(studentC, 'pr_c', 'x', 'student', '学生丙', now);

    const insSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    const exp = now + 3600_000;
    insSession.run(teacherToken, JSON.stringify({ userId: teacherId, role: 'teacher', username: 'pr_teacher' }), now, exp);
    insSession.run(tokenA, JSON.stringify({ userId: studentA, role: 'student', username: 'pr_a' }), now, exp);
    insSession.run(tokenB, JSON.stringify({ userId: studentB, role: 'student', username: 'pr_b' }), now, exp);
    insSession.run(tokenC, JSON.stringify({ userId: studentC, role: 'student', username: 'pr_c' }), now, exp);

    db.prepare('INSERT OR REPLACE INTO classes (id, name, created_at) VALUES (?, ?, ?)').run(classId, '互评测试班', now);
    db.prepare('INSERT OR REPLACE INTO lessons (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      lessonId,
      '互评测试课节',
      now,
      now,
    );
    // students 表无 class_id 列；班级归属通过 class_students 关联表表达
    for (const [id, name] of [
      [studentA, '学生甲'],
      [studentB, '学生乙'],
      [studentC, '学生丙'],
    ] as const) {
      db.prepare(
        'INSERT OR REPLACE INTO students (id, name, student_number, created_at) VALUES (?, ?, ?, ?)',
      ).run(id, name, name, now);
      db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
        classId,
        id,
        now,
      );
    }

    // 课堂会话（互评表以 session 归属）
    db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(lessonId);
    db.prepare(
      `INSERT INTO classroom_sessions (id, lesson_id, class_id, teacher_id, stage, started_at, created_at)
       VALUES (?, ?, ?, ?, 'IN_CLASS_TEACHING', ?, ?)`,
    ).run('sess-pr-0001', lessonId, classId, teacherId, now, now);

    // 三份真实课件作答（>2 份才允许分配）。
    // schema 事实：courseware_attempt 无 lesson_id，课节↔课件关联在
    // whiteboard_elements(type='html-applet').data.coursewareUuid。
    const cwId = 'cw-pr-0001';
    db.prepare('INSERT OR REPLACE INTO courseware (id, uuid, name, entry, created_at) VALUES (?, ?, ?, ?, ?)').run(
      cwId,
      'uuid-pr-0001',
      '螺旋绘制课件',
      'index.html',
      now,
    );
    db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id = ?').run(lessonId);
    db.prepare('INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
      'el-pr-0001',
      lessonId,
      'html-applet',
      JSON.stringify({ coursewareUuid: 'uuid-pr-0001' }),
      now,
    );

    const seededStudents = [studentA, studentB, studentC];
    seededStudents.forEach((sid, i) => {
      const attemptId = `att-pr-${i}`;
      db.prepare(
        `INSERT OR REPLACE INTO courseware_attempt
           (id, courseware_id, student_id, started_at, finished_at, status)
         VALUES (?, ?, ?, ?, ?, 'completed')`,
      ).run(attemptId, cwId, sid, now, now);
      db.prepare(
        `INSERT OR REPLACE INTO submission_result (id, attempt_id, score, completion) VALUES (?, ?, ?, 1)`,
      ).run(`sr-pr-${i}`, attemptId, 70 + i * 10);
    });

    const app = express();
    app.use(express.json());
    registerClassroomPeerReviewRoutes(app as any);
    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    db.prepare('DELETE FROM classroom_peer_reviews WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM classroom_peer_review_tasks WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM classroom_peer_badges WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM classroom_peer_nominations WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM classroom_danmaku WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM classroom_peer_rubric_dimensions WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM courseware_attempt WHERE courseware_id = ?').run('cw-pr-0001');
    db.prepare('DELETE FROM submission_result WHERE attempt_id LIKE ?').run('att-pr-%');
    db.prepare('DELETE FROM courseware WHERE id = ?').run('cw-pr-0001');
    db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
    for (const sid of [studentA, studentB, studentC]) {
      db.prepare('DELETE FROM students WHERE id = ?').run(sid);
      db.prepare('DELETE FROM users WHERE id = ?').run(sid);
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(teacherId);
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?, ?)').run(teacherToken, tokenA, tokenB, tokenC);
    if (server) await new Promise<void>((r) => server.close(() => r()));
  });

  describe('鉴权', () => {
    it('匿名不可分配任务', async () => {
      const res = await call('POST', `/api/classroom/sessions/${lessonId}/peer-review/auto-assign`, null, {});
      expect(res.status).toBe(401);
    });

    it('学生不可分配任务（教师专属）', async () => {
      const res = await call('POST', `/api/classroom/sessions/${lessonId}/peer-review/auto-assign`, tokenA, {});
      expect(res.status).toBe(403);
    });

    it('匿名不可读取展示数据', async () => {
      const res = await call('GET', `/api/classroom/sessions/${lessonId}/peer-review`, null);
      expect(res.status).toBe(401);
    });
  });

  describe('分配任务', () => {
    it('教师可一键分配，且不产生「自己评自己」', async () => {
      const res = await call('POST', `/api/classroom/sessions/${lessonId}/peer-review/auto-assign`, teacherToken, {
        perStudent: 2,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.works).toBe(3);

      const tasks = db
        .prepare('SELECT reviewer_id, target_student_id FROM classroom_peer_review_tasks WHERE lesson_id = ?')
        .all(lessonId) as Array<{ reviewer_id: string; target_student_id: string }>;
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks.every((t) => t.reviewer_id !== t.target_student_id)).toBe(true);
    });

    it('作品不足 2 份时拒绝（无课件课节 + 无学生班级 → 两级口径都取不到作品）', async () => {
      const emptyLesson = 'les-pr-empty';
      const emptyClass = 'cls-pr-empty';
      const now = Date.now();
      db.prepare('INSERT OR REPLACE INTO classes (id, name, created_at) VALUES (?, ?, ?)').run(
        emptyClass,
        '空班级',
        now,
      );
      db.prepare('INSERT OR REPLACE INTO lessons (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
        emptyLesson,
        '无作品课节',
        now,
        now,
      );
      db.prepare(
        `INSERT OR REPLACE INTO classroom_sessions (id, lesson_id, class_id, teacher_id, stage, started_at, created_at)
         VALUES (?, ?, ?, ?, 'IN_CLASS_TEACHING', ?, ?)`,
      ).run('sess-pr-empty', emptyLesson, emptyClass, teacherId, now, now);
      const res = await call('POST', `/api/classroom/sessions/${emptyLesson}/peer-review/auto-assign`, teacherToken, {});
      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error).toMatch(/Not enough submitted works/);
      db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(emptyLesson);
      db.prepare('DELETE FROM lessons WHERE id = ?').run(emptyLesson);
      db.prepare('DELETE FROM classes WHERE id = ?').run(emptyClass);
    });

    it('无内嵌课件时回退到班级口径（scope=class）', async () => {
      const otherLesson = 'les-pr-nocw';
      const now = Date.now();
      db.prepare('INSERT OR REPLACE INTO lessons (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
        otherLesson,
        '无内嵌课件课节',
        now,
        now,
      );
      db.prepare(
        `INSERT OR REPLACE INTO classroom_sessions (id, lesson_id, class_id, teacher_id, stage, started_at, created_at)
         VALUES (?, ?, ?, ?, 'IN_CLASS_TEACHING', ?, ?)`,
      ).run('sess-pr-nocw', otherLesson, classId, teacherId, now, now);
      const res = await call('POST', `/api/classroom/sessions/${otherLesson}/peer-review/auto-assign`, teacherToken, {});
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      // 班级里有三份真实作答 → 走 class 回退口径
      expect(body.scope).toBe('class');
      db.prepare('DELETE FROM classroom_peer_review_tasks WHERE lesson_id = ?').run(otherLesson);
      db.prepare('DELETE FROM classroom_peer_rubric_dimensions WHERE lesson_id = ?').run(otherLesson);
      db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(otherLesson);
      db.prepare('DELETE FROM lessons WHERE id = ?').run(otherLesson);
    });
  });

  describe('展示数据', () => {
    it('返回真实匹配矩阵 / 量规维度 / 进度，且无假学生姓名', async () => {
      const res = await call('GET', `/api/classroom/sessions/${lessonId}/peer-review`, teacherToken);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(Array.isArray(body.matchingItems)).toBe(true);
      expect(body.matchingItems.length).toBeGreaterThan(0);
      // 真实学生姓名出现在匹配项中
      const names = body.matchingItems.map((m: any) => m.reviewerName).join(',');
      expect(names).toMatch(/学生[甲乙丙]/);
      expect(names).not.toMatch(/陈子墨|张子豪|李晓彤/);
      // 量规维度已自动落库
      expect(body.dimensions).toHaveLength(3);
      expect(body.dimensions[0]).toHaveProperty('percentage');
      // 进度来自真实任务
      expect(body.progress.total).toBeGreaterThan(0);
      expect(body.progress.completed).toBe(0);
    });
  });

  describe('提交互评', () => {
    it('越界分数返回 400', async () => {
      const task = db
        .prepare('SELECT id, reviewer_id FROM classroom_peer_review_tasks WHERE lesson_id = ? LIMIT 1')
        .get(lessonId) as any;
      const token = task.reviewer_id === studentA ? tokenA : task.reviewer_id === studentB ? tokenB : tokenC;
      const res = await call(
        'POST',
        `/api/classroom/sessions/${lessonId}/peer-review/tasks/${task.id}/submit`,
        token,
        { score: 9 },
      );
      expect(res.status).toBe(400);
    });

    it('学生不能提交他人的任务（防代评 403）', async () => {
      const task = db
        .prepare(
          `SELECT id, reviewer_id FROM classroom_peer_review_tasks
            WHERE lesson_id = ? AND reviewer_id != ? LIMIT 1`,
        )
        .get(lessonId, studentA) as any;
      expect(task).toBeTruthy();
      const res = await call(
        'POST',
        `/api/classroom/sessions/${lessonId}/peer-review/tasks/${task.id}/submit`,
        tokenA,
        { score: 4 },
      );
      expect(res.status).toBe(403);
    });

    it('合法提交成功，且重复提交走 UPDATE（不产生第二条记录）', async () => {
      const task = db
        .prepare('SELECT id, reviewer_id FROM classroom_peer_review_tasks WHERE lesson_id = ? LIMIT 1')
        .get(lessonId) as any;
      const token = task.reviewer_id === studentA ? tokenA : task.reviewer_id === studentB ? tokenB : tokenC;
      const url = `/api/classroom/sessions/${lessonId}/peer-review/tasks/${task.id}/submit`;

      const r1 = await call('POST', url, token, { score: 4, comment: '首次评语' });
      expect(r1.status).toBe(200);
      const r2 = await call('POST', url, token, { score: 5, comment: '修改后评语' });
      expect(r2.status).toBe(200);

      const rows = db
        .prepare(
          'SELECT score, comment FROM classroom_peer_reviews WHERE lesson_id = ? AND reviewer_id = ?',
        )
        .all(lessonId, task.reviewer_id) as any[];
      expect(rows).toHaveLength(1);
      expect(rows[0].score).toBe(5);
      expect(rows[0].comment).toBe('修改后评语');

      // 提交后进度更新
      const res = await call('GET', `/api/classroom/sessions/${lessonId}/peer-review`, teacherToken);
      const body = (await res.json()) as any;
      expect(body.progress.completed).toBeGreaterThan(0);
      expect(body.reactions.find((x: any) => x.id === 'reviews').count).toBeGreaterThan(0);
    });
  });

  describe('徽章与提名', () => {
    it('未知 badgeKey 返回 400', async () => {
      const res = await call('POST', `/api/classroom/sessions/${lessonId}/peer-review/badges`, tokenA, {
        receiverId: studentB,
        badgeKey: 'not_a_real_badge',
      });
      expect(res.status).toBe(400);
    });

    it('互赠合法徽章并幂等（重复发送不重复计数）', async () => {
      const url = `/api/classroom/sessions/${lessonId}/peer-review/badges`;
      const r1 = await call('POST', url, tokenA, { receiverId: studentB, badgeKey: 'brilliant_idea' });
      expect(r1.status).toBe(200);
      const r2 = await call('POST', url, tokenA, { receiverId: studentB, badgeKey: 'brilliant_idea' });
      expect(r2.status).toBe(200);
      const count = (db
        .prepare('SELECT COUNT(*) as c FROM classroom_peer_badges WHERE lesson_id = ?')
        .get(lessonId) as any).c;
      expect(count).toBe(1);
    });

    it('不能提名自己（400）', async () => {
      const res = await call('POST', `/api/classroom/sessions/${lessonId}/peer-review/nominations`, tokenA, {
        nominatedStudentId: studentA,
      });
      expect(res.status).toBe(400);
    });

    it('提名他人后先锋榜按真实票数聚合', async () => {
      await call('POST', `/api/classroom/sessions/${lessonId}/peer-review/nominations`, tokenA, {
        nominatedStudentId: studentB,
        honorKey: 'best_open_source',
      });
      await call('POST', `/api/classroom/sessions/${lessonId}/peer-review/nominations`, tokenC, {
        nominatedStudentId: studentB,
        honorKey: 'best_open_source',
      });
      const res = await call('GET', `/api/classroom/sessions/${lessonId}/peer-review`, teacherToken);
      const body = (await res.json()) as any;
      const top = body.podiumStudents[0];
      expect(top.name).toBe('学生乙');
      expect(top.votes).toBe(2);
      expect(top.honorTitle).toBe('最佳开源作者');
    });
  });

  describe('弹幕', () => {
    it('空文本返回 400', async () => {
      const res = await call('POST', `/api/classroom/sessions/${lessonId}/danmaku`, tokenA, { text: '   ' });
      expect(res.status).toBe(400);
    });

    it('发送后出现在展示数据中，超长文本被截断到 120 字', async () => {
      const long = 'a'.repeat(200);
      const r = await call('POST', `/api/classroom/sessions/${lessonId}/danmaku`, tokenB, { text: long });
      expect(r.status).toBe(200);
      const res = await call('GET', `/api/classroom/sessions/${lessonId}/peer-review`, teacherToken);
      const body = (await res.json()) as any;
      expect(body.danmaku.length).toBeGreaterThan(0);
      expect(body.danmaku[0].text).toHaveLength(120);
      expect(body.danmaku[0].sender).toBe('学生乙');
    });
  });
});
