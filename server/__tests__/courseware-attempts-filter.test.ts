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
  const teacherId = 'usr-filter-teacher-1';
  const teacherToken = 'tok-filter-teacher-1';
  const studentToken = 'tok-filter-student-1';
  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

  beforeAll(async () => {
    // Seed two coursewares + one student + three attempts (2 for A, 1 for B)
    const now = Date.now();

    kernelContainer.db
      .prepare(
        'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(teacherId, 'filter_teacher', 'placeholder', 'teacher', 'Filter 教师', now);
    kernelContainer.db
      .prepare(
        'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(studentId, 'filter_student', 'placeholder', 'student', '小明明', now);

    // 真实会话行：getValidSession(token) 读 client_sessions.session_data
    const insertSession = kernelContainer.db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'filter_teacher' }),
      now,
      now + 60 * 60 * 1000,
    );
    insertSession.run(
      studentToken,
      JSON.stringify({ userId: studentId, role: 'student', username: 'filter_student', studentId }),
      now,
      now + 60 * 60 * 1000,
    );

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
    insertResult.run('sr-A-1', 'att-A-1', 80, '教师评语：不错', 1, JSON.stringify({ answers: [1, 2, 3] }));
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
    kernelContainer.db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?)').run(teacherToken, studentToken);
    kernelContainer.db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(teacherId, studentId);
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('returns ALL attempts when coursewareUuid is omitted (backward compatibility)', async () => {
    const res = await fetch(`${baseUrl}/api/courseware/attempts`, { headers: cookie(teacherToken) });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ attemptId: string }>;
    const ids = rows.map((r) => r.attemptId);
    expect(ids).toContain('att-A-1');
    expect(ids).toContain('att-A-2');
    expect(ids).toContain('att-B-1');
  });

  it('filters by coursewareUuid=A and returns only A attempts with same shape', async () => {
    const res = await fetch(`${baseUrl}/api/courseware/attempts?coursewareUuid=${uuidA}`, {
      headers: cookie(teacherToken),
    });
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
    const res = await fetch(`${baseUrl}/api/courseware/attempts?coursewareUuid=${uuidB}`, {
      headers: cookie(teacherToken),
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ attemptId: string; score: number }>;
    expect(rows.length).toBe(1);
    expect(rows[0].attemptId).toBe('att-B-1');
    expect(rows[0].score).toBe(60);
  });

  it('returns empty array for non-existent coursewareUuid (not 500)', async () => {
    const res = await fetch(
      `${baseUrl}/api/courseware/attempts?coursewareUuid=${encodeURIComponent('does-not-exist')}`,
      { headers: cookie(teacherToken) },
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as unknown[];
    expect(Array.isArray(rows)).toBe(true);
    expect((rows as Array<unknown>).length).toBe(0);
  });

  it('rejects unauthenticated callers (成绩榜必须登录后可见)', async () => {
    const res = await fetch(`${baseUrl}/api/courseware/attempts?coursewareUuid=${uuidA}`);
    expect(res.status).toBe(401);
  });

  it('trims extra_json / comment for students but keeps them for teachers', async () => {
    const studentRes = await fetch(`${baseUrl}/api/courseware/attempts?coursewareUuid=${uuidA}`, {
      headers: cookie(studentToken),
    });
    expect(studentRes.status).toBe(200);
    const studentRows = (await studentRes.json()) as Array<Record<string, any>>;
    const studentRow = studentRows.find((r) => r.attemptId === 'att-A-1')!;
    expect(studentRow).toBeDefined();
    // 榜单字段仍在
    expect(studentRow.score).toBe(80);
    expect(studentRow.studentName).toBe('小明');
    // 原始作答与教师评语绝不下发
    expect(Object.prototype.hasOwnProperty.call(studentRow, 'extra_json')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(studentRow, 'comment')).toBe(false);

    const teacherRes = await fetch(`${baseUrl}/api/courseware/attempts?coursewareUuid=${uuidA}`, {
      headers: cookie(teacherToken),
    });
    expect(teacherRes.status).toBe(200);
    const teacherRows = (await teacherRes.json()) as Array<Record<string, any>>;
    const teacherRow = teacherRows.find((r) => r.attemptId === 'att-A-1')!;
    expect(teacherRow.comment).toBe('教师评语：不错');
    expect(teacherRow.extra_json).toContain('answers');
  });
});