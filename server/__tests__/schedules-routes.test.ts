import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerSchedulesRoutes } from '../routes/schedules.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('Schedules routes integration & cascade mesh (D1d)', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const teacherId = 'usr-sched-teacher';
  const studentId = 'usr-sched-student';

  const teacherToken = 'tok-sched-teacher';
  const studentToken = 'tok-sched-student';

  const testClassId = 'class-sched-test-01';
  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

  beforeAll(async () => {
    const now = Date.now();
    const expiresAt = now + 60 * 60 * 1000;
    const db = kernelContainer.db;

    // 1. 预置用户与班级
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(teacherId, 'sched_teacher', 'hash', 'teacher', '排课教师', now);

    db.prepare(
      'INSERT OR REPLACE INTO students (id, name, student_number, password, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(studentId, '学生乙', 'STU_SCH_001', 'hash', now);

    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, created_at) VALUES (?, ?, ?, ?)',
    ).run(testClassId, '排课测试班', '排课专用', now);

    // 2. 预置 session
    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'sched_teacher' }),
      now,
      expiresAt,
    );
    insertSession.run(
      studentToken,
      JSON.stringify({ userId: studentId, role: 'student', username: 'sched_student' }),
      now,
      expiresAt,
    );

    // 3. 构建 Express 测试应用
    app = express();
    app.use(express.json());
    registerSchedulesRoutes({ app } as any);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    const db = kernelContainer.db;
    try {
      db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?)').run(teacherToken, studentToken);
      db.prepare('DELETE FROM users WHERE id = ?').run(teacherId);
      db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
      db.prepare('DELETE FROM schedules WHERE class_id = ?').run(testClassId);
      db.prepare('DELETE FROM classes WHERE id = ?').run(testClassId);
    } catch {}
  });

  describe('1. 权限拦截与列表查询', () => {
    it('未登录访问排课列表应返回 401', async () => {
      const res = await fetch(`${baseUrl}/api/schedules`);
      expect(res.status).toBe(401);
    });

    it('学生角色禁止执行排课操作（403 越权拦截）', async () => {
      const res = await fetch(`${baseUrl}/api/classes/${testClassId}/schedules`, {
        method: 'POST',
        headers: {
          ...cookie(studentToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scheduledDate: '2026-10-10',
          timeSlot: '08:00 - 08:45',
        }),
      });
      expect(res.status).toBe(403);
    });

    it('登录用户可正常获取分页排课列表', async () => {
      const res = await fetch(`${baseUrl}/api/schedules?page=1&pageSize=10`, {
        headers: cookie(teacherToken),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty('data');
      expect(json).toHaveProperty('total');
      expect(Array.isArray(json.data)).toBe(true);
    });
  });

  describe('2. 排课完整生命周期与级联删除', () => {
    let createdScheduleId = '';

    it('教师可成功为班级新增课表项', async () => {
      const res = await fetch(`${baseUrl}/api/classes/${testClassId}/schedules`, {
        method: 'POST',
        headers: {
          ...cookie(teacherToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scheduledDate: '2026-10-15',
          timeSlot: '09:00 - 09:45',
          notes: '期中复习课',
        }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.schedule).toBeDefined();
      expect(json.schedule.notes).toBe('期中复习课');
      createdScheduleId = json.schedule.id;
    });

    it('教师可更新已有课表项内容', async () => {
      const res = await fetch(`${baseUrl}/api/classes/${testClassId}/schedules/${createdScheduleId}`, {
        method: 'PUT',
        headers: {
          ...cookie(teacherToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scheduledDate: '2026-10-15',
          timeSlot: '10:00 - 10:45',
          status: 'completed',
          notes: '已结课',
        }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      // 验证 DB 字段已变更
      const record = kernelContainer.db.prepare('SELECT * FROM schedules WHERE id = ?').get(createdScheduleId) as any;
      expect(record.status).toBe('completed');
      expect(record.notes).toBe('已结课');
    });

    it('删除课表时级联清理关联考勤表 (DATA-INT-01 事务保护)', async () => {
      const db = kernelContainer.db;
      // 预置关联考勤记录
      db.prepare(
        'INSERT OR REPLACE INTO attendance (schedule_id, student_id, status, recorded_at) VALUES (?, ?, ?, ?)',
      ).run(createdScheduleId, studentId, 'present', Date.now());

      const res = await fetch(`${baseUrl}/api/classes/${testClassId}/schedules/${createdScheduleId}`, {
        method: 'DELETE',
        headers: cookie(teacherToken),
      });
      expect(res.status).toBe(200);

      // 验证 schedule 与 attendance 均已被删除
      const sched = db.prepare('SELECT id FROM schedules WHERE id = ?').get(createdScheduleId);
      expect(sched).toBeUndefined();

      const att = db.prepare('SELECT schedule_id FROM attendance WHERE schedule_id = ?').get(createdScheduleId);
      expect(att).toBeUndefined();
    });
  });

  describe('3. 批量排课 (Batch)', () => {
    it('教师可批量排入多节课程', async () => {
      const res = await fetch(`${baseUrl}/api/classes/${testClassId}/schedules/batch`, {
        method: 'POST',
        headers: {
          ...cookie(teacherToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          schedules: [
            { scheduledDate: '2026-11-01', timeSlot: '08:00 - 08:45', notes: '第1周课' },
            { scheduledDate: '2026-11-08', timeSlot: '08:00 - 08:45', notes: '第2周课' },
          ],
        }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.count).toBe(2);

      // 清理
      kernelContainer.db.prepare('DELETE FROM schedules WHERE class_id = ?').run(testClassId);
    });
  });
});
