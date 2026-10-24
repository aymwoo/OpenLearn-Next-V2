/**
 * P0 鉴权修复回归：
 * 1. `PUT/DELETE /api/students/:id` 必须有学生级对象授权——教师只能写自己班级的学生，管理员不限。
 * 2. `GET /api/students/:id/dashboard` 不得把 `private_notes` 返回给学生本人或非本班教师。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerRosterRoutes } from '../routes/roster.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { setAuditSinkForTests } from '../../packages/core/observability/audit-log.js';

describe('学生写操作与私有备忘的对象级授权', () => {
  let server: Server;
  let baseUrl: string;
  const db = kernelContainer.db;

  const teacherA = 'usr-stu-auth-teacher-a';
  const teacherB = 'usr-stu-auth-teacher-b';
  const adminId = 'usr-stu-auth-admin';
  const studentA = 'stu-stu-auth-a';
  const studentB = 'stu-stu-auth-b';
  const classA = 'cls-stu-auth-a';
  const classB = 'cls-stu-auth-b';

  const tokTeacherA = 'tok-stu-auth-teacher-a';
  const tokTeacherB = 'tok-stu-auth-teacher-b';
  const tokAdmin = 'tok-stu-auth-admin';
  const tokStudentA = 'tok-stu-auth-student-a';
  const tokStudentB = 'tok-stu-auth-student-b';

  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });
  const jsonHeaders = (token: string) => ({ ...cookie(token), 'Content-Type': 'application/json' });

  const updateStudent = (target: string, token: string, body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/students/${target}`, {
      method: 'PUT',
      headers: jsonHeaders(token),
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    const now = Date.now();
    const exp = now + 3600_000;

    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(
      tokTeacherA,
      JSON.stringify({ userId: teacherA, role: 'teacher', username: 'stu_auth_a' }),
      now,
      exp,
    );
    insertSession.run(
      tokTeacherB,
      JSON.stringify({ userId: teacherB, role: 'teacher', username: 'stu_auth_b' }),
      now,
      exp,
    );
    insertSession.run(
      tokAdmin,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'stu_auth_admin' }),
      now,
      exp,
    );
    insertSession.run(
      tokStudentA,
      JSON.stringify({ userId: studentA, studentId: studentA, role: 'student', username: 'stu_auth_sa' }),
      now,
      exp,
    );
    insertSession.run(
      tokStudentB,
      JSON.stringify({ userId: studentB, studentId: studentB, role: 'student', username: 'stu_auth_sb' }),
      now,
      exp,
    );

    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(classA, '鉴权甲班', '', teacherA, now);
    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(classB, '鉴权乙班', '', teacherB, now);
    db.prepare(
      'INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(studentA, 'AUTH-A', '甲班学生', '', now);
    db.prepare(
      'INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(studentB, 'AUTH-B', '乙班学生', '', now);
    db.prepare('UPDATE students SET private_notes = ? WHERE id = ?').run(
      '{"category":"SpecialCare","html":"需重点关注"}',
      studentA,
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
    registerRosterRoutes({ app, io: { emit: () => {}, to: () => ({ emit: () => {} }) }, loginLimiter: noop } as any);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?, ?, ?)').run(
        tokTeacherA,
        tokTeacherB,
        tokAdmin,
        tokStudentA,
        tokStudentB,
      );
      db.prepare('DELETE FROM class_students WHERE class_id IN (?, ?)').run(classA, classB);
      db.prepare('DELETE FROM classes WHERE id IN (?, ?)').run(classA, classB);
      db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(studentA, studentB);
    } catch {
      // 清理失败不掩盖测试结论
    }
  });

  describe('PUT /api/students/:id 对象级授权', () => {
    it('其它班级的教师不能修改学生（403，数据保持原样）', async () => {
      const res = await updateStudent(studentA, tokTeacherB, {
        name: '越权改名',
        private_notes: '{"category":"General","html":"越权写入"}',
        locked_lesson_id: 'les-hijacked',
      });
      expect(res.status).toBe(403);

      const row = db
        .prepare('SELECT name, private_notes, locked_lesson_id FROM students WHERE id = ?')
        .get(studentA) as any;
      expect(row.name).toBe('甲班学生');
      expect(row.private_notes).toContain('需重点关注');
      expect(row.locked_lesson_id).toBeNull();
    });

    it('本班教师可以修改学生（200，字段生效）', async () => {
      const res = await updateStudent(studentA, tokTeacherA, {
        name: '甲班学生（已更新）',
        locked_lesson_id: 'les-owned',
      });
      expect(res.status).toBe(200);

      const row = db.prepare('SELECT name, locked_lesson_id FROM students WHERE id = ?').get(studentA) as any;
      expect(row.name).toBe('甲班学生（已更新）');
      expect(row.locked_lesson_id).toBe('les-owned');
    });

    it('管理员可以跨班修改任意学生（200）', async () => {
      const res = await updateStudent(studentB, tokAdmin, { name: '乙班学生（管理员更新）' });
      expect(res.status).toBe(200);

      const row = db.prepare('SELECT name FROM students WHERE id = ?').get(studentB) as any;
      expect(row.name).toBe('乙班学生（管理员更新）');
    });

    it('学生角色仍然不能调用该接口（403）', async () => {
      const res = await updateStudent(studentB, tokStudentA, { name: '学生越权' });
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/students/:id 对象级授权', () => {
    it('其它班级的教师不能删除学生（403，学生仍在）', async () => {
      const res = await fetch(`${baseUrl}/api/students/${studentA}`, {
        method: 'DELETE',
        headers: cookie(tokTeacherB),
      });
      expect(res.status).toBe(403);
      expect(db.prepare('SELECT id FROM students WHERE id = ?').get(studentA)).toBeTruthy();
    });
  });

  describe('GET /api/students/:id/dashboard 私有备忘隔离', () => {
    it('学生本人查看自己的仪表盘时不会收到 private_notes', async () => {
      const res = await fetch(`${baseUrl}/api/students/${studentA}/dashboard`, { headers: cookie(tokStudentA) });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.profile).toBeTruthy();
      expect(body.profile).not.toHaveProperty('private_notes');
      expect(body.profile.locked_lesson_id).toBe('les-owned');
    });

    it('本班教师查看学生仪表盘时仍能拿到 private_notes', async () => {
      const res = await fetch(`${baseUrl}/api/students/${studentA}/dashboard`, { headers: cookie(tokTeacherA) });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.profile.private_notes).toContain('需重点关注');
    });

    it('其它班级教师仍被拒绝访问（403）', async () => {
      const res = await fetch(`${baseUrl}/api/students/${studentA}/dashboard`, { headers: cookie(tokTeacherB) });
      expect(res.status).toBe(403);
    });
  });

  describe('密码写入校验与敏感字段审计', () => {
    const auditEvents: any[] = [];

    beforeAll(() => {
      setAuditSinkForTests((record) => auditEvents.push(record));
    });

    afterAll(() => {
      setAuditSinkForTests(null);
    });

    it('空密码或纯空白密码返回 400，且哈希保持不变', async () => {
      const before = (db.prepare('SELECT password FROM students WHERE id = ?').get(studentA) as any).password;
      const blank = await updateStudent(studentA, tokTeacherA, { password: '   ' });
      expect(blank.status).toBe(400);
      const empty = await updateStudent(studentA, tokTeacherA, { password: '' });
      expect(empty.status).toBe(400);

      const after = (db.prepare('SELECT password FROM students WHERE id = ?').get(studentA) as any).password;
      expect(after).toBe(before);
    });

    it('设置新密码成功，审计只记录字段名不记录明文', async () => {
      auditEvents.length = 0;
      const newPassword = 'Audit-Pw-9281';
      const res = await updateStudent(studentA, tokTeacherA, { password: newPassword });
      expect(res.status).toBe(200);

      const event = auditEvents.find((e) => e.event === 'student.sensitive_fields_updated');
      expect(event).toBeTruthy();
      expect(event.fields).toContain('password');
      expect(event.studentId).toBe(studentA);
      expect(event.actorId).toBe(teacherA);
      expect(JSON.stringify(event)).not.toContain(newPassword);
    });

    it('锁定课节与私有备忘变更同样留痕', async () => {
      auditEvents.length = 0;
      const res = await updateStudent(studentA, tokTeacherA, {
        locked_lesson_id: 'les-audit',
        private_notes: JSON.stringify({ category: 'General', html: '<b>审计备注</b>' }),
      });
      expect(res.status).toBe(200);

      const event = auditEvents.find((e) => e.event === 'student.sensitive_fields_updated');
      expect(event).toBeTruthy();
      expect(event.fields).toEqual(expect.arrayContaining(['locked_lesson_id', 'private_notes']));
    });
  });
});
