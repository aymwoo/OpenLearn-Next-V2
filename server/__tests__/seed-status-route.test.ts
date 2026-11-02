/**
 * `GET /api/auth/seed-status` —— 登录页「首次安装用默认口令」提示的数据源。
 *
 * ## 为什么需要这个端点
 *
 * 初始口令改成「口令 = 用户名」后，用户仍然要**知道**这件事。写在文档里没用
 * （装完就进浏览器了），所以要显示在登录页。但如果无条件显示，等于对公网永久
 * 广播 admin/admin；因此前端每次加载登录页都问一次服务端：默认口令还在生效吗？
 *
 * 端点只回答「种子账号是否仍是默认口令」，不回答口令是什么；改密后 active 立刻转 false。
 *
 * ## 为什么断言这么细
 *
 * 匿名可访问的端点，任何多余字段都是信息泄露面。这里同时钉住：
 * ① 判定基于真实 bcrypt 校验而不是 `must_change_password` 标记；
 * ② 响应体只有 active / accounts 两个字段；
 * ③ 缓存可被改密路径主动失效（否则提示会多留 15 秒）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import bcrypt from 'bcryptjs';
import { registerRosterRoutes, invalidateSeedStatusCache } from '../routes/roster.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('/api/auth/seed-status', () => {
  let server: Server;
  let baseUrl: string;

  const db = kernelContainer.db as any;

  const setHash = (username: string, password: string) => {
    db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(bcrypt.hashSync(password, 10), username);
    invalidateSeedStatusCache();
  };

  // connection: close —— 与其它 server 测试并行跑时，undici 复用的 keep-alive 连接
  // 可能已被服务端关掉，表现为随机 ECONNRESET。每次新建连接即可稳定。
  const getStatus = () => fetch(`${baseUrl}/api/auth/seed-status`, { headers: { connection: 'close' } });

  const readStatus = async (): Promise<{ active: boolean; accounts: string[] }> => {
    const res = await getStatus();
    expect(res.status).toBe(200);
    return (await res.json()) as { active: boolean; accounts: string[] };
  };

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    const noopLimiter = (_req: any, _res: any, next: any) => next();
    registerRosterRoutes({ app, io: undefined, loginLimiter: noopLimiter } as any);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    // 复原种子行，避免同 worker 内复用库的其他用例读到被改过的口令
    setHash('admin', 'Vitest-admin-NotDefault9');
    setHash('teacher', 'Vitest-teacher-NotDefault9');
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('种子账号用默认口令（口令 = 用户名）时 active 为真', async () => {
    setHash('admin', 'admin');
    setHash('teacher', 'teacher');
    const status = await readStatus();
    expect(status.active).toBe(true);
    expect(status.accounts).toEqual(expect.arrayContaining(['admin', 'teacher']));
  });

  it('只改掉 admin 后提示仍为真（教师入口还开着，提示不能提前消失）', async () => {
    setHash('admin', 'Strong-Admin-Pass9');
    const status = await readStatus();
    expect(status.active).toBe(true);
    expect(status.accounts).toEqual(['teacher']);
  });

  it('全部改掉后 active 立刻转假 —— 提示不会对公网永久广播默认口令', async () => {
    setHash('admin', 'Strong-Admin-Pass9');
    setHash('teacher', 'Strong-Teacher-Pass9');
    const status = await readStatus();
    expect(status).toEqual({ active: false, accounts: [] });
  });

  it('响应体只含 active / accounts，不泄露口令或改密标记', async () => {
    setHash('admin', 'admin');
    const res = await getStatus();
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['accounts', 'active']);
    expect(JSON.stringify(body)).not.toContain('password');
  });
});
