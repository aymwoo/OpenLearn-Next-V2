import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerRosterRoutes } from '../routes/roster.js';
import type { ServerContext } from '../context.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { hashPassword } from '../../packages/core/db/index.js';

describe('Onboarding tour persistence API (#530)', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const adminAId = 'usr-onboarding-admin-a';
  const adminBId = 'usr-onboarding-admin-b';
  const studentId = 'stu-onboarding-test';
  const studentToken = 'tok-onboarding-student';
  const ghostToken = 'tok-onboarding-ghost';

  beforeAll(async () => {
    const db = kernelContainer.db;
    const now = Date.now();
    const expiresAt = now + 60 * 60 * 1000;
    const pwdHash = hashPassword('Pass-2026-Strong');

    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, must_change_password, tour_status, created_at) VALUES (?, ?, ?, ?, ?, 0, NULL, ?)',
    ).run(adminAId, 'onboarding_admin_a', pwdHash, 'administrator', '管理员A', now);

    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, must_change_password, tour_status, created_at) VALUES (?, ?, ?, ?, ?, 0, NULL, ?)',
    ).run(adminBId, 'onboarding_admin_b', pwdHash, 'administrator', '管理员B', now);

    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      studentToken,
      JSON.stringify({ role: 'student', studentId, userId: studentId, name: '测试学生' }),
      now,
      expiresAt,
    );

    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      ghostToken,
      JSON.stringify({ role: 'teacher', userId: 'usr-does-not-exist', subRole: 'administrator', name: '幽灵用户' }),
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

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  beforeEach(() => {
    kernelContainer.db.prepare('UPDATE users SET tour_status = NULL WHERE id IN (?, ?)').run(adminAId, adminBId);
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    const db = kernelContainer.db;
    try {
      db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?)').run(studentToken, ghostToken);
      db.prepare(
        "DELETE FROM client_sessions WHERE json_valid(session_data) = 1 AND json_extract(session_data, '$.userId') IN (?, ?)",
      ).run(adminAId, adminBId);
      db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(adminAId, adminBId);
    } catch {}
  });

  async function loginAs(username: string): Promise<{ cookie: string; session: any }> {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entrance: 'teacher', username, password: 'Pass-2026-Strong' }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') || '';
    const tokenMatch = setCookie.match(/edu_os_token=[^;]+/);
    expect(tokenMatch).not.toBeNull();
    const data = (await res.json()) as { session: any };
    return { cookie: tokenMatch![0], session: data.session };
  }

  it('persists skipped/completed per user and survives refresh + re-login without affecting other accounts', async () => {
    const loginA1 = await loginAs('onboarding_admin_a');
    expect(loginA1.session.tourStatus).toBe('pending');

    // Admin A skips the tour
    const skipRes = await fetch(`${baseUrl}/api/auth/onboarding`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: loginA1.cookie },
      body: JSON.stringify({ status: 'skipped' }),
    });
    expect(skipRes.status).toBe(200);
    const skipBody = (await skipRes.json()) as { success: boolean; tourStatus: string };
    expect(skipBody).toEqual({ success: true, tourStatus: 'skipped' });

    // Page refresh (/api/auth/session & /api/auth/me) preserves 'skipped'
    const sessionRes = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: loginA1.cookie } });
    expect(sessionRes.status).toBe(200);
    const sessionJson = (await sessionRes.json()) as { session: { tourStatus?: string } };
    expect(sessionJson.session.tourStatus).toBe('skipped');

    const meRes = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: loginA1.cookie } });
    expect(meRes.status).toBe(200);
    const meJson = (await meRes.json()) as { session: { tourStatus?: string } };
    expect(meJson.session.tourStatus).toBe('skipped');

    // Re-login after logout/session reset still returns 'skipped'
    const loginA2 = await loginAs('onboarding_admin_a');
    expect(loginA2.session.tourStatus).toBe('skipped');

    // Account B in the same DB remains isolated ('pending')
    const loginB = await loginAs('onboarding_admin_b');
    expect(loginB.session.tourStatus).toBe('pending');

    // Updating to 'completed' works too
    const completeRes = await fetch(`${baseUrl}/api/auth/onboarding`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: loginA2.cookie },
      body: JSON.stringify({ status: 'completed' }),
    });
    expect(completeRes.status).toBe(200);
    const loginA3 = await loginAs('onboarding_admin_a');
    expect(loginA3.session.tourStatus).toBe('completed');
    const loginB2 = await loginAs('onboarding_admin_b');
    expect(loginB2.session.tourStatus).toBe('pending');
  });

  it('validates auth, status values, role, and missing user rows', async () => {
    // 401 when unauthenticated
    const unauthRes = await fetch(`${baseUrl}/api/auth/onboarding`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'skipped' }),
    });
    expect(unauthRes.status).toBe(401);

    // 400 on invalid status
    const { cookie } = await loginAs('onboarding_admin_a');
    const badStatusRes = await fetch(`${baseUrl}/api/auth/onboarding`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'later' }),
    });
    expect(badStatusRes.status).toBe(400);

    // 403 for student sessions
    const studentRes = await fetch(`${baseUrl}/api/auth/onboarding`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: `edu_os_token=${studentToken}` },
      body: JSON.stringify({ status: 'skipped' }),
    });
    expect(studentRes.status).toBe(403);

    // 404 when DB user row is missing instead of silently faking success
    const ghostRes = await fetch(`${baseUrl}/api/auth/onboarding`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: `edu_os_token=${ghostToken}` },
      body: JSON.stringify({ status: 'skipped' }),
    });
    expect(ghostRes.status).toBe(404);
  });
});
