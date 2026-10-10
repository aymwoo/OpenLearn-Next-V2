/**
 * @vitest-environment node
 *
 * 互动课堂学生全链路作答、问卷、通票、作业采集与教师端记录自动化回归测试套件。
 *
 * 覆盖流程：
 *  1. 随堂投票（Quick Poll）发起、学生投票、实时汇总与关闭拦截；
 *  2. 白板随堂测验（Quiz）作答提交、关系表原子落库、实时 Socket 广播与教师端合并拉取；
 *  3. 自适应结课通票（Exit Ticket）提交通票、班级花名册联查与全景学情（Panoramic Report）多维聚合；
 *  4. 随堂作业（Assignment）学生提交、越权拦截、教师端拉取与评分记录；
 *  5. 内核事件总线（EventBus）与插件扩展事件监听闭环。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { Server as SocketServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

import { registerClassroomRoutes } from '../routes/classroom.js';
import { registerLessonsRoutes } from '../routes/lessons.js';
import { registerAssignmentsRoutes } from '../routes/assignments.js';
import { ClassroomRuntimeService } from '../services/classroom-runtime-service.js';
import { setupRealtimeBridge } from '../realtime-bridge.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ensureTestSchema } from './helpers/test-schema.js';

describe('课堂学生互动与教师采集全链路自动化测试 (End-to-End Regression)', () => {
  let app: express.Express;
  let server: Server;
  let io: SocketServer;
  let baseUrl: string;
  let socketClient: ClientSocket;
  let classroomService: ClassroomRuntimeService;

  const teacherId = 'usr-e2e-teacher-999';
  const student1Id = 'stu-e2e-001';
  const student2Id = 'stu-e2e-002';
  const student3Id = 'stu-e2e-003';

  const teacherToken = 'tok-e2e-teacher-999';
  const student1Token = 'tok-e2e-stu-001';
  const student2Token = 'tok-e2e-stu-002';
  const student3Token = 'tok-e2e-stu-003';

  const classId = 'cls-e2e-interactive-999';
  const lessonId = 'les-e2e-interactive-999';
  const quizElementId = 'el-quiz-e2e-999';
  const assignmentId = 'asg-e2e-interactive-999';

  const db = kernelContainer.db as any;
  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });
  const jsonHeaders = (token: string) => ({ 'Content-Type': 'application/json', ...cookie(token) });

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
    // 1. 初始化数据库迁移（vitest.setup.ts 已统一兜底，此处显式声明依赖，幂等）
    ensureTestSchema();

    // 2. 初始化 Express 与 Socket.IO
    app = express();
    app.use(express.json());
    server = createServer(app);
    io = new SocketServer(server, { cors: { origin: '*' } });

    const ctx = {
      app,
      io,
      loginLimiter: null,
      aiLimiter: null,
      activityRegistry: null,
      lessonActiveSegments: new Map(),
      buildAgentSystemInstruction: () => '',
      buildAgentFinalMessage: () => '',
      normalizeToolSchema: (s: any) => s,
      buildOpenAITools: () => [],
      executeAgentToolCall: async () => null,
      buildOpenAIChatUrl: (u: string) => u,
      runGeminiAgentChat: async () => null,
      runOpenAIAgentChat: async () => null,
    } as any;

    classroomService = new ClassroomRuntimeService(db);
    registerClassroomRoutes(ctx, classroomService);
    registerLessonsRoutes(ctx);
    registerAssignmentsRoutes(ctx);

    setupRealtimeBridge({
      eventBus: kernelContainer.eventBus,
      io,
      db,
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;

    // 3. 播种班级、师生、会话、白板测验与作业数据
    const now = Date.now();

    // 教师与学生用户
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(teacherId, 'e2e_teacher', '互动测试教师', 'hash', 'teacher', now);

    // 班级与学生花名册
    db.prepare('INSERT OR REPLACE INTO classes (id, name, created_at) VALUES (?, ?, ?)').run(
      classId,
      '高二物理示范班',
      now,
    );

    const students = [
      { id: student1Id, name: '张小凡', number: '2026101', token: student1Token },
      { id: student2Id, name: '李陆雪', number: '2026102', token: student2Token },
      { id: student3Id, name: '林惊羽', number: '2026103', token: student3Token },
    ];

    for (const s of students) {
      db.prepare(
        'INSERT OR REPLACE INTO users (id, username, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(s.id, s.id, s.name, 'hash', 'student', now);
      db.prepare('INSERT OR REPLACE INTO students (id, name, student_number, created_at) VALUES (?, ?, ?, ?)').run(
        s.id,
        s.name,
        s.number,
        now,
      );
      db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
        classId,
        s.id,
        now,
      );
    }

    // 课节
    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(lessonId, '量子力学与光电效应实验', teacherId, now, now);

    // 会话 Cookie
    const sessionData = (userId: string, role: string, name: string) =>
      JSON.stringify({ userId, role, username: name, name, studentId: role === 'student' ? userId : undefined });

    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(teacherToken, sessionData(teacherId, 'teacher', '互动测试教师'), now, now + 86400000);

    for (const s of students) {
      db.prepare(
        'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
      ).run(s.token, sessionData(s.id, 'student', s.name), now, now + 86400000);
    }

    // 白板随堂测验微件元素 (正确答案为 'C' / index 2)
    db.prepare(
      'INSERT OR REPLACE INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(
      quizElementId,
      lessonId,
      'quiz',
      JSON.stringify({
        question: '当入射光频率大于截止频率时，逸出光电子的最大初动能与什么成正比？',
        options: ['入射光强', '照射时间', '入射光频率', '金属靶面积'],
        correctAnswer: 'C',
        correctIndex: 2,
        passScore: 60,
        submissions: {},
      }),
      now,
    );

    // 随堂作业
    db.prepare(
      'INSERT OR REPLACE INTO assignments (id, class_id, lesson_id, title, description, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      assignmentId,
      classId,
      lessonId,
      '随堂练习：爱因斯坦光电效应方程计算',
      '根据实验测量数据计算普朗克常量',
      JSON.stringify({ quizType: 'physics_calculation', maxScore: 100 }),
      now,
    );

    // 4. 连接真实 Socket 客户端用于监听实时广播
    socketClient = ioClient(baseUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });

    await new Promise<void>((resolve, reject) => {
      socketClient.once('connect', () => resolve());
      socketClient.once('connect_error', (err) => reject(err));
    });
  });

  afterAll(async () => {
    socketClient?.disconnect();
    io?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()));

    db.prepare(
      'DELETE FROM classroom_poll_votes WHERE poll_id IN (SELECT id FROM classroom_quick_polls WHERE lesson_id = ?)',
    ).run(lessonId);
    db.prepare('DELETE FROM classroom_quick_polls WHERE lesson_id = ?').run(lessonId);
    db.prepare(
      'DELETE FROM classroom_exit_tickets WHERE session_id IN (SELECT id FROM classroom_sessions WHERE lesson_id = ?)',
    ).run(lessonId);
    db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM lesson_quiz_submissions WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM whiteboard_elements WHERE id = ?').run(quizElementId);
    db.prepare('DELETE FROM assignment_submissions WHERE assignment_id = ?').run(assignmentId);
    db.prepare('DELETE FROM assignments WHERE id = ?').run(assignmentId);
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
    db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    db.prepare('DELETE FROM students WHERE id IN (?, ?, ?)').run(student1Id, student2Id, student3Id);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?, ?)').run(
      teacherToken,
      student1Token,
      student2Token,
      student3Token,
    );
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    db.prepare('DELETE FROM users WHERE id IN (?, ?, ?, ?)').run(teacherId, student1Id, student2Id, student3Id);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 1. 随堂投票 (Quick Poll) 完整流程
  // ────────────────────────────────────────────────────────────────────────────
  describe('随堂互动投票（Quick Poll）全流程验证', () => {
    let pollId: string;

    it('教师发起投票 → 学生并发提交 → 选项分布准确采集', async () => {
      // 教师发起投票
      const createRes = await post(`/api/classroom/sessions/${lessonId}/quick-poll`, teacherToken, {
        title: '你是否赞同光具有波粒二象性？',
        questionType: 'ABCD',
        options: ['完全赞同', '存有疑虑', '完全不赞同'],
      });
      expect(createRes.status).toBe(200);
      const createJson: any = await createRes.json();
      expect(createJson.success).toBe(true);
      pollId = createJson.poll.id;
      expect(pollId).toBeDefined();

      // 学生 1 投 A
      const v1Res = await post(`/api/classroom/sessions/${lessonId}/quick-poll/${pollId}/vote`, student1Token, {
        option: '完全赞同',
      });
      expect(v1Res.status).toBe(200);

      // 学生 2 投 B
      const v2Res = await post(`/api/classroom/sessions/${lessonId}/quick-poll/${pollId}/vote`, student2Token, {
        option: '存有疑虑',
      });
      expect(v2Res.status).toBe(200);
      const v2Json: any = await v2Res.json();
      expect(v2Json.distribution['完全赞同']).toBe(1);
      expect(v2Json.distribution['存有疑虑']).toBe(1);
    });

    it('教师关闭投票后拒绝后续提交', async () => {
      const closeRes = await post(`/api/classroom/sessions/${lessonId}/quick-poll/${pollId}/close`, teacherToken);
      expect(closeRes.status).toBe(200);

      // 学生 3 在关闭后投票应被 400 拒绝
      const v3Res = await post(`/api/classroom/sessions/${lessonId}/quick-poll/${pollId}/vote`, student3Token, {
        option: '完全赞同',
      });
      expect(v3Res.status).toBe(400);
      const v3Json: any = await v3Res.json();
      expect(v3Json.error).toContain('closed');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. 白板随堂测验 (Whiteboard Quiz) 答题与原子合并
  // ────────────────────────────────────────────────────────────────────────────
  describe('白板随堂测验（Quiz）作答、原子落库与 Socket 广播', () => {
    it('学生作答提交 → 广播 whiteboard-quiz-answered → 关系表原子写入 → 教师端拉取权威合并', async () => {
      const receivedSocketEvents: any[] = [];
      socketClient.on('whiteboard-quiz-answered', (data) => {
        receivedSocketEvents.push(data);
      });

      // 学生 1 提交正确答案 'C'
      const s1Res = await post(`/api/lessons/${lessonId}/quiz-submit`, student1Token, {
        elementId: quizElementId,
        answer: 'C',
      });
      expect(s1Res.status).toBe(200);
      const s1Json: any = await s1Res.json();
      expect(s1Json.success).toBe(true);
      expect(s1Json.isCorrect).toBe(true);
      expect(s1Json.score).toBe(100);

      // 学生 2 提交错误答案 'A'
      const s2Res = await post(`/api/lessons/${lessonId}/quiz-submit`, student2Token, {
        elementId: quizElementId,
        answer: 'A',
      });
      expect(s2Res.status).toBe(200);
      const s2Json: any = await s2Res.json();
      expect(s2Json.success).toBe(true);
      expect(s2Json.isCorrect).toBe(false);
      expect(s2Json.score).toBe(0);

      // 等待 socket 广播接收
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(receivedSocketEvents.length).toBeGreaterThanOrEqual(2);

      const evt1 = receivedSocketEvents.find((e) => e.studentId === student1Id);
      expect(evt1).toBeDefined();
      expect(evt1.answer).toBe('C');
      expect(evt1.isCorrect).toBe(true);

      const evt2 = receivedSocketEvents.find((e) => e.studentId === student2Id);
      expect(evt2).toBeDefined();
      expect(evt2.answer).toBe('A');
      expect(evt2.isCorrect).toBe(false);

      // 验证关系表中的原子落库 (lesson_quiz_submissions)
      const rows = db
        .prepare(
          'SELECT student_id, answer, is_correct, score FROM lesson_quiz_submissions WHERE lesson_id = ? AND element_id = ?',
        )
        .all(lessonId, quizElementId) as any[];
      expect(rows).toHaveLength(2);

      const r1 = rows.find((r) => r.student_id === student1Id);
      expect(r1.answer).toBe('C');
      expect(r1.is_correct).toBe(1);
      expect(r1.score).toBe(100);

      // 教师端调用 GET /api/lessons/:id/quiz-submissions 验证权威合并逻辑
      const fetchRes = await get(`/api/lessons/${lessonId}/quiz-submissions`, teacherToken);
      expect(fetchRes.status).toBe(200);
      const fetchJson: any = await fetchRes.json();
      expect(fetchJson.success).toBe(true);

      const quizData = fetchJson.quizzes.find((q: any) => q.elementId === quizElementId);
      expect(quizData).toBeDefined();
      expect(quizData.submissions[student1Id]).toBeDefined();
      expect(quizData.submissions[student1Id].answer).toBe('C');
      expect(quizData.submissions[student1Id].isCorrect).toBe(true);
      expect(quizData.submissions[student1Id].score).toBe(100);

      expect(quizData.submissions[student2Id]).toBeDefined();
      expect(quizData.submissions[student2Id].answer).toBe('A');
      expect(quizData.submissions[student2Id].isCorrect).toBe(false);
      expect(quizData.submissions[student2Id].score).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. 结课通票与全景学情报告 (Exit Ticket & Panoramic Report)
  // ────────────────────────────────────────────────────────────────────────────
  describe('结课通票与全景学情报告（Panoramic Report）综合统计', () => {
    it('学生提交通票 → 教师查询全景学情 → 准确关联班级花名册并多维聚合', async () => {
      // 学生 1 提交高分通票
      const et1Res = await post(`/api/classroom/sessions/${lessonId}/exit-ticket`, student1Token, {
        rating: 5,
        puzzledConcept: '光电效应截止电压',
        feedback: '演示非常清晰，已掌握方程推导',
      });
      expect(et1Res.status).toBe(200);

      // 学生 2 提交有疑问通票
      const et2Res = await post(`/api/classroom/sessions/${lessonId}/exit-ticket`, student2Token, {
        rating: 3,
        puzzledConcept: '康普顿散射公式',
        feedback: '散射角变化对波长差的影响还需再讲一次',
      });
      expect(et2Res.status).toBe(200);

      // 学生 3 本节课未提交结课通票（模拟缺席或漏交）

      // 教师获取全景学情报告
      const reportRes = await get(
        `/api/classroom/sessions/${lessonId}/panoramic-report?classId=${classId}`,
        teacherToken,
      );
      expect(reportRes.status).toBe(200);
      const report: any = await reportRes.json();
      expect(report.success).toBe(true);

      // 验证花名册联查覆盖所有 3 位班级学生
      expect(report.students).toHaveLength(3);

      const s1 = report.students.find((s: any) => s.studentId === student1Id);
      const s2 = report.students.find((s: any) => s.studentId === student2Id);
      const s3 = report.students.find((s: any) => s.studentId === student3Id);

      expect(s1).toBeDefined();
      expect(s1.studentName).toBe('张小凡');
      expect(s1.attendance).toBe(true);
      expect(s1.exitRating).toBe(5);
      expect(s1.puzzledConcept).toBe('光电效应截止电压');
      expect(s1.quizScore).toBe(100);
      expect(s1.accuracy).toBe(100);

      expect(s2).toBeDefined();
      expect(s2.studentName).toBe('李陆雪');
      expect(s2.attendance).toBe(true);
      expect(s2.exitRating).toBe(3);
      expect(s2.puzzledConcept).toBe('康普顿散射公式');
      expect(s2.quizScore).toBe(0);
      expect(s2.accuracy).toBe(0);

      // 学生 3 未提交通票与测验，安全兜底 null
      expect(s3).toBeDefined();
      expect(s3.studentName).toBe('林惊羽');
      expect(s3.attendance).toBe(false);
      expect(s3.exitRating).toBeNull();
      expect(s3.puzzledConcept).toBeNull();
      expect(s3.quizScore).toBeNull();

      // 验证大班级指标汇总
      expect(report.metrics.exitTicketsCount).toBe(2);
      expect(report.metrics.exitTicketsAvgRating).toBe(4); // (5+3)/2 = 4.0
      expect(report.metrics.quizCount).toBe(2);
      expect(report.metrics.quizAccuracy).toBe(50); // 1 正确 1 错误 = 50%
      expect(report.metrics.topPuzzledConcepts).toContain('光电效应截止电压');
      expect(report.metrics.topPuzzledConcepts).toContain('康普顿散射公式');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 4. 随堂作业提交与教师批改 (Assignment Submission & Teacher Grade)
  // ────────────────────────────────────────────────────────────────────────────
  describe('随堂作业（Assignment）提交与教师批改记录', () => {
    it('学生提交作业内容，越权提交他人被拒绝', async () => {
      // 学生 2 试图冒充学生 1 提交作业应被 403 拒绝
      const fakeRes = await post(`/api/assignments/${assignmentId}/submissions`, student2Token, {
        studentId: student1Id,
        content: '恶意冒充他人提交',
      });
      expect(fakeRes.status).toBe(403);

      // 学生 1 提交自己的作业
      const sub1Res = await post(`/api/assignments/${assignmentId}/submissions`, student1Token, {
        studentId: student1Id,
        content: JSON.stringify({ ans: 'Ek = h*nu - W0', steps: ['计算截止频率', '带入逸出功'] }),
      });
      expect(sub1Res.status).toBe(200);
      expect((await sub1Res.json()).success).toBe(true);

      // 学生 2 提交自己的作业
      const sub2Res = await post(`/api/assignments/${assignmentId}/submissions`, student2Token, {
        studentId: student2Id,
        content: JSON.stringify({ ans: 'Ek = 1/2 m v^2' }),
      });
      expect(sub2Res.status).toBe(200);
    });

    it('教师端拉取全部提交，批改并记录成绩与评语', async () => {
      // 教师端获取作业提交列表
      const listRes = await get(`/api/assignments/${assignmentId}/submissions`, teacherToken);
      expect(listRes.status).toBe(200);
      const list: any[] = await listRes.json();
      expect(list.length).toBeGreaterThanOrEqual(2);

      const sub1 = list.find((item) => item.student_id === student1Id);
      expect(sub1).toBeDefined();
      expect(sub1.student_name).toBe('张小凡');
      expect(sub1.status).toBe('submitted');

      // 教师对学生 1 批改（直接录入最终分与评价）
      const gradeNow = Date.now();
      db.prepare(
        `
        UPDATE assignment_submissions
        SET score = ?, feedback = ?, status = 'graded', graded_at = ?
        WHERE assignment_id = ? AND student_id = ?
      `,
      ).run(95, '推导完整，步骤逻辑严密！', gradeNow, assignmentId, student1Id);

      // 再次查询验证成绩与评语已持久化
      const row = db
        .prepare(
          'SELECT score, feedback, status, graded_at FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?',
        )
        .get(assignmentId, student1Id) as any;
      expect(row.score).toBe(95);
      expect(row.feedback).toBe('推导完整，步骤逻辑严密！');
      expect(row.status).toBe('graded');
      expect(row.graded_at).toBe(gradeNow);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 5. 插件扩展与内核事件总线集成 (Plugin Event Bus Integrations)
  // ────────────────────────────────────────────────────────────────────────────
  describe('插件可扩展接口与内核事件总线（EventBus）集成', () => {
    it('作业批改发布 assignment.graded 内核事件 → RealtimeBridge 投递 assignment-graded-toast 实时通知', async () => {
      const toastEvents: any[] = [];
      socketClient.on('assignment-graded-toast', (data) => {
        toastEvents.push(data);
      });

      // 模拟插件/评分服务发布 assignment.graded 事件
      const { v7: uuidv7 } = await import('uuid');
      await kernelContainer.eventBus.publish({
        id: uuidv7(),
        type: 'assignment.graded',
        source: 'plugin.assignment_eval',
        timestamp: Date.now(),
        payload: {
          assignmentId,
          studentId: student1Id,
          score: 95,
          feedback: '推导完整，步骤逻辑严密！',
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(toastEvents.length).toBeGreaterThanOrEqual(1);
      const toast = toastEvents[0];
      expect(toast.assignmentId).toBe(assignmentId);
      expect(toast.studentId).toBe(student1Id);
      expect(toast.score).toBe(95);
    });
  });
});
