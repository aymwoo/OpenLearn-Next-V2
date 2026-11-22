/**
 * LearningSurface 路由（阶段 1：状态底座）。
 *
 * 设计：docs/architecture/learning-surface.md
 *
 * 路由清单：
 *   GET    /api/learning-surface-renderers                  渲染器目录（内置 + 已激活插件）
 *   POST   /api/learning-surfaces                           按容器创建 / 更新 Surface（阶段 3 容器接线用）
 *   PATCH  /api/learning-surfaces/:id                       更新 Surface 内容引用
 *   DELETE /api/learning-surfaces/:id                       软删 Surface（attempt 保留）
 *   POST   /api/learning-surface-attempts                   创建 / 续用 attempt
 *   GET    /api/learning-surface-attempts/mine?lessonId=    当前学生的 attempts
 *   PATCH  /api/learning-surface-attempts/:id               更新进度 / 教师评分
 *   POST   /api/learning-surface-attempts/:id/submit        提交（幂等）
 *   POST   /api/learning-surface-attempts/:id/attempts      显式开启下一次尝试
 *   GET    /api/lessons/:lessonId/learning-surface-attempts 教师查看全班
 *   GET    /api/lessons/:lessonId/learning-surface-summary  教师查看课时级 Surface 汇总
 *
 * 权限复用 class-access：
 *   - 学生：只能读写自己的 attempt，且必须能参与该课节；
 *   - 教师：本课 / 本班（authorizeLessonStaff），可评分覆盖；
 *   - 管理员：全量。
 *   教师预览写 is_preview = 1，不计入学生统计。
 */
import type { Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import type { ServerContext } from '../context.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import {
  type AccessSession,
  actorUserId,
  authorizeClass,
  authorizeLessonParticipation,
  authorizeLessonStaff,
  isAdministrator,
  isTeacher,
  rejectUnless,
  studentActorId,
} from '../services/class-access.js';
import {
  createNextAttempt,
  createOrResumeAttempt,
  getLearningSurface,
  getLearningSurfaceAttempt,
  gradeAttempt,
  LEARNING_SURFACE_KINDS,
  type LearningSurfaceAttemptRow,
  type LearningSurfaceKind,
  type LearningSurfaceRow,
  listLearningSurfaceRenderers,
  listLessonAttempts,
  listStudentAttempts,
  softDeleteLearningSurface,
  submitAttempt,
  updateAttemptProgress,
  upsertLearningSurface,
  validateLearningContentRef,
} from '../services/learning-surface-service.js';
import { sendSafeError } from '../utils/error-handler.js';
import {
  authorizeAssignmentAccess,
  ensureAssignmentAttempt,
  ensureAssignmentSurface,
  findAssignmentLocator,
  findAssignmentSurface,
} from '../services/assignment-attempt-bridge.js';
import { summarizeLessonSurfaces } from '../services/learning-surface-summary.js';

function requestSession(req: Request): AccessSession {
  return (req as Request & { session?: AccessSession }).session!;
}

function isStaff(session: AccessSession): boolean {
  return isAdministrator(session) || isTeacher(session);
}

interface AttemptAccess {
  attempt: LearningSurfaceAttemptRow;
  surface: LearningSurfaceRow;
  staff: boolean;
  /** 学生 = studentActorId；教师 / 管理员 = actorUserId（预览 attempt 的归属人） */
  actorId: string;
}

/** 加载 attempt 并做对象级授权；失败时已写响应并返回 null。 */
function loadAttemptWithAccess(req: Request, res: Response, db: Database.Database): AttemptAccess | null {
  const session = requestSession(req);
  const attempt = getLearningSurfaceAttempt(db, req.params.id);
  if (!attempt) {
    res.status(404).json({ success: false, error: 'Attempt not found' });
    return null;
  }

  // 容器删除后 attempt 仍需可追溯：历史视图允许读到已软删的 Surface。
  const surface = getLearningSurface(db, attempt.surface_id, { includeDeleted: true });
  if (!surface) {
    res.status(404).json({ success: false, error: 'Surface not found' });
    return null;
  }

  if (isStaff(session)) {
    if (rejectUnless(res, authorizeLessonStaff(db, session, surface.lesson_id))) return null;
    const actor = actorUserId(session);
    if (!actor) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return null;
    }
    return { attempt, surface, staff: true, actorId: actor };
  }

  const actor = studentActorId(session);
  if (!actor) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return null;
  }
  if (attempt.is_preview) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return null;
  }
  if (attempt.student_id !== actor) {
    res.status(403).json({ success: false, error: 'Forbidden: cannot access another student attempt' });
    return null;
  }
  if (rejectUnless(res, authorizeLessonParticipation(db, session, surface.lesson_id))) return null;
  return { attempt, surface, staff: false, actorId: actor };
}

export function registerLearningSurfaceRoutes(ctx: ServerContext): void {
  const { app } = ctx;
  const db = kernelContainer.db;

  // ── 渲染器目录 ──────────────────────────────────────────────────────────
  app.get('/api/learning-surface-renderers', requireScopedAuth('authenticated'), (_req: Request, res: Response) => {
    const renderers = listLearningSurfaceRenderers();
    res.json({ ok: true, data: renderers, total: renderers.length });
  });

  // ── Surface 管理（阶段 3 的白板 / 学案容器接线调用）────────────────────
  app.post('/api/learning-surfaces', requireScopedAuth('class-staff'), (req: Request, res: Response) => {
    try {
      const session = requestSession(req);
      const { lessonId, kind, ownerId, contentRef } = (req.body || {}) as Record<string, unknown>;

      if (typeof lessonId !== 'string' || !lessonId) {
        return res.status(400).json({ success: false, error: 'lessonId is required' });
      }
      if (typeof kind !== 'string' || !(LEARNING_SURFACE_KINDS as readonly string[]).includes(kind)) {
        return res.status(400).json({ success: false, error: 'Invalid surface kind' });
      }
      if (typeof ownerId !== 'string' || !ownerId.trim()) {
        return res.status(400).json({ success: false, error: 'ownerId is required' });
      }
      if (rejectUnless(res, authorizeLessonStaff(db, session, lessonId))) return;

      const parsed = validateLearningContentRef(contentRef);
      if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });

      const result = upsertLearningSurface(db, {
        lessonId,
        kind: kind as LearningSurfaceKind,
        ownerId: ownerId.trim(),
        contentRef: parsed.value,
      });
      if (!result.ok) return res.status(result.status).json({ success: false, error: result.error });

      res.status(result.created ? 201 : 200).json({ ...result.surface, created: result.created });
    } catch (err: unknown) {
      sendSafeError(res, err);
    }
  });

  // 宿主（白板 learning_surface 元素 / 学案活动）读取单个 Surface 的内容引用。
  app.get('/api/learning-surfaces/:id', requireScopedAuth('authenticated'), (req: Request, res: Response) => {
    try {
      const session = requestSession(req);
      const surface = getLearningSurface(db, req.params.id);
      if (!surface) return res.status(404).json({ success: false, error: 'Surface not found' });

      if (isStaff(session)) {
        if (rejectUnless(res, authorizeLessonStaff(db, session, surface.lesson_id))) return;
      } else {
        // 班级级作业 Surface（lesson_id 为空）不属于任何课时，学生不经此入口读取。
        if (!surface.lesson_id) return res.status(404).json({ success: false, error: 'Surface not found' });
        if (rejectUnless(res, authorizeLessonParticipation(db, session, surface.lesson_id))) return;
      }

      res.json(surface);
    } catch (err: unknown) {
      sendSafeError(res, err);
    }
  });

  app.patch('/api/learning-surfaces/:id', requireScopedAuth('class-staff'), (req: Request, res: Response) => {
    try {
      const session = requestSession(req);
      const surface = getLearningSurface(db, req.params.id);
      if (!surface) return res.status(404).json({ success: false, error: 'Surface not found' });
      if (rejectUnless(res, authorizeLessonStaff(db, session, surface.lesson_id))) return;

      const parsed = validateLearningContentRef(req.body?.contentRef);
      if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });

      const result = upsertLearningSurface(db, {
        lessonId: surface.lesson_id,
        kind: surface.kind,
        ownerId: surface.owner_id,
        contentRef: parsed.value,
      });
      if (!result.ok) return res.status(result.status).json({ success: false, error: result.error });
      res.json(result.surface);
    } catch (err: unknown) {
      sendSafeError(res, err);
    }
  });

  app.delete('/api/learning-surfaces/:id', requireScopedAuth('class-staff'), (req: Request, res: Response) => {
    try {
      const session = requestSession(req);
      const surface = getLearningSurface(db, req.params.id);
      if (!surface) return res.status(404).json({ success: false, error: 'Surface not found' });
      if (rejectUnless(res, authorizeLessonStaff(db, session, surface.lesson_id))) return;

      softDeleteLearningSurface(db, surface.id);
      res.json({ success: true });
    } catch (err: unknown) {
      sendSafeError(res, err);
    }
  });

  // ── attempt 创建 / 续用 ─────────────────────────────────────────────────
  app.post('/api/learning-surface-attempts', requireScopedAuth('authenticated'), (req: Request, res: Response) => {
    try {
      const session = requestSession(req);
      const { surfaceId, assignmentId, lessonId, preview } = (req.body || {}) as Record<string, unknown>;

      const staff = isStaff(session);
      const actor = staff ? actorUserId(session) : studentActorId(session);
      if (!actor) return res.status(403).json({ success: false, error: 'Forbidden' });

      // 作业通道：前端只知道 assignmentId，由桥接层解析 / 创建 kind='assignment' 的 Surface。
      if (typeof assignmentId === 'string' && assignmentId) {
        const locator = findAssignmentLocator(db, assignmentId);
        if (!locator) return res.status(404).json({ success: false, error: 'Assignment not found' });
        if (rejectUnless(res, authorizeAssignmentAccess(db, session, locator, staff ? 'staff' : 'member'))) return;

        const surface = ensureAssignmentSurface(db, locator);
        const isPreview = staff && preview !== false ? 1 : 0;
        const result = isPreview
          ? createOrResumeAttempt(db, surface, { studentId: actor, isPreview })
          : { attempt: ensureAssignmentAttempt(db, locator, actor), created: false, readOnly: false };
        return res.status(result.created ? 201 : 200).json({
          ...result.attempt,
          created: result.created,
          readOnly: result.readOnly,
        });
      }

      if (typeof surfaceId !== 'string' || !surfaceId) {
        return res.status(400).json({ success: false, error: 'surfaceId or assignmentId is required' });
      }

      const surface = getLearningSurface(db, surfaceId);
      if (!surface) return res.status(404).json({ success: false, error: 'Surface not found' });
      if (lessonId != null && lessonId !== surface.lesson_id) {
        return res.status(400).json({ success: false, error: 'surfaceId does not belong to lessonId' });
      }

      if (staff) {
        if (rejectUnless(res, authorizeLessonStaff(db, session, surface.lesson_id))) return;
      } else if (rejectUnless(res, authorizeLessonParticipation(db, session, surface.lesson_id))) {
        return;
      }

      // 教师预览默认 is_preview = 1；显式 preview: false 才写入学生统计口径。
      const isPreview = staff && preview !== false ? 1 : 0;
      const result = createOrResumeAttempt(db, surface, { studentId: actor, isPreview });
      res.status(result.created ? 201 : 200).json({
        ...result.attempt,
        created: result.created,
        readOnly: result.readOnly,
      });
    } catch (err: unknown) {
      sendSafeError(res, err);
    }
  });

  app.get('/api/learning-surface-attempts/mine', requireScopedAuth('authenticated'), (req: Request, res: Response) => {
    try {
      const session = requestSession(req);
      const actor = studentActorId(session);
      if (!actor) return res.json([]);

      const lessonId = typeof req.query.lessonId === 'string' ? req.query.lessonId : undefined;
      const assignmentId = typeof req.query.assignmentId === 'string' ? req.query.assignmentId : undefined;
      let surfaceId: string | undefined;
      if (assignmentId) {
        const surface = findAssignmentSurface(db, assignmentId);
        if (!surface) return res.json([]);
        surfaceId = surface.id;
      }

      const rows = listStudentAttempts(db, {
        studentId: actor,
        lessonId,
        surfaceId,
        includePreview: isStaff(session),
      });
      res.json(rows);
    } catch (err: unknown) {
      sendSafeError(res, err);
    }
  });

  // ── 进度 / 提交 / 评分 ──────────────────────────────────────────────────
  app.patch('/api/learning-surface-attempts/:id', requireScopedAuth('authenticated'), (req: Request, res: Response) => {
    try {
      const access = loadAttemptWithAccess(req, res, db);
      if (!access) return;
      const body = (req.body || {}) as Record<string, unknown>;

      // 教师评分：可覆盖 auto_score，写最终 score。
      if (access.staff && (body.score !== undefined || body.status === 'graded')) {
        if (body.score === undefined) {
          return res.status(400).json({ success: false, error: 'score is required' });
        }
        const result = gradeAttempt(db, access.attempt, {
          score: Number(body.score),
          maxScore: body.maxScore == null ? null : Number(body.maxScore),
          gradedBy: access.actorId,
        });
        if (!result.ok) return res.status(result.status).json({ success: false, error: result.error });
        return res.json(result.attempt);
      }

      const patch: Parameters<typeof updateAttemptProgress>[2] = {};
      if ('state' in body) patch.state = body.state;
      if (body.completion !== undefined) patch.completion = Number(body.completion);
      if (body.autoScore !== undefined) patch.autoScore = body.autoScore == null ? null : Number(body.autoScore);
      if (body.maxScore !== undefined) patch.maxScore = body.maxScore == null ? null : Number(body.maxScore);

      const result = updateAttemptProgress(db, access.attempt, patch);
      if (!result.ok) return res.status(result.status).json({ success: false, error: result.error });
      res.json(result.attempt);
    } catch (err: unknown) {
      sendSafeError(res, err);
    }
  });

  app.post(
    '/api/learning-surface-attempts/:id/submit',
    requireScopedAuth('authenticated'),
    (req: Request, res: Response) => {
      try {
        const access = loadAttemptWithAccess(req, res, db);
        if (!access) return;
        const body = (req.body || {}) as Record<string, unknown>;

        const result = submitAttempt(db, access.attempt, {
          autoScore: body.autoScore == null ? null : Number(body.autoScore),
          maxScore: body.maxScore == null ? null : Number(body.maxScore),
          payload: 'payload' in body ? body.payload : undefined,
        });
        if (!result.ok) return res.status(result.status).json({ success: false, error: result.error });
        res.json(result.attempt);
      } catch (err: unknown) {
        sendSafeError(res, err);
      }
    },
  );

  app.post(
    '/api/learning-surface-attempts/:id/attempts',
    requireScopedAuth('authenticated'),
    (req: Request, res: Response) => {
      try {
        const access = loadAttemptWithAccess(req, res, db);
        if (!access) return;
        if (access.surface.deleted_at) {
          return res.status(404).json({ success: false, error: 'Surface not found' });
        }

        const result = createNextAttempt(db, access.surface, {
          studentId: access.actorId,
          isPreview: access.attempt.is_preview,
        });
        if (!result.ok) return res.status(result.status).json({ success: false, error: result.error });
        res.status(201).json(result.attempt);
      } catch (err: unknown) {
        sendSafeError(res, err);
      }
    },
  );

  // ── 教师：按课时查看全班 attempts ───────────────────────────────────────
  app.get(
    '/api/lessons/:lessonId/learning-surface-attempts',
    requireScopedAuth('class-staff'),
    (req: Request, res: Response) => {
      try {
        const session = requestSession(req);
        const lessonId = req.params.lessonId;
        if (rejectUnless(res, authorizeLessonStaff(db, session, lessonId))) return;

        const rows = listLessonAttempts(db, lessonId, { includePreview: req.query.includePreview === '1' });
        res.json(rows);
      } catch (err: unknown) {
        sendSafeError(res, err);
      }
    },
  );

  // ── 教师：课时级 Surface 学习分析（课堂内面板）────────────────────────
  app.get(
    '/api/lessons/:lessonId/learning-surface-summary',
    requireScopedAuth('class-staff'),
    (req: Request, res: Response) => {
      try {
        const session = requestSession(req);
        const lessonId = req.params.lessonId;
        if (rejectUnless(res, authorizeLessonStaff(db, session, lessonId))) return;
        const classId = typeof req.query.classId === 'string' && req.query.classId ? req.query.classId : null;
        if (classId && rejectUnless(res, authorizeClass(db, session, classId, 'staff'))) return;
        res.json(summarizeLessonSurfaces(db, { lessonId, classId }));
      } catch (err: unknown) {
        sendSafeError(res, err);
      }
    },
  );
}
