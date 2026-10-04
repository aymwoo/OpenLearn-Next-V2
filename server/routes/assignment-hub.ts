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
import type { ServerContext } from '../context.js';
import { sendSafeError } from '../utils/error-handler.js';
import { ASSIGNMENT_MAX_FILE_SIZE } from '../utils/assignment-upload-policy.js';
import { AssignmentService } from '../services/assignment-service.js';

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
    const isPrivileged = role === 'teacher' || role === 'administrator' || role === 'admin';
    const studentId = session?.userId || session?.studentId || null;
    return { isPrivileged, studentId: studentId ? String(studentId) : null };
  };

  // ── 作业实体 ─────────────────────────────────────────────────────────────
  app.post('/api/assignments', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const cmd = kernelContainer.commandBus.createCommand('assignment.create', req.body || {}, getActorId(req));
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      sendHubError(res, e);
    }
  });

  app.get('/api/assignments', requireAuth(), async (req, res) => {
    try {
      const payload: Record<string, unknown> = {
        lessonId: req.query.lessonId,
        classId: req.query.classId,
        elementId: req.query.elementId,
        includeArchived: req.query.includeArchived === '1' || req.query.includeArchived === 'true',
      };
      const { isPrivileged, studentId } = describeRequester(req);
      const requestedStudent = typeof req.query.studentId === 'string' ? req.query.studentId : undefined;
      if (isPrivileged && requestedStudent) {
        payload.studentId = requestedStudent;
      } else if (!isPrivileged && studentId) {
        payload.studentId = studentId;
      }
      const cmd = kernelContainer.commandBus.createCommand('assignment.list', payload, getActorId(req), {
        silent: true,
      });
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      sendHubError(res, e);
    }
  });

  app.get('/api/assignments/:assignmentId', requireAuth(), async (req, res) => {
    try {
      const { isPrivileged, studentId } = describeRequester(req);
      const payload: Record<string, unknown> = { assignmentId: req.params.assignmentId };
      const requestedStudent = typeof req.query.studentId === 'string' ? req.query.studentId : undefined;
      if (isPrivileged && requestedStudent) {
        payload.studentId = requestedStudent;
      } else if (!isPrivileged && studentId) {
        payload.studentId = studentId;
      }
      // H1: 挂班级的作业，学生必须属于该班才能读详情
      const assignmentRow = kernelContainer.db
        .prepare('SELECT class_id FROM plugin_assignments WHERE id = ?')
        .get(req.params.assignmentId) as { class_id: string | null } | undefined;
      if (assignmentRow) {
        assignmentService.assertClassMembership(assignmentRow, isPrivileged, studentId);
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
    requireAuth(),
    express.raw({ type: () => true, limit: ASSIGNMENT_MAX_FILE_SIZE + 1024 * 1024 }),
    async (req, res) => {
      try {
        const assignmentId = req.params.assignmentId;
        const { isPrivileged, studentId: sessionStudentId } = describeRequester(req);

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
  app.get('/api/assignments/:assignmentId/files', requireAuth(), async (req, res) => {
    try {
      const { isPrivileged, studentId } = describeRequester(req);
      const files = assignmentService.listAssignmentFiles(req.params.assignmentId, studentId, isPrivileged);
      res.json({ success: true, files });
    } catch (e: any) {
      sendHubError(res, e);
    }
  });

  app.get('/api/assignments/:assignmentId/files/:fileId', requireAuth(), async (req, res) => {
    try {
      const { isPrivileged, studentId } = describeRequester(req);
      const { absPath, originalName } = assignmentService.getAssignmentFileDownloadPath(
        req.params.assignmentId,
        req.params.fileId,
        studentId,
        isPrivileged,
      );

      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.download(absPath, originalName);
    } catch (e: any) {
      sendHubError(res, e);
    }
  });

  app.delete('/api/assignments/:assignmentId/files/:fileId', requireAuth(), async (req, res) => {
    try {
      const { isPrivileged, studentId } = describeRequester(req);
      assignmentService.softDeleteAssignmentFile(
        req.params.assignmentId,
        req.params.fileId,
        studentId,
        isPrivileged,
      );
      res.json({ success: true });
    } catch (e: any) {
      sendHubError(res, e);
    }
  });

  // ── 提交 / 互评 / 评分（透传命令总线，校验在插件内完成）─────────────────
  app.post('/api/assignments/:assignmentId/submit', requireAuth(), async (req, res) => {
    try {
      const { isPrivileged, studentId } = describeRequester(req);
      const body = req.body || {};
      const targetStudentId = isPrivileged ? String(body.studentId || '') : String(studentId || '');
      if (!targetStudentId) {
        return res.status(400).json({ success: false, error: 'Missing studentId' });
      }
      const assignmentRow = kernelContainer.db
        .prepare('SELECT class_id FROM plugin_assignments WHERE id = ?')
        .get(req.params.assignmentId) as { class_id: string | null } | undefined;
      assignmentService.assertClassMembership(assignmentRow, isPrivileged, targetStudentId);
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

  app.post('/api/assignments/:assignmentId/peer-review', requireAuth(), async (req, res) => {
    try {
      const { isPrivileged, studentId } = describeRequester(req);
      const body = req.body || {};
      const reviewerId = isPrivileged ? String(body.reviewerId || body.studentId || '') : String(studentId || '');
      if (!reviewerId) {
        return res.status(400).json({ success: false, error: 'Missing reviewerId' });
      }
      const reviewAssignmentRow = kernelContainer.db
        .prepare('SELECT class_id FROM plugin_assignments WHERE id = ?')
        .get(req.params.assignmentId) as { class_id: string | null } | undefined;
      assignmentService.assertClassMembership(reviewAssignmentRow, isPrivileged, reviewerId);
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
