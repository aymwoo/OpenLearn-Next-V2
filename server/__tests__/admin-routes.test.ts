import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerAdminRoutes } from '../routes/admin.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('Admin routes integration & permission mesh (D1c)', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const adminId = 'usr-admin-test';
  const teacherId = 'usr-admin-teacher';
  const studentId = 'usr-admin-student';

  const adminToken = 'tok-admin-test';
  const teacherToken = 'tok-admin-teacher';
  const studentToken = 'tok-admin-student';

  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

  beforeAll(async () => {
    const now = Date.now();
    const expiresAt = now + 60 * 60 * 1000;
    const db = kernelContainer.db;

    // 1. 预置用户
    const insertUser = db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertUser.run(adminId, 'admin_user', 'hash', 'administrator', '系统超管', now);
    insertUser.run(teacherId, 'teacher_user', 'hash', 'teacher', '普通教师', now);

    const insertStudent = db.prepare(
      'INSERT OR REPLACE INTO students (id, name, student_number, password, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    insertStudent.run(studentId, '学生甲', 'STU_ADM_001', 'hash', now);

    // 2. 预置 session
    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(
      adminToken,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'admin_user' }),
      now,
      expiresAt,
    );
    insertSession.run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'teacher_user' }),
      now,
      expiresAt,
    );
    insertSession.run(
      studentToken,
      JSON.stringify({ userId: studentId, role: 'student', username: 'student_test' }),
      now,
      expiresAt,
    );

    // 3. 构建 Express 测试应用
    app = express();
    app.use(express.json());
    registerAdminRoutes({ app } as any);

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
      db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?)').run(adminToken, teacherToken, studentToken);
      db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(adminId, teacherId);
      db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
    } catch {}
  });

  describe('1. 权限拦截契约 (401 / 403)', () => {
    it('未登录访问管理员专属端点返回 401', async () => {
      const res = await fetch(`${baseUrl}/api/admin/seed-demo`, { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('普通教师访问管理员专属端点（seed-demo）被 403 阻断', async () => {
      const res = await fetch(`${baseUrl}/api/admin/seed-demo`, {
        method: 'POST',
        headers: cookie(teacherToken),
      });
      expect(res.status).toBe(403);
    });

    it('学生访问导入端点（/api/classes/import）被 403 阻断', async () => {
      const res = await fetch(`${baseUrl}/api/classes/import`, {
        method: 'POST',
        headers: {
          ...cookie(studentToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ classes: [] }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('2. 批量导入功能与入参门禁', () => {
    it('非数组格式 payload 应返回 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/classes/import`, {
        method: 'POST',
        headers: {
          ...cookie(teacherToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ classes: 'invalid-string' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('classes must be an array');
    });

    it('教师可成功批量导入班级与学生名册', async () => {
      const className = `批量导入测试班_${Date.now()}`;
      const res = await fetch(`${baseUrl}/api/classes/import`, {
        method: 'POST',
        headers: {
          ...cookie(teacherToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          classes: [
            {
              name: className,
              description: '批量导入测试说明',
              students: [
                { name: '导入生A', email: 'imported_a@example.com' },
                { name: '导入生B', email: 'imported_b@example.com' },
              ],
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.imported.length).toBe(1);
      expect(json.imported[0].name).toBe(className);
      expect(json.imported[0].studentsCount).toBe(2);

      // 清理数据
      const classId = json.imported[0].id;
      kernelContainer.db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
      kernelContainer.db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
      kernelContainer.db.prepare("DELETE FROM students WHERE email LIKE 'imported_%@example.com'").run();
    });

    it('教师可成功批量导入独立学生列表', async () => {
      const res = await fetch(`${baseUrl}/api/students/import`, {
        method: 'POST',
        headers: {
          ...cookie(teacherToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          students: [
            { name: '独立生1', email: 'solo_1@example.com', student_number: 'SOLO_001' },
            { name: '独立生2', email: 'solo_2@example.com', student_number: 'SOLO_002' },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.imported.length).toBe(2);

      // 清理数据
      kernelContainer.db.prepare("DELETE FROM students WHERE student_number LIKE 'SOLO_%'").run();
    });
  });

  describe('3. 管理员初始化播种 (seed-demo)', () => {
    it('超级管理员可成功触发示范数据播种', async () => {
      const res = await fetch(`${baseUrl}/api/admin/seed-demo`, {
        method: 'POST',
        headers: cookie(adminToken),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.classId).toBe('demo-class');
    });
  });
});
