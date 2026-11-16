/**
 * 学案包 P1 API：互评、进度催办、导入导出、教师预览（Gitee IKVO15）。
 */
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getCookieToken, getValidSession, requireAuth } from '../middleware/auth.js';
import { sendSafeError } from '../utils/error-handler.js';
import type { ServerContext } from '../context.js';
import { checkLessonOwnership } from './lessons.js';
import { actorUserId, canSeeLesson, isAdministrator, studentActorId } from '../services/class-access.js';
import { LessonActivityError, LessonActivityService } from '../services/lesson-activity-service.js';
import { ActivityPeerReviewService } from '../services/activity-peer-review-service.js';
import { ActivityProgressReportService } from '../services/activity-progress-report-service.js';
import {
  ACTIVITY_PACK_IMPORT_PATH,
  ACTIVITY_PACK_MAX_FILE_BYTES,
  LessonActivityPackTransferService,
} from '../services/lesson-activity-pack-transfer.js';

function sessionOf(req: any) {
  const token = getCookieToken(req);
  return req.session || (token ? getValidSession(token) : null);
}

function staffCanManage(req: any, lessonId: string): { ok: boolean; status: number; error?: string } {
  const ownership = checkLessonOwnership(req, lessonId);
  if (ownership.allowed) return { ok: true, status: 200 };
  return { ok: false, status: ownership.status, error: ownership.error };
}

function sendActivityError(res: any, err: unknown): void {
  if (err instanceof LessonActivityError) {
    res.status(err.statusCode).json({ success: false, error: err.message });
    return;
  }
  sendSafeError(res, err);
}

function parseZipBuffer(body: unknown): Buffer | null {
  if (Buffer.isBuffer(body)) return body;
  if (body && typeof body === 'object' && typeof (body as { zipBase64?: string }).zipBase64 === 'string') {
    return Buffer.from((body as { zipBase64: string }).zipBase64, 'base64');
  }
  return null;
}

export function registerLessonActivityPackP1Routes(ctx: ServerContext): void {
  const { app } = ctx;
  const db = () => kernelContainer.db;
  const readDb = () => kernelContainer.getReadDb?.() ?? kernelContainer.db;
  const activities = () => new LessonActivityService(db());
  const peer = () => new ActivityPeerReviewService(db());
  const report = () => new ActivityProgressReportService(db());
  const transfer = () => new LessonActivityPackTransferService(db());

  app.get('/api/lessons/:lessonId/activity-pack/preview', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { lessonId } = req.params;
      const access = staffCanManage(req, lessonId);
      if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });
      res.json({ success: true, pack: activities().getPreviewPack(lessonId) });
    } catch (err) {
      sendActivityError(res, err);
    }
  });

  app.get(
    '/api/lessons/:lessonId/activity-pack/progress-report',
    requireAuth('teacher', 'administrator'),
    (req, res) => {
      try {
        const { lessonId } = req.params;
        const access = staffCanManage(req, lessonId);
        if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });
        res.json({ success: true, report: report().buildReport(lessonId) });
      } catch (err) {
        sendActivityError(res, err);
      }
    },
  );

  app.post('/api/lessons/:lessonId/activity-pack/nudge', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { lessonId } = req.params;
      const access = staffCanManage(req, lessonId);
      if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });
      const session = sessionOf(req);
      const teacherId = actorUserId(session) || session?.userId;
      if (!teacherId) return res.status(400).json({ success: false, error: 'Teacher identity required' });
      const body = req.body ?? {};
      const result = report().nudgeIncomplete({
        lessonId,
        teacherId,
        activityId: body.activityId ?? null,
        studentIds: Array.isArray(body.studentIds) ? body.studentIds : undefined,
        message: body.message,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendActivityError(res, err);
    }
  });

  app.get('/api/me/activity-nudges', requireAuth('student'), (req, res) => {
    try {
      const studentId = studentActorId(sessionOf(req));
      if (!studentId) return res.status(400).json({ success: false, error: 'Student identity required' });
      res.json({ success: true, nudges: report().listNudgesForStudent(studentId) });
    } catch (err) {
      sendActivityError(res, err);
    }
  });

  app.get('/api/lessons/:lessonId/activity-pack/export', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { lessonId } = req.params;
      const access = staffCanManage(req, lessonId);
      if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });
      const { filename, buffer } = await transfer().exportPack(lessonId);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.send(buffer);
    } catch (err) {
      sendActivityError(res, err);
    }
  });

  app.post(ACTIVITY_PACK_IMPORT_PATH, requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const lessonId = String((req.body && req.body.lessonId) || req.query.lessonId || '');
      if (!lessonId) return res.status(400).json({ success: false, error: 'lessonId is required' });
      const access = staffCanManage(req, lessonId);
      if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });
      const zip = parseZipBuffer(req.body);
      if (!zip) return res.status(400).json({ success: false, error: '请提供 zipBase64' });
      if (zip.length > ACTIVITY_PACK_MAX_FILE_BYTES) {
        return res.status(413).json({ success: false, error: '学案包超过 20MB 上限' });
      }
      const session = sessionOf(req);
      const result = await transfer().importPack(lessonId, zip, {
        authorId: actorUserId(session) || undefined,
        replace: req.body?.replace !== false,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendActivityError(res, err);
    }
  });

  app.post('/api/lessons/:lessonId/peer-reviews/cycles', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { lessonId } = req.params;
      const access = staffCanManage(req, lessonId);
      if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });
      const session = sessionOf(req);
      const createdBy = actorUserId(session) || session?.userId;
      if (!createdBy) return res.status(400).json({ success: false, error: 'Teacher identity required' });
      const body = req.body ?? {};
      const activityIds: string[] = Array.isArray(body.activityIds)
        ? body.activityIds
        : body.activityId
          ? [body.activityId]
          : activities()
              .listActivities(lessonId, { includeHidden: true })
              .filter((item) => item.peerReview && item.visible)
              .map((item) => item.id);
      const result = peer().startCycle({
        activityIds,
        title: body.title,
        anonymous: body.anonymous !== false,
        reviewsPerStudent: body.reviewsPerStudent,
        rubric: body.rubric,
        dueAt: body.dueAt,
        createdBy,
        courseId: body.courseId,
      });
      res.status(201).json({ success: true, ...result });
    } catch (err) {
      sendActivityError(res, err);
    }
  });

  app.get(
    '/api/lessons/:lessonId/peer-reviews/cycles',
    requireAuth('teacher', 'administrator', 'student'),
    (req, res) => {
      try {
        const { lessonId } = req.params;
        const session = sessionOf(req);
        if (!canSeeLesson(readDb(), session, lessonId)) {
          return res.status(403).json({ success: false, error: 'Forbidden' });
        }
        res.json({ success: true, cycles: peer().listCyclesForLesson(lessonId) });
      } catch (err) {
        sendActivityError(res, err);
      }
    },
  );

  app.post(
    '/api/lessons/:lessonId/peer-reviews/cycles/:cycleId/close',
    requireAuth('teacher', 'administrator'),
    (req, res) => {
      try {
        const { lessonId, cycleId } = req.params;
        const access = staffCanManage(req, lessonId);
        if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });
        if (!peer().cycleBelongsToLesson(cycleId, lessonId)) {
          return res.status(404).json({ success: false, error: '互评轮次不存在' });
        }
        res.json({ success: true, cycle: peer().closeCycle(cycleId) });
      } catch (err) {
        sendActivityError(res, err);
      }
    },
  );

  app.get(
    '/api/lessons/:lessonId/peer-reviews/cycles/:cycleId/assignments',
    requireAuth('teacher', 'administrator'),
    (req, res) => {
      try {
        const { lessonId, cycleId } = req.params;
        const access = staffCanManage(req, lessonId);
        if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });
        if (!peer().cycleBelongsToLesson(cycleId, lessonId)) {
          return res.status(404).json({ success: false, error: '互评轮次不存在' });
        }
        res.json({ success: true, assignments: peer().listAssignmentsForTeacher(cycleId) });
      } catch (err) {
        sendActivityError(res, err);
      }
    },
  );

  app.get('/api/me/peer-review-assignments', requireAuth('student'), (req, res) => {
    try {
      const studentId = studentActorId(sessionOf(req));
      if (!studentId) return res.status(400).json({ success: false, error: 'Student identity required' });
      const lessonId = typeof req.query.lessonId === 'string' ? req.query.lessonId : undefined;
      if (lessonId && !canSeeLesson(readDb(), sessionOf(req), lessonId)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      res.json({ success: true, assignments: peer().listAssignmentsForStudent(studentId, { lessonId }) });
    } catch (err) {
      sendActivityError(res, err);
    }
  });

  app.post('/api/lessons/:lessonId/peer-reviews/assignments/:assignmentId', requireAuth('student'), (req, res) => {
    try {
      const { lessonId, assignmentId } = req.params;
      const session = sessionOf(req);
      if (!canSeeLesson(readDb(), session, lessonId)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      if (peer().assignmentLessonId(assignmentId) !== lessonId) {
        return res.status(404).json({ success: false, error: '互评任务不存在' });
      }
      const studentId = studentActorId(session);
      if (!studentId) return res.status(400).json({ success: false, error: 'Student identity required' });
      const body = req.body ?? {};
      const review = peer().submitReview(assignmentId, studentId, {
        scores: body.scores || {},
        comment: body.comment,
      });
      res.json({ success: true, review });
    } catch (err) {
      sendActivityError(res, err);
    }
  });

  app.post(
    '/api/lessons/:lessonId/peer-reviews/:reviewId/moderate',
    requireAuth('teacher', 'administrator'),
    (req, res) => {
      try {
        const { lessonId, reviewId } = req.params;
        const access = staffCanManage(req, lessonId);
        if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });
        if (peer().reviewLessonId(reviewId) !== lessonId) {
          return res.status(404).json({ success: false, error: '互评不存在' });
        }
        const session = sessionOf(req);
        const teacherId = actorUserId(session) || session?.userId;
        if (!teacherId) return res.status(400).json({ success: false, error: 'Teacher identity required' });
        const action = req.body?.action;
        if (action !== 'confirm' && action !== 'override' && action !== 'reject') {
          return res.status(400).json({ success: false, error: 'action 必须是 confirm / override / reject' });
        }
        const review = peer().teacherReview(reviewId, teacherId, action, {
          scores: req.body?.scores,
          teacherFeedback: req.body?.teacherFeedback,
        });
        res.json({ success: true, review });
      } catch (err) {
        sendActivityError(res, err);
      }
    },
  );

  app.post('/api/lessons/:lessonId/peer-reviews/:reviewId/report', requireAuth('student'), (req, res) => {
    try {
      const { lessonId, reviewId } = req.params;
      const session = sessionOf(req);
      if (!canSeeLesson(readDb(), session, lessonId)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      if (peer().reviewLessonId(reviewId) !== lessonId) {
        return res.status(404).json({ success: false, error: '互评不存在' });
      }
      const studentId = studentActorId(session);
      if (!studentId) return res.status(400).json({ success: false, error: 'Student identity required' });
      const result = peer().reportReview(reviewId, studentId, String(req.body?.reason || ''));
      res.status(201).json({ success: true, report: result });
    } catch (err) {
      sendActivityError(res, err);
    }
  });

  app.get('/api/lessons/:lessonId/peer-reviews/reports', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { lessonId } = req.params;
      const access = staffCanManage(req, lessonId);
      if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });
      const cycleId = typeof req.query.cycleId === 'string' ? req.query.cycleId : undefined;
      if (cycleId && !peer().cycleBelongsToLesson(cycleId, lessonId)) {
        return res.status(404).json({ success: false, error: '互评轮次不存在' });
      }
      res.json({ success: true, reports: peer().listOpenReports(cycleId) });
    } catch (err) {
      sendActivityError(res, err);
    }
  });
}
