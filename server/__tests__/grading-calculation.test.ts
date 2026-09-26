import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerGradingRoutes } from '../routes/grading.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('学期成绩结算计算漏洞回归测试（未交作业/缺考 0 分与无作业/考试默认满分）', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const teacherId = 'usr-grade-teacher-01';
  const teacherToken = 'tok-grade-teacher-01';

  const classWithWorkId = 'cls-grade-with-work';
  const classEmptyId = 'cls-grade-empty';

  const studentAliceId = 'stu-grade-alice'; // 作业 90，考试 80
  const studentBobId = 'stu-grade-bob';     // 未交作业，缺考

  const studentCharlieId = 'stu-grade-charlie'; // 在空班级中

  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

  beforeAll(async () => {
    const now = Date.now();
    const db = kernelContainer.db;

    // 1. 教师与 Session
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(teacherId, 'grade_teacher', 'placeholder', 'teacher', '成绩测试教师', now);

    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    const expiresAt = now + 60 * 60 * 1000;
    insertSession.run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'grade_teacher' }),
      now,
      expiresAt,
    );

    // 2. 班级与学生
    db.prepare('INSERT OR REPLACE INTO classes (id, name, created_at) VALUES (?, ?, ?)').run(
      classWithWorkId,
      '有作业班级',
      now,
    );
    db.prepare('INSERT OR REPLACE INTO classes (id, name, created_at) VALUES (?, ?, ?)').run(
      classEmptyId,
      '无作业班级',
      now,
    );

    const insertStudent = db.prepare(
      'INSERT OR REPLACE INTO students (id, student_number, name, created_at) VALUES (?, ?, ?, ?)',
    );
    insertStudent.run(studentAliceId, 'NUM_ALICE', 'Alice', now);
    insertStudent.run(studentBobId, 'NUM_BOB', 'Bob', now);
    insertStudent.run(studentCharlieId, 'NUM_CHARLIE', 'Charlie', now);

    const enroll = db.prepare(
      'INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)',
    );
    enroll.run(classWithWorkId, studentAliceId, now);
    enroll.run(classWithWorkId, studentBobId, now);
    enroll.run(classEmptyId, studentCharlieId, now);

    // 3. 有作业班级的作业与提交
    const assignmentId = 'asg-grade-01';
    db.prepare(
      'INSERT OR REPLACE INTO assignments (id, class_id, title, created_at) VALUES (?, ?, ?, ?)',
    ).run(assignmentId, classWithWorkId, '第一单元练习', now);

    db.prepare(
      'INSERT OR REPLACE INTO assignment_submissions (assignment_id, student_id, score, status, submitted_at, graded_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(assignmentId, studentAliceId, 90, 'graded', now, now);
    // 注意：Bob 不插入 assignment_submissions（未交作业）

    // 4. 有作业班级的考试与成绩
    const examId = 'exam-grade-01';
    db.prepare(
      'INSERT OR REPLACE INTO exams (id, class_id, title, max_score, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(examId, classWithWorkId, '期末测试', 100, now);

    db.prepare(
      'INSERT OR REPLACE INTO exam_scores (exam_id, student_id, score, recorded_at) VALUES (?, ?, ?, ?)',
    ).run(examId, studentAliceId, 80, now);
    // 注意：Bob 不插入 exam_scores（缺考）

    // 5. 启动测试 Express 服务并挂载 grading 路由
    app = express();
    app.use(express.json());
    const ctx: any = { app, io: { emit: () => undefined } };
    registerGradingRoutes(ctx);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const db = kernelContainer.db;

    db.prepare('DELETE FROM client_sessions WHERE id = ?').run(teacherToken);
    db.prepare('DELETE FROM users WHERE id = ?').run(teacherId);

    db.prepare('DELETE FROM assignment_submissions WHERE assignment_id = ?').run('asg-grade-01');
    db.prepare('DELETE FROM assignments WHERE class_id = ?').run(classWithWorkId);
    db.prepare('DELETE FROM exam_scores WHERE exam_id = ?').run('exam-grade-01');
    db.prepare('DELETE FROM exams WHERE class_id = ?').run(classWithWorkId);

    db.prepare('DELETE FROM class_students WHERE class_id IN (?, ?)').run(classWithWorkId, classEmptyId);
    db.prepare('DELETE FROM students WHERE id IN (?, ?, ?)').run(studentAliceId, studentBobId, studentCharlieId);
    db.prepare('DELETE FROM classes WHERE id IN (?, ?)').run(classWithWorkId, classEmptyId);
  });

  it('班级有已发布作业和考试时：未提交作业的学生应计 0 分，缺考学生应计 0 分（修复前误判为 100 分）', async () => {
    const res = await fetch(`${baseUrl}/api/classes/${classWithWorkId}/semester-grades`, {
      headers: cookie(teacherToken),
    });
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      success: boolean;
      weights: any;
      students: Array<{
        studentId: string;
        assignmentScore: number;
        examScore: number;
        totalScore: number;
      }>;
    };
    expect(data.success).toBe(true);
    const grades = data.students;

    const alice = grades.find((g) => g.studentId === studentAliceId);
    const bob = grades.find((g) => g.studentId === studentBobId);

    expect(alice).toBeDefined();
    expect(alice!.assignmentScore).toBe(90);
    expect(alice!.examScore).toBe(80);

    expect(bob).toBeDefined();
    // 关键断言：Bob 未交作业，且班级有布置作业，平时成绩必须为 0 分而非 100 分
    expect(bob!.assignmentScore).toBe(0);
    // 关键断言：Bob 缺考，且班级有考试，考试成绩必须为 0 分而非 100 分
    expect(bob!.examScore).toBe(0);

    // 总评加权对比：默认权重 (attendance: 0.15*100=15, progress: 0.25*100=25, assignment: 0.35, exam: 0.25)
    // Bob: 15 + 25 + 0*0.35 + 0*0.25 = 40 分
    // 修复前 Bob 会得到 15 + 25 + 100*0.35 + 100*0.25 = 100 分
    expect(bob!.totalScore).toBeLessThanOrEqual(40);
  });

  it('班级未发布任何作业与考试时：学生作业与考试成绩应保留默认 100 分（避免无课程产出时误扣分）', async () => {
    const res = await fetch(`${baseUrl}/api/classes/${classEmptyId}/semester-grades`, {
      headers: cookie(teacherToken),
    });
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      success: boolean;
      weights: any;
      students: Array<{
        studentId: string;
        assignmentScore: number;
        examScore: number;
        totalScore: number;
      }>;
    };
    expect(data.success).toBe(true);
    const grades = data.students;

    const charlie = grades.find((g) => g.studentId === studentCharlieId);
    expect(charlie).toBeDefined();
    expect(charlie!.assignmentScore).toBe(100);
    expect(charlie!.examScore).toBe(100);
    expect(charlie!.totalScore).toBe(100);
  });
});
