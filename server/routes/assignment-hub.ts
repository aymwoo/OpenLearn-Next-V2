/**
 * 作业中心（Assignment Hub）路由
 *
 * 与 `server/routes/assignments.ts` 的分工：
 *  - 后者是既有「班级作业 / AI 出题」入口，操作 `assignments` + `assignment_submissions`；
 *  - 本文件是白板作业对象与学生提交链路的入口，操作 `plugin_assignments` +
 *    `plugin_submission_versions` + `plugin_assignment_files`，并在教师确认评分后
 *    由插件把成绩投影回 `assignments` + `assignment_submissions`。
 *
 * 文件上传采用原始二进制体（不是 multipart）：宿主全局 `express.json` 只解析 JSON，
 * 因此这里用路由级 `express.raw` 承接 `application/octet-stream`，既避免 base64 膨胀，
 * 又能把体积放到 50MB。二进制写入磁盘，元数据写 DB，下载端点按元数据鉴权。
 */
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import express from 'express';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getActorId, requireAuth } from '../middleware/auth.js';
import type { ServerContext } from '../context.js';
import { sendSafeError } from '../utils/error-handler.js';
import { validateMagicBytes, SIZE_LIMITS, BLOCKED_EXTENSIONS } from '../utils/upload.js';

/** 作业文件白名单：文档 / 表格 / 演示 / 图片 / 压缩包 / 纯文本与代码 */
const ALLOWED_ASSIGNMENT_EXT = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
  '.csv',
  '.txt',
  '.md',
  '.rtf',
  '.odt',
  '.odp',
  '.ods',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.heic',
  '.zip',
  '.py',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.java',
  '.c',
  '.h',
  '.cpp',
  '.cs',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.sql',
  '.json',
  '.xml',
  '.html',
  '.css',
  '.ino',
]);

/** ZIP 容器族（magic bytes 为 PK\x03\x04），用于补强 .docx/.xlsx 等无独立签名的格式 */
const ZIP_CONTAINER_EXT = new Set(['.zip', '.pptx', '.docx', '.xlsx', '.odt', '.odp', '.ods', '.epub']);

const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** 只保留安全字符，避免把 URL 参数拼进磁盘路径时产生目录穿越 */
function safeSegment(value: string): string {
  const cleaned = String(value || '').replace(/[^A-Za-z0-9._-]/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 96) : 'unknown';
}

function decodeFileName(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function assignmentStorageDir(assignmentId: string, studentId: string): string {
  return path.join(process.cwd(), 'storage', 'assignments', safeSegment(assignmentId), safeSegment(studentId));
}

export function registerAssignmentHubRoutes(ctx: ServerContext) {
  const { app } = ctx;

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
      sendSafeError(res, e);
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
      // 学生只能看自己的提交概要；教师可显式指定某名学生
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
      sendSafeError(res, e);
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
      const cmd = kernelContainer.commandBus.createCommand('assignment.get', payload, getActorId(req), { silent: true });
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // ── 文件上传（原始二进制体）────────────────────────────────────────────
  app.post(
    '/api/assignments/:assignmentId/files',
    requireAuth(),
    express.raw({ type: () => true, limit: MAX_FILE_SIZE + 1024 * 1024 }),
    async (req, res) => {
      try {
        const assignmentId = req.params.assignmentId;
        const { isPrivileged, studentId: sessionStudentId } = describeRequester(req);

        // 学生只能传到自己名下；教师代传时必须显式给出 studentId
        const headerStudent = decodeFileName(req.header('x-student-id') || '');
        const ownerStudentId = isPrivileged ? headerStudent || sessionStudentId : sessionStudentId;
        if (!ownerStudentId) {
          return res.status(400).json({ success: false, error: 'Missing studentId' });
        }

        const assignment = kernelContainer.db
          .prepare('SELECT id, max_files, max_file_size, status FROM plugin_assignments WHERE id = ?')
          .get(assignmentId) as { id: string; max_files: number; max_file_size: number; status: string } | undefined;
        if (!assignment) {
          return res.status(404).json({ success: false, error: `Assignment not found: ${assignmentId}` });
        }

        const fileName = decodeFileName(req.header('x-file-name') || '');
        if (!fileName) {
          return res.status(400).json({ success: false, error: 'Missing X-File-Name header' });
        }
        const ext = path.extname(fileName).toLowerCase();
        if (!ALLOWED_ASSIGNMENT_EXT.has(ext)) {
          return res.status(400).json({ success: false, error: `File type not allowed: ${ext || '(none)'}` });
        }
        if (BLOCKED_EXTENSIONS.includes(ext)) {
          return res.status(400).json({ success: false, error: `File type blocked: ${ext}` });
        }

        const buffer: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (buffer.length === 0) {
          return res.status(400).json({ success: false, error: 'Empty file body' });
        }

        const sizeLimit = Math.min(Number(assignment.max_file_size) || SIZE_LIMITS.assignment, MAX_FILE_SIZE);
        if (buffer.length > sizeLimit) {
          return res.status(413).json({ success: false, error: `File too large (limit ${sizeLimit} bytes)` });
        }
        if (ZIP_CONTAINER_EXT.has(ext) && !(buffer[0] === 0x50 && buffer[1] === 0x4b)) {
          return res.status(400).json({ success: false, error: 'File content does not match its extension' });
        }
        if (!validateMagicBytes(buffer, fileName)) {
          return res.status(400).json({ success: false, error: 'File content does not match its extension' });
        }

        const existingCount = (
          kernelContainer.db
            .prepare(
              'SELECT COUNT(*) AS c FROM plugin_assignment_files WHERE assignment_id = ? AND student_id = ? AND deleted_at IS NULL',
            )
            .get(assignmentId, ownerStudentId) as { c: number }
        ).c;
        if (existingCount >= (Number(assignment.max_files) || 10)) {
          return res.status(409).json({ success: false, error: `At most ${assignment.max_files} files are allowed` });
        }

        const dir = assignmentStorageDir(assignmentId, ownerStudentId);
        fs.mkdirSync(dir, { recursive: true });
        const storedName = `${crypto.randomUUID()}${ext}`;
        const storedPath = path.join(dir, storedName);
        fs.writeFileSync(storedPath, buffer);

        const fileId = 'af-' + crypto.randomUUID();
        const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
        kernelContainer.db
          .prepare(
            `INSERT INTO plugin_assignment_files
               (id, assignment_id, submission_id, version_id, student_id, original_name, stored_path, size, mime, sha256, uploaded_at)
             VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            fileId,
            assignmentId,
            ownerStudentId,
            fileName,
            path.relative(process.cwd(), storedPath),
            buffer.length,
            req.header('content-type') || null,
            sha256,
            Date.now(),
          );

        res.json({
          success: true,
          file: { id: fileId, name: fileName, size: buffer.length, sha256, studentId: ownerStudentId },
        });
      } catch (e: any) {
        sendSafeError(res, e);
      }
    },
  );

  // ── 文件列表 / 下载 / 删除 ───────────────────────────────────────────────
  app.get('/api/assignments/:assignmentId/files', requireAuth(), async (req, res) => {
    try {
      const { isPrivileged, studentId } = describeRequester(req);
      const rows = kernelContainer.db
        .prepare(
          `SELECT id, student_id, original_name, size, mime, sha256, uploaded_at, version_id
             FROM plugin_assignment_files
            WHERE assignment_id = ? AND deleted_at IS NULL
            ORDER BY uploaded_at DESC`,
        )
        .all(req.params.assignmentId) as any[];
      const files = isPrivileged ? rows : rows.filter((r) => r.student_id === studentId);
      res.json({ success: true, files });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/assignments/:assignmentId/files/:fileId', requireAuth(), async (req, res) => {
    try {
      const file = kernelContainer.db
        .prepare(
          `SELECT id, student_id, original_name, stored_path, mime, deleted_at
             FROM plugin_assignment_files WHERE id = ? AND assignment_id = ?`,
        )
        .get(req.params.fileId, req.params.assignmentId) as any;
      const { isPrivileged, studentId } = describeRequester(req);
      if (!file || file.deleted_at) {
        return res.status(404).json({ success: false, error: 'File not found' });
      }
      // 不存在与非本人同样返回 403，避免用状态码枚举文件是否存在
      if (!isPrivileged && file.student_id !== studentId) {
        return res.status(403).json({ success: false, error: 'Forbidden: Cannot read another student file' });
      }

      const absPath = path.resolve(process.cwd(), file.stored_path);
      const root = path.join(process.cwd(), 'storage', 'assignments');
      if (!absPath.startsWith(root) || !fs.existsSync(absPath)) {
        return res.status(404).json({ success: false, error: 'File not found on disk' });
      }

      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.download(absPath, file.original_name);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.delete('/api/assignments/:assignmentId/files/:fileId', requireAuth(), async (req, res) => {
    try {
      const file = kernelContainer.db
        .prepare(
          `SELECT id, student_id, version_id, deleted_at FROM plugin_assignment_files
            WHERE id = ? AND assignment_id = ?`,
        )
        .get(req.params.fileId, req.params.assignmentId) as any;
      const { isPrivileged, studentId } = describeRequester(req);
      if (!file || file.deleted_at) {
        return res.status(404).json({ success: false, error: 'File not found' });
      }
      if (!isPrivileged && file.student_id !== studentId) {
        return res.status(403).json({ success: false, error: 'Forbidden: Cannot delete another student file' });
      }
      // 已随某次提交归档的文件不允许删除，保证历史提交可追溯
      if (file.version_id) {
        return res.status(409).json({ success: false, error: 'File already attached to a submission version' });
      }
      kernelContainer.db
        .prepare('UPDATE plugin_assignment_files SET deleted_at = ? WHERE id = ?')
        .run(Date.now(), req.params.fileId);
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
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
      sendSafeError(res, e);
    }
  });

  app.post('/api/assignments/:assignmentId/assign-peer-reviews', requireAuth('teacher', 'administrator'), async (req, res) => {
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
      sendSafeError(res, e);
    }
  });
}
