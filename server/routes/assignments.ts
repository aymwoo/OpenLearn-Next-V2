/**
 * 班级作业路由。
 *
 * 读路由（班级作业列表）已抽到 `assignment-read.ts`；阶段 12.3 起旧路径
 * `/api/classes/:classId/assignments` 只返回 410，读取统一走
 * `/api/classes/:classId/learning-surface-assignments`。本文件只保留
 * 阶段 2 起统一 410 的旧写端点。
 */
import { requireAuth } from '../middleware/auth.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import type { ServerContext } from '../context.js';
import { rejectLegacyAssignmentWrite } from '../utils/legacy-assignment-write.js';
import { registerClassAssignmentsReadRoute } from './assignment-read.js';

export function registerAssignmentsRoutes(ctx: ServerContext) {
  const { app } = ctx;

  registerClassAssignmentsReadRoute(app, {
    path: '/api/classes/:classId/assignments',
    successorPath: '/api/classes/:classId/learning-surface-assignments',
    retired: true,
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

  app.post(
    '/api/assignments/:id/submissions/:studentId/grade',
    requireAuth('teacher', 'administrator'),
    (_req, res) => {
      rejectLegacyAssignmentWrite(res, '/api/learning-surface-assignments/:assignmentId/submissions/:studentId/grade');
    },
  );
}
