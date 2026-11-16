/**
 * 学案活动编排与学生学案页 API（Gitee IKVO15 P0）。
 *
 * 与课堂 timeline / 门禁路由隔离：这里只读写活动、区块与活动级进度。
 */
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getCookieToken, getValidSession, requireAuth } from '../middleware/auth.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import { sendSafeError } from '../utils/error-handler.js';
import type { ServerContext } from '../context.js';
import { checkLessonOwnership } from './lessons.js';
import { canSeeLesson, isAdministrator, isTeacher, studentActorId } from '../services/class-access.js';
import { LessonActivityError, LessonActivityService, isActivityType } from '../services/lesson-activity-service.js';

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

export function registerLessonActivityRoutes(ctx: ServerContext): void {
  const { app } = ctx;
  const service = () => new LessonActivityService(kernelContainer.db);
  const readDb = () => kernelContainer.getReadDb?.() ?? kernelContainer.db;

  app.get('/api/me/lesson-activity-packs', requireAuth('student', 'teacher', 'administrator'), (req, res) => {
    try {
      const session = sessionOf(req);
      const studentId = studentActorId(session);
      if (!studentId) {
        return res.status(400).json({ success: false, error: 'Student identity required' });
      }
      const requested = typeof req.query.lessonIds === 'string' ? req.query.lessonIds.split(',').filter(Boolean) : [];
      const lessonIds = requested.filter((lessonId) => canSeeLesson(readDb(), session, lessonId));
      const packs = service().listStudentPackSummaries(studentId, lessonIds);
      res.json({ success: true, packs });
    } catch (err) {
      sendActivityError(res, err);
    }
  });

  app.get('/api/lessons/:lessonId/activity-pack', requireScopedAuth('authenticated'), (req, res) => {
    try {
      const { lessonId } = req.params;
      const session = sessionOf(req);
      if (!session) return res.status(401).json({ success: false, error: 'Authentication required' });
      if (!canSeeLesson(readDb(), session, lessonId) && !staffCanManage(req, lessonId).ok) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      const isStaff = isAdministrator(session) || isTeacher(session);
      if (isStaff && staffCanManage(req, lessonId).ok) {
        return res.json({ success: true, role: 'teacher', pack: service().getTeacherPack(lessonId) });
      }
      const studentId = studentActorId(session);
      if (!studentId) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      const pack = service().getStudentPack(lessonId, studentId);
      res.json({ success: true, role: 'student', pack });
    } catch (err) {
      sendActivityError(res, err);
    }
  });

  app.put('/api/lessons/:lessonId/activity-blocks', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { lessonId } = req.params;
      const access = staffCanManage(req, lessonId);
      if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });
      const blocks = Array.isArray(req.body?.blocks) ? req.body.blocks : req.body;
      if (!Array.isArray(blocks)) {
        return res.status(400).json({ success: false, error: 'blocks must be an array' });
      }
      const saved = service().replaceBlocks(
        lessonId,
        blocks.map((block: any) => ({
          id: block.id,
          blockType: block.blockType ?? block.block_type,
          content: block.content ?? block.content_json ?? {},
        })),
      );
      res.json({ success: true, blocks: saved });
    } catch (err) {
      sendActivityError(res, err);
    }
  });

  app.post('/api/lessons/:lessonId/activities', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { lessonId } = req.params;
      const access = staffCanManage(req, lessonId);
      if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });
      const body = req.body ?? {};
      if (!isActivityType(body.type)) {
        return res.status(400).json({ success: false, error: 'Unsupported activity type' });
      }
      const activity = service().createActivity(lessonId, {
        type: body.type,
        title: body.title,
        config: body.config ?? {},
        required: body.required,
        visible: body.visible,
        peerReview: body.peerReview,
        groupMode: body.groupMode,
        submissionType: body.submissionType,
        rubric: body.rubric,
        releaseAt: body.releaseAt,
        dueAt: body.dueAt,
        orderIndex: body.orderIndex,
      });
      res.status(201).json({ success: true, activity });
    } catch (err) {
      sendActivityError(res, err);
    }
  });

  app.put('/api/lessons/:lessonId/activities/reorder', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { lessonId } = req.params;
      const access = staffCanManage(req, lessonId);
      if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });
      const ids = req.body?.activityIds ?? req.body?.ids;
      if (!Array.isArray(ids) || ids.some((id: unknown) => typeof id !== 'string')) {
        return res.status(400).json({ success: false, error: 'activityIds must be a string array' });
      }
      const activities = service().reorderActivities(lessonId, ids);
      res.json({ success: true, activities });
    } catch (err) {
      sendActivityError(res, err);
    }
  });

  app.patch('/api/lessons/:lessonId/activities/:activityId', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { lessonId, activityId } = req.params;
      const access = staffCanManage(req, lessonId);
      if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });
      const current = service().getActivity(activityId);
      if (current.lessonId !== lessonId) {
        return res.status(404).json({ success: false, error: 'Activity not found' });
      }
      const body = req.body ?? {};
      if (body.type != null && !isActivityType(body.type)) {
        return res.status(400).json({ success: false, error: 'Unsupported activity type' });
      }
      const activity = service().updateActivity(activityId, body);
      res.json({ success: true, activity });
    } catch (err) {
      sendActivityError(res, err);
    }
  });

  app.delete('/api/lessons/:lessonId/activities/:activityId', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { lessonId, activityId } = req.params;
      const access = staffCanManage(req, lessonId);
      if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });
      const current = service().getActivity(activityId);
      if (current.lessonId !== lessonId) {
        return res.status(404).json({ success: false, error: 'Activity not found' });
      }
      service().deleteActivity(activityId);
      res.json({ success: true });
    } catch (err) {
      sendActivityError(res, err);
    }
  });

  app.get(
    '/api/lessons/:lessonId/activities/:activityId/progress',
    requireAuth('teacher', 'administrator'),
    (req, res) => {
      try {
        const { lessonId, activityId } = req.params;
        const access = staffCanManage(req, lessonId);
        if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });
        const current = service().getActivity(activityId);
        if (current.lessonId !== lessonId) {
          return res.status(404).json({ success: false, error: 'Activity not found' });
        }
        res.json({ success: true, activity: current, progress: service().listActivityProgress(activityId) });
      } catch (err) {
        sendActivityError(res, err);
      }
    },
  );

  app.post(
    '/api/lessons/:lessonId/activities/:activityId/start',
    requireAuth('student', 'teacher', 'administrator'),
    (req, res) => {
      try {
        const { lessonId, activityId } = req.params;
        const session = sessionOf(req);
        if (!canSeeLesson(readDb(), session, lessonId)) {
          return res.status(403).json({ success: false, error: 'Forbidden' });
        }
        const current = service().getActivity(activityId);
        if (current.lessonId !== lessonId) {
          return res.status(404).json({ success: false, error: 'Activity not found' });
        }
        const studentId = studentActorId(session);
        if (!studentId) return res.status(400).json({ success: false, error: 'Student identity required' });
        const progress = service().startActivity(activityId, studentId);
        res.json({ success: true, progress });
      } catch (err) {
        sendActivityError(res, err);
      }
    },
  );

  app.post('/api/lessons/:lessonId/activities/:activityId/self-report', requireAuth('student'), (req, res) => {
    try {
      const { lessonId, activityId } = req.params;
      const session = sessionOf(req);
      if (!canSeeLesson(readDb(), session, lessonId)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      const current = service().getActivity(activityId);
      if (current.lessonId !== lessonId) {
        return res.status(404).json({ success: false, error: 'Activity not found' });
      }
      const studentId = studentActorId(session);
      if (!studentId) return res.status(400).json({ success: false, error: 'Student identity required' });
      const progress = service().selfReportActivity(activityId, studentId);
      res.json({ success: true, progress });
    } catch (err) {
      sendActivityError(res, err);
    }
  });

  app.post(
    '/api/lessons/:lessonId/activities/:activityId/students/:studentId/verify',
    requireAuth('teacher', 'administrator'),
    (req, res) => {
      try {
        const { lessonId, activityId, studentId } = req.params;
        const access = staffCanManage(req, lessonId);
        if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });
        const current = service().getActivity(activityId);
        if (current.lessonId !== lessonId) {
          return res.status(404).json({ success: false, error: 'Activity not found' });
        }
        const body = req.body ?? {};
        const progress = service().teacherVerify(activityId, studentId, {
          score: body.score,
          feedback: body.feedback ?? null,
        });
        res.json({ success: true, progress });
      } catch (err) {
        sendActivityError(res, err);
      }
    },
  );

  app.post(
    '/api/lessons/:lessonId/activities/:activityId/students/:studentId/grade',
    requireAuth('teacher', 'administrator'),
    (req, res) => {
      try {
        const { lessonId, activityId, studentId } = req.params;
        const access = staffCanManage(req, lessonId);
        if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });
        const current = service().getActivity(activityId);
        if (current.lessonId !== lessonId) {
          return res.status(404).json({ success: false, error: 'Activity not found' });
        }
        const body = req.body ?? {};
        if (body.score == null) {
          return res.status(400).json({ success: false, error: 'Score is required' });
        }
        const progress = service().teacherGrade(activityId, studentId, {
          score: Number(body.score),
          feedback: body.feedback ?? null,
        });
        res.json({ success: true, progress });
      } catch (err) {
        sendActivityError(res, err);
      }
    },
  );

  app.post(
    '/api/lessons/:lessonId/activities/:activityId/relink',
    requireAuth('teacher', 'administrator'),
    (req, res) => {
      try {
        const { lessonId, activityId } = req.params;
        const access = staffCanManage(req, lessonId);
        if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });
        const current = service().getActivity(activityId);
        if (current.lessonId !== lessonId) {
          return res.status(404).json({ success: false, error: 'Activity not found' });
        }
        const result = service().relinkActivity(activityId, req.body ?? {});
        res.json({ success: true, ...result });
      } catch (err) {
        sendActivityError(res, err);
      }
    },
  );

  app.post(
    '/api/lessons/:lessonId/activities/:activityId/programming-artifact',
    requireAuth('student', 'teacher', 'administrator'),
    (req, res) => {
      try {
        const { lessonId, activityId } = req.params;
        const session = sessionOf(req);
        if (!canSeeLesson(readDb(), session, lessonId)) {
          return res.status(403).json({ success: false, error: 'Forbidden' });
        }
        const current = service().getActivity(activityId);
        if (current.lessonId !== lessonId) {
          return res.status(404).json({ success: false, error: 'Activity not found' });
        }
        const studentId = studentActorId(session);
        if (!studentId) return res.status(400).json({ success: false, error: 'Student identity required' });
        const submit = Boolean(req.body?.submit);
        const progress = service().saveProgrammingArtifact(
          activityId,
          studentId,
          req.body?.artifact ?? req.body,
          submit,
        );
        res.json({ success: true, progress });
      } catch (err) {
        sendActivityError(res, err);
      }
    },
  );
}
