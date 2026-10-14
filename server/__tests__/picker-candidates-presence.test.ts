import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerRosterRoutes } from '../routes/roster.js';
import { setupPresence } from '../presence.js';
import { RosterService } from '../services/roster-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

/**
 * 随机点名候选接口 × Socket.IO 在场状态。
 *
 * 全班花名册仍是频次画像的来源，但带 lessonId 的响应只留下
 * 「在线且已 enter-lesson 到这一节」的学生。leave-lesson / 断线后下一次请求不再包含他们。
 */
describe('picker-candidates follows live class presence', () => {
  let server: Server;
  let baseUrl: string;
  let service: RosterService;
  const db = kernelContainer.db;

  const adminId = 'usr-picker-presence-admin';
  const adminToken = 'tok-picker-presence-admin';
  const lessonId = 'lesson-picker-presence';
  const otherLessonId = 'lesson-picker-presence-other';

  let classId = '';
  let presentId = '';
  let onlineOnlyId = '';
  let otherLessonIdStudent = '';

  const sockets: Array<{ trigger: (event: string, data?: unknown) => void }> = [];

  let openSocket: (socketId: string) => { trigger: (event: string, data?: unknown) => void } = () => {
    throw new Error('presence not ready');
  };

  beforeAll(async () => {
    const now = Date.now();
    service = new RosterService(db);

    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(adminId, 'picker_presence_admin', 'hash', 'administrator', '点名在场管理员', now);
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      adminToken,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'picker_presence_admin' }),
      now,
      now + 60 * 60 * 1000,
    );

    for (const num of ['PP-001', 'PP-002', 'PP-003']) {
      const leftover = db.prepare('SELECT id FROM students WHERE student_number = ?').get(num) as
        { id: string } | undefined;
      if (leftover) service.deleteStudentCascade(leftover.id);
    }

    classId = service.createClass('点名在场测试班', '只抽在场学生', undefined, adminId);
    const present = service.createStudent({ name: '在场学生', student_number: 'PP-001' });
    const onlineOnly = service.createStudent({ name: '仅在线', student_number: 'PP-002' });
    const other = service.createStudent({ name: '在别的课', student_number: 'PP-003' });
    presentId = present.id;
    onlineOnlyId = onlineOnly.id;
    otherLessonIdStudent = other.id;
    service.enrollStudent(classId, presentId);
    service.enrollStudent(classId, onlineOnlyId);
    service.enrollStudent(classId, otherLessonIdStudent);

    service.evaluateRollcall({
      studentId: presentId,
      classId,
      lessonId,
      rating: 'good',
      score: 2,
      rewardCoins: 5,
    });
    service.evaluateRollcall({
      studentId: onlineOnlyId,
      classId,
      lessonId,
      rating: 'encourage',
      score: 1,
      rewardCoins: 2,
    });

    const connectionHandlers: Array<(socket: any) => void> = [];
    const io = {
      on: (event: string, cb: (socket: any) => void) => {
        if (event === 'connection') connectionHandlers.push(cb);
      },
      emit: () => {},
      to: () => ({ emit: () => {} }),
    };
    setupPresence({
      io: io as any,
      eventBus: { publish: async () => {}, subscribe: () => () => {} } as any,
    });

    openSocket = (socketId: string) => {
      const socketHandlers = new Map<string, (data?: any) => void>();
      const socket = {
        id: socketId,
        data: {},
        on: (event: string, cb: (data?: any) => void) => socketHandlers.set(event, cb),
        emit: () => {},
        to: () => ({ emit: () => {} }),
        join: () => {},
        leave: () => {},
      };
      for (const handler of connectionHandlers) handler(socket);
      const api = {
        trigger: (event: string, data?: unknown) => {
          const handler = socketHandlers.get(event);
          if (!handler) throw new Error(`no socket handler for ${event}`);
          handler(data);
        },
      };
      sockets.push(api);
      return api;
    };

    const app = express();
    app.use(express.json());
    registerRosterRoutes({
      app,
      io: { emit: () => {}, to: () => ({ emit: () => {} }) },
      loginLimiter: ((_req: any, _res: any, next: any) => next()) as any,
    } as any);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const socket of sockets) {
      try {
        socket.trigger('disconnect');
      } catch {
        /* socket may already be gone */
      }
    }
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      if (classId) service.deleteClassCascade(classId);
      for (const id of [presentId, onlineOnlyId, otherLessonIdStudent]) {
        if (id) service.deleteStudentCascade(id);
      }
      db.prepare('DELETE FROM client_sessions WHERE id = ?').run(adminToken);
      db.prepare('DELETE FROM users WHERE id = ?').run(adminId);
    } catch {
      /* cleanup is best-effort so a failed assertion still releases the port */
    }
  });

  async function candidates(withLesson: string | null) {
    const url = withLesson
      ? `${baseUrl}/api/classes/${classId}/picker-candidates?lessonId=${encodeURIComponent(withLesson)}`
      : `${baseUrl}/api/classes/${classId}/picker-candidates`;
    const res = await fetch(url, { headers: { Cookie: `edu_os_token=${adminToken}` } });
    expect(res.status).toBe(200);
    return (await res.json()) as Array<{ id: string; term_picked_count: number; total_reward_coins: number }>;
  }

  it('returns the whole roster without a lesson, and only students inside that lesson otherwise', async () => {
    const everyone = await candidates(null);
    expect(everyone.map((s) => s.id).sort()).toEqual([presentId, onlineOnlyId, otherLessonIdStudent].sort());

    expect(await candidates(lessonId)).toEqual([]);

    const inClass = openSocket('sock-present');
    inClass.trigger('register-student', { studentId: presentId, name: '在场学生' });
    inClass.trigger('enter-lesson', { studentId: presentId, lessonId });

    const onlineOnly = openSocket('sock-online');
    onlineOnly.trigger('register-student', { studentId: onlineOnlyId, name: '仅在线' });

    const elsewhere = openSocket('sock-other');
    elsewhere.trigger('register-student', { studentId: otherLessonIdStudent, name: '在别的课' });
    elsewhere.trigger('enter-lesson', { studentId: otherLessonIdStudent, lessonId: otherLessonId });

    const inLesson = await candidates(lessonId);
    expect(inLesson.map((s) => s.id)).toEqual([presentId]);
    expect(inLesson[0].term_picked_count).toBe(1);
    expect(inLesson[0].total_reward_coins).toBe(5);
    expect(await candidates(otherLessonId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: otherLessonIdStudent })]),
    );
    expect((await candidates(otherLessonId)).map((s) => s.id)).toEqual([otherLessonIdStudent]);

    inClass.trigger('leave-lesson', { studentId: presentId });
    expect(await candidates(lessonId)).toEqual([]);

    inClass.trigger('enter-lesson', { studentId: presentId, lessonId });
    expect((await candidates(lessonId)).map((s) => s.id)).toEqual([presentId]);

    inClass.trigger('disconnect');
    expect(await candidates(lessonId)).toEqual([]);
  });
});
