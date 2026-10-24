/**
 * @vitest-environment node
 *
 * PR-2 回归：带学生数据的平台事件必须只抵达目标房间
 * （课节 / 班级 / 本人用户房间 / 教师房间），不得再退化为全局广播。
 *
 * 这里用真实 Socket.IO 服务 + 真实 socket.io-client + 真实 EventBus，
 * 按生产拓扑手动把连接放进房间（生产环境由 presence 的 join-room /
 * register-student 完成，见 server/__tests__/presence.test.ts）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'node:crypto';
import { Server as SocketServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

import { setupRealtimeBridge } from '../realtime-bridge.js';
import { PRESENCE_STAFF_ROOM } from '../presence.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ensureTestSchema } from './helpers/test-schema.js';

const LESSON_A = 'lesson-scope-a';
const LESSON_B = 'lesson-scope-b';
const CLASS_A = 'class-scope-a';
const CLASS_B = 'class-scope-b';
const STUDENT_A = 'stu-scope-a';
const STUDENT_B = 'stu-scope-b';
const ATTEMPT_A = 'attempt-scope-a';

const WATCHED_EVENTS = [
  'assignment-graded-toast',
  'classroom:points_awarded',
  'whiteboard-quiz-answered',
  'whiteboard-quiz-answered-staff',
  'courseware-attempt-updated',
  'class-lock-status-changed',
  'student-progress-updated',
] as const;

interface Packet {
  event: string;
  payload: any;
}

interface Probe {
  socket: ClientSocket;
  packets: Packet[];
}

const eventsOf = (probe: Probe, event: string) => probe.packets.filter((p) => p.event === event);
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

describe('Socket 事件投递范围（学生数据不得全局广播）', () => {
  let app: express.Express;
  let server: Server;
  let io: SocketServer;
  let baseUrl: string;
  const sockets: ClientSocket[] = [];

  let studentA: Probe;
  let studentB: Probe;
  let classmateA: Probe;
  let staff: Probe;

  const db = kernelContainer.db as any;

  const watch = (socket: ClientSocket): Probe => {
    const packets: Packet[] = [];
    for (const event of WATCHED_EVENTS) {
      socket.on(event, (payload: unknown) => packets.push({ event, payload }));
    }
    return { socket, packets };
  };

  const connect = async (rooms: string[]): Promise<Probe> => {
    const socket = ioClient(baseUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', (err) => reject(err));
    });
    if (socket.id && rooms.length > 0) io.in(socket.id).socketsJoin(rooms);
    return watch(socket);
  };

  const reset = () => {
    for (const probe of [studentA, studentB, classmateA, staff]) probe.packets.length = 0;
  };

  const publish = async (type: string, payload: Record<string, unknown>) => {
    await kernelContainer.eventBus.publish({
      id: randomUUID(),
      type,
      source: 'test.socket-scope',
      timestamp: Date.now(),
      payload,
    });
    await settle();
  };

  beforeAll(async () => {
    ensureTestSchema();

    app = express();
    app.use(express.json());
    server = createServer(app);
    io = new SocketServer(server, { cors: { origin: '*' } });
    setupRealtimeBridge({
      eventBus: kernelContainer.eventBus,
      io,
      db: kernelContainer.db as any,
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // 课节 → 班级解析依赖进行中的课堂会话（loadLessonClassId）。
    const now = Date.now();
    for (const [lessonId, classId] of [
      [LESSON_A, CLASS_A],
      [LESSON_B, CLASS_B],
    ]) {
      db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(lessonId);
      db.prepare(
        `INSERT INTO classroom_sessions (id, lesson_id, class_id, teacher_id, stage, created_at)
         VALUES (?, ?, ?, ?, 'IN_CLASS_TEACHING', ?)`,
      ).run(`cs-${lessonId}`, lessonId, classId, 'teacher-scope', now);
    }

    db.prepare('DELETE FROM courseware_attempt WHERE id = ?').run(ATTEMPT_A);
    db.prepare(
      'INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, status) VALUES (?, ?, ?, ?, ?)',
    ).run(ATTEMPT_A, 'cw-scope', STUDENT_A, now, 'submitted');

    // 学生 A：课节 A + 班级 A + 本人房间
    studentA = await connect([LESSON_A, `class-${CLASS_A}`, `user-${STUDENT_A}`]);
    // 学生 B：另一个班/另一节课，用于证明事件不会跨班泄露
    studentB = await connect([LESSON_B, `class-${CLASS_B}`, `user-${STUDENT_B}`]);
    // 同班同学：已离开课节视图，只靠班级房间接收课堂状态（兜底路径）
    classmateA = await connect([`class-${CLASS_A}`]);
    // 教师端：只加入教师房间
    staff = await connect([PRESENCE_STAFF_ROOM]);
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    io?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    db.prepare('DELETE FROM classroom_sessions WHERE lesson_id IN (?, ?)').run(LESSON_A, LESSON_B);
    db.prepare('DELETE FROM courseware_attempt WHERE id = ?').run(ATTEMPT_A);
  });

  it('assignment.graded：只投给被评分学生本人，同班与教师都收不到', async () => {
    reset();
    await publish('assignment.graded', {
      assignmentId: 'asg-scope',
      studentId: STUDENT_A,
      score: 95,
      feedback: 'ok',
    });

    expect(eventsOf(studentA, 'assignment-graded-toast')).toHaveLength(1);
    expect(eventsOf(studentB, 'assignment-graded-toast')).toHaveLength(0);
    expect(eventsOf(classmateA, 'assignment-graded-toast')).toHaveLength(0);
    expect(eventsOf(staff, 'assignment-graded-toast')).toHaveLength(0);
  });

  it('points.awarded：投获得者本人 + 教师房间，不投同班其他学生', async () => {
    reset();
    await publish('points.awarded', { studentId: STUDENT_A, points: 10, reason: '回答正确' });

    expect(eventsOf(studentA, 'classroom:points_awarded')).toHaveLength(1);
    expect(eventsOf(staff, 'classroom:points_awarded')).toHaveLength(1);
    expect(eventsOf(studentB, 'classroom:points_awarded')).toHaveLength(0);
    expect(eventsOf(classmateA, 'classroom:points_awarded')).toHaveLength(0);
  });

  it('whiteboard.quiz_answered：课节 + 班级房间可达，跨班不可达，教师房间不重复', async () => {
    reset();
    await publish('whiteboard.quiz_answered', {
      lessonId: LESSON_A,
      elementId: 'el-scope',
      studentId: STUDENT_A,
      studentName: '甲同学',
      answer: 'B',
      isCorrect: true,
      score: 100,
      correctAnswer: 'B',
      correctIndex: 1,
      question: '测试题面',
    });

    expect(eventsOf(studentA, 'whiteboard-quiz-answered')).toHaveLength(1);
    // 离开课节视图的同班学生靠班级房间兜底，仍能看到答题进度
    expect(eventsOf(classmateA, 'whiteboard-quiz-answered')).toHaveLength(1);
    expect(eventsOf(studentB, 'whiteboard-quiz-answered')).toHaveLength(0);

    // Issue #238：学生房间收到的 payload 必须已脱敏（无正确答案/作答内容）
    const classmatePacket = eventsOf(classmateA, 'whiteboard-quiz-answered')[0] as any;
    expect(classmatePacket.payload.correctAnswer).toBeUndefined();
    expect(classmatePacket.payload.correctIndex).toBeUndefined();
    expect(classmatePacket.payload.answer).toBeUndefined();
    expect(classmatePacket.payload.studentId).toBe(STUDENT_A);

    // 教师房间收到全量镜像事件（含正确答案），且主事件不重复投给 staff
    expect(eventsOf(staff, 'whiteboard-quiz-answered')).toHaveLength(0);
    const staffPacket = eventsOf(staff, 'whiteboard-quiz-answered-staff')[0] as any;
    expect(staffPacket.payload.answer).toBe('B');
    expect(staffPacket.payload.correctAnswer).toBe('B');
    expect(staffPacket.payload.correctIndex).toBe(1);
  });

  it('classroom.lock_changed：班级级指令覆盖全班，跨班与教师房间不收', async () => {
    reset();
    await publish('classroom.lock_changed', { lessonId: LESSON_A, classId: CLASS_A, locked: true });

    expect(eventsOf(studentA, 'class-lock-status-changed')).toHaveLength(1);
    expect(eventsOf(classmateA, 'class-lock-status-changed')).toHaveLength(1);
    expect(eventsOf(studentB, 'class-lock-status-changed')).toHaveLength(0);
    expect(eventsOf(staff, 'class-lock-status-changed')).toHaveLength(0);
  });

  it('courseware.attempt_updated：投 attempt 归属学生 + 教师，归属缺失时退回教师房间', async () => {
    reset();
    await publish('courseware.attempt_updated', { attemptId: ATTEMPT_A, status: 'submitted' });

    expect(eventsOf(studentA, 'courseware-attempt-updated')).toHaveLength(1);
    expect(eventsOf(staff, 'courseware-attempt-updated')).toHaveLength(1);
    expect(eventsOf(studentB, 'courseware-attempt-updated')).toHaveLength(0);
    expect(eventsOf(classmateA, 'courseware-attempt-updated')).toHaveLength(0);

    reset();
    await publish('courseware.attempt_updated', { attemptId: 'attempt-missing', status: 'submitted' });

    expect(eventsOf(staff, 'courseware-attempt-updated')).toHaveLength(1);
    expect(eventsOf(studentA, 'courseware-attempt-updated')).toHaveLength(0);
    expect(eventsOf(studentB, 'courseware-attempt-updated')).toHaveLength(0);
    expect(eventsOf(classmateA, 'courseware-attempt-updated')).toHaveLength(0);
  });

  it('student.progress_updated：课节 + 班级房间可达，跨班不可达', async () => {
    reset();
    await publish('student.progress_updated', { lessonId: LESSON_A, studentId: STUDENT_A, progress: 42 });

    expect(eventsOf(studentA, 'student-progress-updated')).toHaveLength(1);
    expect(eventsOf(classmateA, 'student-progress-updated')).toHaveLength(1);
    expect(eventsOf(studentB, 'student-progress-updated')).toHaveLength(0);
    expect(eventsOf(staff, 'student-progress-updated')).toHaveLength(0);
  });
});
