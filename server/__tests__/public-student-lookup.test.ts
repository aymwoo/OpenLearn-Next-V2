import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerRosterRoutes } from '../routes/roster.js';
import { registerPluginsRoutes } from '../routes/plugins.js';
import { createStudentLookupLimiter } from '../security/rate-limit.js';
import type { ServerContext } from '../context.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('Public student ID lookup & site toggle (#538)', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const adminId = 'usr-lookup-admin';
  const adminToken = 'tok-lookup-admin';
  const classAId = 'cls-lookup-a';
  const classBId = 'cls-lookup-b';
  const createdStudentIds: string[] = [];
  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

  let prevSetting: number | null | undefined;

  beforeAll(async () => {
    const db = kernelContainer.db;
    const now = Date.now();
    const expiresAt = now + 60 * 60 * 1000;

    const existing = db.prepare('SELECT allow_public_student_lookup FROM site_settings WHERE id = ?').get('global') as
      { allow_public_student_lookup?: number | null } | undefined;
    prevSetting = existing?.allow_public_student_lookup;

    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(adminId, 'lookup_admin', 'hash', 'administrator', '查询开关测试管理员', now);

    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      adminToken,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'lookup_admin' }),
      now,
      expiresAt,
    );

    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(classAId, '七年级(1)班', '测试一班', 'SECRET_PASS_A', adminId, now);

    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(classBId, '信息学竞赛班', '测试二班', 'SECRET_PASS_B', adminId, now);

    const insertStu = db.prepare(
      'INSERT OR REPLACE INTO students (id, student_number, name, email, password, private_notes, gender, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const enroll = db.prepare(
      'INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)',
    );

    // 1. 重名学生与多班级学生
    insertStu.run('stu-lk-1', '20260101', '张伟', 'zw1@example.com', 'hashed-pw', '秘密备注', 'male', now);
    enroll.run(classAId, 'stu-lk-1', now);
    enroll.run(classBId, 'stu-lk-1', now);
    createdStudentIds.push('stu-lk-1');

    insertStu.run('stu-lk-2', '20260102', '张伟', 'zw2@example.com', 'hashed-pw', null, 'male', now);
    enroll.run(classBId, 'stu-lk-2', now);
    createdStudentIds.push('stu-lk-2');

    // 2. 未分班学生
    insertStu.run('stu-lk-3', '20260103', 'Alice Chen', 'alice@example.com', 'hashed-pw', null, 'female', now);
    createdStudentIds.push('stu-lk-3');

    // 3. 批量同名/前缀学生用于验证 10 条上限截断（12 位李同学）
    for (let i = 1; i <= 12; i++) {
      const sid = `stu-lk-li-${i}`;
      const num = `202602${String(i).padStart(2, '0')}`;
      insertStu.run(sid, num, `李测试${String(i).padStart(2, '0')}`, `li${i}@example.com`, 'hashed', null, null, now);
      enroll.run(classAId, sid, now);
      createdStudentIds.push(sid);
    }

    app = express();
    app.use(express.json());
    const noopMiddleware: express.RequestHandler = (_req, _res, next) => next();
    const stubCtx = {
      app,
      io: { emit: () => {}, on: () => {}, to: () => ({ emit: () => {} }) } as unknown as ServerContext['io'],
      loginLimiter: noopMiddleware,
      studentLookupLimiter: createStudentLookupLimiter(100),
      aiLimiter: noopMiddleware,
    } as unknown as ServerContext;
    registerRosterRoutes(stubCtx);
    registerPluginsRoutes(stubCtx);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  beforeEach(() => {
    kernelContainer.db.prepare('UPDATE site_settings SET allow_public_student_lookup = 1 WHERE id = ?').run('global');
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    const db = kernelContainer.db;
    try {
      db.prepare('UPDATE site_settings SET allow_public_student_lookup = ? WHERE id = ?').run(
        prevSetting ?? 1,
        'global',
      );
      for (const sid of createdStudentIds) {
        db.prepare('DELETE FROM class_students WHERE student_id = ?').run(sid);
        db.prepare('DELETE FROM students WHERE id = ?').run(sid);
      }
      db.prepare('DELETE FROM classes WHERE id IN (?, ?)').run(classAId, classBId);
      db.prepare('DELETE FROM client_sessions WHERE id = ?').run(adminToken);
      db.prepare('DELETE FROM users WHERE id = ?').run(adminId);
    } catch {}
  });

  it('defaults allowPublicStudentLookup to true and allows admin to toggle and preserve it', async () => {
    const res1 = await fetch(`${baseUrl}/api/site-settings`);
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { allowPublicStudentLookup?: boolean };
    expect(body1.allowPublicStudentLookup).toBe(true);

    const badRes = await fetch(`${baseUrl}/api/site-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...cookie(adminToken) },
      body: JSON.stringify({ siteName: 'OpenLearn Next', allowPublicStudentLookup: 'no' }),
    });
    expect(badRes.status).toBe(400);

    const disableRes = await fetch(`${baseUrl}/api/site-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...cookie(adminToken) },
      body: JSON.stringify({ siteName: 'OpenLearn Next', allowPublicStudentLookup: false }),
    });
    expect(disableRes.status).toBe(200);
    const disabledBody = (await disableRes.json()) as { allowPublicStudentLookup?: boolean };
    expect(disabledBody.allowPublicStudentLookup).toBe(false);

    // 后续保存站点设置未显式传递该字段时，应保留已保存的 false
    const omitRes = await fetch(`${baseUrl}/api/site-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...cookie(adminToken) },
      body: JSON.stringify({ siteName: 'OpenLearn Next' }),
    });
    expect(omitRes.status).toBe(200);
    const omittedBody = (await omitRes.json()) as { allowPublicStudentLookup?: boolean };
    expect(omittedBody.allowPublicStudentLookup).toBe(false);
  });

  it('exposes minimal class list without secrets and blocks when disabled', async () => {
    const res = await fetch(`${baseUrl}/api/auth/public-classes`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { items: Array<Record<string, unknown>> };
    const clsA = data.items.find((c) => c.id === classAId);
    expect(clsA).toEqual({ id: classAId, name: '七年级(1)班' });
    expect(clsA).not.toHaveProperty('class_passcode');
    expect(clsA).not.toHaveProperty('owner_user_id');

    kernelContainer.db.prepare('UPDATE site_settings SET allow_public_student_lookup = 0 WHERE id = ?').run('global');
    const blocked = await fetch(`${baseUrl}/api/auth/public-classes`);
    expect(blocked.status).toBe(403);
  });

  it('validates minimum query length and blocks LIKE wildcard scraping', async () => {
    const emptyRes = await fetch(`${baseUrl}/api/auth/student-lookup?name=`);
    expect(emptyRes.status).toBe(400);

    const oneLatinRes = await fetch(`${baseUrl}/api/auth/student-lookup?name=A`);
    expect(oneLatinRes.status).toBe(400);

    // 1 个汉字允许查询
    const oneHanRes = await fetch(`${baseUrl}/api/auth/student-lookup?name=${encodeURIComponent('张')}`);
    expect(oneHanRes.status).toBe(200);

    // LIKE 通配符 %% 不得匹配全部学生
    const wildcardRes = await fetch(`${baseUrl}/api/auth/student-lookup?name=${encodeURIComponent('%%')}`);
    expect(wildcardRes.status).toBe(200);
    const wildcardBody = (await wildcardRes.json()) as { items: unknown[] };
    expect(wildcardBody.items).toHaveLength(0);
  });

  it('supports class filtering, multi-class & unassigned display, truncation, and omits PII', async () => {
    // 重名查询不限班级：返回两条张伟，且不泄露 email / password / private_notes
    const resAll = await fetch(`${baseUrl}/api/auth/student-lookup?name=${encodeURIComponent('张伟')}`);
    expect(resAll.status).toBe(200);
    const bodyAll = (await resAll.json()) as {
      items: Array<Record<string, unknown>>;
      truncated: boolean;
      limit: number;
    };
    expect(bodyAll.truncated).toBe(false);
    expect(bodyAll.items).toHaveLength(2);
    const first = bodyAll.items.find((item) => item.studentNumber === '20260101');
    expect(first).toEqual({
      name: '张伟',
      studentNumber: '20260101',
      classes: ['七年级(1)班', '信息学竞赛班'],
    });
    expect(first).not.toHaveProperty('email');
    expect(first).not.toHaveProperty('password');
    expect(first).not.toHaveProperty('private_notes');

    // 指定班级过滤：只返回七年级(1)班的张伟
    const resClassA = await fetch(
      `${baseUrl}/api/auth/student-lookup?name=${encodeURIComponent('张伟')}&classId=${classAId}`,
    );
    expect(resClassA.status).toBe(200);
    const bodyClassA = (await resClassA.json()) as { items: Array<{ studentNumber: string }> };
    expect(bodyClassA.items).toHaveLength(1);
    expect(bodyClassA.items[0].studentNumber).toBe('20260101');

    // 未分班学生 + 英文模糊查询
    const resUnassigned = await fetch(`${baseUrl}/api/auth/student-lookup?name=Alice`);
    expect(resUnassigned.status).toBe(200);
    const bodyUnassigned = (await resUnassigned.json()) as {
      items: Array<{ name: string; studentNumber: string; classes: string[] }>;
    };
    expect(bodyUnassigned.items).toEqual([{ name: 'Alice Chen', studentNumber: '20260103', classes: [] }]);

    // 超过 10 条时截断并标记 truncated = true
    const resTruncated = await fetch(`${baseUrl}/api/auth/student-lookup?name=${encodeURIComponent('李测试')}`);
    expect(resTruncated.status).toBe(200);
    const bodyTruncated = (await resTruncated.json()) as { items: unknown[]; truncated: boolean; limit: number };
    expect(bodyTruncated.limit).toBe(10);
    expect(bodyTruncated.items).toHaveLength(10);
    expect(bodyTruncated.truncated).toBe(true);

    // 开关关闭后查询接口返回 403
    kernelContainer.db.prepare('UPDATE site_settings SET allow_public_student_lookup = 0 WHERE id = ?').run('global');
    const disabledRes = await fetch(`${baseUrl}/api/auth/student-lookup?name=${encodeURIComponent('张伟')}`);
    expect(disabledRes.status).toBe(403);
  });

  it('enforces IP rate limit on student-lookup endpoint', async () => {
    const limitedApp = express();
    const noopMiddleware: express.RequestHandler = (_req, _res, next) => next();
    const limitedCtx = {
      app: limitedApp,
      io: undefined,
      loginLimiter: noopMiddleware,
      studentLookupLimiter: createStudentLookupLimiter(2),
      aiLimiter: noopMiddleware,
    } as unknown as ServerContext;
    registerRosterRoutes(limitedCtx);
    const limitedServer = createServer(limitedApp);
    await new Promise<void>((resolve) => limitedServer.listen(0, resolve));
    const port = (limitedServer.address() as AddressInfo).port;
    try {
      const r1 = await fetch(`http://127.0.0.1:${port}/api/auth/student-lookup?name=Alice`);
      const r2 = await fetch(`http://127.0.0.1:${port}/api/auth/student-lookup?name=Alice`);
      const r3 = await fetch(`http://127.0.0.1:${port}/api/auth/student-lookup?name=Alice`);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(r3.status).toBe(429);
    } finally {
      await new Promise<void>((resolve) => limitedServer.close(() => resolve()));
    }
  });
});
