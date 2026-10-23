import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerClassroomRoutes } from '../routes/classroom.js';
import { ClassroomRuntimeService } from '../services/classroom-runtime-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ensureTestSchema } from './helpers/test-schema.js';

/**
 * 课堂对象级授权回归（P0）：
 * 角色校验不等于对象级校验 —— 教师只能操作自己的课堂，学生只能进入自己班的课堂。
 * 同时钉住学生端答案脱敏，避免投票 correct_option 随会话读取下发。
 */
describe('课堂对象级授权（教师归属 / 学生班级 / 答案脱敏）', () => {
  let server: Server;
  let baseUrl: string;

  const db = kernelContainer.db as any;

  const teacherA = 'usr-authz-ta';
  const teacherAToken = 'tok-authz-ta';
  const teacherB = 'usr-authz-tb';
  const teacherBToken = 'tok-authz-tb';
  const studentA = 'stu-authz-a';
  const studentAToken = 'tok-authz-sa';
  const studentB = 'stu-authz-b';
  const studentBToken = 'tok-authz-sb';

  const classA = 'cls-authz-a';
  const classB = 'cls-authz-b';
  const lessonA = 'les-authz-a';
  const lessonB = 'les-authz-b';
  const lessonSelfStudy = 'les-authz-self';

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
  let buzzerId = '';

  beforeAll(async () => {
    ensureTestSchema();

    const app = express();
    app.use(express.json());
    registerClassroomRoutes({ app, io: undefined } as any, new ClassroomRuntimeService(db));

    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const now = Date.now();
    const sessionData = (userId: string, role: string, username: string) =>
      JSON.stringify({ userId, role, username, name: username, studentId: role === 'student' ? userId : undefined });

    for (const teacher of [
      { id: teacherA, username: 'authz_ta', token: teacherAToken },
      { id: teacherB, username: 'authz_tb', token: teacherBToken },
    ]) {
      db.prepare(
        'INSERT OR REPLACE INTO users (id, username, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(teacher.id, teacher.username, teacher.username, 'hash', 'teacher', now);
      db.prepare(
        'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
      ).run(teacher.token, sessionData(teacher.id, 'teacher', teacher.username), now, now + 86400000);
    }

    for (const student of [
      { id: studentA, number: 'AUTHZ-A', token: studentAToken },
      { id: studentB, number: 'AUTHZ-B', token: studentBToken },
    ]) {
      db.prepare(
        'INSERT OR REPLACE INTO users (id, username, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(student.id, student.id, student.id, 'hash', 'student', now);
      db.prepare('INSERT OR REPLACE INTO students (id, name, student_number, created_at) VALUES (?, ?, ?, ?)').run(
        student.id,
        student.id,
        student.number,
        now,
      );
      db.prepare(
        'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
      ).run(student.token, sessionData(student.id, 'student', student.id), now, now + 86400000);
    }

    db.prepare('INSERT OR REPLACE INTO classes (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)').run(
      classA,
      '授权测试 A 班',
      teacherA,
      now,
    );
    db.prepare('INSERT OR REPLACE INTO classes (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)').run(
      classB,
      '授权测试 B 班',
      teacherB,
      now,
    );
    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      classA,
      studentA,
      now,
    );
    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      classB,
      studentB,
      now,
    );

    for (const lesson of [
      { id: lessonA, title: '授权测试课堂 A', creator: teacherA },
      { id: lessonB, title: '授权测试课堂 B', creator: teacherB },
      { id: lessonSelfStudy, title: '授权测试自学课', creator: teacherA },
    ]) {
      db.prepare(
        'INSERT OR REPLACE INTO lessons (id, title, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run(lesson.id, lesson.title, lesson.creator, now, now);
    }

    const initA = await call('POST', `/api/classroom/sessions/${lessonA}/init`, teacherAToken, { classId: classA });
    expect(initA.status).toBe(200);
    const initB = await call('POST', `/api/classroom/sessions/${lessonB}/init`, teacherBToken, { classId: classB });
    expect(initB.status).toBe(200);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    db.prepare(
      'DELETE FROM classroom_poll_votes WHERE poll_id IN (SELECT id FROM classroom_quick_polls WHERE lesson_id IN (?, ?, ?))',
    ).run(lessonA, lessonB, lessonSelfStudy);
    for (const lessonId of [lessonA, lessonB, lessonSelfStudy]) {
      db.prepare(
        'DELETE FROM classroom_pacing_signals WHERE session_id IN (SELECT id FROM classroom_sessions WHERE lesson_id = ?)',
      ).run(lessonId);
      for (const table of [
        'classroom_quick_polls',
        'classroom_buzzers',
        'classroom_exit_tickets',
        'classroom_sessions',
      ]) {
        db.prepare(`DELETE FROM ${table} WHERE lesson_id = ?`).run(lessonId);
      }
      db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    }
    db.prepare('DELETE FROM class_students WHERE class_id IN (?, ?)').run(classA, classB);
    db.prepare('DELETE FROM classes WHERE id IN (?, ?)').run(classA, classB);
    db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(studentA, studentB);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?, ?)').run(
      teacherAToken,
      teacherBToken,
      studentAToken,
      studentBToken,
    );
    db.prepare('DELETE FROM users WHERE id IN (?, ?, ?, ?)').run(teacherA, teacherB, studentA, studentB);
  });

  it('教师与学生都只能访问自己班级的课堂会话', async () => {
    const teacherCross = await call('GET', `/api/classroom/sessions/${lessonA}`, teacherBToken);
    expect(teacherCross.status).toBe(403);

    const studentCross = await call('GET', `/api/classroom/sessions/${lessonA}`, studentBToken);
    expect(studentCross.status).toBe(403);

    const studentOwn = await call('GET', `/api/classroom/sessions/${lessonA}`, studentAToken);
    expect(studentOwn.status).toBe(200);
    const studentOwnBody = await studentOwn.json();
    expect(studentOwnBody.session.class_id).toBe(classA);

    const teacherOwn = await call('GET', `/api/classroom/sessions/${lessonA}`, teacherAToken);
    expect(teacherOwn.status).toBe(200);

    const otherTeacherOwn = await call('GET', `/api/classroom/sessions/${lessonB}`, teacherBToken);
    expect(otherTeacherOwn.status).toBe(200);
  });

  it('学生端读取会话时剥离投票答案与 settings_json，教师端保留', async () => {
    const create = await call('POST', `/api/classroom/sessions/${lessonA}/quick-poll`, teacherAToken, {
      title: '授权测试投票',
      questionType: 'ABCD',
      options: ['甲', '乙', '丙'],
      correctOption: '乙',
    });
    expect(create.status).toBe(200);
    pollId = ((await create.json()) as any).poll.id;

    const teacherView = await call('GET', `/api/classroom/sessions/${lessonA}`, teacherAToken);
    const teacherBody = await teacherView.json();
    expect(teacherBody.activePoll.correct_option).toBe('乙');
    expect(teacherBody.session.settings_json).toBeDefined();

    const studentView = await call('GET', `/api/classroom/sessions/${lessonA}`, studentAToken);
    expect(studentView.status).toBe(200);
    const studentBody = await studentView.json();
    expect(studentBody.activePoll.id).toBe(pollId);
    expect(studentBody.activePoll.correct_option).toBeUndefined();
    expect(studentBody.activePoll.correctOption).toBeUndefined();
    expect(studentBody.session.settings_json).toBeUndefined();

    const crossVote = await call(
      'POST',
      `/api/classroom/sessions/${lessonA}/quick-poll/${pollId}/vote`,
      studentBToken,
      { option: '甲' },
    );
    expect(crossVote.status).toBe(403);

    const ownVote = await call('POST', `/api/classroom/sessions/${lessonA}/quick-poll/${pollId}/vote`, studentAToken, {
      option: '甲',
    });
    expect(ownVote.status).toBe(200);
  });

  it('其他教师不能发起/关闭投票、控制倒计时或回写视图状态', async () => {
    const crossPoll = await call('POST', `/api/classroom/sessions/${lessonA}/quick-poll`, teacherBToken, {
      title: '越权投票',
      options: ['A', 'B'],
    });
    expect(crossPoll.status).toBe(403);

    const crossClose = await call(
      'POST',
      `/api/classroom/sessions/${lessonA}/quick-poll/${pollId}/close`,
      teacherBToken,
    );
    expect(crossClose.status).toBe(403);

    const crossCountdown = await call('POST', `/api/classroom/sessions/${lessonA}/countdown`, teacherBToken, {
      action: 'start',
      duration: 60,
    });
    expect(crossCountdown.status).toBe(403);

    const crossViewState = await call('POST', `/api/classroom/sessions/${lessonA}/view-state`, teacherBToken, {
      currentPage: 3,
    });
    expect(crossViewState.status).toBe(403);

    const ownViewState = await call('POST', `/api/classroom/sessions/${lessonA}/view-state`, teacherAToken, {
      currentPage: 3,
    });
    expect(ownViewState.status).toBe(200);

    const ownClose = await call('POST', `/api/classroom/sessions/${lessonA}/quick-poll/${pollId}/close`, teacherAToken);
    expect(ownClose.status).toBe(200);
  });

  it('抢答器按课节与班级隔离，跨班学生不能抢答', async () => {
    const create = await call('POST', `/api/classroom/sessions/${lessonA}/buzzer`, teacherAToken, {
      title: '授权测试抢答',
    });
    expect(create.status).toBe(200);
    buzzerId = ((await create.json()) as any).buzzer.id;

    const crossBuzz = await call('POST', `/api/classroom/sessions/${lessonA}/buzzer/${buzzerId}/buzz`, studentBToken);
    expect(crossBuzz.status).toBe(403);

    const lessonMismatch = await call(
      'POST',
      `/api/classroom/sessions/${lessonB}/buzzer/${buzzerId}/buzz`,
      studentAToken,
    );
    expect(lessonMismatch.status).toBe(403);

    const ownBuzz = await call('POST', `/api/classroom/sessions/${lessonA}/buzzer/${buzzerId}/buzz`, studentAToken);
    expect(ownBuzz.status).toBe(200);
    expect(((await ownBuzz.json()) as any).won).toBe(true);

    const crossReset = await call('POST', `/api/classroom/sessions/${lessonA}/buzzer/${buzzerId}/reset`, teacherBToken);
    expect(crossReset.status).toBe(403);
  });

  it('节奏信号、结课通票与结课汇总都校验课堂归属', async () => {
    const crossPacing = await call('POST', `/api/classroom/sessions/${lessonA}/pacing`, studentBToken, {
      signal: 'CLEAR',
    });
    expect(crossPacing.status).toBe(403);

    const ownPacing = await call('POST', `/api/classroom/sessions/${lessonA}/pacing`, studentAToken, {
      signal: 'CLEAR',
    });
    expect(ownPacing.status).toBe(200);

    const ownSummary = await call('GET', `/api/classroom/sessions/${lessonA}/pacing-summary`, studentAToken);
    expect(ownSummary.status).toBe(200);

    const crossTicket = await call('POST', `/api/classroom/sessions/${lessonA}/exit-ticket`, studentBToken, {
      rating: 5,
    });
    expect(crossTicket.status).toBe(403);

    const ownTicket = await call('POST', `/api/classroom/sessions/${lessonA}/exit-ticket`, studentAToken, {
      rating: 4,
    });
    expect(ownTicket.status).toBe(200);

    const crossTicketSummary = await call(
      'GET',
      `/api/classroom/sessions/${lessonA}/exit-ticket-summary`,
      teacherBToken,
    );
    expect(crossTicketSummary.status).toBe(403);

    const ownTicketSummary = await call('GET', `/api/classroom/sessions/${lessonA}/exit-ticket-summary`, teacherAToken);
    expect(ownTicketSummary.status).toBe(200);

    const teaching = await call('POST', `/api/classroom/sessions/${lessonA}/stage`, teacherAToken, {
      stage: 'IN_CLASS_TEACHING',
      classId: classA,
    });
    expect(teaching.status).toBe(200);

    const wrapUp = await call('POST', `/api/classroom/sessions/${lessonA}/stage`, teacherAToken, {
      stage: 'WRAP_UP_EXIT_TICKET',
      classId: classA,
    });
    expect(wrapUp.status).toBe(200);

    const archive = await call('POST', `/api/classroom/sessions/${lessonA}/stage`, teacherAToken, {
      stage: 'ARCHIVED_REPORT',
      classId: classA,
    });
    expect(archive.status).toBe(200);

    const lateTicket = await call('POST', `/api/classroom/sessions/${lessonA}/exit-ticket`, studentAToken, {
      rating: 3,
    });
    expect(lateTicket.status).toBe(409);

    const archivedSummary = await call('GET', `/api/classroom/sessions/${lessonA}/exit-ticket-summary`, teacherAToken);
    expect(archivedSummary.status).toBe(200);
  });

  it('未绑定班级的自学课堂仍对已登录学生开放，但不对其他教师开放', async () => {
    const init = await call('POST', `/api/classroom/sessions/${lessonSelfStudy}/init`, teacherAToken, {});
    expect(init.status).toBe(200);

    const studentRead = await call('GET', `/api/classroom/sessions/${lessonSelfStudy}`, studentBToken);
    expect(studentRead.status).toBe(200);

    const otherTeacherRead = await call('GET', `/api/classroom/sessions/${lessonSelfStudy}`, teacherBToken);
    expect(otherTeacherRead.status).toBe(403);

    const otherTeacherControl = await call(
      'POST',
      `/api/classroom/sessions/${lessonSelfStudy}/countdown`,
      teacherBToken,
      { action: 'start', duration: 30 },
    );
    expect(otherTeacherControl.status).toBe(403);
  });
});
