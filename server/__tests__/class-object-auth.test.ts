/**
 * 班级 / 作业 / 提交 / 成绩的对象级授权。
 * 学生只能看自己的班级和自己的提交；教师只能看自己管理的班级；管理员不限。
 * 列表与仪表盘不再返回班级口令。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerRosterRoutes } from '../routes/roster.js';
import { registerAssignmentsRoutes } from '../routes/assignments.js';
import { registerGradingRoutes } from '../routes/grading.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('班级与作业对象级授权', () => {
  let server: Server;
  let baseUrl: string;
  const db = kernelContainer.db;

  const teacherA = 'usr-objauth-teacher-a';
  const teacherB = 'usr-objauth-teacher-b';
  const adminId = 'usr-objauth-admin';
  const studentA = 'stu-objauth-a';
  const studentB = 'stu-objauth-b';
  const classA = 'cls-objauth-a';
  const classB = 'cls-objauth-b';
  const assignmentId = 'asg-objauth-a';
  const examId = 'exam-objauth-a';

  const tokTeacherA = 'tok-objauth-teacher-a';
  const tokTeacherB = 'tok-objauth-teacher-b';
  const tokAdmin = 'tok-objauth-admin';
  const tokStudentA = 'tok-objauth-student-a';
  const tokStudentB = 'tok-objauth-student-b';

  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });
  const get = (path: string, token: string) => fetch(`${baseUrl}${path}`, { headers: cookie(token) });

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    const noop = (_req: any, _res: any, next: any) => next();
    registerRosterRoutes({ app, io: undefined, loginLimiter: noop } as any);
    registerAssignmentsRoutes({ app } as any);
    registerGradingRoutes({ app } as any);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const now = Date.now();
    const exp = now + 3600_000;
    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(tokTeacherA, JSON.stringify({ userId: teacherA, role: 'teacher', username: 'obj_a' }), now, exp);
    insertSession.run(tokTeacherB, JSON.stringify({ userId: teacherB, role: 'teacher', username: 'obj_b' }), now, exp);
    insertSession.run(
      tokAdmin,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'obj_admin' }),
      now,
      exp,
    );
    insertSession.run(
      tokStudentA,
      JSON.stringify({ userId: studentA, studentId: studentA, role: 'student', username: 'obj_sa' }),
      now,
      exp,
    );
    insertSession.run(
      tokStudentB,
      JSON.stringify({ userId: studentB, studentId: studentB, role: 'student', username: 'obj_sb' }),
      now,
      exp,
    );

    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(classA, '对象授权甲班', 'secret-a', 'pass-a', teacherA, now);
    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(classB, '对象授权乙班', 'secret-b', 'pass-b', teacherB, now);
    db.prepare(
      'INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(studentA, 'OBJ-A', '学生甲', '', now);
    db.prepare(
      'INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(studentB, 'OBJ-B', '学生乙', '', now);
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
    const content = JSON.stringify({ questions: [{ prompt: '1+1', correctAnswer: '2' }] });
    db.prepare(
      'INSERT OR REPLACE INTO assignments (id, class_id, lesson_id, title, description, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(assignmentId, classA, null, '口算', '', content, now);
    db.prepare(
      `INSERT OR REPLACE INTO assignment_submissions (assignment_id, student_id, content, submitted_at, status, score)
       VALUES (?, ?, ?, ?, 'graded', 100)`,
    ).run(assignmentId, studentA, '2', now);
    db.prepare(
      'INSERT OR REPLACE INTO exams (id, class_id, title, description, max_score, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(examId, classA, '小测', '', 100, now);
    db.prepare(
      'INSERT OR REPLACE INTO exam_scores (exam_id, student_id, score, notes, recorded_at) VALUES (?, ?, ?, ?, ?)',
    ).run(examId, studentA, 88, '', now);
  });

  afterAll(async () => {
    db.prepare('DELETE FROM exam_scores WHERE exam_id = ?').run(examId);
    db.prepare('DELETE FROM exams WHERE id = ?').run(examId);
    db.prepare('DELETE FROM assignment_submissions WHERE assignment_id = ?').run(assignmentId);
    db.prepare('DELETE FROM assignments WHERE id = ?').run(assignmentId);
    db.prepare('DELETE FROM class_students WHERE class_id IN (?, ?)').run(classA, classB);
    db.prepare('DELETE FROM classes WHERE id IN (?, ?)').run(classA, classB);
    db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(studentA, studentB);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?, ?, ?)').run(
      tokTeacherA,
      tokTeacherB,
      tokAdmin,
      tokStudentA,
      tokStudentB,
    );
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('外班学生与外班教师读取作业、仪表盘、成绩返回 403', async () => {
    expect((await get(`/api/classes/${classA}/assignments`, tokStudentB)).status).toBe(403);
    expect((await get(`/api/classes/${classA}/dashboard`, tokStudentB)).status).toBe(403);
    expect((await get(`/api/students/${studentA}/dashboard`, tokStudentB)).status).toBe(403);
    expect((await get(`/api/students/${studentA}/academic-year-comparison`, tokStudentB)).status).toBe(403);
    expect((await get(`/api/classes/${classA}/assignments`, tokTeacherB)).status).toBe(403);
    expect((await get(`/api/classes/${classA}/dashboard`, tokTeacherB)).status).toBe(403);
    expect((await get(`/api/students/${studentA}/academic-year-comparison`, tokTeacherB)).status).toBe(403);
    expect((await get(`/api/exams/${examId}/scores`, tokStudentB)).status).toBe(403);

    expect((await get(`/api/classes/${classA}/semester-grades`, tokTeacherB)).status).toBe(403);
    expect((await get('/api/classes/cls-objauth-missing/assignments', tokTeacherA)).status).toBe(404);
  });

  it('本班学生只能看到自己的作业且不含答案与班级口令', async () => {
    const list = await get(`/api/classes/${classA}/assignments`, tokStudentA);
    expect(list.status).toBe(200);
    const rows: any[] = await list.json();
    expect(rows).toHaveLength(1);
    const parsed = JSON.parse(rows[0].content);
    expect(parsed.questions[0].prompt).toBe('1+1');
    expect(parsed.questions[0].correctAnswer).toBeUndefined();
    expect(JSON.stringify(rows[0])).not.toContain('class_passcode');

    const dash = await get(`/api/students/${studentA}/dashboard`, tokStudentA);
    expect(dash.status).toBe(200);
    const body: any = await dash.json();
    expect(JSON.stringify(body.classes)).not.toContain('pass-a');
    expect(JSON.stringify(body.classes)).not.toContain('class_passcode');
    const own = JSON.parse(body.assignments[0].content);
    expect(own.questions[0].correctAnswer).toBeUndefined();

    const classes = await get('/api/classes?pageSize=all', tokStudentA);
    const envelope: any = await classes.json();
    const ids = (envelope.data || []).map((row: any) => row.id);
    expect(ids).toContain(classA);
    expect(ids).not.toContain(classB);
    expect(JSON.stringify(envelope)).not.toContain('pass-a');
  });

  it('管理该班的教师和管理员可以读取作业全文', async () => {
    const teacher = await get(`/api/classes/${classA}/assignments`, tokTeacherA);
    expect(teacher.status).toBe(200);
    const teacherRows: any[] = await teacher.json();
    expect(JSON.parse(teacherRows[0].content).questions[0].correctAnswer).toBe('2');

    const admin = await get(`/api/classes/${classA}/dashboard`, tokAdmin);
    expect(admin.status).toBe(200);
    const adminBody: any = await admin.json();
    expect(adminBody.recentSubmissions.length).toBeGreaterThan(0);
    expect(JSON.stringify(adminBody)).not.toContain('class_passcode');

    // 学生本人、本班教师与管理员可以查看多学年对比
    const studentComp = await get(`/api/students/${studentA}/academic-year-comparison`, tokStudentA);
    expect(studentComp.status).toBe(200);
    const studentCompBody: any = await studentComp.json();
    expect(studentCompBody.studentId).toBe(studentA);
    expect(Array.isArray(studentCompBody.metricsByYear)).toBe(true);

    const teacherComp = await get(`/api/students/${studentA}/academic-year-comparison`, tokTeacherA);
    expect(teacherComp.status).toBe(200);

    const adminComp = await get(`/api/students/${studentA}/academic-year-comparison`, tokAdmin);
    expect(adminComp.status).toBe(200);
  });
});

