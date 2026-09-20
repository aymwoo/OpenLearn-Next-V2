import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerCoursewareRoutes } from '../routes/courseware.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('GET /api/courseware/attempts coursewareUuid filter', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  // Fixtures
  const uuidA = 'cw-filter-test-A';
  const uuidB = 'cw-filter-test-B';
  const cwAId = 'cw-row-A';
  const cwBId = 'cw-row-B';
  const studentId = 'stu-filter-1';

  beforeAll(async () => {
    // Seed two coursewares + one student + three attempts (2 for A, 1 for B)
    const now = Date.now();

    kernelContainer.db
      .prepare('INSERT OR REPLACE INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(cwAId, uuidA, '课件 A', 'html', 'index.html', now);
    kernelContainer.db
      .prepare('INSERT OR REPLACE INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(cwBId, uuidB, '课件 B', 'html', 'index.html', now + 1);
    kernelContainer.db
      .prepare('INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(studentId, '001', '小明', 'xm@test', now);

    const insertAttempt = kernelContainer.db.prepare(
      'INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, finished_at, status) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertAttempt.run('att-A-1', cwAId, studentId, now, now + 1000, 'finished');
    insertAttempt.run('att-A-2', cwAId, studentId, now + 100, now + 2000, 'finished');
    insertAttempt.run('att-B-1', cwBId, studentId, now, now + 500, 'finished');

    const insertResult = kernelContainer.db.prepare(
      'INSERT INTO submission_result (id, attempt_id, score, comment, completion, extra_json) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertResult.run('sr-A-1', 'att-A-1', 80, null, 1, null);
    insertResult.run('sr-A-2', 'att-A-2', 95, null, 1, null);
    insertResult.run('sr-B-1', 'att-B-1', 60, null, 1, null);

    app = express();
    app.use(express.json());
    registerCoursewareRoutes({
      app,
      io: { emit: () => {} } as any,
    } as any);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    // Cleanup
    kernelContainer.db.prepare('DELETE FROM submission_result WHERE attempt_id IN (?, ?, ?)').run(
      'att-A-1',
      'att-A-2',
      'att-B-1',
    );
    kernelContainer.db.prepare('DELETE FROM courseware_attempt WHERE id IN (?, ?, ?)').run(
      'att-A-1',
      'att-A-2',
      'att-B-1',
    );
    kernelContainer.db.prepare('DELETE FROM courseware WHERE id IN (?, ?)').run(cwAId, cwBId);
    kernelContainer.db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('returns ALL attempts when coursewareUuid is omitted (backward compatibility)', async () => {
    const res = await fetch(`${baseUrl}/api/courseware/attempts`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ attemptId: string }>;
    const ids = rows.map((r) => r.attemptId);
    expect(ids).toContain('att-A-1');
    expect(ids).toContain('att-A-2');
    expect(ids).toContain('att-B-1');
  });

  it('filters by coursewareUuid=A and returns only A attempts with same shape', async () => {
    const res = await fetch(`${baseUrl}/api/courseware/attempts?coursewareUuid=${uuidA}`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{
      attemptId: string;
      coursewareUuid: string;
      coursewareName: string;
      score: number | null;
      studentId: string;
    }>;
    expect(rows.length).toBe(2);
    const ids = rows.map((r) => r.attemptId).sort();
    expect(ids).toEqual(['att-A-1', 'att-A-2']);
    for (const r of rows) {
      expect(r.coursewareUuid).toBe(uuidA);
      expect(r.coursewareName).toBe('课件 A');
      expect(r.studentId).toBe(studentId);
    }
    const scores = rows.map((r) => r.score).sort();
    expect(scores).toEqual([80, 95]);
  });

  it('filters by coursewareUuid=B and returns only B attempt', async () => {
    const res = await fetch(`${baseUrl}/api/courseware/attempts?coursewareUuid=${uuidB}`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ attemptId: string; score: number }>;
    expect(rows.length).toBe(1);
    expect(rows[0].attemptId).toBe('att-B-1');
    expect(rows[0].score).toBe(60);
  });

  it('returns empty array for non-existent coursewareUuid (not 500)', async () => {
    const res = await fetch(
      `${baseUrl}/api/courseware/attempts?coursewareUuid=${encodeURIComponent('does-not-exist')}`,
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as unknown[];
    expect(Array.isArray(rows)).toBe(true);
    expect((rows as Array<unknown>).length).toBe(0);
  });
});