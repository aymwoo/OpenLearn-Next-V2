import fs from 'node:fs';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getUploadsDir } from '../utils/paths.js';
import { getCookieToken, getValidSession, getActorId, requireAuth } from '../middleware/auth.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import { sendSafeError } from '../utils/error-handler.js';
import { randomId } from '../utils/id.js';
import { classRoom, pseudoRoomStudentId } from '../presence.js';
import { parsePagination } from '../utils/pagination.js';
import type { ServerContext } from '../context.js';
import { diagnosticService, VALID_ICEBREAKER_MOODS } from '../services/diagnostic-service.js';
import { authorizePeerReviewSubmission } from '../services/peer-review-access.js';
import { whiteboardService } from '../services/whiteboard-service.js';
import { LessonService } from '../services/lesson-service.js';
import { segmentGateService } from '../services/segment-gate-service.js';
import {
  authorizeClass,
  authorizeLessonStaff,
  canSeeLesson,
  isAdministrator,
  isTeacher,
  lessonVisibilityScope,
  redactAnswerPayload,
  rejectUnless,
  studentActorId,
  teacherCanSeeStudent,
} from '../services/class-access.js';
import { IStageGuardServiceToken } from '../../packages/core/di/interfaces.js';

export { LessonService };

/**
 * 校验当前用户对课程的管理权 (水平越权 IDOR 防护)
 * - 管理员 (administrator) 拥有全局管辖权
 * - 教师仅可修改/删除本人创建的课程 (creator_id === session.userId)
 * - 兼容历史未记录 creator_id 的课程
 */
export function checkLessonOwnership(
  req: any,
  lessonId: string,
): { allowed: boolean; status: number; error?: string; lesson?: any } {
  const token = getCookieToken(req);
  const session = req.session || (token ? getValidSession(token) : null);
  return new LessonService(
    kernelContainer.db,
    kernelContainer.commandBus,
    kernelContainer.aiService,
    kernelContainer.getReadDb(),
  ).checkOwnership(lessonId, session);
}

/**
 * 白板写操作权限守卫中间件 (POST / PUT / DELETE / reset)
 * 1. 强制登录验证：匿名请求直接 401 Unauthorized；
 * 2. 随堂作业学生专属白板 (assignment-${assignmentId}-student-${studentId})：
 *    - 学生仅允许修改本人的作业白板 (匹配 -student-{studentId} 后缀)
 *    - 跨学生越权修改直接 403 Forbidden
 *    - 教师与管理员放行 (用于批注与点评辅导)
 * 3. 课程主教学白板 (!assignment-)：
 *    - 仅课程创建教师或管理员可修改 (checkLessonOwnership 逻辑)
 *    - 学生角色一律 403 Forbidden
 */
export function requireWhiteboardWriteAccess() {
  return (req: any, res: any, next: any) => {
    const { id } = req.params;
    const token = getCookieToken(req);
    const session = req.session || (token ? getValidSession(token) : null);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    req.session = session;

    const isAdmin =
      session.username === 'admin' ||
      session.userId === 'usr_admin' ||
      session.role === 'admin' ||
      session.role === 'administrator';

    // ── 随堂作业专属白板 (assignment-*) ──
    if (id.startsWith('assignment-')) {
      if (isAdmin || session.role === 'teacher') {
        return next();
      }
      if (session.role === 'student') {
        const studentMatch = id.match(/-student-([^-]+)$/);
        const targetStudentId = studentMatch ? studentMatch[1] : null;
        const currentStudentId = session.studentId || session.userId;
        if (targetStudentId && currentStudentId && targetStudentId === currentStudentId) {
          return next();
        }
        return res.status(403).json({
          success: false,
          error: "Forbidden: You do not have permission to modify another student's assignment whiteboard",
        });
      }
      return res.status(403).json({ success: false, error: 'Forbidden: Invalid role for whiteboard write' });
    }

    // ── 课程主教学白板 ──
    const isTeacherOrAdmin = isAdmin || session.role === 'teacher';
    if (!isTeacherOrAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Students cannot modify classroom whiteboards',
      });
    }

    const lesson = new LessonService(
      kernelContainer.db,
      kernelContainer.commandBus,
      kernelContainer.aiService,
      kernelContainer.getReadDb(),
    ).getLesson(id);
    if (!lesson) {
      return res.status(404).json({ success: false, error: 'Lesson not found' });
    }

    if (
      isAdmin ||
      !lesson.creator_id ||
      lesson.creator_id === session.userId ||
      lesson.creator_id === session.username
    ) {
      return next();
    }

    return res.status(403).json({
      success: false,
      error:
        'Forbidden: You do not have permission to modify this lesson whiteboard because it was created by another teacher',
    });
  };
}

/**
 * 白板读操作权限（SEC-AUTH #127）。
 *
 * - 教师/管理员：沿用既有行为，可读取任意课节与作业白板（课堂观察、作业批注）；
 * - 学生 · 作业伪课节（`assignment-<aid>-student-<sid>`）：只允许 sid === 本人；
 * - 学生 · 真实课节：与 socket `canJoinLessonRoom` 同口径 —— 该课节已有开课记录时，
 *   仅开课班级的成员可读；未开课（自学/预览）不额外设限。
 */
export function canReadWhiteboard(session: any, roomId: string): boolean {
  if (!session) return false;
  if (isAdministrator(session) || isTeacher(session)) return true;

  const actorId = studentActorId(session) || session.userId || null;
  const pseudoSid = pseudoRoomStudentId(roomId);
  if (pseudoSid !== null) return !!actorId && pseudoSid === actorId;

  const db = kernelContainer.getReadDb();
  const sessionRow = db
    .prepare('SELECT class_id FROM classroom_sessions WHERE lesson_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(roomId) as { class_id: string } | undefined;
  const classId = sessionRow?.class_id ?? null;
  if (!classId) return true;
  if (!actorId) return false;
  const member = db
    .prepare('SELECT 1 AS ok FROM class_students WHERE class_id = ? AND student_id = ? LIMIT 1')
    .get(classId, actorId) as { ok: number } | undefined;
  return !!member;
}

export function registerLessonsRoutes(ctx: ServerContext) {
  const { app } = ctx;
  const lessonService = new LessonService(
    kernelContainer.db,
    kernelContainer.commandBus,
    kernelContainer.aiService,
    kernelContainer.getReadDb(),
  );

  app.get('/api/lessons', requireScopedAuth('authenticated'), (req, res) => {
    // A7: 分页信封 { data, total, page, pageSize }（pageSize=all 返回全量）
    const pg = parsePagination(req.query as any);
    // 按角色收窄：管理员看全部；教师只见自己教的；学生只见自己班的。
    const scope = lessonVisibilityScope(kernelContainer.getReadDb(), (req as any).session);
    res.json(lessonService.listLessons(pg, scope));
  });

  app.get('/api/lessons/:id', requireScopedAuth('authenticated'), (req, res) => {
    try {
      const session = (req as any).session;
      const lesson = lessonService.getLesson(req.params.id);
      // 先判存在性（404），再判可见性（403）：不存在的课节没有「越权」可言，
      // 直接报 403 会把「不存在」与「无权访问」混为一谈。
      if (!lesson) {
        return res.status(404).json({ success: false, error: 'Lesson not found' });
      }
      // 列表收窄了，单条也得同一口径 —— 否则学生仍能按 id 拉任意课节内容。
      if (!canSeeLesson(kernelContainer.getReadDb(), session, req.params.id)) {
        return res.status(403).json({ success: false, error: 'Forbidden: no access to this lesson' });
      }
      res.json(lesson);
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // ── 作业上传与互评插件 API ──────────────────────────────────────────────
  app.get('/api/lessons/:lessonId/eval-submissions', requireScopedAuth('class-member'), (req, res) => {
    try {
      const session = (req as any).session;
      if (!isAdministrator(session) && !isTeacher(session)) {
        const self = studentActorId(session);
        const rows = lessonService.getEvalSubmissions(req.params.lessonId);
        return res.json(rows.filter((row: any) => row.student_id === self || row.studentId === self));
      }
      if (rejectUnless(res, authorizeLessonStaff(kernelContainer.getReadDb(), session, req.params.lessonId))) return;
      res.json(lessonService.getEvalSubmissions(req.params.lessonId));
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  app.get('/api/lessons/:lessonId/eval-grades', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      if (
        rejectUnless(res, authorizeLessonStaff(kernelContainer.getReadDb(), (req as any).session, req.params.lessonId))
      )
        return;
      res.json(lessonService.getEvalGrades(req.params.lessonId));
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  app.get('/api/eval-submissions/:submissionId/reviews', requireScopedAuth('self'), (req, res) => {
    try {
      const session = (req as any).session;
      const submission = kernelContainer
        .getReadDb()
        .prepare('SELECT lesson_id, student_id FROM plugin_submissions WHERE id = ?')
        .get(req.params.submissionId) as { lesson_id: string; student_id: string } | undefined;
      if (!submission) return res.status(404).json({ error: 'Submission not found' });
      if (isAdministrator(session) || isTeacher(session)) {
        if (rejectUnless(res, authorizeLessonStaff(kernelContainer.getReadDb(), session, submission.lesson_id))) return;
      } else if (studentActorId(session) !== submission.student_id) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      res.json(lessonService.getSubmissionReviews(req.params.submissionId));
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  app.get('/api/lessons/:lessonId/students/:studentId/eval-status', requireScopedAuth('self'), (req, res) => {
    try {
      const { lessonId, studentId } = req.params;
      const session = (req as any).session;
      if (isAdministrator(session) || isTeacher(session)) {
        if (rejectUnless(res, authorizeLessonStaff(kernelContainer.getReadDb(), session, lessonId))) return;
      } else if (studentActorId(session) !== studentId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      res.json(lessonService.getStudentEvalStatus(lessonId, studentId));
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // ── v0.6.1 数据真实性：学生端「作业提交 / 互评」专用写入端点 ────────────
  // 此前学生端走 /api/commands（教师专用端点）→ 必 403，每次点击报错。
  // 学生只能以**本人身份**提交/互评（session.studentId 强制对齐）。
  app.post('/api/lessons/:lessonId/eval-submissions', requireScopedAuth('self'), (req, res) => {
    try {
      const session = (req as any).session;
      const { studentId, filePath, textContent } = req.body || {};
      // Issue #226：管理员判定统一走会话角色唯一真源（与 requireAuth / getActorId 同口径）。
      const isPrivileged = isAdministrator(session);
      const targetStudentId = isPrivileged ? String(studentId || '') : String(session?.studentId || '');
      if (!targetStudentId) {
        return res.status(400).json({ success: false, error: 'Missing studentId' });
      }
      if (filePath && typeof filePath !== 'string') {
        return res.status(400).json({ success: false, error: 'filePath must be a string' });
      }
      const now = Date.now();
      const existing = kernelContainer.db
        .prepare('SELECT id, version FROM plugin_submissions WHERE lesson_id = ? AND student_id = ?')
        .get(req.params.lessonId, targetStudentId) as { id: string; version: number } | undefined;

      if (existing) {
        // 重复提交 = 新版本（面板 toast 展示版本号）
        const newVersion = (existing.version ?? 1) + 1;
        kernelContainer.db
          .prepare('UPDATE plugin_submissions SET file_path = ?, version = ?, updated_at = ? WHERE id = ?')
          .run(filePath || '', newVersion, now, existing.id);
        return res.json({ success: true, submissionId: existing.id, version: newVersion });
      }

      const id = randomId('evalsub_');
      kernelContainer.db
        .prepare(
          `INSERT INTO plugin_submissions (id, assignment_id, lesson_id, student_id, file_path, version, created_at, updated_at)
           VALUES (?, NULL, ?, ?, ?, 1, ?, ?)`,
        )
        .run(id, req.params.lessonId, targetStudentId, filePath || '', now, now);
      if (textContent) {
        console.log(`[Eval] Student ${targetStudentId} submitted text content for lesson ${req.params.lessonId}`);
      }
      res.json({ success: true, submissionId: id, version: 1 });
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  app.post('/api/lessons/:lessonId/eval-submissions/:submissionId/reviews', requireScopedAuth('self'), (req, res) => {
    try {
      const session = (req as any).session;
      const { score, comment } = req.body || {};
      // Issue #226：管理员判定统一走会话角色唯一真源（与 requireAuth / getActorId 同口径）。
      const isPrivileged = isAdministrator(session);
      const reviewerId = isPrivileged
        ? String((req.body || {}).reviewerId || session?.studentId || '')
        : String(session?.studentId || '');
      if (!reviewerId) {
        return res.status(400).json({ success: false, error: 'Missing reviewerId' });
      }
      const numericScore = Number(score);
      if (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > 100) {
        return res.status(400).json({ success: false, error: 'Score must be 0-100' });
      }
      // 对象级授权：与插件命令路径（assignment.eval.submitReview）同源 —— Issue #217
      // 补齐「禁止自评」「必须持有互评任务」「截止时间」三项判定。
      const decision = authorizePeerReviewSubmission(kernelContainer.db, {
        submissionId: req.params.submissionId,
        lessonId: req.params.lessonId,
        reviewerId,
        privileged: isPrivileged,
      });
      if (!decision.ok) {
        return res.status(decision.status).json({ success: false, error: decision.error });
      }
      const id = randomId('evalrev_');
      const now = Date.now();
      kernelContainer.db
        .prepare(
          `INSERT INTO plugin_peer_reviews (id, submission_id, reviewer_id, score, comment, assignment_id, task_id, anonymous, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'submitted', ?, ?)
           ON CONFLICT(submission_id, reviewer_id) DO UPDATE SET
             score = excluded.score,
             comment = excluded.comment,
             assignment_id = excluded.assignment_id,
             task_id = excluded.task_id,
             status = 'submitted',
             updated_at = excluded.updated_at`,
        )
        .run(
          id,
          req.params.submissionId,
          reviewerId,
          numericScore,
          comment || '',
          decision.assignmentId,
          decision.taskId,
          now,
          now,
        );
      res.json({ success: true, reviewId: id });
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // ── 课程发布向导：AI 教学大纲生成 ────────────────────────────────────────
  // 昂贵的 LLM 调用，挂 aiLimiter（与 /api/agent/chat 同级限流）；测试环境下
  // aiLimiter 可能为 null，按 plugins.ts 的先例降级为透传中间件。
  const safeAiLimiter =
    typeof ctx.aiLimiter === 'function' ? ctx.aiLimiter : (_req: any, _res: any, next: any) => next();

  app.post(
    '/api/lessons/generate-outline',
    requireAuth('teacher', 'administrator'),
    safeAiLimiter,
    async (req, res) => {
      try {
        const { title, category, description, timeline, lang } = req.body || {};
        const content = await lessonService.generateOutlineWithAi({
          title,
          category,
          description,
          timeline,
          lang,
        });
        res.json({ success: true, content });
      } catch (e: any) {
        console.error('[Generate Outline Error]:', (e as Error).message);
        sendSafeError(res, e);
      }
    },
  );

  app.post('/api/lessons', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { title, content } = req.body;
      const session = (req as any).session;
      const creatorId = session?.userId || session?.username || 'usr_teacher';
      const actorId = getActorId(req) || 'teacher';
      const result = await lessonService.createLesson({ title, content, creatorId }, actorId);
      res.json({ success: true, result });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.put('/api/lessons/:id/timeline', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { id } = req.params;
      const ownership = checkLessonOwnership(req, id);
      if (!ownership.allowed) {
        return res.status(ownership.status).json({ success: false, error: ownership.error });
      }

      const { timeline } = req.body;
      const actorId = getActorId(req) || 'teacher';
      const result = await lessonService.updateTimeline({ lessonId: id, timeline }, actorId);
      res.json({ success: true, result });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.put('/api/lessons/:id/progress-mode', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { id } = req.params;
      const ownership = checkLessonOwnership(req, id);
      if (!ownership.allowed) {
        return res.status(ownership.status).json({ success: false, error: ownership.error });
      }

      const { progressMode, progressConditions } = req.body;
      const result = await lessonService.updateProgressMode(id, progressMode, progressConditions);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // ── 交互白板 API ──────────────────────────────────────────────────────────
  app.get('/api/lessons/:id/whiteboard', requireScopedAuth('class-member'), (req, res) => {
    try {
      const session = (req as any).session;
      const roomId = req.params.id;
      if (!canReadWhiteboard(session, roomId)) {
        return res.status(403).json({ success: false, error: 'Forbidden: no access to this whiteboard' });
      }
      const elements = whiteboardService.getWhiteboardElements(roomId);
      const isStaff = isAdministrator(session) || isTeacher(session);
      // 学生视角剥离答案字段（correctIndex / correctAnswer 等）；
      // 判分结果由 POST /quiz-submit 在提交后回传，前端已按此设计。
      res.json(
        isStaff ? elements : elements.map((el) => ({ ...el, data: redactAnswerPayload(el.data) as string })),
      );
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/lessons/:id/whiteboard/reset', requireWhiteboardWriteAccess(), async (req, res) => {
    try {
      const result = whiteboardService.resetWhiteboard(req.params.id);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/lessons/:id/whiteboard', requireWhiteboardWriteAccess(), async (req, res) => {
    try {
      const { id } = req.params;
      const { type, data } = req.body;
      const actorId = getActorId(req) || 'user-frontend';
      const result = await whiteboardService.drawElement({
        lessonId: id,
        type,
        data,
        actorId,
      });
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.put('/api/lessons/:id/whiteboard/:elementId', requireWhiteboardWriteAccess(), async (req, res) => {
    try {
      const { id, elementId } = req.params;
      const { data } = req.body;
      const actorId = getActorId(req) || 'user-frontend';
      const result = await whiteboardService.updateElement({
        lessonId: id,
        elementId,
        data,
        actorId,
      });
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.delete('/api/lessons/:id/whiteboard', requireWhiteboardWriteAccess(), async (req, res) => {
    try {
      const { id } = req.params;
      const actorId = getActorId(req) || 'user-frontend';
      const result = await whiteboardService.clearWhiteboard(id, actorId);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.delete('/api/lessons/:id/whiteboard/:elementId', requireWhiteboardWriteAccess(), async (req, res) => {
    try {
      const { id, elementId } = req.params;
      const actorId = getActorId(req) || 'user-frontend';
      const result = await whiteboardService.deleteElement(id, elementId, actorId);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // ── 教学环节门禁服务端权威判定 ───────────────────────────────────────────
  app.post('/api/lessons/:id/stage-access', requireAuth('student', 'teacher', 'administrator'), async (req, res) => {
    try {
      const { id: lessonId } = req.params;
      const session = (req as any).session;
      const studentId = session.studentId || session.userId || 'guest';
      const { currentStageId = null, targetStageId, metadata } = req.body ?? {};

      if (typeof targetStageId !== 'string' || targetStageId.length === 0) {
        return res.status(400).json({ error: 'targetStageId is required' });
      }

      const pipeline = await kernelContainer.serviceRegistry.resolve(IStageGuardServiceToken);
      const result = await pipeline.checkAccess({
        studentId,
        lessonId,
        currentStageId,
        targetStageId,
        metadata,
      });

      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // 教学环节进入条件。全班指针由教师推进；这里只回答「这名学生能不能看到该环节」。
  // 未达标返回 403，正文仍是完整判定（原因与进度），供学生端展示锁定。
  app.post('/api/lessons/:id/segment-access', requireAuth('student', 'teacher', 'administrator'), async (req, res) => {
    try {
      const { id: lessonId } = req.params;
      const session = (req as any).session;
      const role = session?.role;
      const selfId = session?.studentId || session?.userId;
      const targetSegmentId = req.body?.targetSegmentId;
      if (typeof targetSegmentId !== 'string' || targetSegmentId.trim().length === 0) {
        return res.status(400).json({ error: 'targetSegmentId is required' });
      }

      const previewId = typeof req.body?.studentId === 'string' ? req.body.studentId.trim() : '';
      const isStaff = role === 'teacher' || role === 'administrator';
      const evaluatingOther = isStaff && !!previewId && previewId !== selfId;
      const studentId = evaluatingOther ? previewId : selfId;
      if (!studentId) return res.status(403).json({ error: 'Student identity required' });

      if (evaluatingOther && isTeacher(session)) {
        if (!teacherCanSeeStudent(kernelContainer.db, session, studentId)) {
          return res.status(403).json({ error: 'Forbidden: Cannot evaluate student outside your classes' });
        }
      }

      const result = await segmentGateService.evaluate({
        studentId,
        lessonId,
        targetSegmentId: targetSegmentId.trim().slice(0, 128),
        bypass: isStaff && !evaluatingOther,
        enforceClassSegment: role === 'student',
      });
      res.status(result.allowed ? 200 : 403).json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // ── Quiz submission (student) ──────────────────────────────────────────────
  app.post('/api/lessons/:id/quiz-submit', requireAuth('student', 'teacher', 'administrator'), async (req, res) => {
    try {
      const { id: lessonId } = req.params;
      const { elementId, answer, timeSpentMs } = req.body;
      const session = (req as any).session;
      const studentId = session.studentId || session.userId || 'guest';
      const studentName = session.studentName || session.name || null;

      const result = await diagnosticService.submitQuiz({
        lessonId,
        elementId,
        studentId,
        studentName,
        answer,
        timeSpentMs,
        role: session?.role || 'student',
      });

      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // ── Quiz submission counts (all authenticated roles) ───────────────────────
  app.get('/api/lessons/:id/quiz-counts', requireScopedAuth('authenticated'), (req, res) => {
    try {
      const { id: lessonId } = req.params;
      const quizzes = diagnosticService.getQuizCounts(lessonId);
      res.json({ quizzes });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // ── Quiz submissions retrieval (teacher) ────────────────────────────────────
  app.get('/api/lessons/:id/quiz-submissions', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { id: lessonId } = req.params;
      if (rejectUnless(res, authorizeLessonStaff(kernelContainer.getReadDb(), (req as any).session, lessonId))) return;
      const quizzes = diagnosticService.getQuizSubmissions(lessonId);
      res.json({ success: true, quizzes });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // ── AI 助教协同 ────────────────────────────────────────────────────────────
  app.post('/api/lessons/:id/ai-tutor', requireAuth('student', 'teacher', 'administrator'), async (req, res) => {
    try {
      const { elements } = req.body;
      const hint = await lessonService.generateAiTutorHint(req.params.id, elements);
      res.json({ success: true, hint });
    } catch (e: any) {
      console.error('AI Tutor error:', e);
      sendSafeError(res, e);
    }
  });

  // ── 课程删除 API (级联删除事务) ──────────────────────────────────────────
  app.delete('/api/lessons/:id', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { id } = req.params;
      const ownership = checkLessonOwnership(req, id);
      if (!ownership.allowed) {
        return res.status(ownership.status).json({ success: false, error: ownership.error });
      }

      const result = lessonService.deleteLessonCascade(id);
      if (!result.deleted) {
        return res.status(404).json({ error: 'Lesson not found' });
      }

      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // ── 课程统计 API (删除确认弹窗用) ─────────────────────────────────────────
  app.get('/api/lessons/:id/stats', requireScopedAuth('authenticated'), (req, res) => {
    try {
      res.json(lessonService.getLessonStats(req.params.id));
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // ── 课程复制 API ──────────────────────────────────────────────────────────
  app.post('/api/lessons/:id/clone', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { id } = req.params;
      const session = (req as any).session;
      const creatorId = session?.userId || session?.username || 'usr_teacher';
      const cloned = lessonService.cloneLesson(id, creatorId);
      res.json({ success: true, lesson: cloned });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // ── Pre-Class Diagnostic Hub & Pre-flight Healthcheck APIs ────────────────
  app.get('/api/lessons/:lessonId/pre-class-diagnostic', requireScopedAuth('authenticated'), (req, res) => {
    try {
      const lessonId = req.params.lessonId;
      const classId = req.query.classId as string | undefined;
      const result = diagnosticService.getPreClassDiagnostic(lessonId, classId);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // Issue #131: 课前破冰心情打卡（严格校验班级成员权限、mood 枚举校验、按学生幂等去重落库）
  app.post('/api/classes/:classId/checkin/icebreaker', requireScopedAuth('class-member'), (req, res) => {
    try {
      const classId = req.params.classId;
      const session = (req as any).session;
      if (rejectUnless(res, authorizeClass(kernelContainer.db, session, classId, 'member'))) return;

      const { mood, lessonId } = req.body || {};
      if (!mood || typeof mood !== 'string' || !VALID_ICEBREAKER_MOODS.includes(mood as any)) {
        res.status(400).json({
          error: `Invalid mood: ${mood}. Expected one of: ${VALID_ICEBREAKER_MOODS.join(', ')}`,
        });
        return;
      }

      const studentId = studentActorId(session) || 'anonymous';
      const resolvedLessonId = typeof lessonId === 'string' && lessonId.trim() ? lessonId.trim() : (req.query.lessonId as string | undefined);
      const current = diagnosticService.recordIcebreakerCheckin(classId, mood, studentId, resolvedLessonId);

      if (ctx.io) {
        ctx.io.to(classRoom(classId)).emit('classroom:icebreaker_updated', {
          classId,
          lessonId: resolvedLessonId || undefined,
          stats: current,
        });
      }

      res.json({ success: true, stats: current });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/classes/:classId/preflight-health', requireScopedAuth('class-staff'), (req, res) => {
    // v0.6.1 数据真实性：逐项真实探测（数据层延迟 / 课件存储可写 / 内核插件链 /
    // 实时广播总线），健康分 = 通过项占比。此前 SELECT 1 之外全部硬编码
    // 「98 分 + 全部 passed」。
    if (rejectUnless(res, authorizeClass(kernelContainer.db, (req as any).session, req.params.classId, 'staff')))
      return;
    try {
      const classId = req.params.classId;
      // 混合形状：延迟为数值字段，其余为探测结论对象（与客户端 CheckResult 契约一致）
      const checks: Record<string, any> = {};
      let passed = 0;

      // 1. 数据层连通（真实往返延迟）
      const startTime = Date.now();
      kernelContainer.db.prepare('SELECT 1 as alive').get();
      const rttMs = Math.max(2, Date.now() - startTime);
      checks.localApiLatencyMs = rttMs;
      checks.database = { status: 'passed', message: `数据层连通（往返 ${rttMs}ms）` };
      passed += 1;

      // 2. 课件存储目录可写
      try {
        const dir = getUploadsDir();
        fs.mkdirSync(dir, { recursive: true });
        fs.accessSync(dir, fs.constants.W_OK);
        checks.staticResources = { status: 'passed', message: '课件存储目录可写' };
        passed += 1;
      } catch (err: any) {
        checks.staticResources = { status: 'failed', message: `课件存储目录不可写：${err?.message ?? '未知原因'}` };
      }

      // 3. 内核插件链就绪
      const activeRow = kernelContainer.db
        .prepare("SELECT COUNT(*) as n FROM plugins WHERE status = 'active'")
        .get() as { n: number };
      if ((activeRow?.n ?? 0) > 0) {
        checks.pluginSandbox = { status: 'passed', message: `内核插件链就绪（${activeRow.n} 个 active 插件）` };
        passed += 1;
      } else {
        checks.pluginSandbox = { status: 'failed', message: '无 active 插件，内核插件链未就绪' };
      }

      // 4. 实时广播总线
      if (ctx.io) {
        checks.socketMesh = { status: 'passed', message: '实时广播总线在线（Socket.IO 已挂载）' };
        passed += 1;
      } else {
        checks.socketMesh = { status: 'failed', message: 'Socket.IO 未挂载，实时广播不可用' };
      }

      res.json({
        classId,
        timestamp: Date.now(),
        healthScore: Math.round((passed / 4) * 100),
        status: passed === 4 ? 'healthy' : 'degraded',
        checks,
      });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });
}
