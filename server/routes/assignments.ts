import { kernelContainer } from '../../packages/core/kernel/index.js';
import { requireAuth } from '../middleware/auth.js';
import type { ServerContext } from '../context.js';
import { sendSafeError } from '../utils/error-handler.js';
import { AssignmentService } from '../services/assignment-service.js';
import {
  authorizeAssignment,
  authorizeClass,
  redactAssignmentForStudent,
  rejectUnless,
} from '../services/class-access.js';

export function registerAssignmentsRoutes(ctx: ServerContext) {
  const { app } = ctx;
  const assignmentService = new AssignmentService();

  app.get('/api/classes/:classId/assignments', requireAuth(), (req, res) => {
    try {
      const decision = authorizeClass(kernelContainer.db, (req as any).session, req.params.classId, 'member');
      if (rejectUnless(res, decision) || !decision.ok) return;
      const rows = assignmentService.listClassAssignments(req.params.classId);
      res.json(decision.level === 'student' ? rows.map((row) => redactAssignmentForStudent(row)) : rows);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/classes/:classId/assignments/generate', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      if (rejectUnless(res, authorizeClass(kernelContainer.db, (req as any).session, req.params.classId, 'staff')))
        return;
      const { topic, lessonId } = req.body;
      const result = await assignmentService.generateQuizWithAi(req.params.classId, topic, lessonId);
      res.json({
        success: true,
        assignment: result,
      });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/classes/:classId/assignments/suggest', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      if (rejectUnless(res, authorizeClass(kernelContainer.db, (req as any).session, req.params.classId, 'staff')))
        return;
      const { lessonId } = req.body;
      const result = await assignmentService.suggestQuizWithAi(lessonId);
      res.json(result);
    } catch (e: any) {
      if (e.message === 'Lesson not found' || e.status === 404) {
        return res.status(404).json({ error: 'Lesson not found' });
      }
      sendSafeError(res, e);
    }
  });

  app.post(
    '/api/classes/:classId/assignments/create-suggested-quiz',
    requireAuth('teacher', 'administrator'),
    async (req, res) => {
      try {
        if (rejectUnless(res, authorizeClass(kernelContainer.db, (req as any).session, req.params.classId, 'staff')))
          return;
        const assignmentId = assignmentService.createSuggestedQuiz(req.params.classId, req.body || {});
        res.json({ success: true, assignmentId });
      } catch (e: any) {
        sendSafeError(res, e);
      }
    },
  );

  app.post('/api/assignments/:id/submissions', requireAuth(), (req, res) => {
    try {
      const { studentId, content } = req.body;
      const session = (req as any).session;
      const decision = authorizeAssignment(kernelContainer.db, session, req.params.id, 'member');
      if (rejectUnless(res, decision) || !decision.ok) return;
      const isPrivileged = decision.level !== 'student';
      const currentUserId = session?.userId || session?.studentId;

      const targetStudentId = assignmentService.resolveTargetStudentId(studentId, currentUserId, isPrivileged);

      assignmentService.submitTraditionalAssignment(req.params.id, targetStudentId, content);
      res.json({ success: true });
    } catch (e: any) {
      if (e.status === 403 || e.status === 404) {
        return res.status(e.status).json({ error: e.message || 'Forbidden' });
      }
      sendSafeError(res, e);
    }
  });

  app.get('/api/assignments/:id/submissions', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      if (rejectUnless(res, authorizeAssignment(kernelContainer.db, (req as any).session, req.params.id, 'staff')))
        return;
      res.json(assignmentService.listTraditionalSubmissions(req.params.id));
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post(
    '/api/assignments/:id/submissions/:studentId/grade',
    requireAuth('teacher', 'administrator'),
    async (req, res) => {
      try {
        if (rejectUnless(res, authorizeAssignment(kernelContainer.db, (req as any).session, req.params.id, 'staff')))
          return;
        const grade = await assignmentService.gradeTraditionalAssignment(req.params.id, req.params.studentId);
        res.json({
          success: true,
          pendingApproval: true,
          message: 'Grade generated and sent for approval.',
          score: grade.score,
          feedback: grade.feedback,
        });
      } catch (e: any) {
        sendSafeError(res, e);
      }
    },
  );
}
