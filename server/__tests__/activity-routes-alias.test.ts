import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { registerOsRoutes } from '../../server/routes/os.js';
import { registerLessonActivitiesRoutes } from '../../server/routes/lesson-activities.js';
import { ActivityRegistry } from '../../packages/activity-ecosystem/index.js';
import { ActivityRunService } from '../../server/services/activity-run-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import type { ServerContext } from '../../server/context.js';

/**
 * Phase 2.1-B：/api/activities 旧路径 307 alias 断言。
 * - provider 旧路径 → /api/activity-providers + /api/activity-runs
 * - 学案旧路径 → /api/lesson-activities
 * - 歧义路径两边都不存在 → 404 明确提示
 */
describe('/api/activities alias 307（Phase 2.1）', () => {
  let server: Server;
  let baseUrl: string;
  let cookie: Record<string, string>;

  const db = kernelContainer.db;

  beforeAll(async () => {
    const token = `tok_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const userId = `usr_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const now = Date.now();
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(token, JSON.stringify({ userId, role: 'teacher', username: 'alias-teacher' }), now, now + 60 * 60 * 1000);
    cookie = { Cookie: `edu_os_token=${token}` };

    const app = express();
    app.use(express.json());
    const activityRegistry = new ActivityRegistry();
    const ctx = {
      app,
      activityRegistry,
      aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
      runOpenAIAgentChat: async () => ({}),
    } as unknown as ServerContext;

    const runService = new ActivityRunService(activityRegistry);
    registerOsRoutes(ctx, runService);
    registerLessonActivitiesRoutes(ctx);
    app.all('/api/*', (_req, res) => res.status(404).json({ error: 'not found' }));

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET /api/activities → 307 /api/activity-providers（保留 query）', async () => {
    const res = await fetch(`${baseUrl}/api/activities?role=teacher`, { headers: cookie, redirect: 'manual' });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/api/activity-providers?role=teacher');
  });

  it('POST /api/activities/:id/start → 307 /api/activity-providers/:id/runs（method 保留）', async () => {
    const res = await fetch(`${baseUrl}/api/activities/act-1/start`, {
      method: 'POST',
      headers: { ...cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: {} }),
      redirect: 'manual',
    });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/api/activity-providers/act-1/runs');
  });

  it('PUT /api/activities/:id → 307 /api/lesson-activities/:id', async () => {
    const res = await fetch(`${baseUrl}/api/activities/la-1`, {
      method: 'PUT',
      headers: { ...cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
      redirect: 'manual',
    });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/api/lesson-activities/la-1');
  });

  it('歧义路径两边都不存在 → 404 且提示明确', async () => {
    const res = await fetch(`${baseUrl}/api/activities/does-not-exist`, {
      method: 'PATCH',
      headers: { ...cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      redirect: 'manual',
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('Not found as provider or lesson-activity');
  });
});
