import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerLearningSurfaceLessonEvalRoutes } from '../routes/learning-surface-lesson-evals.js';
import { registerLessonsRoutes } from '../routes/lessons.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

/**
 * 课时级随堂提交 / 互评的新写通道回归。
 *
 * 覆盖：
 *  1. 旧 `/api/lessons/:lessonId/eval-submissions` 写端点返回 410；
 *  2. 新端点写 plugin_submissions 与 kind='lesson_eval' attempt；
 *  3. 重复提交只递增版本、复用同一条 attempt；
 *  4. 互评写入后挂到被评提交的 attempt。
 */
const lessonId = 'lesson-leveval-1';
const studentA = 'stu-leveval-a';
const studentB = 'stu-leveval-b';
const teacherId = 'usr-leveval-teacher';
const tokenA = 'tok-leveval-a';
const tokenB = 'tok-leveval-b';
const teacherToken = 'tok-leveval-teacher';

let server: Server;
let baseUrl: string;

const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('课时级随堂提交新写通道', () => {
  beforeAll(async () => {
    const now = Date.now();
    const db = kernelContainer.db;

    const insertUser = db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertUser.run(studentA, 'leveval_a', 'placeholder', 'student', '随堂学生 A', now);
    insertUser.run(studentB, 'leveval_b', 'placeholder', 'student', '随堂学生 B', now);
    insertUser.run(teacherId, 'leveval_teacher', 'placeholder', 'teacher', '随堂教师', now);

    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    const expiresAt = now + 60 * 60 * 1000;
    insertSession.run(
      tokenA,
      JSON.stringify({ userId: studentA, studentId: studentA, role: 'student' }),
      now,
      expiresAt,
    );
    insertSession.run(
      tokenB,
      JSON.stringify({ userId: studentB, studentId: studentB, role: 'student' }),
      now,
      expiresAt,
    );
    insertSession.run(teacherToken, JSON.stringify({ userId: teacherId, role: 'teacher' }), now, expiresAt);

    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(lessonId, '随堂提交测试课', teacherId, now, now);

    const app = express();
    app.use(express.json());
    registerLearningSurfaceLessonEvalRoutes({ app } as never);
    registerLessonsRoutes({ app, io: { emit: () => undefined } } as never);

    await new Promise<void>((resolve) => {
      server = createServer(app);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    const db = kernelContainer.db;
    db.prepare(
      "DELETE FROM learning_surface_attempts WHERE surface_id IN (SELECT id FROM learning_surfaces WHERE kind = 'lesson_eval' AND owner_id = ?)",
    ).run(lessonId);
    db.prepare("DELETE FROM learning_surfaces WHERE kind = 'lesson_eval' AND owner_id = ?").run(lessonId);
    db.prepare(
      'DELETE FROM plugin_peer_reviews WHERE submission_id IN (SELECT id FROM plugin_submissions WHERE lesson_id = ?)',
    ).run(lessonId);
    db.prepare(
      'DELETE FROM plugin_peer_review_tasks WHERE submission_id IN (SELECT id FROM plugin_submissions WHERE lesson_id = ?)',
    ).run(lessonId);
    db.prepare('DELETE FROM plugin_submissions WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?)').run(tokenA, tokenB, teacherToken);
    db.prepare('DELETE FROM users WHERE id IN (?, ?, ?)').run(studentA, studentB, teacherId);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('旧写端点返回 410，并指向新通道', async () => {
    const res = await api(`/api/lessons/${lessonId}/eval-submissions`, {
      method: 'POST',
      headers: cookie(tokenA),
      body: JSON.stringify({ filePath: 'files/old.pdf' }),
    });
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('LEGACY_ASSIGNMENT_WRITE_DISABLED');
    expect(res.body.replacement).toBe('/api/learning-surface-lessons/:lessonId/eval-submissions');
  });

  it('新端点写入提交与 attempt，重复提交复用 attempt 并递增版本', async () => {
    const first = await api(`/api/learning-surface-lessons/${lessonId}/eval-submissions`, {
      method: 'POST',
      headers: cookie(tokenA),
      body: JSON.stringify({ filePath: 'files/one.pdf', textContent: '第一版' }),
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.success).toBe(true);
    expect(first.body.version).toBe(1);
    expect(first.body.attemptId).toBeTruthy();
    const submissionId = first.body.submissionId as string;

    const second = await api(`/api/learning-surface-lessons/${lessonId}/eval-submissions`, {
      method: 'POST',
      headers: cookie(tokenA),
      body: JSON.stringify({ filePath: 'files/two.pdf', textContent: '第二版' }),
    });
    expect(second.status).toBe(200);
    expect(second.body.submissionId).toBe(submissionId);
    expect(second.body.version).toBe(2);
    expect(second.body.attemptId).toBe(first.body.attemptId);

    const row = kernelContainer.db
      .prepare('SELECT file_path, version, attempt_id FROM plugin_submissions WHERE id = ?')
      .get(submissionId) as { file_path: string; version: number; attempt_id: string };
    expect(row).toMatchObject({ file_path: 'files/two.pdf', version: 2, attempt_id: first.body.attemptId });

    const attempt = kernelContainer.db
      .prepare('SELECT status, completion, state_json FROM learning_surface_attempts WHERE id = ?')
      .get(first.body.attemptId) as { status: string; completion: number; state_json: string };
    expect(attempt.status).toBe('submitted');
    expect(attempt.completion).toBe(1);
    expect(JSON.parse(attempt.state_json)).toMatchObject({
      submissionId,
      version: 2,
      filePath: 'files/two.pdf',
      textContent: '第二版',
    });
  });

  it('互评写入后挂到被评提交的 attempt', async () => {
    const submission = kernelContainer.db
      .prepare('SELECT id, attempt_id FROM plugin_submissions WHERE lesson_id = ? AND student_id = ?')
      .get(lessonId, studentA) as { id: string; attempt_id: string };

    const review = await api(`/api/learning-surface-lessons/${lessonId}/eval-submissions/${submission.id}/reviews`, {
      method: 'POST',
      headers: cookie(tokenB),
      body: JSON.stringify({ score: 95, comment: '很好' }),
    });
    expect(review.status, JSON.stringify(review.body)).toBe(200);
    expect(review.body.success).toBe(true);

    const row = kernelContainer.db
      .prepare('SELECT score, attempt_id FROM plugin_peer_reviews WHERE id = ?')
      .get(review.body.reviewId) as { score: number; attempt_id: string | null };
    expect(row.score).toBe(95);
    expect(row.attempt_id).toBe(submission.attempt_id);
  });

  it('旧读接口保持可用', async () => {
    const res = await api(`/api/lessons/${lessonId}/eval-submissions`, { headers: cookie(teacherToken) });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((row: { student_id: string }) => row.student_id === studentA)).toBe(true);
  });
});
