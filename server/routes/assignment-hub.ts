/**
 * 作业中心（Assignment Hub）路由
 *
 * 核心作业文件与提交流程已委托给 AssignmentService 领域服务；
 * 本路由作为白板作业对象与学生提交链路的入口，负责鉴权、
 * 原始二进制 BodyParser 挂载、文件下载与命令总线派发。
 */
import express from 'express';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getActorId, requireAuth } from '../middleware/auth.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import type { ServerContext } from '../context.js';
import { sendSafeError } from '../utils/error-handler.js';
import { ASSIGNMENT_MAX_FILE_SIZE } from '../utils/assignment-upload-policy.js';
import { isInlineSafeContentType, resolveContentType } from '../../packages/core/assignment/file-preview-policy.js';
import { AssignmentService } from '../services/assignment-service.js';
import {
  accessibleClassIds,
  authorizeClass,
  isAdministrator,
  isTeacher,
  rejectUnless,
} from '../services/class-access.js';

function decodeFileName(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * M4: 物理清理已软删除超过保留期的附件文件（导出供单测使用，委托至 AssignmentService）。
 */
export function gcSoftDeletedAssignmentFiles(
  db: { prepare(sql: string): { get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] } } = kernelContainer.db,
  retentionMs: number = 7 * 24 * 60 * 60 * 1000,
): number {
  return new AssignmentService(db as any).gcSoftDeletedAssignmentFiles(retentionMs);
}

/** GC 调度：注册路由时执行一次 + 每 24h 一次（unref 不阻塞退出） */
function scheduleAssignmentFileGC(service: AssignmentService): void {
  try {
    service.gcSoftDeletedAssignmentFiles();
  } catch {
    /* 首次执行失败不影响路由注册 */
  }
  const timer = setInterval(
    () => {
      try {
        const removed = service.gcSoftDeletedAssignmentFiles();
        if (removed > 0) console.log(`[assignment-hub] GC removed ${removed} soft-deleted files`);
      } catch (e) {
        console.warn('[assignment-hub] file GC failed:', e);
      }
    },
    24 * 60 * 60 * 1000,
  );
  timer.unref?.();
}

export function registerAssignmentHubRoutes(ctx: ServerContext) {
  const { app } = ctx;
  const assignmentService = new AssignmentService();

  // M4: 启动软删除文件物理 GC（立即一次 + 每 24h）
  scheduleAssignmentFileGC(assignmentService);

  /** 本文件统一的错误响应：尊重业务异常携带的 err.status，其余 500 */
  const sendHubError = (res: express.Response, e: unknown) => {
    const status = (e as any)?.status;
    sendSafeError(res, e, typeof status === 'number' && status >= 400 && status < 500 ? status : 500);
  };

  /** 当前请求者身份：privileged = 教师/管理员，否则视为学生（只能操作自己） */
  const describeRequester = (req: express.Request) => {
    const session = (req as any).session;
    const role = session?.role;
    const isPrivileged =
      role === 'teacher' ||
      role === 'administrator' ||
      role === 'admin' ||
      isAdministrator(session) ||
      isTeacher(session);
    const studentId = session?.userId || session?.studentId || null;
    return { isPrivileged, studentId: studentId ? String(studentId) : null, session };
  };

  /** class_id 为空的历史作业保持原行为；挂了班级则按归属校验。返回 true 表示已拒绝。 */
  const rejectUnlessHubClass = (
    req: express.Request,
    res: express.Response,
    classId: string | null | undefined,
    level: 'staff' | 'member',
  ) => {
    if (!classId) return false;
    return rejectUnless(res, authorizeClass(kernelContainer.db, (req as any).session, classId, level));
  };

  const hubAssignmentClassId = (assignmentId: string): string | null | undefined => {
    const row = kernelContainer.db.prepare('SELECT class_id FROM plugin_assignments WHERE id = ?').get(assignmentId) as
      { class_id: string | null } | undefined;
    return row?.class_id;
  };

  /**
   * assignment.* 命令由 assignment-eval 插件独家提供。插件被停用或未激活时命令总线
   * 只会抛「No handler registered」，调用方看到的是 500 噪音；这里显式返回 503，
   * 让前端区分「服务不可用」与「请求有问题」。
   */
  const requireAssignmentCommand = (res: express.Response, ...types: string[]): boolean => {
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
  };

  // ── 作业实体 ─────────────────────────────────────────────────────────────
  app.post('/api/assignments', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      if (requireAssignmentCommand(res, 'assignment.create')) return;
      const classId = (req.body || {}).classId || (req.body || {}).class_id;
      if (classId && rejectUnlessHubClass(req, res, String(classId), 'staff')) return;
      const cmd = kernelContainer.commandBus.createCommand('assignment.create', req.body || {}, getActorId(req));
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      sendHubError(res, e);
    }
  });

  app.get('/api/assignments', requireScopedAuth('class-member'), async (req, res) => {
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
    } catch (e: any) {
      sendHubError(res, e);
    }
  });

  app.get('/api/assignments/:assignmentId', requireScopedAuth('class-member'), async (req, res) => {
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
      const classId = hubAssignmentClassId(req.params.assignmentId);
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
    } catch (e: any) {
      sendHubError(res, e);
    }
  });

  // ── 文件上传（原始二进制体）────────────────────────────────────────────
  app.post(
    '/api/assignments/:assignmentId/files',
    requireScopedAuth('class-member'),
    express.raw({ type: () => true, limit: ASSIGNMENT_MAX_FILE_SIZE + 1024 * 1024 }),
    async (req, res) => {
      try {
        const assignmentId = req.params.assignmentId;
        const { isPrivileged, studentId: sessionStudentId } = describeRequester(req);
        if (rejectUnlessHubClass(req, res, hubAssignmentClassId(assignmentId), isPrivileged ? 'staff' : 'member'))
          return;

        const headerStudent = decodeFileName(req.header('x-student-id') || '');
        const ownerStudentId = isPrivileged ? headerStudent || sessionStudentId : sessionStudentId;
        if (!ownerStudentId) {
          return res.status(400).json({ success: false, error: 'Missing studentId' });
        }

        const fileName = decodeFileName(req.header('x-file-name') || '');
        if (!fileName) {
          return res.status(400).json({ success: false, error: 'Missing X-File-Name header' });
        }

        const buffer: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

        const file = await assignmentService.uploadAssignmentFile({
          assignmentId,
          ownerStudentId,
          isPrivileged,
          fileName,
          buffer,
          contentType: req.header('content-type') || null,
        });

        res.json({ success: true, file });
      } catch (e: any) {
        if (e.message?.includes('At most')) {
          return res.status(409).json({ success: false, error: e.message });
        }
        sendHubError(res, e);
      }
    },
  );

  // ── 文件列表 / 下载 / 删除 ───────────────────────────────────────────────
  app.get('/api/assignments/:assignmentId/files', requireScopedAuth('class-member'), async (req, res) => {
    try {
      const { isPrivileged, studentId } = describeRequester(req);
      if (
        rejectUnlessHubClass(req, res, hubAssignmentClassId(req.params.assignmentId), isPrivileged ? 'staff' : 'member')
      )
        return;
      const files = assignmentService.listAssignmentFiles(req.params.assignmentId, studentId, isPrivileged);
      res.json({ success: true, files });
    } catch (e: any) {
      sendHubError(res, e);
    }
  });

  app.get('/api/assignments/:assignmentId/files/:fileId', requireScopedAuth('class-member'), async (req, res) => {
    try {
      const { isPrivileged, studentId } = describeRequester(req);
      if (
        rejectUnlessHubClass(req, res, hubAssignmentClassId(req.params.assignmentId), isPrivileged ? 'staff' : 'member')
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
    } catch (e: any) {
      sendHubError(res, e);
    }
  });

  app.delete('/api/assignments/:assignmentId/files/:fileId', requireScopedAuth('class-member'), async (req, res) => {
    try {
      const { isPrivileged, studentId } = describeRequester(req);
      if (
        rejectUnlessHubClass(req, res, hubAssignmentClassId(req.params.assignmentId), isPrivileged ? 'staff' : 'member')
      )
        return;
      assignmentService.softDeleteAssignmentFile(req.params.assignmentId, req.params.fileId, studentId, isPrivileged);
      res.json({ success: true });
    } catch (e: any) {
      sendHubError(res, e);
    }
  });

  // ── 提交 / 互评 / 评分（透传命令总线，校验在插件内完成）─────────────────
  app.post('/api/assignments/:assignmentId/submit', requireScopedAuth('class-member'), async (req, res) => {
    try {
      if (requireAssignmentCommand(res, 'assignment.submit')) return;
      const { isPrivileged, studentId } = describeRequester(req);
      const body = req.body || {};
      const targetStudentId = isPrivileged ? String(body.studentId || '') : String(studentId || '');
      if (!targetStudentId) {
        return res.status(400).json({ success: false, error: 'Missing studentId' });
      }
      const assignmentRow = kernelContainer.db
        .prepare('SELECT class_id FROM plugin_assignments WHERE id = ?')
        .get(req.params.assignmentId) as { class_id: string | null } | undefined;
      if (rejectUnlessHubClass(req, res, assignmentRow?.class_id, isPrivileged ? 'staff' : 'member')) return;
      if (!isPrivileged) assignmentService.assertClassMembership(assignmentRow, false, targetStudentId);
      const cmd = kernelContainer.commandBus.createCommand(
        'assignment.submit',
        {
          assignmentId: req.params.assignmentId,
          studentId: targetStudentId,
          fileIds: Array.isArray(body.fileIds) ? body.fileIds : [],
          textContent: body.textContent,
          linkUrl: body.linkUrl,
        },
        getActorId(req),
      );
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      sendHubError(res, e);
    }
  });

  app.post('/api/assignments/:assignmentId/peer-review', requireScopedAuth('class-member'), async (req, res) => {
    try {
      if (requireAssignmentCommand(res, 'assignment.peer_review')) return;
      const { isPrivileged, studentId } = describeRequester(req);
      const body = req.body || {};
      const reviewerId = isPrivileged ? String(body.reviewerId || body.studentId || '') : String(studentId || '');
      if (!reviewerId) {
        return res.status(400).json({ success: false, error: 'Missing reviewerId' });
      }
      const reviewAssignmentRow = kernelContainer.db
        .prepare('SELECT class_id FROM plugin_assignments WHERE id = ?')
        .get(req.params.assignmentId) as { class_id: string | null } | undefined;
      if (rejectUnlessHubClass(req, res, reviewAssignmentRow?.class_id, isPrivileged ? 'staff' : 'member')) return;
      if (!isPrivileged) assignmentService.assertClassMembership(reviewAssignmentRow, false, reviewerId);
      const submissionId = String(body.submissionId || '');
      if (!submissionId) {
        return res.status(400).json({ success: false, error: 'Missing submissionId' });
      }
      const cmd = kernelContainer.commandBus.createCommand(
        'assignment.peer_review',
        {
          submissionId,
          reviewerId,
          score: body.score,
          comment: body.comment,
          taskId: body.taskId,
        },
        getActorId(req),
      );
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      sendHubError(res, e);
    }
  });

  app.post(
    '/api/assignments/:assignmentId/assign-peer-reviews',
    requireAuth('teacher', 'administrator'),
    async (req, res) => {
      try {
        if (requireAssignmentCommand(res, 'assignment.assign_peer_reviews')) return;
        if (rejectUnlessHubClass(req, res, hubAssignmentClassId(req.params.assignmentId), 'staff')) return;
        const body = req.body || {};
        const cmd = kernelContainer.commandBus.createCommand(
          'assignment.assign_peer_reviews',
          { assignmentId: req.params.assignmentId, reviewerCount: body.reviewerCount, dueAt: body.dueAt },
          getActorId(req),
        );
        const result = await kernelContainer.commandBus.execute(cmd);
        res.json(result);
      } catch (e: any) {
        sendHubError(res, e);
      }
    },
  );
}
