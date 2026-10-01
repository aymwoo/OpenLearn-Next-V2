import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { Server as SocketServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import bcrypt from 'bcryptjs';
import { registerRosterRoutes } from '../routes/roster.js';
import { enforcePasswordChanged, socketAuthMiddleware } from '../middleware/auth.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

/**
 * SEC-AUTH-06: 默认密码强制改密。
 *
 * 种子账号 admin/admin、teacher/teacher 的特征是「密码 = 用户名」。登录成功即打
 * `mustChangePassword` 标记（存 session_data）：登录响应与 /api/auth/session 均可见，
 * 前端渲染全屏改密门；服务端 enforcePasswordChanged 对非 GET 的 API（除豁免路径）
 * 兜底拦截，防止绕过前端直接调写接口。改密成功后当前会话标记清除、其余会话删除。
 */

describe('SEC-AUTH-06: 默认密码强制改密', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const defaultUserId = 'usr-force-default';
  const defaultUsername = 'force_default_admin'; // 密码将等于用户名（模拟种子特征）
  const normalUserId = 'usr-force-normal';
  const normalUsername = 'force_normal_teacher';
  const normalPwd = 'S3curePass!42';

  const post = (path: string, token?: string, body?: Record<string, unknown>) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: `edu_os_token=${token}` } : {}) },
      body: JSON.stringify(body ?? {}),
    });

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    // 模拟 server.ts 的接线：改密门在所有业务路由之前
    app.use(enforcePasswordChanged);
    registerRosterRoutes({ app, io: undefined, loginLimiter: (_req: any, _res: any, next: () => void) => next() } as any);
    // 受保护写操作的样本路由
    app.post('/api/lessons', (_req, res) => res.json({ ok: true }));
    app.get('/api/lessons', (_req, res) => res.json({ ok: true }));

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const now = Date.now();
    kernelContainer.db
      .prepare('DELETE FROM users WHERE id IN (?, ?)')
      .run(defaultUserId, normalUserId);
    // 默认密码特征：password_hash = bcrypt(username)
    kernelContainer.db
      .prepare('INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(defaultUserId, defaultUsername, bcrypt.hashSync(defaultUsername, 10), 'administrator', '默认密码管理员', now);
    kernelContainer.db
      .prepare('INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(normalUserId, normalUsername, bcrypt.hashSync(normalPwd, 10), 'teacher', '正常教师', now);
  });

  afterAll(async () => {
    kernelContainer.db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(defaultUserId, normalUserId);
    kernelContainer.db
      .prepare('DELETE FROM client_sessions WHERE session_data LIKE ? OR session_data LIKE ?')
      .run(`%${defaultUserId}%`, `%${normalUserId}%`);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('密码 = 用户名登录 → 会话与响应带 mustChangePassword 标记', async () => {
    const res = await post('/api/auth/login', undefined, { entrance: 'teacher', username: defaultUsername, password: defaultUsername });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.session?.mustChangePassword).toBe(true);
  });

  it('带标记会话的写操作被 403 拦截，GET 放行', async () => {
    const login = await post('/api/auth/login', undefined, { entrance: 'teacher', username: defaultUsername, password: defaultUsername });
    const rawCookie = login.headers.get('set-cookie') || '';
    const token = rawCookie.split(';')[0].split('=')[1];

    const postRes = await post('/api/lessons', token);
    expect(postRes.status).toBe(403);
    const body: any = await postRes.json();
    expect(body.code).toBe('FORBIDDEN_DEFAULT_PASSWORD');

    const getRes = await fetch(`${baseUrl}/api/lessons`, { headers: { Cookie: `edu_os_token=${token}` } });
    expect(getRes.status).toBe(200);

    // 非默认密码账号不受影响
    const normalLogin = await post('/api/auth/login', undefined, { entrance: 'teacher', username: normalUsername, password: normalPwd });
    const normalBody: any = await normalLogin.json();
    expect(normalBody.session?.mustChangePassword).toBeUndefined();
  });

  it('/api/auth/session 暴露标记，供页面刷新后继续强制改密', async () => {
    const login = await post('/api/auth/login', undefined, { entrance: 'teacher', username: defaultUsername, password: defaultUsername });
    const token = (login.headers.get('set-cookie') || '').split(';')[0].split('=')[1];

    const res = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: `edu_os_token=${token}` } });
    const body: any = await res.json();
    expect(body.session?.mustChangePassword).toBe(true);
  });

  it('改密成功 → 当前会话标记清除，写操作恢复', async () => {
    const login = await post('/api/auth/login', undefined, { entrance: 'teacher', username: defaultUsername, password: defaultUsername });
    const token = (login.headers.get('set-cookie') || '').split(';')[0].split('=')[1];

    const changeRes = await post('/api/auth/change-password', token, {
      oldPassword: defaultUsername,
      newPassword: 'BrandNew-Pw9',
    });
    expect(changeRes.status).toBe(200);

    // 标记已清除：写操作放行
    const postRes = await post('/api/lessons', token);
    expect(postRes.status).toBe(200);

    // /api/auth/session 不再带标记
    const sessionRes = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: `edu_os_token=${token}` } });
    const sessionBody: any = await sessionRes.json();
    expect(sessionBody.session?.mustChangePassword).toBe(false);
  });

  it('SEC-AUTH-06b: 建学生未提供密码 → 随机初始密码一次性返回，123456 失效', async () => {
    const login = await post('/api/auth/login', undefined, { entrance: 'teacher', username: normalUsername, password: normalPwd });
    const teacherToken = (login.headers.get('set-cookie') || '').split(';')[0].split('=')[1];

    const createRes = await post('/api/students', teacherToken, { name: '随机口令学生', email: '' });
    expect(createRes.status).toBe(200);
    const created: any = await createRes.json();
    expect(created.initial_password).toMatch(/^[a-zA-Z0-9]{12}$/);

    // 123456 不再能登录该学生
    const legacyLogin = await post('/api/auth/login', undefined, {
      entrance: 'student',
      studentId: created.student_number,
      password: '123456',
    });
    expect(legacyLogin.status).toBe(401);

    // 随机初始密码可登录，且不打标（非默认口令）
    const okLogin = await post('/api/auth/login', undefined, {
      entrance: 'student',
      studentId: created.student_number,
      password: created.initial_password,
    });
    expect(okLogin.status).toBe(200);
    const okBody: any = await okLogin.json();
    expect(okBody.session?.mustChangePassword).toBeUndefined();

    kernelContainer.db.prepare('DELETE FROM students WHERE id = ?').run(created.id);
    kernelContainer.db.prepare('DELETE FROM client_sessions WHERE session_data LIKE ?').run(`%${created.id}%`);
  });

  it('SEC-AUTH-06b: 存量 123456 学生个人密码登录打标；班级口令登录不打标；改密后恢复', async () => {
    const now = Date.now();
    const sid = 'stu-force-legacy';
    const classId = 'cls-force-legacy';
    kernelContainer.db.prepare('DELETE FROM students WHERE id = ?').run(sid);
    kernelContainer.db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    kernelContainer.db
      .prepare('INSERT INTO students (id, student_number, name, email, password, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sid, 'STU-FORCE-1', '存量学生', '', bcrypt.hashSync('123456', 10), now);
    kernelContainer.db
      .prepare('INSERT INTO classes (id, name, class_passcode, class_passcode_expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(classId, '口令班', 'passcode-xyz', now + 3600000, now);
    kernelContainer.db.prepare('INSERT INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(classId, sid, now);

    // 个人密码 123456 登录 → 打标
    const login = await post('/api/auth/login', undefined, { entrance: 'student', studentId: 'STU-FORCE-1', password: '123456' });
    expect(login.status).toBe(200);
    const body: any = await login.json();
    expect(body.session?.mustChangePassword).toBe(true);
    const token = (login.headers.get('set-cookie') || '').split(';')[0].split('=')[1];

    // 写操作被兜底中间件拦截
    const blocked = await post('/api/lessons', token);
    expect(blocked.status).toBe(403);

    // 班级口令登录不打标（与个人密码无关）
    const passcodeLogin = await post('/api/auth/login', undefined, { entrance: 'student', studentId: 'STU-FORCE-1', password: 'passcode-xyz' });
    expect(passcodeLogin.status).toBe(200);
    const passcodeBody: any = await passcodeLogin.json();
    expect(passcodeBody.session?.mustChangePassword).toBeUndefined();

    // 改密 → 清标，写操作恢复
    const change = await post('/api/auth/change-password', token, { oldPassword: '123456', newPassword: 'MyNew-Pw123' });
    expect(change.status).toBe(200);
    const afterPost = await post('/api/lessons', token);
    expect(afterPost.status).toBe(200);

    kernelContainer.db.prepare('DELETE FROM students WHERE id = ?').run(sid);
    kernelContainer.db.prepare('DELETE FROM class_students WHERE student_id = ?').run(sid);
    kernelContainer.db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    kernelContainer.db.prepare('DELETE FROM client_sessions WHERE session_data LIKE ?').run(`%${sid}%`);
  });
});

describe('SEC-AUTH-06: Socket 层 mustChangePassword 握手全拒', () => {
  let app: express.Express;
  let server: Server;
  let io: SocketServer;
  let baseUrl: string;

  const defaultUserId = 'usr-force-default';
  const defaultUsername = 'force_default_admin';
  const normalUserId = 'usr-force-normal';
  const normalUsername = 'force_normal_teacher';
  const normalPwd = 'S3curePass!42';

  const post = (path: string, token?: string, body?: Record<string, unknown>) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: `edu_os_token=${token}` } : {}) },
      body: JSON.stringify(body ?? {}),
    });

  const tryConnect = (token?: string): Promise<{ error?: string }> =>
    new Promise((resolve) => {
      const client = ioClient(baseUrl, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
        timeout: 3000,
        ...(token ? { extraHeaders: { Cookie: `edu_os_token=${token}` } } : {}),
      });
      const finish = (result: { error?: string }) => {
        client.close();
        resolve(result);
      };
      client.on('connect', () => finish({}));
      client.on('connect_error', (err: Error) => finish({ error: err.message }));
    });

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    registerRosterRoutes({ app, io: undefined, loginLimiter: (_req: any, _res: any, next: () => void) => next() } as any);
    server = createServer(app);
    io = new SocketServer(server, { cors: { origin: '*' } });
    io.use(socketAuthMiddleware);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const now = Date.now();
    kernelContainer.db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(defaultUserId, normalUserId);
    kernelContainer.db
      .prepare('INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(defaultUserId, defaultUsername, bcrypt.hashSync(defaultUsername, 10), 'administrator', '默认密码管理员', now);
    kernelContainer.db
      .prepare('INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(normalUserId, normalUsername, bcrypt.hashSync(normalPwd, 10), 'teacher', '正常教师', now);
  });

  afterAll(async () => {
    io.close();
    kernelContainer.db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(defaultUserId, normalUserId);
    kernelContainer.db
      .prepare('DELETE FROM client_sessions WHERE session_data LIKE ? OR session_data LIKE ?')
      .run(`%${defaultUserId}%`, `%${normalUserId}%`);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('带 mustChangePassword 标记的会话握手被拒（FORBIDDEN_DEFAULT_PASSWORD）', async () => {
    const login = await post('/api/auth/login', undefined, { entrance: 'teacher', username: defaultUsername, password: defaultUsername });
    expect(login.status).toBe(200);
    const token = (login.headers.get('set-cookie') || '').split(';')[0].split('=')[1];

    const result = await tryConnect(token);
    expect(result.error).toBe('FORBIDDEN_DEFAULT_PASSWORD');
  });

  it('正常密码会话连接成功；无 token + test 环境放行不受影响', async () => {
    const login = await post('/api/auth/login', undefined, { entrance: 'teacher', username: normalUsername, password: normalPwd });
    const normalToken = (login.headers.get('set-cookie') || '').split(';')[0].split('=')[1];
    expect((await tryConnect(normalToken)).error).toBeUndefined();

    // NODE_ENV=test 无 token 放行（存量 mock 用例依赖此口径）
    expect((await tryConnect()).error).toBeUndefined();
  });

  it('改密后同一会话可正常建立 socket 连接', async () => {
    const login = await post('/api/auth/login', undefined, { entrance: 'teacher', username: defaultUsername, password: defaultUsername });
    const token = (login.headers.get('set-cookie') || '').split(';')[0].split('=')[1];
    expect((await tryConnect(token)).error).toBe('FORBIDDEN_DEFAULT_PASSWORD');

    const change = await post('/api/auth/change-password', token, { oldPassword: defaultUsername, newPassword: 'BrandNew-Pw9' });
    expect(change.status).toBe(200);
    expect((await tryConnect(token)).error).toBeUndefined();
  });
});
