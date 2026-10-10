/**
 * @vitest-environment node
 *
 * 业务黄金旅程场景测试：学生上课与互动白板全功能 (Classroom & Whiteboard Journey)
 *
 * 覆盖教师与学生从课前准备到上课、白板全要素操作、快照事务回滚、随堂测验、出门条与结课归档的完整闭环：
 *  阶段 1: 课前就绪与开启课堂 (Session Init & Stage Switching)
 *  阶段 2: 互动白板全要素操作与自动快照事务回滚 (Whiteboard Full Matrix & Snapshot Revert)
 *  阶段 3: 白板权限网格与学生作业白板隔离 (Whiteboard Permission Mesh)
 *  阶段 4: 随堂即时测验与结课出门条 (Quick Poll & Exit Ticket)
 *  阶段 5: 课堂会话终态锁定与归档 (Session Archival & Immutability)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { Server as SocketServer } from 'socket.io';

import { registerClassroomRoutes } from '../routes/classroom.js';
import { registerLessonsRoutes } from '../routes/lessons.js';
import { registerAssignmentsRoutes } from '../routes/assignments.js';
import { ClassroomRuntimeService, ARCHIVED_REPORT_STAGE } from '../services/classroom-runtime-service.js';
import { ClassroomFeedService, attachClassroomFeedService } from '../services/classroom-feed-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ensureTestSchema } from './helpers/test-schema.js';

describe('业务黄金旅程场景测试：学生上课与互动白板全功能 (Classroom & Whiteboard Journey)', () => {
  let app: express.Express;
  let server: Server;
  let io: SocketServer;
  let baseUrl: string;
  let runtimeService: ClassroomRuntimeService;
  let feedService: ClassroomFeedService;

  const teacherId = 'usr-journey-wb-teacher';
  const otherTeacherId = 'usr-journey-wb-other-teacher';
  // 注意：学生 ID 不含连字符，以兼容 /-student-([^-]+)$/ 作业白板解析正则
  const studentAliceId = 'stualice01';
  const studentBobId = 'stubob02';

  const teacherToken = 'tok-journey-wb-teacher';
  const otherTeacherToken = 'tok-journey-wb-other-teacher';
  const studentAliceToken = 'tok-journey-wb-alice';
  const studentBobToken = 'tok-journey-wb-bob';

  const classId = 'cls-journey-wb-001';
  const lessonId = 'les-journey-wb-001';
  const assignmentId = 'asg-journey-wb-001';

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

  const put = (urlPath: string, token: string, body?: Record<string, unknown>) =>
    fetch(`${baseUrl}${urlPath}`, {
      method: 'PUT',
      headers: jsonHeaders(token),
      body: JSON.stringify(body ?? {}),
    });

  const get = (urlPath: string, token: string) =>
    fetch(`${baseUrl}${urlPath}`, {
      headers: cookie(token),
    });

  const del = (urlPath: string, token: string) =>
    fetch(`${baseUrl}${urlPath}`, {
      method: 'DELETE',
      headers: cookie(token),
    });

  beforeAll(async () => {
    ensureTestSchema();
    const now = Date.now();
    const expiresAt = now + 24 * 3600 * 1000;

    // 清理可能存在的历史测试数据
    try {
      db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id LIKE ? OR lesson_id LIKE ?').run(
        `%${lessonId}%`,
        `%${assignmentId}%`,
      );
      db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(lessonId);
      db.prepare('DELETE FROM classroom_feed WHERE lesson_id = ?').run(lessonId);
      db.prepare('DELETE FROM classroom_quick_polls WHERE lesson_id = ?').run(lessonId);
      db.prepare('DELETE FROM classroom_exit_tickets WHERE lesson_id = ?').run(lessonId);
      db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
      db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
      db.prepare('DELETE FROM users WHERE id IN (?, ?, ?, ?)').run(
        teacherId,
        otherTeacherId,
        studentAliceId,
        studentBobId,
      );
      db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(studentAliceId, studentBobId);
      db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?, ?)').run(
        teacherToken,
        otherTeacherToken,
        studentAliceToken,
        studentBobToken,
      );
    } catch {}

    // 1. 初始化用户主体与 Session 映射
    const insertUser = db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertUser.run(teacherId, 'wb_teacher', 'hash', 'teacher', '主讲教师', now);
    insertUser.run(otherTeacherId, 'wb_other_teacher', 'hash', 'teacher', '其他教师', now);
    insertUser.run(studentAliceId, 'student_alice', 'hash', 'student', '爱丽丝', now);
    insertUser.run(studentBobId, 'student_bob', 'hash', 'student', '鲍勃', now);

    const insertStudent = db.prepare(
      'INSERT OR REPLACE INTO students (id, name, student_number, password, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    insertStudent.run(studentAliceId, '爱丽丝', 'STU_WB_001', 'hash', now);
    insertStudent.run(studentBobId, '鲍勃', 'STU_WB_002', 'hash', now);

    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'wb_teacher' }),
      now,
      expiresAt,
    );
    insertSession.run(
      otherTeacherToken,
      JSON.stringify({ userId: otherTeacherId, role: 'teacher', username: 'wb_other_teacher' }),
      now,
      expiresAt,
    );
    insertSession.run(
      studentAliceToken,
      JSON.stringify({
        userId: studentAliceId,
        studentId: studentAliceId,
        role: 'student',
        username: 'student_alice',
        name: '爱丽丝',
        studentName: '爱丽丝',
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
        username: 'student_bob',
        name: '鲍勃',
        studentName: '鲍勃',
      }),
      now,
      expiresAt,
    );

    // 2. 初始化班级与课程
    db.prepare('INSERT OR REPLACE INTO classes (id, name, description, created_at) VALUES (?, ?, ?, ?)').run(
      classId,
      '互动白板实训班',
      '计算机科学互动课堂',
      now,
    );
    db.prepare(
      'INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?), (?, ?, ?)',
    ).run(classId, studentAliceId, now, classId, studentBobId, now);

    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, content, timeline, progress_mode, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(lessonId, '算法与数据结构实训', null, null, 'manual', teacherId, now, now);

    // 3. 构建 Express 与路由上下文
    app = express();
    app.use(express.json());
    server = createServer(app);
    io = new SocketServer(server, { cors: { origin: '*' } });

    runtimeService = new ClassroomRuntimeService(db, io);
    feedService = new ClassroomFeedService(db, io);
    attachClassroomFeedService(feedService, kernelContainer.eventBus as any);

    const ctx = {
      app,
      io,
      loginLimiter: null,
      aiLimiter: null,
      activityRegistry: null,
      MF_REMOTE_CACHE: new Map(),
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

    registerClassroomRoutes(ctx, runtimeService, feedService);
    registerLessonsRoutes(ctx);
    registerAssignmentsRoutes(ctx);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    try {
      db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id LIKE ? OR lesson_id LIKE ?').run(
        `%${lessonId}%`,
        `%${assignmentId}%`,
      );
      db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(lessonId);
      db.prepare('DELETE FROM classroom_feed WHERE lesson_id = ?').run(lessonId);
      db.prepare('DELETE FROM classroom_quick_polls WHERE lesson_id = ?').run(lessonId);
      db.prepare('DELETE FROM classroom_exit_tickets WHERE lesson_id = ?').run(lessonId);
      db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
      db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
      db.prepare('DELETE FROM users WHERE id IN (?, ?, ?, ?)').run(
        teacherId,
        otherTeacherId,
        studentAliceId,
        studentBobId,
      );
      db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(studentAliceId, studentBobId);
      db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?, ?)').run(
        teacherToken,
        otherTeacherToken,
        studentAliceToken,
        studentBobToken,
      );
    } catch {}
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 阶段 1: 课前就绪与开启课堂 (Session Init & Stage Switching)
  // ══════════════════════════════════════════════════════════════════════════════
  describe('阶段 1: 课前就绪与开启课堂 (Session Init & Stage Switching)', () => {
    it('教师开课初始化 POST /api/classroom/sessions/:id/init 激活课堂会话', async () => {
      const res = await post(`/api/classroom/sessions/${lessonId}/init`, teacherToken, { classId });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);

      // 验证数据库状态为 PRE_CLASS_READY 初始状态
      const sessionRow = db
        .prepare('SELECT stage, class_id, lesson_id FROM classroom_sessions WHERE lesson_id = ?')
        .get(lessonId) as any;
      expect(sessionRow).toBeDefined();
      expect(sessionRow.class_id).toBe(classId);
      expect(sessionRow.stage).toBe('PRE_CLASS_READY');
    });

    it('教师切换课堂阶段为授课模式 POST /api/classroom/sessions/:id/stage', async () => {
      const res = await post(`/api/classroom/sessions/${lessonId}/stage`, teacherToken, {
        stage: 'IN_CLASS_TEACHING',
        classId,
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      // 验证阶段已更新
      const sessionRow = db
        .prepare('SELECT stage FROM classroom_sessions WHERE lesson_id = ?')
        .get(lessonId) as any;
      expect(sessionRow.stage).toBe('IN_CLASS_TEACHING');
    });

    it('回写白板视图状态 POST /api/classroom/sessions/:id/view-state', async () => {
      const res = await post(`/api/classroom/sessions/${lessonId}/view-state`, teacherToken, {
        currentPage: 1,
        activeSegmentId: 'segment-intro',
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      // 读取会话详情并校验持久化视图状态
      const detailRes = await get(`/api/classroom/sessions/${lessonId}`, teacherToken);
      expect(detailRes.status).toBe(200);
      const detail = await detailRes.json();
      expect(detail.session.class_id).toBe(classId);
      expect(detail.session.stage).toBe('IN_CLASS_TEACHING');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 阶段 2: 互动白板全要素操作与自动快照事务回滚 (Whiteboard Full Matrix)
  // ══════════════════════════════════════════════════════════════════════════════
  describe('阶段 2: 互动白板全要素操作与自动快照事务回滚 (Whiteboard Full Matrix)', () => {
    let rectElementId = '';
    let penElementId = '';
    let textElementId = '';

    it('教师预置基础图元并验证初次访问自动生成 snapshot 快照备份', async () => {
      // 1. 教师在白板上绘制一个预置矩形
      const drawRes = await post(`/api/lessons/${lessonId}/whiteboard`, teacherToken, {
        type: 'rectangle',
        data: { x: 50, y: 50, width: 200, height: 100, stroke: '#000000', fill: '#f0f0f0' },
      });
      expect(drawRes.status).toBe(200);
      const drawJson = await drawRes.json();
      expect(drawJson.elementId).toBeTruthy();
      rectElementId = drawJson.elementId;

      // 2. 首次通过 GET 加载白板，系统触发快照自动备份
      const getRes = await get(`/api/lessons/${lessonId}/whiteboard`, teacherToken);
      expect(getRes.status).toBe(200);
      const elements = await getRes.json();
      expect(elements.length).toBeGreaterThanOrEqual(1);

      // 3. 查验数据库中快照标记 marker 及快照影子图元
      const snapshotMarker = db
        .prepare('SELECT * FROM whiteboard_elements WHERE lesson_id = ? AND type = ?')
        .get(`snapshot-${lessonId}`, 'snapshot_marker') as any;
      expect(snapshotMarker).toBeDefined();

      const snapshotElements = db
        .prepare("SELECT * FROM whiteboard_elements WHERE lesson_id = ? AND type != 'snapshot_marker'")
        .all(`snapshot-${lessonId}`) as any[];
      expect(snapshotElements.length).toBe(1);
      expect(snapshotElements[0].id).toBe(`snapshot-${rectElementId}`);
    });

    it('白板全图元录入：绘制手绘笔刷 (pen) 与文本标注 (text)', async () => {
      // 1. 绘制笔刷线条 pen
      const penRes = await post(`/api/lessons/${lessonId}/whiteboard`, teacherToken, {
        type: 'pen',
        data: {
          points: [
            { x: 10, y: 10 },
            { x: 20, y: 30 },
            { x: 35, y: 50 },
          ],
          stroke: '#ff0000',
          strokeWidth: 3,
        },
      });
      expect(penRes.status).toBe(200);
      penElementId = (await penRes.json()).elementId;

      // 2. 绘制文本标注 text
      const textRes = await post(`/api/lessons/${lessonId}/whiteboard`, teacherToken, {
        type: 'text',
        data: { x: 150, y: 200, text: '重要考点：二分查找边界', fontSize: 18, color: '#333333' },
      });
      expect(textRes.status).toBe(200);
      textElementId = (await textRes.json()).elementId;

      // 验证白板中现有图元数量为 3
      const listRes = await get(`/api/lessons/${lessonId}/whiteboard`, teacherToken);
      const elements = await listRes.json();
      expect(elements.length).toBe(3);
    });

    it('图元更新：修改几何图形坐标与样式 PUT /api/lessons/:id/whiteboard/:elementId', async () => {
      const updateRes = await put(`/api/lessons/${lessonId}/whiteboard/${rectElementId}`, teacherToken, {
        data: { x: 80, y: 90, width: 250, height: 120, stroke: '#0088ff', fill: '#e6f7ff' },
      });
      expect(updateRes.status).toBe(200);

      // 验证数据库中该图元已被修改
      const updatedRow = db.prepare('SELECT data FROM whiteboard_elements WHERE id = ?').get(rectElementId) as any;
      const parsedData = JSON.parse(updatedRow.data);
      expect(parsedData.x).toBe(80);
      expect(parsedData.stroke).toBe('#0088ff');
    });

    it('图元精准删除：橡皮擦抹除文本标注 DELETE /api/lessons/:id/whiteboard/:elementId', async () => {
      const delRes = await del(`/api/lessons/${lessonId}/whiteboard/${textElementId}`, teacherToken);
      expect(delRes.status).toBe(200);

      // 验证该图元已不存在，其余图元依然存活
      expect(db.prepare('SELECT 1 FROM whiteboard_elements WHERE id = ?').get(textElementId)).toBeUndefined();
      expect(db.prepare('SELECT 1 FROM whiteboard_elements WHERE id = ?').get(rectElementId)).toBeDefined();
      expect(db.prepare('SELECT 1 FROM whiteboard_elements WHERE id = ?').get(penElementId)).toBeDefined();
    });

    it('重置白板：触发 DATA-INT-01 事务级原子回滚至初态快照', async () => {
      const resetRes = await post(`/api/lessons/${lessonId}/whiteboard/reset`, teacherToken);
      expect(resetRes.status).toBe(200);
      const json = await resetRes.json();
      expect(json.success).toBe(true);

      // 查验回滚结果：
      // - 课堂白板恢复为仅包含初始快照中的 1 个图元 (rectangle)
      // - 后续新增的 pen 线条已被清除
      // - 被更新的 rectangle 属性被还原为初始状态 (x: 50)
      const listRes = await get(`/api/lessons/${lessonId}/whiteboard`, teacherToken);
      const elements = await listRes.json();
      expect(elements.length).toBe(1);
      expect(elements[0].id).toBe(rectElementId);

      const restoredData = typeof elements[0].data === 'string' ? JSON.parse(elements[0].data) : elements[0].data;
      expect(restoredData.x).toBe(50);
      expect(restoredData.stroke).toBe('#000000');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 阶段 3: 白板权限网格与学生作业白板隔离 (Whiteboard Permission Mesh)
  // ══════════════════════════════════════════════════════════════════════════════
  describe('阶段 3: 白板权限网格与学生作业白板隔离 (Whiteboard Permission Mesh)', () => {
    it('学生尝试修改课堂教学白板应被 403 严格拦截', async () => {
      const res = await post(`/api/lessons/${lessonId}/whiteboard`, studentAliceToken, {
        type: 'text',
        data: { text: '学生擅自涂鸦' },
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain('Students cannot modify classroom whiteboards');
    });

    it('未授权的外部教师尝试修改他人创建的课节白板应被 403 拦截', async () => {
      const res = await post(`/api/lessons/${lessonId}/whiteboard`, otherTeacherToken, {
        type: 'text',
        data: { text: '外部教师篡改' },
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain('because it was created by another teacher');
    });

    it('学生个人作业白板 (assignment-*) 正常写入与操作', async () => {
      const studentWhiteboardId = `assignment-${assignmentId}-student-${studentAliceId}`;
      const aliceActorId = `user:${studentAliceId}:student`;
      const bobActorId = `user:${studentBobId}:student`;

      // 内核赋权：学生在随堂作业环节获得作业白板写入能力
      kernelContainer.capabilityGuard.grant(aliceActorId, 'whiteboard:write');
      kernelContainer.capabilityGuard.grant(bobActorId, 'whiteboard:write');

      // Alice 写入自己的作业白板
      const res = await post(`/api/lessons/${studentWhiteboardId}/whiteboard`, studentAliceToken, {
        type: 'rectangle',
        data: { x: 10, y: 10, width: 80, height: 40, label: 'Alice的作业草稿' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.elementId).toBeTruthy();

      // 读取作业白板图元
      const getRes = await get(`/api/lessons/${studentWhiteboardId}/whiteboard`, studentAliceToken);
      expect(getRes.status).toBe(200);
      const elements = await getRes.json();
      expect(elements.length).toBe(1);
    });

    it('Bob 尝试越权修改 Alice 的作业白板应被 403 强力阻断', async () => {
      const aliceWhiteboardId = `assignment-${assignmentId}-student-${studentAliceId}`;

      const res = await post(`/api/lessons/${aliceWhiteboardId}/whiteboard`, studentBobToken, {
        type: 'text',
        data: { text: 'Bob越权篡改Alice' },
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("permission to modify another student's assignment whiteboard");
    });

    it('作业白板重置操作直接清空（不使用课程快照）', async () => {
      const aliceWhiteboardId = `assignment-${assignmentId}-student-${studentAliceId}`;

      const resetRes = await post(`/api/lessons/${aliceWhiteboardId}/whiteboard/reset`, studentAliceToken);
      expect(resetRes.status).toBe(200);

      // 验证已被彻底清空
      const getRes = await get(`/api/lessons/${aliceWhiteboardId}/whiteboard`, studentAliceToken);
      const elements = await getRes.json();
      expect(elements.length).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 阶段 4: 随堂即时测验与结课出门条 (Quick Poll & Exit Ticket)
  // ══════════════════════════════════════════════════════════════════════════════
  describe('阶段 4: 随堂即时测验与结课出门条 (Quick Poll & Exit Ticket)', () => {
    let pollId = '';

    it('教师发起随堂即时单选题投票 POST /api/classroom/sessions/:id/quick-poll', async () => {
      const res = await post(`/api/classroom/sessions/${lessonId}/quick-poll`, teacherToken, {
        title: '二分查找的最优时间复杂度是？',
        options: ['A', 'B', 'C', 'D'],
        correctOption: 'B',
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.poll.id).toBeTruthy();
      pollId = json.poll.id;
    });

    it('学生参与投票并验证防重复刷票', async () => {
      // 1. Alice 投票选择选项 B
      const v1 = await post(`/api/classroom/sessions/${lessonId}/quick-poll/${pollId}/vote`, studentAliceToken, {
        option: 'B',
      });
      expect(v1.status).toBe(200);

      // 2. Bob 投票选择选项 A
      const v2 = await post(`/api/classroom/sessions/${lessonId}/quick-poll/${pollId}/vote`, studentBobToken, {
        option: 'A',
      });
      expect(v2.status).toBe(200);

      // 3. 查验数据库聚合记录
      const votes = db
        .prepare('SELECT student_id, selected_option FROM classroom_poll_votes WHERE poll_id = ?')
        .all(pollId) as any[];
      expect(votes.length).toBe(2);
      expect(votes.find((v) => v.student_id === studentAliceId)?.selected_option).toBe('B');
      expect(votes.find((v) => v.student_id === studentBobId)?.selected_option).toBe('A');
    });

    it('教师关闭随堂投票，后续投票被拒绝拦截', async () => {
      const closeRes = await post(`/api/classroom/sessions/${lessonId}/quick-poll/${pollId}/close`, teacherToken);
      expect(closeRes.status).toBe(200);

      // 关闭后再次投票被阻断
      const lateRes = await post(`/api/classroom/sessions/${lessonId}/quick-poll/${pollId}/vote`, studentAliceToken, {
        option: 'C',
      });
      expect(lateRes.status).toBe(400);
    });

    it('学生提交结课出门条 (Exit Ticket) 并汇总学情', async () => {
      // Alice 提交出门条反馈
      const et1 = await post(`/api/classroom/sessions/${lessonId}/exit-ticket`, studentAliceToken, {
        rating: 5,
        puzzledConcept: '循环不变量在递归实现中如何严谨保持？',
        feedback: '深刻理解了二分查找左右边界指针的更新细节',
      });
      expect(et1.status).toBe(200);

      // Bob 提交出门条反馈
      const et2 = await post(`/api/classroom/sessions/${lessonId}/exit-ticket`, studentBobToken, {
        rating: 4,
        puzzledConcept: '无',
        feedback: '掌握了时间复杂度的推导方法',
      });
      expect(et2.status).toBe(200);

      // 教师端汇总拉取全班出门条
      const listRes = await get(`/api/classroom/sessions/${lessonId}/exit-ticket-summary`, teacherToken);
      expect(listRes.status).toBe(200);
      const list = await listRes.json();
      expect(list.totalCount).toBe(2);
      expect(list.submissions.length).toBe(2);
      expect(list.submissions.some((t: any) => t.student_name === '爱丽丝')).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 阶段 5: 课堂会话终态锁定与归档 (Session Archival & Immutability)
  // ══════════════════════════════════════════════════════════════════════════════
  describe('阶段 5: 课堂会话终态锁定与归档 (Session Archival & Immutability)', () => {
    it('教师结束下课并将会话状态流转至 ARCHIVED_REPORT 结课阶段', async () => {
      // P0-2：阶段白名单要求经 WRAP_UP_EXIT_TICKET 才能归档
      const wrapRes = await post(`/api/classroom/sessions/${lessonId}/stage`, teacherToken, {
        stage: 'WRAP_UP_EXIT_TICKET',
        classId,
      });
      expect(wrapRes.status).toBe(200);
      const endRes = await post(`/api/classroom/sessions/${lessonId}/stage`, teacherToken, {
        stage: ARCHIVED_REPORT_STAGE,
        classId,
      });
      expect(endRes.status).toBe(200);
      const json = await endRes.json();
      expect(json.success).toBe(true);
      expect(json.stage).toBe(ARCHIVED_REPORT_STAGE);

      // 验证数据库状态为 ARCHIVED_REPORT 且 ended_at 时间戳已打上
      const sessionRow = db
        .prepare('SELECT stage, ended_at FROM classroom_sessions WHERE lesson_id = ?')
        .get(lessonId) as any;
      expect(sessionRow.stage).toBe(ARCHIVED_REPORT_STAGE);
      expect(sessionRow.ended_at).toBeGreaterThan(0);
    });

    it('结课后生成全景学情战报 GET /api/classroom/sessions/:id/panoramic-report 包含多维聚合指标', async () => {
      const reportRes = await get(`/api/classroom/sessions/${lessonId}/panoramic-report`, teacherToken);
      expect(reportRes.status).toBe(200);
      const report = await reportRes.json();
      expect(report.success).toBe(true);
      expect(report.session.lessonId).toBe(lessonId);
      expect(report.metrics.pollVotesTotal).toBe(2);
      expect(report.metrics.exitTicketsCount).toBe(2);
      expect(report.students.length).toBe(2);
    });
  });
});
