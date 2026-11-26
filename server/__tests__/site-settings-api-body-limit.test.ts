/**
 * 全局请求体上限的管理后台配置链路（GET/PUT /api/site-settings）。
 *
 * 端到端断言的是真实装配：可配置解析器读取的是真实 SQLite 中的
 * `site_settings.api_body_limit_mb`，管理员保存后下一个请求即按新上限解析。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerPluginsRoutes } from '../routes/plugins.js';
import { mountConfigurableBodyParsers, resolveApiBodyLimitMb } from '../middleware/body-limits.js';
import { sendSafeError } from '../utils/error-handler.js';
import type { ServerContext } from '../context.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

const ADMIN_ID = 'usr-body-limit-admin';
const ADMIN_TOKEN = 'tok-body-limit-admin';
const cookie = { Cookie: `edu_os_token=${ADMIN_TOKEN}` };

let app: express.Express;
let server: Server;
let baseUrl = '';
let previousLimit: number | null | undefined;

function makeBody(totalBytes: number) {
  return { filler: 'x'.repeat(Math.max(0, totalBytes - 64)) };
}

function setStoredLimit(value: number | null) {
  kernelContainer.db.prepare('UPDATE site_settings SET api_body_limit_mb = ? WHERE id = ?').run(value, 'global');
}

describe('site settings: apiBodyLimitMb (#413)', () => {
  beforeAll(async () => {
    const db = kernelContainer.db;
    const now = Date.now();
    const expiresAt = now + 60 * 60 * 1000;

    // 确保 site_settings 有 global 行，并记录原始值以便恢复
    db.prepare("INSERT OR IGNORE INTO site_settings (id) VALUES ('global')").run();
    const existing = db.prepare('SELECT api_body_limit_mb FROM site_settings WHERE id = ?').get('global') as
      { api_body_limit_mb?: number | null } | undefined;
    previousLimit = existing?.api_body_limit_mb ?? null;

    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(ADMIN_ID, 'body_limit_admin', 'hash', 'administrator', '请求体上限测试管理员', now);
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      ADMIN_TOKEN,
      JSON.stringify({ userId: ADMIN_ID, role: 'administrator', username: 'body_limit_admin' }),
      now,
      expiresAt,
    );

    app = express();
    mountConfigurableBodyParsers(app, () => resolveApiBodyLimitMb(kernelContainer.db));
    const noopMiddleware: express.RequestHandler = (_req, _res, next) => next();
    const stubCtx = {
      app,
      io: { emit: () => {}, on: () => {}, to: () => ({ emit: () => {} }) } as unknown as ServerContext['io'],
      loginLimiter: noopMiddleware,
      studentLookupLimiter: noopMiddleware,
      aiLimiter: noopMiddleware,
    } as unknown as ServerContext;
    registerPluginsRoutes(stubCtx);
    app.post('/api/test/ordinary', (req, res) => {
      res.json({ ok: true, parsed: Boolean(req.body) });
    });
    app.use(((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      sendSafeError(res, err, 500);
    }) as express.ErrorRequestHandler);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    setStoredLimit(null);
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    const db = kernelContainer.db;
    try {
      setStoredLimit(previousLimit ?? null);
      db.prepare('DELETE FROM client_sessions WHERE id = ?').run(ADMIN_TOKEN);
      db.prepare('DELETE FROM users WHERE id = ?').run(ADMIN_ID);
    } catch {
      /* 清理失败不影响测试结论 */
    }
  });

  it('未配置时返回 null（服务端使用默认 2MB）', async () => {
    setStoredLimit(null);
    const res = await fetch(`${baseUrl}/api/site-settings`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { apiBodyLimitMb: number | null };
    expect(body.apiBodyLimitMb).toBeNull();
  });

  it('拒绝越界、非整数与非法类型', async () => {
    for (const bad of [0, 51, 2.5, 'abc']) {
      const res = await fetch(`${baseUrl}/api/site-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...cookie },
        body: JSON.stringify({ apiBodyLimitMb: bad }),
      });
      expect(res.status, `apiBodyLimitMb=${String(bad)} 应被拒绝`).toBe(400);
    }
  });

  it('保存后即时生效：普通端点按新上限放行，调回后重新收紧', async () => {
    // 调高到 6MB
    const putHigh = await fetch(`${baseUrl}/api/site-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...cookie },
      body: JSON.stringify({ apiBodyLimitMb: 6 }),
    });
    expect(putHigh.status).toBe(200);
    expect(((await putHigh.json()) as { apiBodyLimitMb: number }).apiBodyLimitMb).toBe(6);

    const getHigh = await fetch(`${baseUrl}/api/site-settings`);
    expect(((await getHigh.json()) as { apiBodyLimitMb: number }).apiBodyLimitMb).toBe(6);

    // 4MB 请求此前会被默认 2MB 拒绝，现在应通过
    const okRes = await fetch(`${baseUrl}/api/test/ordinary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeBody(4 * 1024 * 1024)),
    });
    expect(okRes.status).toBe(200);

    // 省略字段保存时保留已配置值
    const putOmit = await fetch(`${baseUrl}/api/site-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...cookie },
      body: JSON.stringify({ siteName: 'OpenLearn Next' }),
    });
    expect(putOmit.status).toBe(200);
    expect(((await putOmit.json()) as { apiBodyLimitMb: number }).apiBodyLimitMb).toBe(6);

    // 调回 2MB 后，同样的 4MB 请求重新被拒，且错误码可被前端识别
    const putLow = await fetch(`${baseUrl}/api/site-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...cookie },
      body: JSON.stringify({ apiBodyLimitMb: 2 }),
    });
    expect(putLow.status).toBe(200);

    const rejected = await fetch(`${baseUrl}/api/test/ordinary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeBody(4 * 1024 * 1024)),
    });
    expect(rejected.status).toBe(413);
    expect(((await rejected.json()) as { code?: string }).code).toBe('PAYLOAD_TOO_LARGE');
  });
});
