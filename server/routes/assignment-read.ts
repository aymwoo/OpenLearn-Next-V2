/**
 * 作业读路由（新旧路径共用）。
 *
 * 阶段 7.2 起，旧 `/api/assignments/*` 作为兼容入口，与
 * `/api/learning-surface-assignments/*` 共用同一份鉴权与读取逻辑：
 * - 旧路径响应带 `Deprecation` / `Link` 头，阶段 8 再下线；
 * - 新路径是前端唯一调用入口；
 * - 写端点不在这里，仍由 `/api/learning-surface-assignments/*` 处理。
 */
import express from 'express';
import type Database from 'better-sqlite3';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getActorId } from '../middleware/auth.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import { sendSafeError } from '../utils/error-handler.js';
import { isInlineSafeContentType, resolveContentType } from '../../packages/core/assignment/file-preview-policy.js';
import { AssignmentService } from '../services/assignment-service.js';
import {
  accessibleClassIds,
  authorizeAssignment,
  authorizeClass,
  isAdministrator,
  isTeacher,
  rejectUnless,
  redactAssignmentForStudent,
} from '../services/class-access.js';

type SessionRecord = Record<string, unknown> | undefined;

function getSession(req: unknown): SessionRecord {
  return (req as { session?: Record<string, unknown> })?.session;
}

/** 当前请求者身份：privileged = 教师/管理员，否则视为学生（只能操作自己） */
function describeRequester(req: express.Request) {
  const session = getSession(req);
  const role = session?.role;
  const isPrivileged =
    role === 'teacher' ||
    role === 'administrator' ||
    role === 'admin' ||
    isAdministrator(session) ||
    isTeacher(session);
  const studentId = session?.userId || session?.studentId || null;
  return { isPrivileged, studentId: studentId ? String(studentId) : null, session };
}

/** class_id 为空的历史作业保持原行为；挂了班级则按归属校验。返回 true 表示已拒绝。 */
function rejectUnlessHubClass(
  req: express.Request,
  res: express.Response,
  classId: string | null | undefined,
  level: 'staff' | 'member',
): boolean {
  if (!classId) return false;
  return rejectUnless(res, authorizeClass(kernelContainer.db, getSession(req), classId, level));
}

function hubAssignmentClassId(db: Database.Database, assignmentId: string): string | null | undefined {
  const row = db.prepare('SELECT class_id FROM plugin_assignments WHERE id = ?').get(assignmentId) as
    { class_id: string | null } | undefined;
  return row?.class_id;
}

/**
 * assignment.* 命令由 assignment-eval 插件独家提供。插件被停用或未激活时命令总线
 * 只会抛「No handler registered」，调用方看到的是 500 噪音；这里显式返回 503，
 * 让前端区分「服务不可用」与「请求有问题」。
 */
function requireAssignmentCommand(res: express.Response, ...types: string[]): boolean {
  for (const type of types) {
    if (!kernelContainer.commandBus.hasHandler(type)) {
      res.status(503).json({
        success: false,
        code: 'ASSIGNMENT_SERVICE_UNAVAILABLE',
        error: 'Assignment service is unavailable: the assignment-eval plugin is not active.',
      });
      return true;
    }
  }
  return false;
}

function markDeprecated(req: express.Request, res: express.Response, fromBase: string, toBase?: string): void {
  if (!toBase) return;
  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', `<${req.originalUrl.replace(fromBase, toBase)}>; rel="successor-version"`);
}

export interface AssignmentReadRoutesOptions {
  /** 读路由基路径，如 `/api/learning-surface-assignments`。 */
  basePath: string;
  /** 旧路径迁移目标；提供后响应带 Deprecation / Link 头。 */
  successorBasePath?: string;
}

/**
 * 注册作业读路由：
 *   GET {basePath}                              列表
 *   GET {basePath}/:assignmentId                详情
 *   GET {basePath}/:assignmentId/files          附件列表
 *   GET {basePath}/:assignmentId/files/:fileId  附件预览 / 下载
 *   GET {basePath}/:assignmentId/submissions    教师查看传统班级提交
 */
export function registerAssignmentReadRoutes(
  app: express.Express,
  options: AssignmentReadRoutesOptions,
): AssignmentService {
  const assignmentService = new AssignmentService();
  const { basePath, successorBasePath } = options;
  const deprecated = (req: express.Request, res: express.Response) =>
    markDeprecated(req, res, basePath, successorBasePath);

  app.get(basePath, requireScopedAuth('class-member'), async (req, res) => {
    deprecated(req, res);
    try {
      if (requireAssignmentCommand(res, 'assignment.list')) return;
      const payload: Record<string, unknown> = {
        lessonId: req.query.lessonId,
        classId: req.query.classId,
        elementId: req.query.elementId,
        includeArchived: req.query.includeArchived === '1' || req.query.includeArchived === 'true',
      };
      const { isPrivileged, studentId, session } = describeRequester(req);
      const requestedStudent = typeof req.query.studentId === 'string' ? req.query.studentId : undefined;
      if (isPrivileged && requestedStudent) {
        payload.studentId = requestedStudent;
      } else if (!isPrivileged && studentId) {
        payload.studentId = studentId;
      }
      const requestedClass = typeof req.query.classId === 'string' ? req.query.classId : '';
      if (requestedClass && rejectUnlessHubClass(req, res, requestedClass, 'member')) return;
      const cmd = kernelContainer.commandBus.createCommand('assignment.list', payload, getActorId(req), {
        silent: true,
      });
      const result = (await kernelContainer.commandBus.execute(cmd)) as {
        assignments?: Array<{ class_id?: string | null }>;
      };
      const allowed = accessibleClassIds(kernelContainer.db, session);
      if (allowed && Array.isArray(result?.assignments)) {
        result.assignments = result.assignments.filter((row) => !row.class_id || allowed.includes(row.class_id));
      }
      res.json(result);
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  app.get(`${basePath}/:assignmentId`, requireScopedAuth('class-member'), async (req, res) => {
    deprecated(req, res);
    try {
      if (requireAssignmentCommand(res, 'assignment.get')) return;
      const { isPrivileged, studentId } = describeRequester(req);
      const payload: Record<string, unknown> = { assignmentId: req.params.assignmentId };
      const requestedStudent = typeof req.query.studentId === 'string' ? req.query.studentId : undefined;
      if (isPrivileged && requestedStudent) {
        payload.studentId = requestedStudent;
      } else if (!isPrivileged && studentId) {
        payload.studentId = studentId;
      }
      // 挂班级的作业：学生须在班内，教师须是该班负责人
      const classId = hubAssignmentClassId(kernelContainer.db, req.params.assignmentId);
      if (rejectUnlessHubClass(req, res, classId, isPrivileged ? 'staff' : 'member')) return;
      if (!isPrivileged && classId) {
        assignmentService.assertClassMembership({ class_id: classId }, false, studentId);
      }
      if (isPrivileged) {
        payload.includePeerProgress = true;
      }
      const cmd = kernelContainer.commandBus.createCommand('assignment.get', payload, getActorId(req), {
        silent: true,
      });
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  app.get(`${basePath}/:assignmentId/files`, requireScopedAuth('class-member'), async (req, res) => {
    deprecated(req, res);
    try {
      const { isPrivileged, studentId } = describeRequester(req);
      if (
        rejectUnlessHubClass(
          req,
          res,
          hubAssignmentClassId(kernelContainer.db, req.params.assignmentId),
          isPrivileged ? 'staff' : 'member',
        )
      )
        return;
      const files = assignmentService.listAssignmentFiles(req.params.assignmentId, studentId, isPrivileged);
      res.json({ success: true, files });
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  app.get(`${basePath}/:assignmentId/files/:fileId`, requireScopedAuth('class-member'), async (req, res) => {
    deprecated(req, res);
    try {
      const { isPrivileged, studentId } = describeRequester(req);
      if (
        rejectUnlessHubClass(
          req,
          res,
          hubAssignmentClassId(kernelContainer.db, req.params.assignmentId),
          isPrivileged ? 'staff' : 'member',
        )
      )
        return;
      const { absPath, originalName } = assignmentService.getAssignmentFileDownloadPath(
        req.params.assignmentId,
        req.params.fileId,
        studentId,
        isPrivileged,
      );

      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');

      // 预览模式（?disposition=inline）：让浏览器把附件当**数据**而不是当**下载**。
      //
      // 三条硬约束，缺一不可：
      // 1. Content-Type 由**服务端按扩展名推导**（`resolveContentType`），绝不采信
      //    上传时客户端自报的 mime —— 那是客户端说了算的，拿它决定浏览器的解释方式
      //    等于把「文件被当成什么」交给上传者。
      // 2. 只有白名单里的类型才允许 inline（PDF / text/plain / 常见位图）；
      //    text/html、image/svg+xml 这类**可执行文档**一律回落到下载 ——
      //    inline 回去就等于把学生上传的文件变成同源页面。
      // 3. `nosniff` 兜底，防止浏览器把 text/plain 嗅探成 HTML。
      const wantsInline = String(req.query.disposition || '').toLowerCase() === 'inline';
      const contentType = resolveContentType(originalName);
      if (wantsInline && isInlineSafeContentType(contentType)) {
        res.setHeader('Content-Type', contentType);
        // PDF 不加 sandbox：Chrome 的 PDF 查看器在 sandbox 下会拒绝渲染。
        // 它本身运行在浏览器的 PDF 沙箱里，不与页面同源（业界通行做法）。
        // 文本与图片加 sandbox：即便将来出现新的嗅探路径，也没有执行余地。
        res.setHeader(
          'Content-Security-Policy',
          contentType === 'application/pdf' ? 'sandbox allow-scripts' : 'sandbox',
        );
        const safeName = encodeURIComponent(originalName).replace(/['()]/g, escape);
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${safeName}`);
        res.sendFile(absPath);
        return;
      }

      res.download(absPath, originalName);
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  app.get(`${basePath}/:assignmentId/submissions`, requireScopedAuth('class-staff'), (req, res) => {
    deprecated(req, res);
    try {
      if (rejectUnless(res, authorizeAssignment(kernelContainer.db, getSession(req), req.params.assignmentId, 'staff')))
        return;
      res.json(assignmentService.listTraditionalSubmissions(req.params.assignmentId));
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  return assignmentService;
}

export interface ClassAssignmentsReadRouteOptions {
  /** 路由模板，如 `/api/classes/:classId/learning-surface-assignments`。 */
  path: string;
  /** 旧路径迁移目标；提供后响应带 Deprecation / Link 头。 */
  successorPath?: string;
}

/** 班级作业列表读路由（新旧路径共用）。 */
export function registerClassAssignmentsReadRoute(
  app: express.Express,
  options: ClassAssignmentsReadRouteOptions,
): AssignmentService {
  const assignmentService = new AssignmentService();
  const { path, successorPath } = options;

  app.get(path, requireScopedAuth('class-member'), (req, res) => {
    markDeprecated(req, res, path, successorPath);
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

  return assignmentService;
}
