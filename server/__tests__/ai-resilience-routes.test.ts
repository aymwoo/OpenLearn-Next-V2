import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { registerPluginsRoutes } from '../routes/plugins.js';
import { registerGradingRoutes } from '../routes/grading.js';
import type { ServerContext } from '../context.js';

describe('B5: AI 出站接口超时熔断与韧性加固', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;
  const originalFetch = globalThis.fetch;

  const adminToken = 'tok-ai-resilience-admin';
  const adminId = 'usr-ai-resilience-admin';
  const cookie = { Cookie: `edu_os_token=${adminToken}` };

  beforeAll(async () => {
    const db = kernelContainer.db;
    const now = Date.now();

    // 插入测试用户与 Session
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(adminId, 'ai_admin', 'hash', 'administrator', 'AI测试管理员', now);

    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      adminToken,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'ai_admin' }),
      now,
      now + 3600000,
    );

    app = express();
    app.use(express.json());

    const ctx: any = {
      app,
      io: { to: () => ({ emit: vi.fn() }), emit: vi.fn() },
    };

    registerPluginsRoutes(ctx);
    registerGradingRoutes(ctx);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('/api/ai-providers/test 遇到超时时返回 504 网关超时提示', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: any, init?: any) => {
      const urlStr = String(input?.url || input);
      // 本地请求透传
      if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
        return originalFetch(input, init);
      }
      // 模拟外部 AI 出站请求超时触发 AbortError
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });

    const res = await originalFetch(`${baseUrl}/api/ai-providers/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...cookie,
      },
      body: JSON.stringify({
        api_url: 'https://api.openai.com/v1',
        api_key: 'sk-test',
        model_name: 'gpt-4o',
      }),
    });

    expect(res.status).toBe(504);
    const body: any = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('timed out');
  });

  it('/api/ai-providers/test 正常响应时返回 200 成功', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: any, init?: any) => {
      const urlStr = String(input?.url || input);
      if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
        return originalFetch(input, init);
      }
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: 'connected' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    const res = await originalFetch(`${baseUrl}/api/ai-providers/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...cookie,
      },
      body: JSON.stringify({
        api_url: 'https://api.openai.com/v1',
        api_key: 'sk-test',
        model_name: 'gpt-4o',
      }),
    });

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
  });
});
