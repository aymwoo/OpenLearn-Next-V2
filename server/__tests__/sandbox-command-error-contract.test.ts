/**
 * @vitest-environment node
 *
 * `/api/plugins/:id/sandbox-command` 的错误响应契约（Issue IKWCBU）。
 *
 * 插件前端运行在不透明源 iframe 里，只能通过桥接层拿结果。此前错误分支只返回
 * `{ success:false, error }`，HTTP 状态码与业务错误码都丢失，前端只能显示
 * 「未知错误」。本测试钉住三条可区分的原因：
 * - 缺命令类型 → 400 + COMMAND_TYPE_REQUIRED
 * - 插件不存在 → 404 + PLUGIN_NOT_FOUND
 * - 命令无 handler → 404 + COMMAND_HANDLER_NOT_REGISTERED
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerPluginsRoutes } from '../routes/plugins.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('POST /api/plugins/:id/sandbox-command error contract', () => {
  let server: Server;
  let baseUrl: string;

  const userId = 'usr-sandbox-cmd';
  const token = 'tok-sandbox-cmd';
  const cookie = { Cookie: `edu_os_token=${token}` };
  const pluginPathId = encodeURIComponent('ext-sandbox-cmd');

  beforeAll(async () => {
    const now = Date.now();
    kernelContainer.db
      .prepare(
        'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(userId, 'sandbox_cmd_user', 'placeholder', 'teacher', '沙箱命令测试', now);
    kernelContainer.db
      .prepare('INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, JSON.stringify({ userId, role: 'teacher', username: 'sandbox_cmd_user' }), now, now + 60 * 60 * 1000);

    const app = express();
    app.use(express.json());
    registerPluginsRoutes({ app, io: { emit: () => {} } } as unknown as Parameters<typeof registerPluginsRoutes>[0]);

    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, '127.0.0.1', () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const post = (body: unknown) =>
    fetch(`${baseUrl}/api/plugins/${pluginPathId}/sandbox-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie },
      body: JSON.stringify(body),
    });

  it('缺 type → 400 + COMMAND_TYPE_REQUIRED', async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      code: 'COMMAND_TYPE_REQUIRED',
    });
  });

  it('插件不存在 → 404 + PLUGIN_NOT_FOUND', async () => {
    const res = await post({ type: 'ext-sandbox-cmd.anything' });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      code: 'PLUGIN_NOT_FOUND',
    });
  });

  it('命令无 handler → 404 + COMMAND_HANDLER_NOT_REGISTERED', async () => {
    vi.spyOn(kernelContainer.pluginHost, 'resolvePluginUuid').mockReturnValue('plugin-uuid');
    vi.spyOn(kernelContainer.pluginHost, 'getPluginManifest').mockReturnValue({ id: 'ext-sandbox-cmd' } as never);

    const res = await post({ type: 'ext-sandbox-cmd.not_registered' });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      code: 'COMMAND_HANDLER_NOT_REGISTERED',
      error: expect.stringContaining('No handler registered'),
    });
  });
});
