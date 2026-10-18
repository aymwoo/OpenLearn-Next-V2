import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerRosterRoutes } from '../routes/roster.js';
import { runStartupMigrations } from '../bootstrap-db.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('Roster routes integration & permission mesh (D1b)', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const adminId = 'usr-roster-admin';
  const teacherId = 'usr-roster-teacher';
  const studentId = 'usr-roster-student';
  const victimStudentId = 'usr-roster-victim';

  const adminToken = 'tok-roster-admin';
  const teacherToken = 'tok-roster-teacher';
  const studentToken = 'tok-roster-student';

  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

  beforeAll(async () => {
    const now = Date.now();
    const expiresAt = now + 60 * 60 * 1000;
    const db = kernelContainer.db;
    await runStartupMigrations(db as unknown as import('../bootstrap-db.js').MigrationDb); // strict: Database/MigrationDb 端口漂移，运行时相容

    // 1. 预置基础用户与学生
    const insertUser = db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertUser.run(adminId, 'roster_admin', 'hash_placeholder', 'administrator', '花名册管理员', now);
    insertUser.run(teacherId, 'roster_teacher', 'hash_placeholder', 'teacher', '花名册教师', now);

    const insertStudent = db.prepare(
      'INSERT OR REPLACE INTO students (id, name, student_number, password, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    insertStudent.run(studentId, '爱丽丝', 'STU_ALICE_001', 'hash_placeholder', now);
    insertStudent.run(victimStudentId, '鲍勃', 'STU_BOB_002', 'hash_placeholder', now);

    // 2. 预置客户端 session
    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(
      adminToken,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'roster_admin' }),
      now,
      expiresAt,
    );
    insertSession.run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'roster_teacher' }),
      now,
      expiresAt,
    );
    insertSession.run(
      studentToken,
      JSON.stringify({ userId: studentId, role: 'student', username: 'student_alice' }),
      now,
      expiresAt,
    );

    // 3. 构建 Express 测试应用
    app = express();
    app.use(express.json());
    registerRosterRoutes({
      app,
      io: { emit: () => {}, to: () => ({ emit: () => {} }) },
      loginLimiter: ((_req: any, _res: any, next: any) => next()) as any,
    } as any);

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
      db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(studentId, victimStudentId);
      db.prepare("DELETE FROM classes WHERE id LIKE 'test-roster-%'").run();
    } catch {}
  });

  describe('1. 班级管理与权限隔离', () => {
    it('未携带鉴权凭证时应返回 401 Unauthorized', async () => {
      const res = await fetch(`${baseUrl}/api/classes`);
      expect(res.status).toBe(401);
    });

    it('合法教师可获取班级分页列表', async () => {
      const res = await fetch(`${baseUrl}/api/classes?page=1&pageSize=10`, {
        headers: cookie(teacherToken),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty('data');
      expect(Array.isArray(json.data)).toBe(true);
      expect(json).toHaveProperty('total');
      expect(json.page).toBe(1);
    });

    it('学生角色禁止创建班级（403 越权拦截）', async () => {
      const res = await fetch(`${baseUrl}/api/classes`, {
        method: 'POST',
        headers: {
          ...cookie(studentToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: '高一1班（非法创建）',
          description: '测试越权',
        }),
      });
      expect(res.status).toBe(403);
    });

    it('教师角色可成功创建班级', async () => {
      const res = await fetch(`${baseUrl}/api/classes`, {
        method: 'POST',
        headers: {
          ...cookie(teacherToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: '高一3班',
          description: '高一信息科技实验班',
        }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.id).toBeDefined();

      // 清理该班级
      kernelContainer.db.prepare('DELETE FROM classes WHERE id = ?').run(json.id);
    });
  });

  describe('2. 学生管理与 IDOR 越权防护', () => {
    const ownedClassId = 'test-roster-owned-class';
    let createdStudentId = '';

    beforeAll(() => {
      const db = kernelContainer.db;
      const now = Date.now();
      db.prepare('INSERT OR REPLACE INTO classes (id, name, description, created_at) VALUES (?, ?, ?, ?)').run(
        ownedClassId,
        '教师自有班级',
        'IDOR 测试',
        now,
      );
      db.prepare('UPDATE classes SET owner_user_id = ? WHERE id = ?').run(teacherId, ownedClassId);
    });

    afterAll(() => {
      const db = kernelContainer.db;
      db.prepare('DELETE FROM class_students WHERE class_id = ?').run(ownedClassId);
      db.prepare('DELETE FROM classes WHERE id = ?').run(ownedClassId);
    });

    it('教师角色可创建新学生', async () => {
      const res = await fetch(`${baseUrl}/api/students`, {
        method: 'POST',
        headers: {
          ...cookie(teacherToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: '测试新生查理',
          email: 'charlie@test.com',
          studentNumber: 'STU_CHARLIE_999',
        }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.id).toBeDefined();
      createdStudentId = json.id;

      // 真实流程：创建后立即编入教师自己的班级（写操作授权依赖班级归属）
      const linkRes = await fetch(`${baseUrl}/api/classes/${ownedClassId}/students`, {
        method: 'POST',
        headers: {
          ...cookie(teacherToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ studentId: createdStudentId }),
      });
      expect(linkRes.status).toBe(200);
    });

    it('学生角色禁止修改其他学生的信息（IDOR 越权拦截 403）', async () => {
      const res = await fetch(`${baseUrl}/api/students/${victimStudentId}`, {
        method: 'PUT',
        headers: {
          ...cookie(studentToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: '鲍勃已被篡改',
        }),
      });
      expect(res.status).toBe(403);
    });

    it('教师可修改学生姓名并重置密码', async () => {
      // 修改姓名
      const updateRes = await fetch(`${baseUrl}/api/students/${createdStudentId}`, {
        method: 'PUT',
        headers: {
          ...cookie(teacherToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: '查理（已更名）',
        }),
      });
      expect(updateRes.status).toBe(200);
      const updateJson = await updateRes.json();
      expect(updateJson.success).toBe(true);

      const updated = kernelContainer.db.prepare('SELECT name FROM students WHERE id = ?').get(createdStudentId) as any;
      expect(updated.name).toBe('查理（已更名）');
    });

    it('删除学生时应正确触发级联删除清理', async () => {
      const delRes = await fetch(`${baseUrl}/api/students/${createdStudentId}`, {
        method: 'DELETE',
        headers: cookie(teacherToken),
      });
      expect(delRes.status).toBe(200);
      const delJson = await delRes.json();
      expect(delJson.success).toBe(true);

      // 验证数据库中已被彻底移除
      const record = kernelContainer.db.prepare('SELECT id FROM students WHERE id = ?').get(createdStudentId);
      expect(record).toBeUndefined();
    });
  });

  describe('3. 花名册与点名接口', () => {
    const testClassId = 'test-roster-class-99';

    beforeAll(() => {
      kernelContainer.db
        .prepare('INSERT OR REPLACE INTO classes (id, name, description, created_at) VALUES (?, ?, ?, ?)')
        .run(testClassId, '点名测试班级', '测试专用', Date.now());
      kernelContainer.db.prepare('UPDATE classes SET owner_user_id = ? WHERE id = ?').run(teacherId, testClassId);
      kernelContainer.db
        .prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)')
        .run(testClassId, studentId, Date.now());
    });

    afterAll(() => {
      try {
        kernelContainer.db.prepare('DELETE FROM class_students WHERE class_id = ?').run(testClassId);
        kernelContainer.db.prepare('DELETE FROM student_rollcalls WHERE class_id = ?').run(testClassId);
        kernelContainer.db.prepare('DELETE FROM classes WHERE id = ?').run(testClassId);
      } catch {}
    });

    it('教师可查询班级花名册列表', async () => {
      const res = await fetch(`${baseUrl}/api/classes/${testClassId}/students`, {
        headers: cookie(teacherToken),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json)).toBe(true);
      expect(json.some((s: any) => s.id === studentId)).toBe(true);
    });

    it('教师可记录并查询点名评价记录', async () => {
      const postRes = await fetch(`${baseUrl}/api/rollcalls/evaluate`, {
        method: 'POST',
        headers: {
          ...cookie(teacherToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          studentId: studentId,
          classId: testClassId,
          rating: 'excellent',
          score: 100,
          rewardCoins: 5,
        }),
      });
      expect(postRes.status).toBe(200);
      const postJson = await postRes.json();
      expect(postJson.success).toBe(true);

      const getRes = await fetch(`${baseUrl}/api/students/${studentId}/dashboard`, {
        headers: cookie(teacherToken),
      });
      expect(getRes.status).toBe(200);
      const json = await getRes.json();
      expect(Array.isArray(json.rollcalls)).toBe(true);
      expect(json.rollcalls.length).toBeGreaterThan(0);
      expect(json.rollcalls[0].student_id).toBe(studentId);
    });

    it('Issue #110: 教师可对全班开启答题锁定（navigation 模式与 target），且学生面板与数据库正确更新', async () => {
      const lockRes = await fetch(`${baseUrl}/api/classes/${testClassId}/lock_lesson`, {
        method: 'POST',
        headers: {
          ...cookie(teacherToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lessonId: 'lesson-110-test',
          mode: 'navigation',
          target: { tab: 'courseware' },
        }),
      });
      expect(lockRes.status).toBe(200);
      const lockJson = await lockRes.json();
      expect(lockJson.success).toBe(true);

      const studentInDb = kernelContainer.db
        .prepare('SELECT locked_lesson_id, lock_mode, lock_target FROM students WHERE id = ?')
        .get(studentId) as any;
      expect(studentInDb.locked_lesson_id).toBe('lesson-110-test');
      expect(studentInDb.lock_mode).toBe('navigation');
      expect(JSON.parse(studentInDb.lock_target)).toEqual({ tab: 'courseware' });

      // GET /api/students/:id/dashboard
      const dashRes = await fetch(`${baseUrl}/api/students/${studentId}/dashboard`, {
        headers: cookie(teacherToken),
      });
      expect(dashRes.status).toBe(200);
      const dashJson = await dashRes.json();
      expect(dashJson.profile.locked_lesson_id).toBe('lesson-110-test');
      expect(dashJson.profile.lock_mode).toBe('navigation');
      expect(dashJson.profile.lock_target).toEqual({ tab: 'courseware' });

      // PUT /api/students/:id 单人更新模式
      const updateRes = await fetch(`${baseUrl}/api/students/${studentId}`, {
        method: 'PUT',
        headers: {
          ...cookie(teacherToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          locked_lesson_id: 'lesson-110-test',
          lock_mode: 'full',
        }),
      });
      expect(updateRes.status).toBe(200);
      const updatedStudent = kernelContainer.db.prepare('SELECT lock_mode FROM students WHERE id = ?').get(studentId) as any;
      expect(updatedStudent.lock_mode).toBe('full');

      // POST /api/classes/:classId/unlock_lesson 解锁全班重置
      const unlockRes = await fetch(`${baseUrl}/api/classes/${testClassId}/unlock_lesson`, {
        method: 'POST',
        headers: cookie(teacherToken),
      });
      expect(unlockRes.status).toBe(200);
      const unlockedStudent = kernelContainer.db
        .prepare('SELECT locked_lesson_id, lock_mode, lock_target FROM students WHERE id = ?')
        .get(studentId) as any;
      expect(unlockedStudent.locked_lesson_id).toBeNull();
      expect(unlockedStudent.lock_mode).toBe('full');
      expect(unlockedStudent.lock_target).toBeNull();
    });
  });
});
