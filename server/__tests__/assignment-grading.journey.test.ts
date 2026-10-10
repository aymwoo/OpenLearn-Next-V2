/**
 * @vitest-environment node
 *
 * 业务黄金旅程场景测试：作业与成绩全生命周期 (Assignment & Grading Journey)
 *
 * 覆盖教师与学生从作业发布、多版本提交、防越权代交拦截、教师多维度评分批改、
 * 到班级成绩权重配置与学期大盘自动汇算的完整闭环：
 *  阶段 1: 班级选课与作业发布 (Assignment Creation & Listing)
 *  阶段 2: 学生作业提交与越权代交拦截 (Submission & Anti-Impersonation)
 *  阶段 3: 教师批改、评分与评语落库 (Teacher Grading & Feedback)
 *  阶段 4: 成绩权重配置与学期大盘自动综合汇算 (Semester Grade Computation)
 *  阶段 5: 权限边界与越权评分审计 (Security Hardening)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';

import { registerAssignmentsRoutes } from '../routes/assignments.js';
import { registerGradingRoutes } from '../routes/grading.js';
import { registerRosterRoutes } from '../routes/roster.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { runStartupMigrations } from '../bootstrap-db.js';

describe('业务黄金旅程场景测试：作业与成绩全生命周期 (Assignment & Grading Journey)', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const teacherId = 'usr-asg-journey-teacher';
  const studentAliceId = 'stu-asg-alice';
  const studentBobId = 'stu-asg-bob';
  const outsiderStudentId = 'stu-asg-outsider';

  const teacherToken = 'tok-asg-teacher';
  const studentAliceToken = 'tok-asg-alice';
  const studentBobToken = 'tok-asg-bob';
  const outsiderToken = 'tok-asg-outsider';

  const classId = 'cls-asg-journey-001';
  const lessonId = 'les-asg-journey-001';
  let assignmentId = 'asg-journey-core-001';

  const db = kernelContainer.db;

  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });
  const jsonHeaders = (token: string) => ({
    'Content-Type': 'application/json',
    ...cookie(token),
  });

  const post = (urlPath: string, token: string, body?: Record<string, unknown>) =>
    fetch(`${baseUrl}${urlPath}`, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify(body ?? {}),
    });

  const get = (urlPath: string, token: string) =>
    fetch(`${baseUrl}${urlPath}`, {
      headers: cookie(token),
    });

  beforeAll(async () => {
    const now = Date.now();
    const expiresAt = now + 24 * 3600 * 1000;
    await runStartupMigrations(db as unknown as import('../bootstrap-db.js').MigrationDb); // strict: Database/MigrationDb 端口漂移，运行时相容

    // 清理可能遗留的历史测试数据
    try {
      db.prepare('DELETE FROM assignment_submissions WHERE assignment_id LIKE ?').run('%asg-journey%');
      db.prepare('DELETE FROM assignments WHERE class_id = ? OR id LIKE ?').run(classId, '%asg-journey%');
      db.prepare('DELETE FROM exam_scores WHERE student_id IN (?, ?, ?)').run(
        studentAliceId,
        studentBobId,
        outsiderStudentId,
      );
      db.prepare('DELETE FROM exams WHERE class_id = ?').run(classId);
      db.prepare('DELETE FROM attendance WHERE student_id IN (?, ?, ?)').run(
        studentAliceId,
        studentBobId,
        outsiderStudentId,
      );
      db.prepare('DELETE FROM schedules WHERE class_id = ?').run(classId);
      db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
      db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
      db.prepare('DELETE FROM users WHERE id IN (?, ?, ?, ?)').run(
        teacherId,
        studentAliceId,
        studentBobId,
        outsiderStudentId,
      );
      db.prepare('DELETE FROM students WHERE id IN (?, ?, ?)').run(studentAliceId, studentBobId, outsiderStudentId);
      db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?, ?)').run(
        teacherToken,
        studentAliceToken,
        studentBobToken,
        outsiderToken,
      );
    } catch {}

    // 1. 初始化用户主体与 Session 映射
    const insertUser = db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertUser.run(teacherId, 'asg_teacher', 'hash', 'teacher', '作业导师', now);
    insertUser.run(studentAliceId, 'asg_alice', 'hash', 'student', '爱丽丝', now);
    insertUser.run(studentBobId, 'asg_bob', 'hash', 'student', '鲍勃', now);
    insertUser.run(outsiderStudentId, 'asg_outsider', 'hash', 'student', '局外人查理', now);

    const insertStudent = db.prepare(
      'INSERT OR REPLACE INTO students (id, name, student_number, password, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    insertStudent.run(studentAliceId, '爱丽丝', 'STU_ASG_001', 'hash', now);
    insertStudent.run(studentBobId, '鲍勃', 'STU_ASG_002', 'hash', now);
    insertStudent.run(outsiderStudentId, '局外人查理', 'STU_ASG_003', 'hash', now);

    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'asg_teacher', name: '作业导师' }),
      now,
      expiresAt,
    );
    insertSession.run(
      studentAliceToken,
      JSON.stringify({
        userId: studentAliceId,
        studentId: studentAliceId,
        role: 'student',
        username: 'asg_alice',
        name: '爱丽丝',
      }),
      now,
      expiresAt,
    );
    insertSession.run(
      studentBobToken,
      JSON.stringify({
        userId: studentBobId,
        studentId: studentBobId,
        role: 'student',
        username: 'asg_bob',
        name: '鲍勃',
      }),
      now,
      expiresAt,
    );
    insertSession.run(
      outsiderToken,
      JSON.stringify({
        userId: outsiderStudentId,
        studentId: outsiderStudentId,
        role: 'student',
        username: 'asg_outsider',
        name: '局外人查理',
      }),
      now,
      expiresAt,
    );

    // 2. 初始化班级与花名册（仅 Alice 和 Bob 入班，查理不在本班）
    db.prepare('INSERT OR REPLACE INTO classes (id, name, description, created_at) VALUES (?, ?, ?, ?)').run(
      classId,
      '全栈开发高级实训班',
      '作业全流程测试班级',
      now,
    );
    db.prepare(
      'INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?), (?, ?, ?)',
    ).run(classId, studentAliceId, now, classId, studentBobId, now);

    // 3. 构建 Express 应用并挂载路由
    app = express();
    app.use(express.json());

    const ctx = {
      app,
      io: { emit: () => {}, to: () => ({ emit: () => {} }) },
      loginLimiter: ((_req: any, _res: any, next: any) => next()) as any,
      aiLimiter: null,
      activityRegistry: null,
      lessonActiveSegments: new Map(),
    } as any;

    registerAssignmentsRoutes(ctx);
    registerGradingRoutes(ctx);
    registerRosterRoutes(ctx);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    try {
      db.prepare('DELETE FROM assignment_submissions WHERE assignment_id LIKE ?').run('%asg-journey%');
      db.prepare('DELETE FROM assignments WHERE class_id = ? OR id LIKE ?').run(classId, '%asg-journey%');
      db.prepare('DELETE FROM exam_scores WHERE student_id IN (?, ?, ?)').run(
        studentAliceId,
        studentBobId,
        outsiderStudentId,
      );
      db.prepare('DELETE FROM exams WHERE class_id = ?').run(classId);
      db.prepare('DELETE FROM attendance WHERE student_id IN (?, ?, ?)').run(
        studentAliceId,
        studentBobId,
        outsiderStudentId,
      );
      db.prepare('DELETE FROM schedules WHERE class_id = ?').run(classId);
      db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
      db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
      db.prepare('DELETE FROM users WHERE id IN (?, ?, ?, ?)').run(
        teacherId,
        studentAliceId,
        studentBobId,
        outsiderStudentId,
      );
      db.prepare('DELETE FROM students WHERE id IN (?, ?, ?)').run(studentAliceId, studentBobId, outsiderStudentId);
      db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?, ?)').run(
        teacherToken,
        studentAliceToken,
        studentBobToken,
        outsiderToken,
      );
    } catch {}
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 阶段 1: 班级作业发布与查询 (Assignment Creation & Listing)
  // ══════════════════════════════════════════════════════════════════════════════
  describe('阶段 1: 班级作业发布与查询 (Assignment Creation & Listing)', () => {
    it('教师为班级创建随堂作业 POST /api/classes/:classId/assignments/create-suggested-quiz', async () => {
      const res = await post(`/api/classes/${classId}/assignments/create-suggested-quiz`, teacherToken, {
        title: '泛型与条件类型实战大作业',
        description: '实现一个 DeepReadonly 工具类型并附带单元测试',
        questions: [{ question: '如何递归映射', answer: '使用条件类型' }],
        lessonId,
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.assignmentId).toBeTruthy();
      assignmentId = json.assignmentId;

      // 验证 assignments 记录在数据库落库
      const asgRow = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId) as any;
      expect(asgRow).toBeDefined();
      expect(asgRow.class_id).toBe(classId);
      expect(asgRow.title).toBe('泛型与条件类型实战大作业');
    });

    it('教师与学生均可查询班级作业列表 GET /api/classes/:classId/assignments', async () => {
      const teacherRes = await get(`/api/classes/${classId}/assignments`, teacherToken);
      expect(teacherRes.status).toBe(200);
      const list = await teacherRes.json();
      expect(Array.isArray(list)).toBe(true);
      expect(list.some((a: any) => a.id === assignmentId)).toBe(true);

      const studentRes = await get(`/api/classes/${classId}/assignments`, studentAliceToken);
      expect(studentRes.status).toBe(200);
      const sList = await studentRes.json();
      expect(sList.some((a: any) => a.id === assignmentId)).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 阶段 2: 学生作业提交与越权代交防范 (Submission & Anti-Impersonation)
  // ══════════════════════════════════════════════════════════════════════════════
  describe('阶段 2: 学生作业提交与防越权代交 (Submission & Security)', () => {
    it('学生 Alice 提交第一版作答草稿 POST /api/assignments/:id/submissions', async () => {
      const res = await post(`/api/assignments/${assignmentId}/submissions`, studentAliceToken, {
        studentId: studentAliceId,
        content: '版本1：初步完成了 DeepReadonly 的递归映射类型定义。',
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      // 验证 assignment_submissions 表落库
      const subRow = db
        .prepare('SELECT * FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
        .get(assignmentId, studentAliceId) as any;
      expect(subRow).toBeDefined();
      expect(subRow.content).toContain('版本1');
      expect(subRow.status).toBe('submitted');
    });

    it('学生 Alice 再次提交更新为第二版终版代码，支持幂等更新', async () => {
      const res = await post(`/api/assignments/${assignmentId}/submissions`, studentAliceToken, {
        studentId: studentAliceId,
        content: '版本2：补齐了函数类型排除与 Symbol 键支持，附带完整 Vitest 样例。',
      });

      expect(res.status).toBe(200);

      // 验证内容被最新版本覆盖
      const subRow = db
        .prepare('SELECT * FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
        .get(assignmentId, studentAliceId) as any;
      expect(subRow.content).toContain('版本2');
    });

    it('越权防御：Bob 尝试传入 Alice 的 studentId 冒名代交应被 403 强力拦截', async () => {
      const res = await post(`/api/assignments/${assignmentId}/submissions`, studentBobToken, {
        studentId: studentAliceId, // 冒充 Alice
        content: 'Bob 恶意篡改 Alice 的作答内容',
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain('Cannot submit assignment on behalf of another student');
    });

    it('学生 Bob 正常提交自己的作业内容', async () => {
      const res = await post(`/api/assignments/${assignmentId}/submissions`, studentBobToken, {
        studentId: studentBobId,
        content: 'Bob 的作答：使用条件类型 Distributive Conditional Types 实现。',
      });

      expect(res.status).toBe(200);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 阶段 3: 教师批改、评分与评语落库 (Teacher Grading & Feedback)
  // ══════════════════════════════════════════════════════════════════════════════
  describe('阶段 3: 教师批改与打分 (Teacher Grading & Feedback)', () => {
    it('教师拉取作业全部学生提交列表 GET /api/assignments/:id/submissions', async () => {
      const res = await get(`/api/assignments/${assignmentId}/submissions`, teacherToken);
      expect(res.status).toBe(200);
      const submissions = await res.json();
      expect(submissions.length).toBe(2);

      const aliceSub = submissions.find((s: any) => s.student_id === studentAliceId);
      const bobSub = submissions.find((s: any) => s.student_id === studentBobId);
      expect(aliceSub).toBeDefined();
      expect(bobSub).toBeDefined();
      expect(aliceSub.content).toContain('版本2');
    });

    it('教师对学生作业录入成绩与批语并持久化落库', async () => {
      // 模拟教师评分确认：95 分 + 评语
      const now = Date.now();
      db.prepare(
        `UPDATE assignment_submissions
         SET score = ?, feedback = ?, status = 'graded', graded_at = ?
         WHERE assignment_id = ? AND student_id = ?`,
      ).run(95, '实现优雅，边界条件覆盖完整，优秀的工程代码！', now, assignmentId, studentAliceId);

      db.prepare(
        `UPDATE assignment_submissions
         SET score = ?, feedback = ?, status = 'graded', graded_at = ?
         WHERE assignment_id = ? AND student_id = ?`,
      ).run(85, '基本逻辑清晰，注意补充对私有属性的过滤。', now, assignmentId, studentBobId);

      // 验证成绩落库
      const aliceDb = db
        .prepare('SELECT score, feedback, status FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
        .get(assignmentId, studentAliceId) as any;
      expect(aliceDb.score).toBe(95);
      expect(aliceDb.status).toBe('graded');
      expect(aliceDb.feedback).toContain('实现优雅');

      const bobDb = db
        .prepare('SELECT score, feedback, status FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
        .get(assignmentId, studentBobId) as any;
      expect(bobDb.score).toBe(85);
      expect(bobDb.status).toBe('graded');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 阶段 4: 成绩权重配置与学期大盘自动核算 (Semester Grade Computation)
  // ══════════════════════════════════════════════════════════════════════════════
  describe('阶段 4: 成绩权重配置与学期综合核算 (Semester Grade Analytics)', () => {
    it('教师配置班级权重：作业 60% + 考勤 20% + 期中考试 20%', async () => {
      const res = await post(`/api/classes/${classId}/grade-weights`, teacherToken, {
        attendance_weight: 0.2,
        progress_weight: 0.0,
        assignment_weight: 0.6,
        exam_weight: 0.2,
      });

      expect(res.status).toBe(200);

      // 验证权重保存
      const getRes = await get(`/api/classes/${classId}/grade-weights`, teacherToken);
      expect(getRes.status).toBe(200);
      const weights = await getRes.json();
      expect(weights.assignment_weight).toBe(0.6);
      expect(weights.attendance_weight).toBe(0.2);
    });

    it('录入考勤与期中考试成绩，综合计算学期总评大盘', async () => {
      const now = Date.now();

      // 1. 考勤：创建排课 schedule 并录入签到（Alice 出勤 present 100分，Bob 缺勤 absent 0分）
      const schedId = 'sched-asg-01';
      db.prepare(
        'INSERT OR REPLACE INTO schedules (id, class_id, lesson_id, scheduled_date, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(schedId, classId, lessonId, '2026-10-04', now);

      db.prepare(
        'INSERT OR REPLACE INTO attendance (schedule_id, student_id, status, recorded_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
      ).run(schedId, studentAliceId, 'present', now, schedId, studentBobId, 'absent', now);

      // 2. 考试：创建期中考试并录入分数（Alice 90分，Bob 80分）
      const examRes = await post(`/api/classes/${classId}/exams`, teacherToken, {
        title: '期中架构师技术评测',
        description: '系统架构与重构理论考试',
        max_score: 100,
      });
      expect(examRes.status).toBe(200);
      const examJson = await examRes.json();
      const examId = examJson.examId;

      await post(`/api/exams/${examId}/scores`, teacherToken, {
        scores: [
          { studentId: studentAliceId, score: 90 },
          { studentId: studentBobId, score: 80 },
        ],
      });

      // 3. 触发学期综合成绩核算 GET /api/classes/:classId/semester-grades
      const semesterRes = await get(`/api/classes/${classId}/semester-grades?semesterName=2026秋季学期`, teacherToken);
      expect(semesterRes.status).toBe(200);
      const gradeReport = await semesterRes.json();
      expect(gradeReport.success).toBe(true);

      const aliceGrade = gradeReport.students.find((s: any) => s.studentId === studentAliceId);
      const bobGrade = gradeReport.students.find((s: any) => s.studentId === studentBobId);

      expect(aliceGrade).toBeDefined();
      expect(bobGrade).toBeDefined();

      // 算分验证：
      // Alice: 作业 95 * 0.6 = 57 + 考勤 100 * 0.2 = 20 + 考试 90 * 0.2 = 18 => 95 分 (等级 A)
      expect(aliceGrade.assignmentScore).toBe(95);
      expect(aliceGrade.attendanceScore).toBe(100);
      expect(aliceGrade.examScore).toBe(90);
      expect(aliceGrade.totalScore).toBe(95);
      expect(aliceGrade.gradeLevel).toBe('A');

      // Bob: 作业 85 * 0.6 = 51 + 考勤 0 * 0.2 = 0 + 考试 80 * 0.2 = 16 => 67 分 (等级 D)
      expect(bobGrade.assignmentScore).toBe(85);
      expect(bobGrade.attendanceScore).toBe(0);
      expect(bobGrade.examScore).toBe(80);
      expect(bobGrade.totalScore).toBe(67);
      expect(bobGrade.gradeLevel).toBe('D');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 阶段 5: 权限边界与越权评分防范 (Security Hardening)
  // ══════════════════════════════════════════════════════════════════════════════
  describe('阶段 5: 权限边界与安全加固 (Security Hardening)', () => {
    it('匿名请求作业与成绩端点统一返回 401 Unauthorized', async () => {
      const endpoints = [
        { url: `${baseUrl}/api/classes/${classId}/assignments`, method: 'GET' },
        { url: `${baseUrl}/api/classes/${classId}/assignments/create-suggested-quiz`, method: 'POST' },
        { url: `${baseUrl}/api/assignments/${assignmentId}/submissions`, method: 'GET' },
        { url: `${baseUrl}/api/classes/${classId}/grade-weights`, method: 'POST' },
      ];

      for (const ep of endpoints) {
        const res = await fetch(ep.url, { method: ep.method });
        expect(res.status).toBe(401);
      }
    });

    it('学生用户越权访问管理端点（创建作业、修改权重、录入考试分）应被 403 阻断', async () => {
      const forbiddenEndpoints = [
        { url: `${baseUrl}/api/classes/${classId}/assignments/create-suggested-quiz`, body: {} },
        { url: `${baseUrl}/api/classes/${classId}/grade-weights`, body: { attendance_weight: 1 } },
        { url: `${baseUrl}/api/classes/${classId}/exams`, body: { title: '非法考试' } },
        { url: `${baseUrl}/api/assignments/${assignmentId}/submissions`, method: 'GET' },
      ];

      for (const ep of forbiddenEndpoints) {
        const res = await fetch(ep.url, {
          method: ep.method || 'POST',
          headers: jsonHeaders(studentAliceToken),
          body: ep.body ? JSON.stringify(ep.body) : undefined,
        });
        expect(res.status).toBe(403);
      }
    });
  });
});
