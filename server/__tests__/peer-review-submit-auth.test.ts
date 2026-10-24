import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerLessonsRoutes } from '../routes/lessons.js';
import type { ServerContext } from '../context.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

/**
 * 回归测试 —— 互评提交接口的对象级授权（Issue #217）。
 *
 * 背景：`POST /api/lessons/:lessonId/eval-submissions/:submissionId/reviews`
 * 历史上只做了「已登录」判定（requireScopedAuth('self') 的角色下限为空），
 * 没有校验「互评人是否为提交人」「是否持有互评任务」「是否已过截止时间」，
 * 与插件命令路径 `assignment.eval.submitReview` 的口径不一致。
 * 后果：学生可以给自己的作业提交互评，把互评均分刷满，直接抬高学期总评。
 *
 * 这里覆盖修复后的行为：
 *   1. 自评被拒
 *   2. 未被分配互评任务的学生被拒
 *   3. 持有任务的互评人可提交，且落库带 assignment_id / task_id
 *   4. 重复提交走 UPDATE，不产生第二条记录
 *   5. 跨课节提交被拒
 *   6. 超过截止时间被拒
 */

describe('互评提交接口的对象级授权（#217）', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const lessonId = 'lesson-prauth-1';
  const otherLessonId = 'lesson-prauth-other';
  const assignmentId = 'asg-prauth-1';

  const ownerId = 'stu-prauth-owner'; // 提交人（自己的作业）
  const reviewerId = 'stu-prauth-reviewer'; // 被分配到的互评人
  const outsiderId = 'stu-prauth-outsider'; // 同班但没被分配任务的第三人

  const ownerToken = 'tok-prauth-owner';
  const reviewerToken = 'tok-prauth-reviewer';
  const outsiderToken = 'tok-prauth-outsider';

  const ownerSubmissionId = 'sub-prauth-owner';
  const targetSubmissionId = 'sub-prauth-target';
  const taskId = 'prt-prauth-1';

  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

  const postReview = (token: string, submissionId: string, lesson = lessonId, body: Record<string, unknown> = {}) =>
    fetch(`${baseUrl}/api/lessons/${lesson}/eval-submissions/${submissionId}/reviews`, {
      method: 'POST',
      headers: { ...cookie(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ score: 100, ...body }),
    });

  const reviewRows = () =>
    kernelContainer.db
      .prepare('SELECT submission_id, reviewer_id, score, assignment_id, task_id FROM plugin_peer_reviews')
      .all() as Array<{
      submission_id: string;
      reviewer_id: string;
      score: number;
      assignment_id: string | null;
      task_id: string | null;
    }>;

  beforeAll(async () => {
    const now = Date.now();

    const insertUser = kernelContainer.db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertUser.run(ownerId, 'prauth_owner', 'placeholder', 'student', '提交人', now);
    insertUser.run(reviewerId, 'prauth_reviewer', 'placeholder', 'student', '互评人', now);
    insertUser.run(outsiderId, 'prauth_outsider', 'placeholder', 'student', '第三人', now);

    const insertStudent = kernelContainer.db.prepare(
      'INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    insertStudent.run(ownerId, 'prauth-owner', '提交人', 'owner@test', now);
    insertStudent.run(reviewerId, 'prauth-reviewer', '互评人', 'reviewer@test', now);
    insertStudent.run(outsiderId, 'prauth-outsider', '第三人', 'outsider@test', now);

    const insertSession = kernelContainer.db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    const mkSession = (token: string, studentId: string) =>
      insertSession.run(
        token,
        JSON.stringify({ userId: studentId, role: 'student', username: studentId, studentId }),
        now,
        now + 60 * 60 * 1000,
      );
    mkSession(ownerToken, ownerId);
    mkSession(reviewerToken, reviewerId);
    mkSession(outsiderToken, outsiderId);

    // 作业：互评截止时间在未来
    kernelContainer.db
      .prepare(
        `INSERT OR REPLACE INTO plugin_assignments
           (id, class_id, lesson_id, title, description, peer_review_mode, peer_review_count,
            peer_review_due_at, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        assignmentId,
        null,
        lessonId,
        '互评授权作业',
        '',
        'assigned',
        1,
        now + 7 * 24 * 60 * 60 * 1000,
        'published',
        now,
        now,
      );

    const insertSubmission = kernelContainer.db.prepare(
      `INSERT OR REPLACE INTO plugin_submissions
         (id, assignment_id, lesson_id, student_id, file_path, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertSubmission.run(ownerSubmissionId, assignmentId, lessonId, ownerId, null, 1, now, now);
    insertSubmission.run(targetSubmissionId, assignmentId, lessonId, 'stu-prauth-target', null, 1, now, now);

    // 互评任务：只有 reviewerId 持有 reviewerId → targetSubmissionId 的任务
    kernelContainer.db
      .prepare(
        `INSERT OR REPLACE INTO plugin_peer_review_tasks
           (id, assignment_id, submission_id, reviewer_id, anonymous, status, due_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        taskId,
        assignmentId,
        targetSubmissionId,
        reviewerId,
        1,
        'pending',
        null,
        now,
      );

    app = express();
    app.use(express.json());
    registerLessonsRoutes({ app, io: { emit: () => {} } } as unknown as ServerContext);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    kernelContainer.db.prepare('DELETE FROM plugin_peer_reviews WHERE submission_id IN (?, ?)').run(
      ownerSubmissionId,
      targetSubmissionId,
    );
    kernelContainer.db.prepare('DELETE FROM plugin_peer_review_tasks WHERE id = ?').run(taskId);
    kernelContainer.db.prepare('DELETE FROM plugin_submissions WHERE id IN (?, ?)').run(
      ownerSubmissionId,
      targetSubmissionId,
    );
    kernelContainer.db.prepare('DELETE FROM plugin_assignments WHERE id = ?').run(assignmentId);
    kernelContainer.db
      .prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?)')
      .run(ownerToken, reviewerToken, outsiderToken);
    kernelContainer.db.prepare('DELETE FROM students WHERE id IN (?, ?, ?)').run(ownerId, reviewerId, outsiderId);
    kernelContainer.db.prepare('DELETE FROM users WHERE id IN (?, ?, ?)').run(ownerId, reviewerId, outsiderId);
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('学生不得给自己的作业提交互评（自评被拒）', async () => {
    const res = await postReview(ownerToken, ownerSubmissionId);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/own assignments/i);
    expect(reviewRows().filter((r) => r.submission_id === ownerSubmissionId)).toHaveLength(0);
  });

  it('未被分配互评任务的学生不得提交（作业已建立分配式互评）', async () => {
    const res = await postReview(outsiderToken, targetSubmissionId);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/not assigned to you/i);
    expect(reviewRows().filter((r) => r.submission_id === targetSubmissionId)).toHaveLength(0);
  });

  it('持有互评任务的互评人可以提交，且落库带 assignment_id 与 task_id', async () => {
    const res = await postReview(reviewerToken, targetSubmissionId);
    expect(res.status).toBe(200);
    const rows = reviewRows().filter((r) => r.submission_id === targetSubmissionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].reviewer_id).toBe(reviewerId);
    expect(rows[0].score).toBe(100);
    expect(rows[0].assignment_id).toBe(assignmentId);
    expect(rows[0].task_id).toBe(taskId);
  });

  it('重复提交走 UPDATE，不产生第二条互评记录', async () => {
    const res = await postReview(reviewerToken, targetSubmissionId, lessonId, { score: 80 });
    expect(res.status).toBe(200);
    const rows = reviewRows().filter((r) => r.submission_id === targetSubmissionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBe(80);
  });

  it('提交不属于该课节时按 404 拒绝（跨课节越权）', async () => {
    const res = await postReview(reviewerToken, targetSubmissionId, otherLessonId);
    expect(res.status).toBe(404);
  });

  it('超过互评截止时间后拒绝提交', async () => {
    // 把作业的互评截止时间推到过去
    kernelContainer.db
      .prepare('UPDATE plugin_assignments SET peer_review_due_at = ? WHERE id = ?')
      .run(Date.now() - 1000, assignmentId);
    try {
      const res = await postReview(reviewerToken, targetSubmissionId);
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/deadline/i);
    } finally {
      kernelContainer.db
        .prepare('UPDATE plugin_assignments SET peer_review_due_at = ? WHERE id = ?')
        .run(Date.now() + 7 * 24 * 60 * 60 * 1000, assignmentId);
    }
  });
});
