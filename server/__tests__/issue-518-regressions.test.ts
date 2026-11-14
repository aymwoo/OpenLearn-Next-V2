import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import fs from 'fs';
import path from 'path';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerClassroomRoutes } from '../routes/classroom.js';
import { injectLmsSdk } from '../routes/shared.js';
import { ClassroomRuntimeService } from '../services/classroom-runtime-service.js';
import { buildHostHelmetOptions } from '../security/host-helmet.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ensureTestSchema } from './helpers/test-schema.js';

describe('Issue #518 server & static asset regressions', () => {
  let server: Server;
  let baseUrl: string;
  const db = kernelContainer.db as any;

  const ownerTeacherId = 'usr-518-owner';
  const ownerToken = 'tok-518-owner';
  const otherTeacherId = 'usr-518-other';
  const otherToken = 'tok-518-other';
  const classId = 'cls-518-a';
  const unstartedLessonId = 'les-518-unstarted';

  const call = (pathStr: string, token: string) =>
    fetch(`${baseUrl}${pathStr}`, {
      headers: { Cookie: `edu_os_token=${token}` },
    });

  beforeAll(async () => {
    ensureTestSchema();

    const app = express();
    app.use(helmet(buildHostHelmetOptions({ NODE_ENV: 'production' }, true)));
    app.use(express.static(path.resolve(process.cwd(), 'public')));
    app.use(express.json());
    registerClassroomRoutes({ app, io: undefined } as any, new ClassroomRuntimeService(db));

    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const now = Date.now();
    for (const teacher of [
      { id: ownerTeacherId, username: 't518_owner', token: ownerToken },
      { id: otherTeacherId, username: 't518_other', token: otherToken },
    ]) {
      db.prepare(
        'INSERT OR REPLACE INTO users (id, username, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(teacher.id, teacher.username, teacher.username, 'hash', 'teacher', now);
      db.prepare(
        'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
      ).run(
        teacher.token,
        JSON.stringify({ userId: teacher.id, role: 'teacher', username: teacher.username, name: teacher.username }),
        now,
        now + 86400000,
      );
    }

    db.prepare('INSERT OR REPLACE INTO classes (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)').run(
      classId,
      '518 Test Class',
      ownerTeacherId,
      now,
    );
    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(unstartedLessonId, 'Unstarted Lesson 518', ownerTeacherId, now, now);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects unauthorized teacher on GET /api/classroom/sessions/:lessonId even before session creation', async () => {
    const unauthorizedRes = await call(`/api/classroom/sessions/${unstartedLessonId}`, otherToken);
    expect(unauthorizedRes.status).toBe(403);

    const ownerRes = await call(`/api/classroom/sessions/${unstartedLessonId}`, ownerToken);
    expect(ownerRes.status).toBe(200);
    const body = await ownerRes.json();
    expect(body.hasActiveSession).toBe(false);
  });

  it('enforces 403 for unauthorized teacher and 200 for owner on rollcall-counts and top-performers', async () => {
    expect((await call(`/api/lessons/${unstartedLessonId}/rollcall-counts`, otherToken)).status).toBe(403);
    expect((await call(`/api/lessons/${unstartedLessonId}/rollcall-counts`, ownerToken)).status).toBe(200);

    expect(
      (await call(`/api/classroom/sessions/${unstartedLessonId}/top-performers?limit=50`, otherToken)).status,
    ).toBe(403);
    expect(
      (await call(`/api/classroom/sessions/${unstartedLessonId}/top-performers?limit=50`, ownerToken)).status,
    ).toBe(200);
  });

  it('serves /favicon.ico and strict non-wildcard CSP without upgrade-insecure-requests on LAN HTTP', async () => {
    const res = await fetch(`${baseUrl}/favicon.ico`);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(0);

    const csp = res.headers.get('content-security-policy') || '';
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).not.toContain('fonts.googleapis.com');
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(res.headers.get('strict-transport-security')).toBeNull();

    const indexHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
    expect(indexHtml).toContain('/favicon.svg');
    expect(indexHtml).toContain('/favicon.ico');
  });

  it('sanitizes external Google Fonts links during server LMS SDK HTML injection', () => {
    const rawHtml =
      '<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter" /></head><body>Quiz</body></html>';
    const injected = injectLmsSdk(rawHtml, { headers: {} }, { id: 'cw-518', name: 'Quiz', uuid: 'u-518' });

    expect(injected).not.toContain('fonts.googleapis.com');
    expect(injected).toContain('data-openlearn-local-font-fallback');
  });
});
