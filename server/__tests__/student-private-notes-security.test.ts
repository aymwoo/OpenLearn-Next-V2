/**
 * P1 回归：
 * 1. 私有备忘（private_notes）落库前必须净化——PUT 与 CSV 导入两条写入路径。
 * 2. GET /api/students 必须按教师班级归属过滤，不能返回全库学生。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerRosterRoutes } from '../routes/roster.js';
import { registerAdminRoutes } from '../routes/admin.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('学生私有备忘净化与花名册范围隔离', () => {
  let server: Server;
  let baseUrl: string;
  const db = kernelContainer.db;

  const teacherA = 'usr-notes-sec-teacher-a';
  const teacherB = 'usr-notes-sec-teacher-b';
  const adminId = 'usr-notes-sec-admin';
  const studentA = 'stu-notes-sec-a';
  const studentB = 'stu-notes-sec-b';
  const classA = 'cls-notes-sec-a';
  const classB = 'cls-notes-sec-b';
  const importedNumber = 'NOTES-SEC-IMPORT-1';

  const tokTeacherA = 'tok-notes-sec-teacher-a';
  const tokTeacherB = 'tok-notes-sec-teacher-b';
  const tokAdmin = 'tok-notes-sec-admin';

  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });
  const jsonHeaders = (token: string) => ({ ...cookie(token), 'Content-Type': 'application/json' });

  beforeAll(async () => {
    const now = Date.now();
    const exp = now + 3600_000;

    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(
      tokTeacherA,
      JSON.stringify({ userId: teacherA, role: 'teacher', username: 'notes_sec_a' }),
      now,
      exp,
    );
    insertSession.run(
      tokTeacherB,
      JSON.stringify({ userId: teacherB, role: 'teacher', username: 'notes_sec_b' }),
      now,
      exp,
    );
    insertSession.run(
      tokAdmin,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'notes_sec_admin' }),
      now,
      exp,
    );

    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(classA, '备忘甲班', '', teacherA, now);
    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(classB, '备忘乙班', '', teacherB, now);
    db.prepare('INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)').run(
      studentA,
      'NOTES-SEC-A',
      '甲班学生',
      '',
      now,
    );
    db.prepare('INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)').run(
      studentB,
      'NOTES-SEC-B',
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

    const app = express();
    app.use(express.json());
    const noop = (_req: any, _res: any, next: any) => next();
    registerRosterRoutes({ app, io: undefined, loginLimiter: noop } as any);
    registerAdminRoutes({ app, io: undefined, loginLimiter: noop } as any);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?)').run(tokTeacherA, tokTeacherB, tokAdmin);
      db.prepare('DELETE FROM class_students WHERE class_id IN (?, ?)').run(classA, classB);
      db.prepare('DELETE FROM classes WHERE id IN (?, ?)').run(classA, classB);
      db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(studentA, studentB);
      db.prepare('DELETE FROM students WHERE student_number = ?').run(importedNumber);
    } catch {
      // 清理失败不掩盖测试结论
    }
  });

  describe('私有备忘写入净化', () => {
    it('PUT /api/students/:id 落库前剥离脚本与事件属性，保留分类结构', async () => {
      const malicious = JSON.stringify({
        category: 'Behavioral',
        html: '<div>课堂表现</div><img src=x onerror="alert(1)"><script>alert(2)</script>',
      });
      const res = await fetch(`${baseUrl}/api/students/${studentA}`, {
        method: 'PUT',
        headers: jsonHeaders(tokTeacherA),
        body: JSON.stringify({ private_notes: malicious }),
      });
      expect(res.status).toBe(200);

      const stored = (db.prepare('SELECT private_notes FROM students WHERE id = ?').get(studentA) as any)
        .private_notes as string;
      expect(stored).toContain('课堂表现');
      expect(stored).not.toContain('<script');
      expect(stored).not.toContain('<img');
      expect(stored).not.toContain('onerror');
      const parsed = JSON.parse(stored);
      expect(parsed.category).toBe('Behavioral');
    });

    it('POST /api/students/import 的备注同样净化后落库', async () => {
      const res = await fetch(`${baseUrl}/api/students/import`, {
        method: 'POST',
        headers: jsonHeaders(tokTeacherA),
        body: JSON.stringify({
          students: [
            {
              name: '导入越权备注学生',
              student_number: importedNumber,
              private_notes: '<div>导入备注</div><img src=x onerror="alert(1)">',
            },
          ],
        }),
      });
      expect(res.status).toBe(200);

      const stored = (db.prepare('SELECT private_notes FROM students WHERE student_number = ?').get(importedNumber) as any)
        ?.private_notes as string;
      expect(stored).toContain('导入备注');
      expect(stored).not.toContain('<img');
      expect(stored).not.toContain('onerror');
    });
  });

  describe('GET /api/students 花名册范围隔离', () => {
    it('教师只看到自己班级的学生，且分页 total 同步收敛', async () => {
      const res = await fetch(`${baseUrl}/api/students?page=1&pageSize=500`, { headers: cookie(tokTeacherA) });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      const ids = body.data.map((s: any) => s.id);
      expect(ids).toContain(studentA);
      expect(ids).not.toContain(studentB);
      expect(body.total).toBe(ids.length);
    });

    it('另一位教师只看到自己班级的学生', async () => {
      const res = await fetch(`${baseUrl}/api/students?page=1&pageSize=500`, { headers: cookie(tokTeacherB) });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      const ids = body.data.map((s: any) => s.id);
      expect(ids).toContain(studentB);
      expect(ids).not.toContain(studentA);
    });

    it('管理员仍可看到全库学生', async () => {
      const res = await fetch(`${baseUrl}/api/students?page=1&pageSize=500`, { headers: cookie(tokAdmin) });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      const ids = body.data.map((s: any) => s.id);
      expect(ids).toContain(studentA);
      expect(ids).toContain(studentB);
    });
  });
});
