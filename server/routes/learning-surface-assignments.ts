/**
 * 作业域的新写入入口（阶段 2）。
 *
 * 从本阶段起，旧 `/api/assignments/*` 的写端点一律 410；所有作业写入都走这里：
 *
 *   POST   /api/learning-surface-assignments                       创建 / 更新作业定义
 *   POST   /api/learning-surface-assignments/generate              AI 生成作业
 *   POST   /api/learning-surface-assignments/suggest               AI 建议题目（不落库）
 *   POST   /api/learning-surface-assignments/create-suggested-quiz 落库 AI 建议
 *   POST   /api/learning-surface-assignments/:id/files             上传附件（原始二进制体）
 *   DELETE /api/learning-surface-assignments/:id/files/:fileId     删除未归档附件
 *   POST   /api/learning-surface-assignments/:id/submit            提交不可变版本
 *   POST   /api/learning-surface-assignments/:id/peer-review       提交互评
 *   POST   /api/learning-surface-assignments/:id/assign-peer-reviews 分配互评
 *   POST   /api/learning-surface-assignments/:id/submissions       传统班级作业提交
 *   POST   /api/learning-surface-assignments/:id/submissions/:studentId/grade 传统作业评分
 *   GET    /api/learning-surface-assignments/:id/attempts          教师查看全班 attempt
 *
 * 阶段 7.2 起读路由也走这里（实现见 `assignment-read.ts`，新旧路径共用）：
 *
 *   GET    /api/learning-surface-assignments                       列表
 *   GET    /api/learning-surface-assignments/:id                   详情
 *   GET    /api/learning-surface-assignments/:id/files             附件列表
 *   GET    /api/learning-surface-assignments/:id/files/:fileId     附件预览 / 下载
 *   GET    /api/learning-surface-assignments/:id/submissions       教师查看传统提交
 *   GET    /api/classes/:classId/learning-surface-assignments      班级作业列表
 *
 * 旧读 API（GET /api/assignments*）保留为兼容入口并带 Deprecation 头；新写入完成后
 * 由桥接服务把 legacy 行同步回 attempt 并回填 attempt_id，读侧口径一致。
 */
import express from 'express';
import type Database from 'better-sqlite3';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import type { ServerContext } from '../context.js';
import { getActorId } from '../middleware/auth.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import { sendSafeError } from '../utils/error-handler.js';
import { ASSIGNMENT_MAX_FILE_SIZE } from '../utils/assignment-upload-policy.js';
import { AssignmentService } from '../services/assignment-service.js';
import { type AccessSession, isAdministrator, isTeacher, rejectUnless } from '../services/class-access.js';
import {
  authorizeAssignmentAccess,
  ensureAssignmentSurface,
  findAssignmentLocator,
  linkAllPeerReviewRecordsForAssignment,
  linkPeerReviewToAttempt,
  linkUploadedFileToAttempt,
  syncAttemptFromHubSubmission,
  syncAttemptFromTraditionalSubmission,
} from '../services/assignment-attempt-bridge.js';
import { registerAssignmentReadRoutes, registerClassAssignmentsReadRoute } from './assignment-read.js';

function requestSession(req: unknown): AccessSession | undefined {
  return (req as { session?: AccessSession }).session;
}

function decodeFileName(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function describeRequester(req: unknown): { isPrivileged: boolean; studentId: string | null; session?: AccessSession } {
  const session = requestSession(req);
  const isPrivileged = isAdministrator(session) || isTeacher(session);
  const studentId = session?.userId || session?.studentId || null;
  return { isPrivileged, studentId: studentId ? String(studentId) : null, session };
}

export function registerLearningSurfaceAssignmentRoutes(ctx: ServerContext): void {
  const { app } = ctx;
  const db: Database.Database = kernelContainer.db;
  const assignmentService = new AssignmentService();

  // 读路由：与旧 `/api/assignments*` 共用 `assignment-read.ts` 的实现。
  registerAssignmentReadRoutes(app, { basePath: '/api/learning-surface-assignments' });
  registerClassAssignmentsReadRoute(app, { path: '/api/classes/:classId/learning-surface-assignments' });

  const sendHubError = (res: express.Response, e: unknown) => {
    const status = (e as { status?: unknown })?.status;
    sendSafeError(res, e, typeof status === 'number' && status >= 400 && status < 500 ? status : 500);
  };

  const requireAssignmentCommand = (res: express.Response, ...types: string[]): boolean => {
    for (const type of types) {
      if (!kernelContainer.commandBus.hasHandler(type)) {
        res.status(503).json({
          success: false,
          code: 'ASSIGNMENT_SERVICE_UNAVAILABLE',
          error: 'Assignment service is unavailable: the assignment-eval plugin is not active.',
        });
        return true;
      }
    }
    return false;
  };

  const loadLocatorOr404 = (res: express.Response, assignmentId: string) => {
    const locator = findAssignmentLocator(db, assignmentId);
    if (!locator) {
      res.status(404).json({ success: false, error: 'Assignment not found' });
      return null;
    }
    return locator;
  };

  // ── 作业定义 ─────────────────────────────────────────────────────────────
  app.post('/api/learning-surface-assignments', requireScopedAuth('class-staff'), async (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const classId = (body.classId ?? body.class_id) as string | undefined;
      const lessonId = (body.lessonId ?? body.lesson_id) as string | undefined;
      if (classId && rejectUnless(res, authorizeAssignmentClass(db, requestSession(req), classId, 'staff'))) return;
      if (
        !classId &&
        lessonId &&
        rejectUnless(res, authorizeAssignmentLesson(db, requestSession(req), lessonId, 'staff'))
      )
        return;
      if (requireAssignmentCommand(res, 'assignment.create')) return;

      const result = (await kernelContainer.commandBus.execute(
        kernelContainer.commandBus.createCommand('assignment.create', body, getActorId(req)),
      )) as { assignmentId?: string };
      const assignmentId = result?.assignmentId;
      if (!assignmentId) return res.status(500).json({ success: false, error: 'Assignment was not created' });

      const locator = findAssignmentLocator(db, assignmentId);
      if (!locator) return res.status(500).json({ success: false, error: 'Assignment not found after creation' });
      const surface = ensureAssignmentSurface(db, locator);
      res.status(201).json({ ...result, surfaceId: surface.id, lessonId: locator.lessonId });
    } catch (e: unknown) {
      sendHubError(res, e);
    }
  });

  app.post('/api/learning-surface-assignments/generate', requireScopedAuth('class-staff'), async (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const classId = String(body.classId ?? body.class_id ?? '');
      if (!classId) return res.status(400).json({ success: false, error: 'classId is required' });
      if (rejectUnless(res, authorizeAssignmentClass(db, requestSession(req), classId, 'staff'))) return;

      const result = await assignmentService.generateQuizWithAi(
        classId,
        String(body.topic ?? ''),
        typeof body.lessonId === 'string' ? body.lessonId : undefined,
      );
      ensureSurfaceForGeneratedAssignment(db, result);
      res.json({ success: true, assignment: result });
    } catch (e: unknown) {
      sendHubError(res, e);
    }
  });

  app.post('/api/learning-surface-assignments/suggest', requireScopedAuth('class-staff'), async (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const lessonId = String(body.lessonId ?? '');
      if (!lessonId) return res.status(400).json({ success: false, error: 'lessonId is required' });
      if (rejectUnless(res, authorizeAssignmentLesson(db, requestSession(req), lessonId, 'staff'))) return;
      const result = await assignmentService.suggestQuizWithAi(lessonId);
      res.json(result);
    } catch (e: unknown) {
      sendHubError(res, e);
    }
  });

  app.post(
    '/api/learning-surface-assignments/create-suggested-quiz',
    requireScopedAuth('class-staff'),
    async (req, res) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        const classId = String(body.classId ?? body.class_id ?? '');
        if (!classId) return res.status(400).json({ success: false, error: 'classId is required' });
        if (rejectUnless(res, authorizeAssignmentClass(db, requestSession(req), classId, 'staff'))) return;

        const assignmentId = assignmentService.createSuggestedQuiz(
          classId,
          body as unknown as Parameters<AssignmentService['createSuggestedQuiz']>[1],
        );
        const locator = typeof assignmentId === 'string' ? findAssignmentLocator(db, assignmentId) : null;
        if (locator) ensureAssignmentSurface(db, locator);
        res.json({ success: true, assignmentId });
      } catch (e: unknown) {
        sendHubError(res, e);
      }
    },
  );

  // ── 附件 ─────────────────────────────────────────────────────────────────
  app.post(
    '/api/learning-surface-assignments/:assignmentId/files',
    requireScopedAuth('class-member'),
    express.raw({ type: () => true, limit: ASSIGNMENT_MAX_FILE_SIZE + 1024 * 1024 }),
    async (req, res) => {
      try {
        const locator = loadLocatorOr404(res, req.params.assignmentId);
        if (!locator) return;
        const { isPrivileged, studentId } = describeRequester(req);
        if (
          rejectUnless(
            res,
            authorizeAssignmentAccess(db, requestSession(req), locator, isPrivileged ? 'staff' : 'member'),
          )
        )
          return;

        const headerStudent = decodeFileName(req.header('x-student-id') || '');
        const ownerStudentId = isPrivileged ? headerStudent || studentId : studentId;
        if (!ownerStudentId) return res.status(400).json({ success: false, error: 'Missing studentId' });

        const fileName = decodeFileName(req.header('x-file-name') || '');
        if (!fileName) return res.status(400).json({ success: false, error: 'Missing X-File-Name header' });

        const buffer: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const file = await assignmentService.uploadAssignmentFile({
          assignmentId: locator.assignmentId,
          ownerStudentId,
          isPrivileged,
          fileName,
          buffer,
          contentType: req.header('content-type') || null,
        });
        const attemptId = linkUploadedFileToAttempt(db, {
          assignmentId: locator.assignmentId,
          studentId: ownerStudentId,
          fileId: file.id,
        });

        res.json({ success: true, file, attemptId });
      } catch (e: unknown) {
        if ((e as Error).message?.includes('At most')) {
          return res.status(409).json({ success: false, error: (e as Error).message });
        }
        sendHubError(res, e);
      }
    },
  );

  app.delete(
    '/api/learning-surface-assignments/:assignmentId/files/:fileId',
    requireScopedAuth('class-member'),
    async (req, res) => {
      try {
        const locator = loadLocatorOr404(res, req.params.assignmentId);
        if (!locator) return;
        const { isPrivileged, studentId } = describeRequester(req);
        if (
          rejectUnless(
            res,
            authorizeAssignmentAccess(db, requestSession(req), locator, isPrivileged ? 'staff' : 'member'),
          )
        )
          return;
        assignmentService.softDeleteAssignmentFile(locator.assignmentId, req.params.fileId, studentId, isPrivileged);
        res.json({ success: true });
      } catch (e: unknown) {
        sendHubError(res, e);
      }
    },
  );

  // ── 提交 / 互评 ──────────────────────────────────────────────────────────
  app.post(
    '/api/learning-surface-assignments/:assignmentId/submit',
    requireScopedAuth('class-member'),
    async (req, res) => {
      try {
        const locator = loadLocatorOr404(res, req.params.assignmentId);
        if (!locator) return;
        const { isPrivileged, studentId } = describeRequester(req);
        if (
          rejectUnless(
            res,
            authorizeAssignmentAccess(db, requestSession(req), locator, isPrivileged ? 'staff' : 'member'),
          )
        )
          return;
        if (requireAssignmentCommand(res, 'assignment.submit')) return;

        const body = (req.body || {}) as Record<string, unknown>;
        const targetStudentId = isPrivileged ? String(body.studentId || '') : String(studentId || '');
        if (!targetStudentId) return res.status(400).json({ success: false, error: 'Missing studentId' });

        const result = (await kernelContainer.commandBus.execute(
          kernelContainer.commandBus.createCommand(
            'assignment.submit',
            {
              assignmentId: locator.assignmentId,
              studentId: targetStudentId,
              fileIds: Array.isArray(body.fileIds) ? body.fileIds : [],
              textContent: body.textContent,
              linkUrl: body.linkUrl,
            },
            getActorId(req),
          ),
        )) as Record<string, unknown>;

        const attempt = syncAttemptFromHubSubmission(db, {
          assignmentId: locator.assignmentId,
          studentId: targetStudentId,
        });
        res.json({ ...result, attemptId: attempt?.id ?? null });
      } catch (e: unknown) {
        sendHubError(res, e);
      }
    },
  );

  app.post(
    '/api/learning-surface-assignments/:assignmentId/peer-review',
    requireScopedAuth('class-member'),
    async (req, res) => {
      try {
        const locator = loadLocatorOr404(res, req.params.assignmentId);
        if (!locator) return;
        const { isPrivileged, studentId } = describeRequester(req);
        if (
          rejectUnless(
            res,
            authorizeAssignmentAccess(db, requestSession(req), locator, isPrivileged ? 'staff' : 'member'),
          )
        )
          return;
        if (requireAssignmentCommand(res, 'assignment.peer_review')) return;

        const body = (req.body || {}) as Record<string, unknown>;
        const reviewerId = isPrivileged ? String(body.reviewerId || body.studentId || '') : String(studentId || '');
        if (!reviewerId) return res.status(400).json({ success: false, error: 'Missing reviewerId' });
        const submissionId = String(body.submissionId || '');
        if (!submissionId) return res.status(400).json({ success: false, error: 'Missing submissionId' });

        const result = await kernelContainer.commandBus.execute(
          kernelContainer.commandBus.createCommand(
            'assignment.peer_review',
            { submissionId, reviewerId, score: body.score, comment: body.comment, taskId: body.taskId },
            getActorId(req),
          ),
        );
        const attemptId = linkPeerReviewToAttempt(db, {
          assignmentId: locator.assignmentId,
          submissionId,
          taskId: typeof body.taskId === 'string' ? body.taskId : undefined,
        });
        res.json({ ...(result as Record<string, unknown>), attemptId });
      } catch (e: unknown) {
        sendHubError(res, e);
      }
    },
  );

  app.post(
    '/api/learning-surface-assignments/:assignmentId/assign-peer-reviews',
    requireScopedAuth('class-staff'),
    async (req, res) => {
      try {
        const locator = loadLocatorOr404(res, req.params.assignmentId);
        if (!locator) return;
        if (rejectUnless(res, authorizeAssignmentAccess(db, requestSession(req), locator, 'staff'))) return;
        if (requireAssignmentCommand(res, 'assignment.assign_peer_reviews')) return;

        const body = (req.body || {}) as Record<string, unknown>;
        const result = await kernelContainer.commandBus.execute(
          kernelContainer.commandBus.createCommand(
            'assignment.assign_peer_reviews',
            { assignmentId: locator.assignmentId, reviewerCount: body.reviewerCount, dueAt: body.dueAt },
            getActorId(req),
          ),
        );
        const linked = linkAllPeerReviewRecordsForAssignment(db, locator.assignmentId);
        res.json({ ...(result as Record<string, unknown>), linkedAttempts: linked });
      } catch (e: unknown) {
        sendHubError(res, e);
      }
    },
  );

  // ── 传统班级作业 ─────────────────────────────────────────────────────────
  app.post(
    '/api/learning-surface-assignments/:assignmentId/submissions',
    requireScopedAuth('class-member'),
    async (req, res) => {
      try {
        const locator = loadLocatorOr404(res, req.params.assignmentId);
        if (!locator) return;
        if (locator.origin !== 'traditional') {
          return res.status(400).json({ success: false, error: 'Not a traditional assignment' });
        }
        const { isPrivileged, studentId } = describeRequester(req);
        if (
          rejectUnless(
            res,
            authorizeAssignmentAccess(db, requestSession(req), locator, isPrivileged ? 'staff' : 'member'),
          )
        )
          return;

        const body = (req.body || {}) as Record<string, unknown>;
        const targetStudentId = assignmentService.resolveTargetStudentId(
          String(body.studentId ?? studentId ?? ''),
          studentId,
          isPrivileged,
        );
        assignmentService.submitTraditionalAssignment(
          locator.assignmentId,
          targetStudentId,
          String(body.content ?? ''),
        );
        const attempt = syncAttemptFromTraditionalSubmission(db, {
          assignmentId: locator.assignmentId,
          studentId: targetStudentId,
        });
        res.json({ success: true, attemptId: attempt?.id ?? null });
      } catch (e: unknown) {
        sendHubError(res, e);
      }
    },
  );

  app.post(
    '/api/learning-surface-assignments/:assignmentId/submissions/:studentId/grade',
    requireScopedAuth('class-staff'),
    async (req, res) => {
      try {
        const locator = loadLocatorOr404(res, req.params.assignmentId);
        if (!locator) return;
        if (locator.origin !== 'traditional') {
          return res.status(400).json({ success: false, error: 'Not a traditional assignment' });
        }
        if (rejectUnless(res, authorizeAssignmentAccess(db, requestSession(req), locator, 'staff'))) return;

        const grade = await assignmentService.gradeTraditionalAssignment(
          locator.assignmentId,
          req.params.studentId,
          getActorId(req),
        );
        const attempt = syncAttemptFromTraditionalSubmission(db, {
          assignmentId: locator.assignmentId,
          studentId: req.params.studentId,
        });
        res.json({
          success: true,
          pendingApproval: true,
          message: 'Grade generated and sent for approval.',
          score: grade.score,
          feedback: grade.feedback,
          attemptId: attempt?.id ?? null,
        });
      } catch (e: unknown) {
        sendHubError(res, e);
      }
    },
  );

  // ── 教师查看全班 attempt ─────────────────────────────────────────────────
  app.get('/api/learning-surface-assignments/:assignmentId/attempts', requireScopedAuth('class-staff'), (req, res) => {
    try {
      const locator = loadLocatorOr404(res, req.params.assignmentId);
      if (!locator) return;
      if (rejectUnless(res, authorizeAssignmentAccess(db, requestSession(req), locator, 'staff'))) return;

      const rows = db
        .prepare(
          `SELECT a.*, u.name AS student_name
               FROM learning_surface_attempts a
               JOIN learning_surfaces s ON s.id = a.surface_id
               LEFT JOIN users u ON u.id = a.student_id
              WHERE s.kind = 'assignment' AND s.owner_id = ? AND a.is_preview = 0
              ORDER BY a.student_id ASC, a.attempt_no DESC`,
        )
        .all(locator.assignmentId);
      res.json(rows);
    } catch (e: unknown) {
      sendHubError(res, e);
    }
  });
}

function authorizeAssignmentClass(
  db: Database.Database,
  session: AccessSession | undefined,
  classId: string,
  level: 'staff' | 'member',
) {
  return authorizeAssignmentAccess(
    db,
    session,
    { assignmentId: '', lessonId: '', classId, title: '', origin: 'hub' },
    level,
  );
}

function authorizeAssignmentLesson(
  db: Database.Database,
  session: AccessSession | undefined,
  lessonId: string,
  level: 'staff' | 'member',
) {
  return authorizeAssignmentAccess(
    db,
    session,
    { assignmentId: '', lessonId, classId: null, title: '', origin: 'hub' },
    level,
  );
}

function ensureSurfaceForGeneratedAssignment(db: Database.Database, result: unknown): void {
  if (!result || typeof result !== 'object') return;
  const record = result as Record<string, unknown>;
  const id =
    typeof record.assignmentId === 'string' ? record.assignmentId : typeof record.id === 'string' ? record.id : '';
  if (!id) return;
  const locator = findAssignmentLocator(db, id);
  if (locator) ensureAssignmentSurface(db, locator);
}
