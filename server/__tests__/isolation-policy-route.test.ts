import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerPluginsRoutes } from '../routes/plugins.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

/**
 * `GET /api/plugins/isolation-policy` —— 安装向导询问「这个 manifest.id 允许
 * 以什么隔离档运行」。
 *
 * 这个端点决定向导是否要展示主进程 / Worker 选项，所以两条性质必须钉住：
 * 1. 只对管理员开放（返回值会暴露部署信任名单内幕）；
 * 2. 结论必须来自 `resolvePluginExecutionMode`，未受信插件说谎也拿不到 inline。
 *
 * 注意 `isTrustedInProcessPlugin` 在 Vitest 下有 `env.VITEST` 逃生口（夹具大量
 * 用非内置 id 走 inline）。要测真实策略，必须显式
 * `OPENLEARN_ENFORCE_PLUGIN_ISOLATION=1`。
 */
describe('GET /api/plugins/isolation-policy', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const adminId = 'usr-iso-admin';
  const teacherId = 'usr-iso-teacher';
  const adminToken = 'tok-iso-admin';
  const teacherToken = 'tok-iso-teacher';
  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

  const TRUSTED_ID = 'openlearn-plugin-trusted-demo';
  const UNTRUSTED_ID = 'ext-community-demo';

  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = ['VITEST', 'OPENLEARN_ENFORCE_PLUGIN_ISOLATION', 'OPENLEARN_TRUSTED_INLINE_PLUGINS'] as const;

  beforeAll(async () => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    // 关闭 Vitest 逃生口，并只放行一个 id
    process.env.VITEST = '1';
    process.env.OPENLEARN_ENFORCE_PLUGIN_ISOLATION = '1';
    process.env.OPENLEARN_TRUSTED_INLINE_PLUGINS = TRUSTED_ID;

    const now = Date.now();
    const insertUser = kernelContainer.db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertUser.run(adminId, 'iso_admin', 'placeholder', 'administrator', '隔离管理员', now);
    insertUser.run(teacherId, 'iso_teacher', 'placeholder', 'teacher', '隔离教师', now);

    const insertSession = kernelContainer.db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    const expiresAt = now + 60 * 60 * 1000;
    insertSession.run(
      adminToken,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'iso_admin' }),
      now,
      expiresAt,
    );
    insertSession.run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'iso_teacher' }),
      now,
      expiresAt,
    );

    app = express();
    app.use(express.json());
    registerPluginsRoutes({ app, io: { emit: () => {} } } as any);

    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, '127.0.0.1', () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const get = (query: string, headers: Record<string, string> = {}) =>
    fetch(`${baseUrl}/api/plugins/isolation-policy${query}`, { headers });

  it('匿名请求被拒（不是 200）', async () => {
    const res = await get(`?manifestId=${UNTRUSTED_ID}`);
    expect(res.status).not.toBe(200);
  });

  it('非管理员被拒（不泄漏信任名单）', async () => {
    const res = await get(`?manifestId=${TRUSTED_ID}`, cookie(teacherToken) as Record<string, string>);
    expect(res.status).not.toBe(200);
  });

  it('缺 manifestId 返回 400', async () => {
    const res = await get('', cookie(adminToken) as Record<string, string>);
    expect(res.status).toBe(400);
    expect((await res.json()).success).toBe(false);
  });

  it('未受信 id：trusted=false，请求 inline 也被改写为 process', async () => {
    const res = await get(
      `?manifestId=${UNTRUSTED_ID}&requestedMode=inline`,
      cookie(adminToken) as Record<string, string>,
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({
      success: true,
      manifestId: UNTRUSTED_ID,
      trusted: false,
      resolvedMode: 'process',
      coerced: true,
    });
  });

  it('白名单 id：trusted=true，可保留 inline', async () => {
    const res = await get(
      `?manifestId=${TRUSTED_ID}&requestedMode=inline`,
      cookie(adminToken) as Record<string, string>,
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({
      success: true,
      trusted: true,
      requestedMode: 'inline',
      resolvedMode: 'inline',
      coerced: false,
    });
  });
});
