/**
 * @vitest-environment node
 *
 * 学生数据越权测试矩阵（Issue #140）。
 *
 * 覆盖 roster / grading / assignments / assessments / courseware / workspace / presence
 * 七个面：同一份种子数据下，学生 A、学生 B、A 班教师、B 班教师、管理员分别访问，
 * 断言 200 / 403。`class-object-auth.test.ts` 已覆盖 roster/grading/assignments 的
 * 部分交叉用例；本文件补齐 scope 门禁（class-staff 中间件拦截）、测评、课件、
 * 客户端诊断与 presence 房间定向。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerRosterRoutes } from '../routes/roster.js';
import { registerGradingRoutes } from '../routes/grading.js';
import { registerAssignmentsRoutes } from '../routes/assignments.js';
import { registerAssessmentRoutes } from '../routes/assessments.js';
import { registerCoursewareRoutes } from '../routes/courseware.js';
import { registerWorkspaceRoutes } from '../routes/workspace.js';
import { PRESENCE_STAFF_ROOM, setupPresence } from '../presence.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('学生数据越权测试矩阵（Issue #140）', () => {
  let server: Server;
  let baseUrl: string;
  const db = kernelContainer.db;

  const teacherA = 'usr-matrix-teacher-a';
  const teacherB = 'usr-matrix-teacher-b';
  const adminId = 'usr-matrix-admin';
  const studentA = 'stu-matrix-a';
  const studentB = 'stu-matrix-b';
  const classA = 'cls-matrix-a';
  const classB = 'cls-matrix-b';
  const assignmentA = 'asg-matrix-a';
  const examA = 'exam-matrix-a';
  const assessmentA = 'asm-matrix-a';
  const coursewareId = 'cw-matrix-a';
  const coursewareUuid = 'cw-matrix-uuid-a';
  const attemptA = 'att-matrix-a';
  const attemptB = 'att-matrix-b';

  const tokTeacherA = 'tok-matrix-teacher-a';
  const tokTeacherB = 'tok-matrix-teacher-b';
  const tokAdmin = 'tok-matrix-admin';
  const tokStudentA = 'tok-matrix-student-a';
  const tokStudentB = 'tok-matrix-student-b';

  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });
  const get = (path: string, token: string) => fetch(`${baseUrl}${path}`, { headers: cookie(token) });

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    const noop = (_req: any, _res: any, next: any) => next();
    const io = { emit: () => undefined, to: () => ({ emit: () => undefined }) };
    registerRosterRoutes({ app, io, loginLimiter: noop } as any);
    registerGradingRoutes({ app } as any);
    registerAssignmentsRoutes({ app } as any);
    registerAssessmentRoutes({ app } as any);
    registerCoursewareRoutes({ app, io } as any);
    registerWorkspaceRoutes({ app, io } as any);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const now = Date.now();
    const exp = now + 3600_000;
    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(
      tokTeacherA,
      JSON.stringify({ userId: teacherA, role: 'teacher', username: 'matrix_ta' }),
      now,
      exp,
    );
    insertSession.run(
      tokTeacherB,
      JSON.stringify({ userId: teacherB, role: 'teacher', username: 'matrix_tb' }),
      now,
      exp,
    );
    insertSession.run(
      tokAdmin,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'matrix_admin' }),
      now,
      exp,
    );
    insertSession.run(
      tokStudentA,
      JSON.stringify({ userId: studentA, studentId: studentA, role: 'student', username: 'matrix_sa' }),
      now,
      exp,
    );
    insertSession.run(
      tokStudentB,
      JSON.stringify({ userId: studentB, studentId: studentB, role: 'student', username: 'matrix_sb' }),
      now,
      exp,
    );

    const insertUser = db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertUser.run(teacherA, 'matrix_ta', 'x', 'teacher', '矩阵教师甲', now);
    insertUser.run(teacherB, 'matrix_tb', 'x', 'teacher', '矩阵教师乙', now);
    insertUser.run(adminId, 'matrix_admin', 'x', 'administrator', '矩阵管理员', now);
    insertUser.run(studentA, 'matrix_sa', 'x', 'student', '矩阵学生甲', now);
    insertUser.run(studentB, 'matrix_sb', 'x', 'student', '矩阵学生乙', now);

    const insertClass = db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertClass.run(classA, '矩阵甲班', '', 'pass-a', teacherA, now);
    insertClass.run(classB, '矩阵乙班', '', 'pass-b', teacherB, now);

    const insertStudent = db.prepare(
      'INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    insertStudent.run(studentA, 'MATRIX-A', '矩阵学生甲', '', now);
    insertStudent.run(studentB, 'MATRIX-B', '矩阵学生乙', '', now);

    const insertEnrollment = db.prepare(
      'INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)',
    );
    insertEnrollment.run(classA, studentA, now);
    insertEnrollment.run(classB, studentB, now);

    db.prepare(
      'INSERT OR REPLACE INTO assignments (id, class_id, lesson_id, title, description, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(assignmentA, classA, null, '矩阵作业', '', '{}', now);

    db.prepare(
      'INSERT OR REPLACE INTO exams (id, class_id, title, description, max_score, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(examA, classA, '矩阵小测', '', 100, now);
    db.prepare(
      'INSERT OR REPLACE INTO exam_scores (exam_id, student_id, score, notes, recorded_at) VALUES (?, ?, ?, ?, ?)',
    ).run(examA, studentA, 88, '', now);

    db.prepare(
      'INSERT OR REPLACE INTO assessments (id, kind, title, description, owner_id, settings_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(assessmentA, 'quiz', '矩阵测评', '', teacherA, '{}', 'draft', now, now);

    db.prepare(
      'INSERT OR REPLACE INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(coursewareId, coursewareUuid, '矩阵课件', 'html', 'index.html', now);
    const insertAttempt = db.prepare(
      'INSERT OR REPLACE INTO courseware_attempt (id, courseware_id, student_id, started_at, status) VALUES (?, ?, ?, ?, ?)',
    );
    insertAttempt.run(attemptA, coursewareId, studentA, now, 'active');
    insertAttempt.run(attemptB, coursewareId, studentB, now, 'active');
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.prepare('DELETE FROM exam_scores WHERE exam_id = ?').run(examA);
    db.prepare('DELETE FROM exams WHERE id = ?').run(examA);
    db.prepare('DELETE FROM assignments WHERE id = ?').run(assignmentA);
    db.prepare('DELETE FROM assessments WHERE id = ?').run(assessmentA);
    db.prepare('DELETE FROM courseware_attempt WHERE id IN (?, ?)').run(attemptA, attemptB);
    db.prepare('DELETE FROM courseware WHERE id = ?').run(coursewareId);
    db.prepare('DELETE FROM class_students WHERE class_id IN (?, ?)').run(classA, classB);
    db.prepare('DELETE FROM classes WHERE id IN (?, ?)').run(classA, classB);
    db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(studentA, studentB);
    db.prepare('DELETE FROM users WHERE id IN (?, ?, ?, ?, ?)').run(teacherA, teacherB, adminId, studentA, studentB);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?, ?, ?)').run(
      tokTeacherA,
      tokTeacherB,
      tokAdmin,
      tokStudentA,
      tokStudentB,
    );
  });

  describe('roster', () => {
    it('班级学生名单：本班学生/本班教师/管理员 200，外班 403', async () => {
      expect((await get(`/api/classes/${classA}/students`, tokStudentA)).status).toBe(200);
      expect((await get(`/api/classes/${classA}/students`, tokStudentB)).status).toBe(403);
      expect((await get(`/api/classes/${classA}/students`, tokTeacherA)).status).toBe(200);
      expect((await get(`/api/classes/${classA}/students`, tokTeacherB)).status).toBe(403);
      expect((await get(`/api/classes/${classA}/students`, tokAdmin)).status).toBe(200);
    });

    it('点名候选（class-staff scope）：学生被中间件 403，本班教师 200，外班教师 403', async () => {
      expect((await get(`/api/classes/${classA}/picker-candidates`, tokStudentA)).status).toBe(403);
      expect((await get(`/api/classes/${classA}/picker-candidates`, tokTeacherA)).status).toBe(200);
      expect((await get(`/api/classes/${classA}/picker-candidates`, tokTeacherB)).status).toBe(403);
    });
  });

  describe('grading', () => {
    it('考勤汇总（class-staff scope）：学生/外班教师 403，本班教师/管理员 200', async () => {
      expect((await get(`/api/classes/${classA}/attendance-summary`, tokStudentA)).status).toBe(403);
      expect((await get(`/api/classes/${classA}/attendance-summary`, tokTeacherA)).status).toBe(200);
      expect((await get(`/api/classes/${classA}/attendance-summary`, tokTeacherB)).status).toBe(403);
      expect((await get(`/api/classes/${classA}/attendance-summary`, tokAdmin)).status).toBe(200);
    });

    it('考试成绩：本班学生只拿到自己的分数，外班学生 403', async () => {
      const own = await get(`/api/exams/${examA}/scores`, tokStudentA);
      expect(own.status).toBe(200);
      const ownBody: any = await own.json();
      const ownRows = Array.isArray(ownBody) ? ownBody : (ownBody.scores ?? ownBody.data ?? []);
      expect(ownRows.every((row: any) => (row.student_id || row.studentId) === studentA)).toBe(true);

      expect((await get(`/api/exams/${examA}/scores`, tokStudentB)).status).toBe(403);
      expect((await get(`/api/exams/${examA}/scores`, tokTeacherB)).status).toBe(403);
    });

    it('学期成绩：本班学生只看到自己，外班学生 403', async () => {
      const own = await get(`/api/classes/${classA}/semester-grades`, tokStudentA);
      expect(own.status).toBe(200);
      const body: any = await own.json();
      expect(body.students.every((row: any) => (row.student_id || row.studentId || row.id) === studentA)).toBe(true);

      expect((await get(`/api/classes/${classA}/semester-grades`, tokStudentB)).status).toBe(403);
    });
  });

  describe('assignments', () => {
    it('班级作业列表：本班学生 200，外班学生/外班教师 403', async () => {
      expect((await get(`/api/classes/${classA}/assignments`, tokStudentA)).status).toBe(200);
      expect((await get(`/api/classes/${classA}/assignments`, tokStudentB)).status).toBe(403);
      expect((await get(`/api/classes/${classA}/assignments`, tokTeacherB)).status).toBe(403);
    });

    it('外班学生不能向本班作业提交', async () => {
      const res = await fetch(`${baseUrl}/api/assignments/${assignmentA}/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...cookie(tokStudentB) },
        body: JSON.stringify({ content: '越权提交' }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('assessments', () => {
    it('学生不能访问教师测评列表；教师只能看到自己的测评', async () => {
      expect((await get('/api/assessments', tokStudentA)).status).toBe(403);

      const teacherAList = await get('/api/assessments', tokTeacherA);
      expect(teacherAList.status).toBe(200);
      const aBody: any = await teacherAList.json();
      expect((aBody.items ?? []).map((row: any) => row.id)).toContain(assessmentA);

      const teacherBList = await get('/api/assessments', tokTeacherB);
      expect(teacherBList.status).toBe(200);
      const bBody: any = await teacherBList.json();
      expect((bBody.items ?? []).map((row: any) => row.id)).not.toContain(assessmentA);
    });

    it('他班教师读取本班教师测评详情 403', async () => {
      expect((await get(`/api/assessments/${assessmentA}`, tokTeacherB)).status).toBe(403);
      expect((await get(`/api/assessments/${assessmentA}`, tokTeacherA)).status).toBe(200);
    });
  });

  describe('courseware', () => {
    it('原始作答：学生读自己 200、读他人 403，教师仅能读本班学生（外班/管理员口径见 #139）', async () => {
      expect((await get(`/api/courseware/attempts/${attemptA}/raw`, tokStudentA)).status).toBe(200);
      expect((await get(`/api/courseware/attempts/${attemptB}/raw`, tokStudentA)).status).toBe(403);
      expect((await get(`/api/courseware/attempts/${attemptB}/raw`, tokStudentB)).status).toBe(200);
      // 教师切片（Issue #139）：仅本班学生可读，外班学生 403
      expect((await get(`/api/courseware/attempts/${attemptA}/raw`, tokTeacherA)).status).toBe(200);
      expect((await get(`/api/courseware/attempts/${attemptB}/raw`, tokTeacherA)).status).toBe(403);
      expect((await get(`/api/courseware/attempts/${attemptB}/raw`, tokTeacherB)).status).toBe(200);
      // 管理员保留全校可见性
      expect((await get(`/api/courseware/attempts/${attemptB}/raw`, tokAdmin)).status).toBe(200);
    });

    it('作答列表：学生只拿到自己的记录，教师仅拿到本班学生，管理员拿全部', async () => {
      const studentList = await get(`/api/courseware/attempts?coursewareUuid=${coursewareUuid}`, tokStudentA);
      expect(studentList.status).toBe(200);
      const studentBody: any = await studentList.json();
      const studentRows: any[] = studentBody.attempts ?? studentBody.data ?? [];
      expect(studentRows.length).toBeGreaterThan(0);
      expect(studentRows.every((row: any) => row.studentId === studentA)).toBe(true);

      // 教师切片（Issue #139）：A 班教师只见本班学生
      const teacherList = await get(`/api/courseware/attempts?coursewareUuid=${coursewareUuid}`, tokTeacherA);
      expect(teacherList.status).toBe(200);
      const teacherBody: any = await teacherList.json();
      const teacherRows: any[] = teacherBody.attempts ?? teacherBody.data ?? [];
      expect(new Set(teacherRows.map((row: any) => row.studentId))).toEqual(new Set([studentA]));

      // B 班教师只见本班学生
      const teacherBList = await get(`/api/courseware/attempts?coursewareUuid=${coursewareUuid}`, tokTeacherB);
      expect(teacherBList.status).toBe(200);
      const teacherBBody: any = await teacherBList.json();
      const teacherBRows: any[] = teacherBBody.attempts ?? teacherBBody.data ?? [];
      expect(new Set(teacherBRows.map((row: any) => row.studentId))).toEqual(new Set([studentB]));

      // 管理员保留全校可见性
      const adminList = await get(`/api/courseware/attempts?coursewareUuid=${coursewareUuid}`, tokAdmin);
      expect(adminList.status).toBe(200);
      const adminBody: any = await adminList.json();
      const adminRows: any[] = adminBody.attempts ?? adminBody.data ?? [];
      expect(new Set(adminRows.map((row: any) => row.studentId))).toEqual(new Set([studentA, studentB]));
    });
  });

  describe('workspace', () => {
    it('客户端诊断：学生不能冒充他人 studentId，本人上报 200', async () => {
      const spoof = await fetch(`${baseUrl}/api/diagnostics/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...cookie(tokStudentA) },
        body: JSON.stringify({ studentId: studentB, error: { type: 'runtime', message: 'spoof' } }),
      });
      expect(spoof.status).toBe(403);

      const self = await fetch(`${baseUrl}/api/diagnostics/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...cookie(tokStudentA) },
        body: JSON.stringify({ studentId: studentA, error: { type: 'runtime', message: 'self report' } }),
      });
      expect(self.status).toBe(200);
    });
  });

  describe('presence', () => {
    it('presence-update 只发给教师房间，不做全局广播', () => {
      const emitted: Array<{ scope: string; room?: string; event: string; payload: unknown }> = [];
      const connectionHandlers: Array<(socket: any) => void> = [];
      const io = {
        on: (event: string, cb: (socket: any) => void) => {
          if (event === 'connection') connectionHandlers.push(cb);
        },
        emit: (event: string, payload: unknown) => emitted.push({ scope: 'global', event, payload }),
        to: (room: string) => ({
          emit: (event: string, payload: unknown) => emitted.push({ scope: 'room', room, event, payload }),
        }),
      } as any;

      setupPresence({
        io,
        eventBus: { publish: async () => undefined, subscribe: () => undefined },
        lookupStudentClassIds: () => [],
        lookupLessonClassId: () => null,
      } as any);

      const handlers = new Map<string, (data: any) => void>();
      const socket = {
        id: 'sock-matrix',
        data: {},
        on: (event: string, cb: (data: any) => void) => handlers.set(event, cb),
        emit: () => undefined,
        to: () => ({ emit: () => undefined }),
        join: () => undefined,
        leave: () => undefined,
      } as any;
      connectionHandlers[connectionHandlers.length - 1](socket);

      handlers.get('register-student')?.({ studentId: studentA, name: '矩阵学生甲' });

      expect(emitted.some((e) => e.scope === 'global' && e.event === 'presence-update')).toBe(false);
      expect(emitted).toContainEqual(
        expect.objectContaining({ scope: 'room', room: PRESENCE_STAFF_ROOM, event: 'presence-update' }),
      );
    });
  });
});
