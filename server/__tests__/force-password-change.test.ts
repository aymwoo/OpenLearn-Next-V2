import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import bcrypt from 'bcryptjs';
import { registerRosterRoutes } from '../routes/roster.js';
import { enforcePasswordChanged } from '../middleware/auth.js';
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
});
