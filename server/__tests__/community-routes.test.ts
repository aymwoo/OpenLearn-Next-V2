import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerPluginsRoutes } from '../routes/plugins.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { COMMUNITY_REGISTRY_ENV } from '../services/community-registry.js';

/**
 * 社区市场路由的鉴权与入参门禁契约。
 *
 * 这里刻意只覆盖「不需要出站请求」的路径：登录态、角色、URL 安全拦截与参数校验。
 * 下载与安装逻辑由 community-registry.test.ts 以注入 fetch 的方式覆盖。
 */
describe('community plugin registry routes', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;
  let savedRegistryEnv: string | undefined;

  const adminId = 'usr-community-admin';
  const teacherId = 'usr-community-teacher';
  const adminToken = 'tok-community-admin';
  const teacherToken = 'tok-community-teacher';
  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

  beforeAll(async () => {
    savedRegistryEnv = process.env[COMMUNITY_REGISTRY_ENV];
    delete process.env[COMMUNITY_REGISTRY_ENV];

    const now = Date.now();
    const insertUser = kernelContainer.db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertUser.run(adminId, 'community_admin', 'placeholder', 'administrator', '社区管理员', now);
    insertUser.run(teacherId, 'community_teacher', 'placeholder', 'teacher', '社区教师', now);

    const insertSession = kernelContainer.db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    const expiresAt = now + 60 * 60 * 1000;
    insertSession.run(
      adminToken,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'community_admin' }),
      now,
      expiresAt,
    );
    insertSession.run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'community_teacher' }),
      now,
      expiresAt,
    );

    app = express();
    app.use(express.json());
    registerPluginsRoutes({ app, io: { emit: () => {} } } as any);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (savedRegistryEnv === undefined) {
      delete process.env[COMMUNITY_REGISTRY_ENV];
    } else {
      process.env[COMMUNITY_REGISTRY_ENV] = savedRegistryEnv;
    }
    kernelContainer.db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?)').run(adminToken, teacherToken);
    kernelContainer.db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(adminId, teacherId);
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  describe('GET /api/plugins/community', () => {
    it('rejects an anonymous caller', async () => {
      const res = await fetch(`${baseUrl}/api/plugins/community`);
      expect(res.status).toBe(401);
    });

    it('is reachable by a teacher and is not swallowed by the /:id(*) catch-all', async () => {
      const res = await fetch(`${baseUrl}/api/plugins/community`, { headers: cookie(teacherToken) });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        success: boolean;
        configured: boolean;
        plugins: unknown[];
        envVar: string;
      };
      expect(body.success).toBe(true);
      expect(body.envVar).toBe(COMMUNITY_REGISTRY_ENV);
      // 未配置注册表地址：明确返回 configured=false 而不是报错
      expect(body.configured).toBe(false);
      expect(body.plugins).toEqual([]);
    });
  });

  describe('POST /api/plugins/install-from-url', () => {
    const post = (token: string | null, payload: unknown) =>
      fetch(`${baseUrl}/api/plugins/install-from-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? cookie(token) : {}) },
        body: JSON.stringify(payload),
      });

    it('rejects an anonymous caller', async () => {
      const res = await post(null, { downloadUrl: 'https://plugins.example.com/a.zip' });
      expect(res.status).toBe(401);
    });

    it('is administrator-only — a teacher cannot install remote code', async () => {
      const res = await post(teacherToken, { downloadUrl: 'https://plugins.example.com/a.zip' });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/Required: administrator/);
    });

    it('requires a downloadUrl', async () => {
      const res = await post(adminToken, {});
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('缺少 downloadUrl');
    });

    it('rejects an illegal expectedId', async () => {
      const res = await post(adminToken, {
        downloadUrl: 'https://plugins.example.com/a.zip',
        expectedId: 'ext home; rm -rf /',
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/expectedId/);
    });

    it.each([
      ['a loopback address', 'http://127.0.0.1/plugin.zip'],
      ['a cloud metadata endpoint', 'http://169.254.169.254/latest/meta-data/'],
      ['a private network address', 'http://192.168.1.10/plugin.zip'],
      ['a non-HTTP protocol', 'file:///etc/passwd'],
    ])('blocks %s before any download', async (_label, downloadUrl) => {
      const res = await post(adminToken, { downloadUrl });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/安全拦截: 非法下载地址/);
    });
  });
});
