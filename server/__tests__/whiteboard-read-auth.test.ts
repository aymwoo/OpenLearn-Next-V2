/**
 * SEC-AUTH #127：白板读接口的答案脱敏与归属校验。
 *
 * - 学生读取课节白板时，元素 data 中的 correctIndex / correctAnswer 等答案字段必须被剥离；
 * - 教师/管理员仍拿到完整数据；
 * - 学生只能读自己的作业工作区伪课节；
 * - 已开课的真实课节，只有开课班级成员可读（与 socket canJoinLessonRoom 同口径）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerLessonsRoutes } from '../routes/lessons.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('白板读取授权与答案脱敏（#127）', () => {
  let server: Server;
  let baseUrl: string;
  const db = kernelContainer.db;

  const teacherA = 'usr-wbread-teacher-a';
  const teacherB = 'usr-wbread-teacher-b';
  const adminId = 'usr-wbread-admin';
  const studentA = 'stu-wbread-a';
  const studentB = 'stu-wbread-b';
  const classA = 'cls-wbread-a';
  const classB = 'cls-wbread-b';
  const lessonStarted = 'les-wbread-started';
  const lessonFree = 'les-wbread-free';
  const pseudoOwn = `assignment-asg-wbread-student-${studentA}`;
  const pseudoOther = `assignment-asg-wbread-student-${studentB}`;

  const tokTeacherA = 'tok-wbread-teacher-a';
  const tokTeacherB = 'tok-wbread-teacher-b';
  const tokAdmin = 'tok-wbread-admin';
  const tokStudentA = 'tok-wbread-student-a';
  const tokStudentB = 'tok-wbread-student-b';

  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });
  const fetchBoard = (roomId: string, token: string) =>
    fetch(`${baseUrl}/api/lessons/${encodeURIComponent(roomId)}/whiteboard`, { headers: cookie(token) });

  beforeAll(async () => {
    const now = Date.now();
    const exp = now + 3600_000;

    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(
      tokTeacherA,
      JSON.stringify({ userId: teacherA, role: 'teacher', username: 'wbread_a' }),
      now,
      exp,
    );
    insertSession.run(
      tokTeacherB,
      JSON.stringify({ userId: teacherB, role: 'teacher', username: 'wbread_b' }),
      now,
      exp,
    );
    insertSession.run(
      tokAdmin,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'wbread_admin' }),
      now,
      exp,
    );
    insertSession.run(
      tokStudentA,
      JSON.stringify({ userId: studentA, studentId: studentA, role: 'student', username: 'wbread_sa' }),
      now,
      exp,
    );
    insertSession.run(
      tokStudentB,
      JSON.stringify({ userId: studentB, studentId: studentB, role: 'student', username: 'wbread_sb' }),
      now,
      exp,
    );

    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(classA, '白板甲班', '', teacherA, now);
    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(classB, '白板乙班', '', teacherB, now);
    db.prepare('INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)').run(
      studentA,
      'WBREAD-A',
      '甲班学生',
      '',
      now,
    );
    db.prepare('INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)').run(
      studentB,
      'WBREAD-B',
      '乙班学生',
      '',
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

    // 已开课：班级为 classA（studentB 不属于该班）
    db.prepare(
      'INSERT OR REPLACE INTO classroom_sessions (id, lesson_id, class_id, teacher_id, stage, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('cs-wbread-1', lessonStarted, classA, teacherA, 'IN_CLASS_TEACHING', now);

    db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id IN (?, ?, ?, ?)').run(
      lessonStarted,
      lessonFree,
      pseudoOwn,
      pseudoOther,
    );
    const insertElement = db.prepare(
      'INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    insertElement.run(
      'wb-el-quiz',
      lessonStarted,
      'quiz',
      JSON.stringify({ type: 'quiz', question: '1+1=?', options: ['1', '2'], correctIndex: 1, correctAnswer: '2' }),
      now,
    );
    insertElement.run('wb-el-free', lessonFree, 'text', JSON.stringify({ text: '自学白板' }), now);
    insertElement.run('wb-el-own', pseudoOwn, 'text', JSON.stringify({ text: '我的作业' }), now);
    insertElement.run('wb-el-other', pseudoOther, 'text', JSON.stringify({ text: '别人的作业' }), now);

    const app = express();
    app.use(express.json());
    registerLessonsRoutes({ app } as any);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id IN (?, ?, ?, ?, ?)').run(
        lessonStarted,
        lessonFree,
        pseudoOwn,
        pseudoOther,
        `snapshot-${lessonStarted}`,
      );
      db.prepare('DELETE FROM classroom_sessions WHERE id = ?').run('cs-wbread-1');
      db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?, ?, ?)').run(
        tokTeacherA,
        tokTeacherB,
        tokAdmin,
        tokStudentA,
        tokStudentB,
      );
      db.prepare('DELETE FROM class_students WHERE class_id IN (?, ?)').run(classA, classB);
      db.prepare('DELETE FROM classes WHERE id IN (?, ?)').run(classA, classB);
      db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(studentA, studentB);
    } catch {
      // 清理失败不掩盖测试结论
    }
  });

  it('学生读取课节白板时剥离 correctIndex / correctAnswer，保留选项', async () => {
    const res = await fetchBoard(lessonStarted, tokStudentA);
    expect(res.status).toBe(200);
    const body: any[] = await res.json();
    const quiz = body.find((el) => el.id === 'wb-el-quiz');
    expect(quiz).toBeTruthy();
    const data = JSON.parse(quiz.data);
    expect(data.correctIndex).toBeUndefined();
    expect(data.correctAnswer).toBeUndefined();
    expect(data.options).toEqual(['1', '2']);
    expect(data.question).toBe('1+1=?');
  });

  it('教师与管理员读取同一白板仍拿到完整答案', async () => {
    for (const token of [tokTeacherA, tokAdmin]) {
      const res = await fetchBoard(lessonStarted, token);
      expect(res.status).toBe(200);
      const body: any[] = await res.json();
      const data = JSON.parse(body.find((el) => el.id === 'wb-el-quiz').data);
      expect(data.correctIndex).toBe(1);
      expect(data.correctAnswer).toBe('2');
    }
  });

  it('非开课班级的学生读取该课节白板返回 403', async () => {
    const res = await fetchBoard(lessonStarted, tokStudentB);
    expect(res.status).toBe(403);
  });

  it('未开课的真实课节不额外限制（自学场景）', async () => {
    const res = await fetchBoard(lessonFree, tokStudentB);
    expect(res.status).toBe(200);
    const body: any[] = await res.json();
    expect(body.find((el) => el.id === 'wb-el-free')).toBeTruthy();
  });

  it('学生读取他人作业工作区白板返回 403，读取自己的返回 200', async () => {
    const denied = await fetchBoard(pseudoOther, tokStudentA);
    expect(denied.status).toBe(403);

    const allowed = await fetchBoard(pseudoOwn, tokStudentA);
    expect(allowed.status).toBe(200);
    const body: any[] = await allowed.json();
    expect(body.find((el) => el.id === 'wb-el-own')).toBeTruthy();
  });

  it('教师可读取学生的作业工作区白板（批注场景）', async () => {
    const res = await fetchBoard(pseudoOther, tokTeacherA);
    expect(res.status).toBe(200);
  });

  it('未登录读取返回 401', async () => {
    const res = await fetch(`${baseUrl}/api/lessons/${lessonStarted}/whiteboard`);
    expect(res.status).toBe(401);
  });
});
