import { kernelContainer } from '../../packages/core/kernel/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import type { ServerContext } from '../context.js';
import { sendSafeError } from '../utils/error-handler.js';
import { rejectLegacyAssignmentWrite } from '../utils/legacy-assignment-write.js';
import { AssignmentService } from '../services/assignment-service.js';
import {
  authorizeAssignment,
  authorizeClass,
  redactAssignmentForStudent,
  rejectUnless,
} from '../services/class-access.js';

function getSession(req: unknown): Record<string, unknown> | undefined {
  return (req as { session?: Record<string, unknown> })?.session;
}

export function registerAssignmentsRoutes(ctx: ServerContext) {
  const { app } = ctx;
  const assignmentService = new AssignmentService();

  app.get('/api/classes/:classId/assignments', requireScopedAuth('class-member'), (req, res) => {
    try {
      const decision = authorizeClass(kernelContainer.db, getSession(req), req.params.classId, 'member');
      if (rejectUnless(res, decision) || !decision.ok) return;
      const rows = assignmentService.listClassAssignments(
        req.params.classId,
        (req.query.academicYear as string) || null,
      );
      res.json(decision.level === 'student' ? rows.map((row) => redactAssignmentForStudent(row)) : rows);
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/classes/:classId/assignments/generate', requireAuth('teacher', 'administrator'), (_req, res) => {
    rejectLegacyAssignmentWrite(res, '/api/learning-surface-assignments/generate');
  });

  app.post('/api/classes/:classId/assignments/suggest', requireAuth('teacher', 'administrator'), (_req, res) => {
    rejectLegacyAssignmentWrite(res, '/api/learning-surface-assignments/suggest');
  });

  app.post(
    '/api/classes/:classId/assignments/create-suggested-quiz',
    requireAuth('teacher', 'administrator'),
    (_req, res) => {
      rejectLegacyAssignmentWrite(res, '/api/learning-surface-assignments/create-suggested-quiz');
    },
  );

  app.post('/api/assignments/:id/submissions', requireScopedAuth('class-member'), (_req, res) => {
    rejectLegacyAssignmentWrite(res, '/api/learning-surface-assignments/:assignmentId/submissions');
  });

  app.get('/api/assignments/:id/submissions', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      if (rejectUnless(res, authorizeAssignment(kernelContainer.db, getSession(req), req.params.id, 'staff'))) return;
      res.json(assignmentService.listTraditionalSubmissions(req.params.id));
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  app.post(
    '/api/assignments/:id/submissions/:studentId/grade',
    requireAuth('teacher', 'administrator'),
    (_req, res) => {
      rejectLegacyAssignmentWrite(res, '/api/learning-surface-assignments/:assignmentId/submissions/:studentId/grade');
    },
  );
}
