/**
 * 课时级随堂提交 / 互评的新写入口（阶段 2 收尾）。
 *
 * 旧端点：
 *   POST /api/lessons/:lessonId/eval-submissions
 *   POST /api/lessons/:lessonId/eval-submissions/:submissionId/reviews
 * 现在统一 410，写请求改走这里：
 *   POST /api/learning-surface-lessons/:lessonId/eval-submissions
 *   POST /api/learning-surface-lessons/:lessonId/eval-submissions/:submissionId/reviews
 *
 * 数据仍保留在 `plugin_submissions` / `plugin_peer_reviews`（旧读 API 不变），
 * 同时写入 `kind='lesson_eval'` 的 Surface 与 attempt，并回填 attempt_id。
 */
import type { Request, Response } from 'express';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import type { ServerContext } from '../context.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import { sendSafeError } from '../utils/error-handler.js';
import { randomId } from '../utils/id.js';
import { isSafeHref } from '../../packages/core/security/url-safety.js';
import { authorizeLessonParticipation, isAdministrator, rejectUnless } from '../services/class-access.js';
import { authorizePeerReviewSubmission } from '../services/peer-review-access.js';
import { linkLessonEvalReviewToAttempt, syncLessonEvalAttempt } from '../services/assignment-attempt-bridge.js';

function requestSession(req: Request): Record<string, unknown> | undefined {
  return (req as Request & { session?: Record<string, unknown> }).session;
}

export function registerLearningSurfaceLessonEvalRoutes(ctx: ServerContext): void {
  const { app } = ctx;
  const db = kernelContainer.db;

  app.post(
    '/api/learning-surface-lessons/:lessonId/eval-submissions',
    requireScopedAuth('self'),
    (req: Request, res: Response) => {
      try {
        const session = requestSession(req);
        const lessonId = req.params.lessonId;
        const body = (req.body || {}) as Record<string, unknown>;
        const isPrivileged = isAdministrator(session);
        const targetStudentId = isPrivileged
          ? String(body.studentId || '')
          : String(session?.studentId || session?.userId || '');
        if (!targetStudentId) {
          return res.status(400).json({ success: false, error: 'Missing studentId' });
        }

        const filePath = body.filePath;
        if (filePath != null && typeof filePath !== 'string') {
          return res.status(400).json({ success: false, error: 'filePath must be a string' });
        }
        if (typeof filePath === 'string' && filePath && !isSafeHref(filePath)) {
          return res.status(400).json({ success: false, error: 'filePath contains an unsupported URL scheme' });
        }
        if (rejectUnless(res, authorizeLessonParticipation(db, session as never, lessonId))) return;

        const now = Date.now();
        const existing = db
          .prepare(
            'SELECT id, version FROM plugin_submissions WHERE lesson_id = ? AND student_id = ? AND assignment_id IS NULL',
          )
          .get(lessonId, targetStudentId) as { id: string; version: number } | undefined;

        const submissionId = existing?.id ?? randomId('evalsub_');
        const version = existing ? (existing.version ?? 1) + 1 : 1;
        if (existing) {
          db.prepare('UPDATE plugin_submissions SET file_path = ?, version = ?, updated_at = ? WHERE id = ?').run(
            typeof filePath === 'string' ? filePath : '',
            version,
            now,
            submissionId,
          );
        } else {
          db.prepare(
            `INSERT INTO plugin_submissions (id, assignment_id, lesson_id, student_id, file_path, version, created_at, updated_at)
             VALUES (?, NULL, ?, ?, ?, 1, ?, ?)`,
          ).run(submissionId, lessonId, targetStudentId, typeof filePath === 'string' ? filePath : '', now, now);
        }

        const attempt = syncLessonEvalAttempt(db, {
          lessonId,
          studentId: targetStudentId,
          submissionId,
          version,
          filePath: typeof filePath === 'string' ? filePath : null,
          textContent: typeof body.textContent === 'string' ? body.textContent : null,
        });

        res.json({ success: true, submissionId, version, attemptId: attempt.id });
      } catch (err: unknown) {
        sendSafeError(res, err);
      }
    },
  );

  app.post(
    '/api/learning-surface-lessons/:lessonId/eval-submissions/:submissionId/reviews',
    requireScopedAuth('self'),
    (req: Request, res: Response) => {
      try {
        const session = requestSession(req);
        const lessonId = req.params.lessonId;
        const submissionId = req.params.submissionId;
        const body = (req.body || {}) as Record<string, unknown>;
        const isPrivileged = isAdministrator(session);
        const reviewerId = isPrivileged
          ? String(body.reviewerId || session?.studentId || '')
          : String(session?.studentId || session?.userId || '');
        if (!reviewerId) {
          return res.status(400).json({ success: false, error: 'Missing reviewerId' });
        }

        const numericScore = Number(body.score);
        if (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > 100) {
          return res.status(400).json({ success: false, error: 'Score must be 0-100' });
        }

        const decision = authorizePeerReviewSubmission(db, {
          submissionId,
          lessonId,
          reviewerId,
          privileged: isPrivileged,
        });
        if (!decision.ok) {
          return res.status(decision.status).json({ success: false, error: decision.error });
        }

        const attemptRow = db.prepare('SELECT attempt_id FROM plugin_submissions WHERE id = ?').get(submissionId) as
          { attempt_id: string | null } | undefined;
        const attemptId = attemptRow?.attempt_id ?? null;

        const id = randomId('evalrev_');
        const now = Date.now();
        db.prepare(
          `INSERT INTO plugin_peer_reviews
             (id, submission_id, reviewer_id, score, comment, assignment_id, task_id, anonymous, status, created_at, updated_at, attempt_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'submitted', ?, ?, ?)
           ON CONFLICT(submission_id, reviewer_id) DO UPDATE SET
             score = excluded.score,
             comment = excluded.comment,
             assignment_id = excluded.assignment_id,
             task_id = excluded.task_id,
             status = 'submitted',
             updated_at = excluded.updated_at,
             attempt_id = excluded.attempt_id`,
        ).run(
          id,
          submissionId,
          reviewerId,
          numericScore,
          typeof body.comment === 'string' ? body.comment : '',
          decision.assignmentId,
          decision.taskId,
          now,
          now,
          attemptId,
        );

        const linkedAttemptId = linkLessonEvalReviewToAttempt(db, { submissionId, reviewId: id }) ?? attemptId;
        res.json({ success: true, reviewId: id, attemptId: linkedAttemptId });
      } catch (err: unknown) {
        sendSafeError(res, err);
      }
    },
  );
}
