/**
 * GDPR 删除只允许管理员。教师即使能看到该学生也必须 403。
 * 管理员缺少 confirm 时 400；{ confirm: true } 才物理删除。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerRosterRoutes } from '../routes/roster.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('GDPR 删除角色门禁', () => {
  let server: Server;
  let baseUrl: string;
  const db = kernelContainer.db as any;

  const adminId = 'usr-gdpr-admin';
  const teacherId = 'usr-gdpr-teacher';
  const studentId = 'stu-gdpr-target';
  const adminToken = 'tok-gdpr-admin';
  const teacherToken = 'tok-gdpr-teacher';

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    registerRosterRoutes({
      app,
      io: undefined,
      loginLimiter: (_req: any, _res: any, next: any) => next(),
    } as any);

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const now = Date.now();
    const expiresAt = now + 60 * 60 * 1000;
    const insertUser = db.prepare(
      `INSERT OR REPLACE INTO users
        (id, username, password_hash, role, name, created_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insertUser.run(adminId, 'gdpr_admin', 'x', 'administrator', 'GDPR 管理员', now, 'active');
    insertUser.run(teacherId, 'gdpr_teacher', 'x', 'teacher', 'GDPR 教师', now, 'active');
    db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
    db.prepare(
      'INSERT INTO students (id, student_number, name, email, password, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(studentId, 'GDPR9001', '待删除学生', 'gdpr@school.edu', 'hash', now);

    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(
      adminToken,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'gdpr_admin' }),
      now,
      expiresAt,
    );
    insertSession.run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'gdpr_teacher' }),
      now,
      expiresAt,
    );
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?)').run(adminToken, teacherToken);
    db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(adminId, teacherId);
    db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
  });

  const remove = (token: string, body: unknown) =>
    fetch(`${baseUrl}/api/students/${studentId}/gdpr-delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: `edu_os_token=${token}` },
      body: JSON.stringify(body),
    });

  it('教师 confirm: true 仍是 403，学生记录还在', async () => {
    const res = await remove(teacherToken, { confirm: true });
    expect(res.status).toBe(403);
    expect(db.prepare('SELECT 1 FROM students WHERE id = ?').get(studentId)).toBeDefined();
  });

  it('管理员未确认 → 400，学生记录还在', async () => {
    const res = await remove(adminToken, {});
    expect(res.status).toBe(400);
    expect(db.prepare('SELECT 1 FROM students WHERE id = ?').get(studentId)).toBeDefined();
  });

  it('管理员 confirm: true → 200，学生记录被删除', async () => {
    const res = await remove(adminToken, { confirm: true });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(db.prepare('SELECT 1 FROM students WHERE id = ?').get(studentId)).toBeUndefined();
  });
});
