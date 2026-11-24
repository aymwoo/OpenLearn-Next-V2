/**
 * 学生端界面可见性策略路由（Gitee Issue IKW5KV）。
 *
 * - 学生读取自己的生效策略；教师/管理员可按既有对象级授权读取学生策略。
 * - 教师按 teacher / class / lesson 三层维护策略；写入前做严格校验与审计。
 */
import type { Request } from 'express';
import type { ServerContext } from '../context.js';
import { getActorId } from '../middleware/auth.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import {
  authorizeClass,
  authorizeLessonStaff,
  authorizeLessonParticipation,
  isAdministrator,
  isTeacher,
  teacherCanSeeStudent,
  type AccessSession,
} from '../services/class-access.js';
import {
  StudentUiPolicyError,
  deleteStudentUiPolicy,
  resolveStudentUiPolicy,
  resolveStudentUiPolicyChain,
  upsertStudentUiPolicy,
  assertStudentUiScope,
  type StudentUiPolicyDbLike,
} from '../services/student-ui-policy-service.js';
import { validateStudentUiPolicyDocument } from '../../packages/core/student-ui-policy/index.js';
import { recordSecurityAudit } from '../../packages/core/observability/audit-log.js';
import { sendSafeError } from '../utils/error-handler.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

function db(): StudentUiPolicyDbLike {
  return kernelContainer.db as unknown as StudentUiPolicyDbLike;
}

function getSession(req: Request): AccessSession | undefined {
  return (req as unknown as { session?: AccessSession })?.session;
}

function scopeExists(scopeType: string, scopeId: string): boolean {
  if (scopeType === 'class') {
    return !!kernelContainer.db.prepare('SELECT 1 AS ok FROM classes WHERE id = ?').get(scopeId);
  }
  if (scopeType === 'lesson') {
    return !!kernelContainer.db.prepare('SELECT 1 AS ok FROM lessons WHERE id = ?').get(scopeId);
  }
  return true;
}

function canManageScope(session: AccessSession | null | undefined, scopeType: string, scopeId: string): boolean {
  if (!session) return false;
  if (scopeType === 'teacher') {
    if (isAdministrator(session)) return true;
    return session.userId === scopeId;
  }
  if (scopeType === 'class') {
    return authorizeClass(kernelContainer.db, session, scopeId, 'staff').ok;
  }
  if (scopeType === 'lesson') {
    return authorizeLessonStaff(kernelContainer.db, session, scopeId).ok;
  }
  return false;
}

export function registerStudentUiPolicyRoutes(ctx: ServerContext) {
  const { app } = ctx;

  app.get('/api/students/:id/ui-policy', requireScopedAuth('self'), (req, res) => {
    try {
      const session = getSession(req);
      const currentUserId = session?.userId || session?.studentId;
      const studentRow = kernelContainer.db
        .prepare('SELECT id, student_number FROM students WHERE id = ? OR student_number = ?')
        .get(req.params.id, req.params.id) as { id: string; student_number?: string | null } | undefined;

      const isSelf = studentRow
        ? currentUserId === studentRow.id || (studentRow.student_number && currentUserId === studentRow.student_number)
        : currentUserId === req.params.id;
      const studentId = studentRow?.id ?? req.params.id;

      if (isAdministrator(session)) {
        // 管理员可查看任意学生
      } else if (isTeacher(session)) {
        if (!teacherCanSeeStudent(kernelContainer.db, session, studentId)) {
          return res.status(403).json({ success: false, error: 'Cannot access another student policy' });
        }
      } else if (!isSelf) {
        return res.status(403).json({ success: false, error: 'Cannot access another student policy' });
      }

      const lessonId =
        typeof req.query.lessonId === 'string' && req.query.lessonId.trim() ? req.query.lessonId.trim() : null;
      if (lessonId) {
        const decision = authorizeLessonParticipation(kernelContainer.db, session, lessonId);
        if (!decision.ok) {
          return res.status(403).json({ success: false, error: 'Cannot access this lesson policy' });
        }
      }

      const resolved = resolveStudentUiPolicy(db(), { studentId, lessonId });
      res.json({ success: true, policy: resolved.policy, applied: resolved.applied });
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/teacher/student-ui-policies', requireScopedAuth('class-staff'), (req, res) => {
    try {
      const session = getSession(req);
      const { scopeType, scopeId } = assertStudentUiScope(req.query.scopeType, req.query.scopeId);
      if (!scopeExists(scopeType, scopeId)) {
        return res.status(404).json({ success: false, error: '策略作用域不存在' });
      }
      if (!canManageScope(session, scopeType, scopeId)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      const chain = resolveStudentUiPolicyChain(db(), { scopeType, scopeId });
      res.json({ success: true, ...chain });
    } catch (e) {
      if (e instanceof StudentUiPolicyError) {
        return res.status(e.status).json({ success: false, error: e.message });
      }
      sendSafeError(res, e);
    }
  });

  app.put('/api/teacher/student-ui-policies', requireScopedAuth('class-staff'), (req, res) => {
    try {
      const session = getSession(req);
      const body = req.body || {};
      const { scopeType, scopeId } = assertStudentUiScope(body.scopeType, body.scopeId);
      if (!scopeExists(scopeType, scopeId)) {
        return res.status(404).json({ success: false, error: '策略作用域不存在' });
      }
      if (!canManageScope(session, scopeType, scopeId)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }

      const validated = validateStudentUiPolicyDocument(body.policy);
      if (!validated.ok) {
        return res.status(400).json({ success: false, error: validated.error });
      }

      upsertStudentUiPolicy(db(), {
        scopeType,
        scopeId,
        policy: validated.value,
        updatedBy: getActorId(req) || null,
      });

      recordSecurityAudit('student_ui_policy.updated', {
        actorId: getActorId(req),
        scopeType,
        scopeId,
        hiddenFeatures: Object.entries(validated.value.features)
          .filter(([, visible]) => visible === false)
          .map(([id]) => id),
        hideGuidance: validated.value.hideGuidance ?? false,
        hiddenPluginCount: validated.value.hiddenPlugins.length,
        hiddenExtensionCount: validated.value.hiddenExtensions.length,
      });

      const chain = resolveStudentUiPolicyChain(db(), { scopeType, scopeId });
      res.json({ success: true, ...chain });
    } catch (e) {
      if (e instanceof StudentUiPolicyError) {
        return res.status(e.status).json({ success: false, error: e.message });
      }
      sendSafeError(res, e);
    }
  });

  app.delete('/api/teacher/student-ui-policies', requireScopedAuth('class-staff'), (req, res) => {
    try {
      const session = getSession(req);
      const { scopeType, scopeId } = assertStudentUiScope(req.query.scopeType, req.query.scopeId);
      if (!canManageScope(session, scopeType, scopeId)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }

      const deleted = deleteStudentUiPolicy(db(), scopeType, scopeId);
      if (deleted) {
        recordSecurityAudit('student_ui_policy.reset', {
          actorId: getActorId(req),
          scopeType,
          scopeId,
        });
      }
      const chain = resolveStudentUiPolicyChain(db(), { scopeType, scopeId });
      res.json({ success: true, deleted, ...chain });
    } catch (e) {
      if (e instanceof StudentUiPolicyError) {
        return res.status(e.status).json({ success: false, error: e.message });
      }
      sendSafeError(res, e);
    }
  });
}
