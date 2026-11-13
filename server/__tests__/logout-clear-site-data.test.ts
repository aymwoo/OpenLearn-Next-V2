import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerRosterRoutes } from '../routes/roster.js';
import { registerPluginsRoutes } from '../routes/plugins.js';
import type { ServerContext } from '../context.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('POST /api/auth/logout Clear-Site-Data configuration (#487)', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const adminId = 'usr-logout-csd-admin';
  const adminToken = 'tok-logout-csd-admin';
  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

  let prevSetting: number | undefined;

  beforeAll(async () => {
    const db = kernelContainer.db;
    const now = Date.now();
    const expiresAt = now + 60 * 60 * 1000;

    const existing = db.prepare('SELECT logout_clear_site_data FROM site_settings WHERE id = ?').get('global') as
      { logout_clear_site_data?: number } | undefined;
    prevSetting = existing?.logout_clear_site_data ?? 0;

    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(adminId, 'logout_csd_admin', 'hash', 'administrator', '超管测试', now);

    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      adminToken,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'logout_csd_admin' }),
      now,
      expiresAt,
    );

    app = express();
    app.use(express.json());
    const noopMiddleware: express.RequestHandler = (_req, _res, next) => next();
    const stubCtx = {
      app,
      io: { emit: () => {}, on: () => {}, to: () => ({ emit: () => {} }) } as unknown as ServerContext['io'],
      loginLimiter: noopMiddleware,
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
    kernelContainer.db.prepare('UPDATE site_settings SET logout_clear_site_data = 0 WHERE id = ?').run('global');
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    const db = kernelContainer.db;
    try {
      db.prepare('UPDATE site_settings SET logout_clear_site_data = ? WHERE id = ?').run(prevSetting ?? 0, 'global');
      db.prepare('DELETE FROM client_sessions WHERE id = ?').run(adminToken);
      db.prepare('DELETE FROM users WHERE id = ?').run(adminId);
    } catch {}
  });

  it('defaults to false and omits Clear-Site-Data header on logout', async () => {
    const settingsRes = await fetch(`${baseUrl}/api/site-settings`);
    expect(settingsRes.status).toBe(200);
    const settings = (await settingsRes.json()) as { logoutClearSiteData?: boolean };
    expect(settings.logoutClearSiteData).toBe(false);

    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' });
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.headers.get('clear-site-data')).toBeNull();
  });

  it('rejects non-boolean logoutClearSiteData values with HTTP 400', async () => {
    const res = await fetch(`${baseUrl}/api/site-settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...cookie(adminToken),
      },
      body: JSON.stringify({
        siteName: 'OpenLearn Next',
        logoutClearSiteData: 'invalid-string',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('enables and disables Clear-Site-Data header on POST /api/auth/logout via PUT /api/site-settings', async () => {
    const enableRes = await fetch(`${baseUrl}/api/site-settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...cookie(adminToken),
      },
      body: JSON.stringify({
        siteName: 'OpenLearn Next',
        logoutClearSiteData: true,
      }),
    });
    expect(enableRes.status).toBe(200);
    const enabledBody = (await enableRes.json()) as { success: boolean; siteInfo: { logoutClearSiteData?: boolean } };
    expect(enabledBody.success).toBe(true);
    expect(enabledBody.siteInfo.logoutClearSiteData).toBe(true);

    const logoutEnabledRes = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' });
    expect(logoutEnabledRes.status).toBe(200);
    expect(logoutEnabledRes.headers.get('clear-site-data')).toBe('"cookies", "storage", "cache"');

    const disableRes = await fetch(`${baseUrl}/api/site-settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...cookie(adminToken),
      },
      body: JSON.stringify({
        siteName: 'OpenLearn Next',
        logoutClearSiteData: false,
      }),
    });
    expect(disableRes.status).toBe(200);

    const logoutDisabledRes = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' });
    expect(logoutDisabledRes.status).toBe(200);
    expect(logoutDisabledRes.headers.get('clear-site-data')).toBeNull();
  });
});
