/**
 * 课程 / 课节讨论区 API（Gitee IKVO15 P2，最小可用）。
 */
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getCookieToken, getValidSession, requireAuth } from '../middleware/auth.js';
import { sendSafeError } from '../utils/error-handler.js';
import type { ServerContext } from '../context.js';
import { actorUserId, canSeeLesson, isAdministrator, studentActorId } from '../services/class-access.js';
import { CourseLayerService } from '../services/course-layer-service.js';
import { DiscussionService } from '../services/discussion-service.js';
import { LessonActivityError } from '../services/lesson-activity-service.js';
import { checkLessonOwnership } from './lessons.js';

function sessionOf(req: any) {
  const token = getCookieToken(req);
  return req.session || (token ? getValidSession(token) : null);
}

function sendError(res: any, err: unknown): void {
  if (err instanceof LessonActivityError) {
    res.status(err.statusCode).json({ success: false, error: err.message });
    return;
  }
  sendSafeError(res, err);
}

function discussionActor(session: any) {
  return {
    userId: actorUserId(session) || session?.userId || null,
    studentId: studentActorId(session),
  };
}

function canAccessScope(req: any, opts: { courseId?: string; lessonId?: string }): boolean {
  const session = sessionOf(req);
  const db = kernelContainer.getReadDb?.() ?? kernelContainer.db;
  if (opts.lessonId && !canSeeLesson(db, session, opts.lessonId)) return false;
  if (opts.courseId) {
    const courses = new CourseLayerService(kernelContainer.db);
    return courses.canViewCourse(opts.courseId, {
      userId: actorUserId(session) || session?.userId,
      studentId: studentActorId(session),
      isAdmin: isAdministrator(session),
    });
  }
  return !!opts.lessonId;
}

function canModerate(req: any, opts: { courseId?: string | null; lessonId?: string | null }): boolean {
  const session = sessionOf(req);
  if (isAdministrator(session)) return true;
  const userId = actorUserId(session) || session?.userId;
  if (!userId) return false;
  if (opts.courseId) {
    return new CourseLayerService(kernelContainer.db).canManageCourse(opts.courseId, userId, false);
  }
  if (opts.lessonId) return checkLessonOwnership(req, opts.lessonId).allowed;
  return false;
}

export function registerDiscussionRoutes(ctx: ServerContext): void {
  const { app } = ctx;
  const service = () => new DiscussionService(kernelContainer.db);

  app.get('/api/discussions', requireAuth('teacher', 'administrator', 'student'), (req, res) => {
    try {
      const courseId = typeof req.query.courseId === 'string' ? req.query.courseId : undefined;
      const lessonId = typeof req.query.lessonId === 'string' ? req.query.lessonId : undefined;
      if (!canAccessScope(req, { courseId, lessonId })) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      res.json({ success: true, threads: service().listThreads({ courseId, lessonId }) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/discussions', requireAuth('teacher', 'administrator', 'student'), (req, res) => {
    try {
      const body = req.body ?? {};
      if (!canAccessScope(req, { courseId: body.courseId, lessonId: body.lessonId })) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      const thread = service().createThread({
        courseId: body.courseId,
        lessonId: body.lessonId,
        title: body.title,
        body: body.body,
        actor: discussionActor(sessionOf(req)),
      });
      res.status(201).json({ success: true, thread });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/discussions/:threadId', requireAuth('teacher', 'administrator', 'student'), (req, res) => {
    try {
      const thread = service().getThread(req.params.threadId);
      if (!canAccessScope(req, { courseId: thread.courseId || undefined, lessonId: thread.lessonId || undefined })) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      res.json({ success: true, thread, posts: service().listPosts(thread.id) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/discussions/:threadId/posts', requireAuth('teacher', 'administrator', 'student'), (req, res) => {
    try {
      const thread = service().getThread(req.params.threadId);
      if (!canAccessScope(req, { courseId: thread.courseId || undefined, lessonId: thread.lessonId || undefined })) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      const post = service().reply(
        thread.id,
        discussionActor(sessionOf(req)),
        String(req.body?.body || ''),
        req.body?.parentId,
      );
      res.status(201).json({ success: true, post });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/discussions/:threadId/state', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const thread = service().getThread(req.params.threadId);
      if (!canModerate(req, thread)) return res.status(403).json({ success: false, error: 'Forbidden' });
      const updated = service().setThreadState(thread.id, {
        pinned: req.body?.pinned,
        locked: req.body?.locked,
      });
      res.json({ success: true, thread: updated });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete(
    '/api/discussions/:threadId/posts/:postId',
    requireAuth('teacher', 'administrator', 'student'),
    (req, res) => {
      try {
        const thread = service().getThread(req.params.threadId);
        if (!canAccessScope(req, { courseId: thread.courseId || undefined, lessonId: thread.lessonId || undefined })) {
          return res.status(403).json({ success: false, error: 'Forbidden' });
        }
        service().deletePost(req.params.postId, discussionActor(sessionOf(req)), canModerate(req, thread));
        res.json({ success: true });
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  app.post('/api/discussions/:threadId/report', requireAuth('teacher', 'administrator', 'student'), (req, res) => {
    try {
      const thread = service().getThread(req.params.threadId);
      if (!canAccessScope(req, { courseId: thread.courseId || undefined, lessonId: thread.lessonId || undefined })) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      const report = service().report({
        threadId: thread.id,
        postId: req.body?.postId,
        actor: discussionActor(sessionOf(req)),
        reason: String(req.body?.reason || ''),
      });
      res.status(201).json({ success: true, report });
    } catch (err) {
      sendError(res, err);
    }
  });
}
