/**
 * 课程层 API（Gitee IKVO15 P2）。
 */
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getCookieToken, getValidSession, requireAuth } from '../middleware/auth.js';
import { sendSafeError } from '../utils/error-handler.js';
import type { ServerContext } from '../context.js';
import { actorUserId, isAdministrator, studentActorId } from '../services/class-access.js';
import { CourseLayerService } from '../services/course-layer-service.js';
import { LessonActivityError } from '../services/lesson-activity-service.js';

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

export function registerCourseLayerRoutes(ctx: ServerContext): void {
  const { app } = ctx;
  const service = () => new CourseLayerService(kernelContainer.db);

  app.get('/api/courses', requireAuth('teacher', 'administrator', 'student'), (req, res) => {
    try {
      const session = sessionOf(req);
      if (session?.role === 'student') {
        const studentId = studentActorId(session);
        if (!studentId) return res.status(400).json({ success: false, error: 'Student identity required' });
        return res.json({ success: true, courses: service().listCoursesForStudent(studentId) });
      }
      const userId = actorUserId(session) || session?.userId;
      if (!userId) return res.status(400).json({ success: false, error: 'User identity required' });
      res.json({ success: true, courses: service().listCoursesForTeacher(userId, isAdministrator(session)) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/courses', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const session = sessionOf(req);
      const userId = actorUserId(session) || session?.userId;
      if (!userId) return res.status(400).json({ success: false, error: 'User identity required' });
      const body = req.body ?? {};
      const classIds = Array.isArray(body.classIds) ? body.classIds : undefined;
      const course =
        body.promoteLesson && body.lessonId
          ? service().promoteLessonToLongCycle(String(body.lessonId), userId, {
              title: body.title,
              description: body.description,
              classIds,
              autoArchiveAfterMs: body.autoArchiveAfterMs,
            })
          : service().createCourse({
              title: body.title,
              description: body.description,
              ownerUserId: userId,
              term: body.term,
              visibility: body.visibility,
              thumbnail: body.thumbnail,
              isLongCycle: body.isLongCycle !== false,
              autoArchiveAfterMs: body.autoArchiveAfterMs,
              lessonId: body.lessonId,
              classIds,
            });
      res.status(201).json({ success: true, course });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/courses/:courseId', requireAuth('teacher', 'administrator', 'student'), (req, res) => {
    try {
      const session = sessionOf(req);
      const allowed = service().canViewCourse(req.params.courseId, {
        userId: actorUserId(session) || session?.userId,
        studentId: studentActorId(session),
        isAdmin: isAdministrator(session),
      });
      if (!allowed) return res.status(403).json({ success: false, error: 'Forbidden' });
      const course = service().getCourse(req.params.courseId);
      const lessons = service().listLessons(req.params.courseId);
      const enrollments = service().listEnrollments(req.params.courseId);
      res.json({ success: true, course, lessons, enrollments });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.patch('/api/courses/:courseId', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const session = sessionOf(req);
      const userId = actorUserId(session) || session?.userId;
      if (!userId || !service().canManageCourse(req.params.courseId, userId, isAdministrator(session))) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      const course = service().updateCourse(req.params.courseId, req.body ?? {});
      res.json({ success: true, course });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete('/api/courses/:courseId', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const session = sessionOf(req);
      const userId = actorUserId(session) || session?.userId;
      if (!userId || !service().canManageCourse(req.params.courseId, userId, isAdministrator(session))) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      service().deleteCourse(req.params.courseId);
      res.json({ success: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/courses/:courseId/lessons', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const session = sessionOf(req);
      const userId = actorUserId(session) || session?.userId;
      if (!userId || !service().canManageCourse(req.params.courseId, userId, isAdministrator(session))) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      const lessonIds = Array.isArray(req.body?.lessonIds) ? req.body.lessonIds : [];
      const lessons = service().attachLessons(req.params.courseId, lessonIds);
      res.json({ success: true, lessons });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.put('/api/courses/:courseId/lessons/reorder', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const session = sessionOf(req);
      const userId = actorUserId(session) || session?.userId;
      if (!userId || !service().canManageCourse(req.params.courseId, userId, isAdministrator(session))) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      const lessons = service().reorderLessons(
        req.params.courseId,
        Array.isArray(req.body?.lessonIds) ? req.body.lessonIds : [],
      );
      res.json({ success: true, lessons });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete('/api/courses/:courseId/lessons/:lessonId', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const session = sessionOf(req);
      const userId = actorUserId(session) || session?.userId;
      if (!userId || !service().canManageCourse(req.params.courseId, userId, isAdministrator(session))) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      service().detachLesson(req.params.courseId, req.params.lessonId);
      res.json({ success: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/courses/:courseId/enrollments', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const session = sessionOf(req);
      const userId = actorUserId(session) || session?.userId;
      if (!userId || !service().canManageCourse(req.params.courseId, userId, isAdministrator(session))) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      res.json({ success: true, enrollments: service().listEnrollments(req.params.courseId) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/api/courses/:courseId/enrollments', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const session = sessionOf(req);
      const userId = actorUserId(session) || session?.userId;
      if (!userId || !service().canManageCourse(req.params.courseId, userId, isAdministrator(session))) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      const body = req.body ?? {};
      const enrollment = body.studentId
        ? service().enrollStudent(req.params.courseId, body.studentId)
        : service().enrollClass(req.params.courseId, body.classId);
      res.status(201).json({ success: true, enrollment });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete(
    '/api/courses/:courseId/enrollments/:enrollmentId',
    requireAuth('teacher', 'administrator'),
    (req, res) => {
      try {
        const session = sessionOf(req);
        const userId = actorUserId(session) || session?.userId;
        if (!userId || !service().canManageCourse(req.params.courseId, userId, isAdministrator(session))) {
          return res.status(403).json({ success: false, error: 'Forbidden' });
        }
        service().unenroll(req.params.enrollmentId);
        res.json({ success: true });
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  app.post(
    '/api/courses/:courseId/lessons/:lessonId/start-session',
    requireAuth('teacher', 'administrator'),
    async (req, res) => {
      try {
        const session = sessionOf(req);
        const userId = actorUserId(session) || session?.userId;
        if (!userId || !service().canManageCourse(req.params.courseId, userId, isAdministrator(session))) {
          return res.status(403).json({ success: false, error: 'Forbidden' });
        }
        const result = await service().startLessonSession(
          req.params.courseId,
          req.params.lessonId,
          userId,
          req.body?.classId,
        );
        res.json({ success: true, ...result });
      } catch (err) {
        sendError(res, err);
      }
    },
  );
}
