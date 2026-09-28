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
import {
  ALLOWED_ASSIGNMENT_EXT,
  ZIP_CONTAINER_EXT,
  ASSIGNMENT_MAX_FILE_SIZE,
  STUDENT_ASSIGNMENT_QUOTA_BYTES,
  parseAllowedExt,
} from '../utils/assignment-upload-policy.js';

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

/**
 * M4: 物理清理已软删除（deleted_at 非空）超过保留期的附件文件。
 *
 * 背景：DELETE 端点只写 deleted_at（保留 DB 行以支持审计与 IDOR 防护里的
 * 404 语义），磁盘文件此前永不清除 → 无限增长。
 * 保留期内文件仍在磁盘上（防误删恢复），超过 REtention 后物理删除、DB 行保留。
 *
 * @param db 内核 SQLite 句柄（注入以便单测）
 * @param retentionMs 软删除保留期，默认 7 天
 * @returns 物理删除的文件数
 */
export function gcSoftDeletedAssignmentFiles(
  db: { prepare(sql: string): { get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] } },
  retentionMs: number = 7 * 24 * 60 * 60 * 1000,
): number {
  const cutoff = Date.now() - retentionMs;
  let rows: Array<{ id: string; stored_path: string }> = [];
  try {
    rows = db
      .prepare(
        'SELECT id, stored_path FROM plugin_assignment_files WHERE deleted_at IS NOT NULL AND deleted_at < ? LIMIT 500',
      )
      .all(cutoff) as Array<{ id: string; stored_path: string }>;
  } catch {
    return 0; // 表尚未迁移（老库启动早期），静默跳过
  }
  let removed = 0;
  // 尾部分隔符哨兵：startsWith 裸前缀会让 storage/assignments2/ 逃逸通过
  const rootWithSep = path.join(process.cwd(), 'storage', 'assignments') + path.sep;
  for (const row of rows) {
    // SEC: stored_path 来源于 DB（历史上由本服务写入），仍做前缀复核防路径逃逸
    const absPath = path.resolve(process.cwd(), row.stored_path);
    if (!absPath.startsWith(rootWithSep)) continue;
    try {
      fs.unlinkSync(absPath);
      removed++;
    } catch {
      /* 文件可能已不存在 — 忽略 */
    }
  }
  return removed;
}

/** GC 调度：注册路由时执行一次 + 每 24h 一次（unref 不阻塞退出） */
function scheduleAssignmentFileGC(): void {
  try {
    gcSoftDeletedAssignmentFiles(kernelContainer.db as any);
  } catch {
    /* 首次执行的失败不影响路由注册 */
  }
  const timer = setInterval(
    () => {
      try {
        const removed = gcSoftDeletedAssignmentFiles(kernelContainer.db as any);
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

  // M4: 启动软删除文件物理 GC（立即一次 + 每 24h）
  scheduleAssignmentFileGC();

  /** 本文件统一的错误响应：尊重业务异常携带的 err.status（如归属校验的 403），其余 500 */
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

  /**
   * H1 班级归属校验：作业挂了 class_id 时，学生必须属于该班才能读详情 / 上传 / 提交。
   * 课时作业（class_id 为 NULL）无法核验选课关系，保持放行（提交侧仍有本人归属约束）。
   */
  const assertClassMembership = (
    assignment: { class_id: string | null } | undefined,
    isPrivileged: boolean,
    studentId: string | null,
  ): void => {
    if (isPrivileged || !assignment?.class_id || !studentId) return;
    const enrolled = kernelContainer.db
      .prepare('SELECT 1 AS ok FROM class_students WHERE class_id = ? AND student_id = ? LIMIT 1')
      .get(assignment.class_id, studentId) as { ok: number } | undefined;
    if (!enrolled) {
      const err: any = new Error("Forbidden: You are not enrolled in this assignment's class");
      err.status = 403;
      throw err;
    }
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
        assertClassMembership(assignmentRow, isPrivileged, studentId);
      }
      // 互评进度与异常标记含学生姓名，只给教师侧携带
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

        // 学生只能传到自己名下；教师代传时必须显式给出 studentId
        const headerStudent = decodeFileName(req.header('x-student-id') || '');
        const ownerStudentId = isPrivileged ? headerStudent || sessionStudentId : sessionStudentId;
        if (!ownerStudentId) {
          return res.status(400).json({ success: false, error: 'Missing studentId' });
        }

        const assignment = kernelContainer.db
          .prepare(
            'SELECT id, class_id, max_files, max_file_size, status, due_at, allow_late, allowed_ext FROM plugin_assignments WHERE id = ?',
          )
          .get(assignmentId) as
          | {
              id: string;
              class_id: string | null;
              max_files: number;
              max_file_size: number;
              status: string;
              due_at: number | null;
              allow_late: number;
              allowed_ext: string | null;
            }
          | undefined;
        if (!assignment) {
          return res.status(404).json({ success: false, error: `Assignment not found: ${assignmentId}` });
        }
        // H1: 挂班级的作业，学生必须属于该班才能上传
        assertClassMembership(assignment, isPrivileged, sessionStudentId || ownerStudentId);
        // H2: 未发布 / 已关闭的作业禁止上传（含教师代传——草稿/归档态不开放收集）
        if (assignment.status !== 'published') {
          return res.status(409).json({ success: false, error: `Assignment is ${assignment.status}` });
        }
        // 已截止且不允许迟交时拒绝学生上传；教师代传豁免（教师补收作业是合理教学场景）
        if (
          !isPrivileged &&
          assignment.due_at !== null &&
          Date.now() > Number(assignment.due_at) &&
          !assignment.allow_late
        ) {
          return res.status(409).json({ success: false, error: 'Assignment is past due (late uploads not allowed)' });
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
        // L1: 每作业扩展名限制（plugin_assignments.allowed_ext）。
        // 只能「收紧」全局白名单，不能放宽 —— 解析时已过滤掉不在全局白名单里的项。
        const perAssignmentExt = parseAllowedExt(assignment.allowed_ext);
        if (perAssignmentExt && !perAssignmentExt.has(ext)) {
          return res.status(400).json({ success: false, error: `File type not allowed for this assignment: ${ext}` });
        }

        const buffer: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (buffer.length === 0) {
          return res.status(400).json({ success: false, error: 'Empty file body' });
        }

        const sizeLimit = Math.min(
          Number(assignment.max_file_size) || SIZE_LIMITS.assignment,
          ASSIGNMENT_MAX_FILE_SIZE,
        );
        if (buffer.length > sizeLimit) {
          return res.status(413).json({ success: false, error: `File too large (limit ${sizeLimit} bytes)` });
        }
        if (ZIP_CONTAINER_EXT.has(ext) && !(buffer[0] === 0x50 && buffer[1] === 0x4b)) {
          return res.status(400).json({ success: false, error: 'File content does not match its extension' });
        }
        if (!validateMagicBytes(buffer, fileName)) {
          return res.status(400).json({ success: false, error: 'File content does not match its extension' });
        }

        const dir = assignmentStorageDir(assignmentId, ownerStudentId);
        fs.mkdirSync(dir, { recursive: true });
        const storedName = `${crypto.randomUUID()}${ext}`;
        const storedPath = path.join(dir, storedName);
        // M1: 异步落盘 — 50MB 同步写会阻塞事件循环，全班请求停摆
        await fs.promises.writeFile(storedPath, buffer);

        const fileId = 'af-' + crypto.randomUUID();
        const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
        try {
          // M2: 计数检查 + 插入放同一同步事务，消除并发双传突破上限的 TOCTOU
          const insertTx = kernelContainer.db.transaction(() => {
            const currentCount = (
              kernelContainer.db
                .prepare(
                  'SELECT COUNT(*) AS c FROM plugin_assignment_files WHERE assignment_id = ? AND student_id = ? AND deleted_at IS NULL',
                )
                .get(assignmentId, ownerStudentId) as { c: number }
            ).c;
            if (currentCount >= (Number(assignment.max_files) || 10)) {
              throw new Error(`At most ${assignment.max_files} files are allowed`);
            }
            // M3: 学生全作业存储配额（软删除文件不计入）— 教师代传不受限
            if (!isPrivileged) {
              const used = (
                kernelContainer.db
                  .prepare(
                    'SELECT COALESCE(SUM(size), 0) AS s FROM plugin_assignment_files WHERE student_id = ? AND deleted_at IS NULL',
                  )
                  .get(ownerStudentId) as { s: number }
              ).s;
              if (used + buffer.length > STUDENT_ASSIGNMENT_QUOTA_BYTES) {
                const err: any = new Error('Storage quota exceeded for this student');
                err.status = 413;
                throw err;
              }
            }
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
          });
          insertTx();
        } catch (dbErr: any) {
          // L3: 写库失败（含超限/超配额）一律回滚物理文件，不留孤儿
          try {
            fs.unlinkSync(storedPath);
          } catch {
            /* best effort */
          }
          if (dbErr?.message?.includes('At most')) {
            return res.status(409).json({ success: false, error: dbErr.message });
          }
          if ((dbErr as any)?.status === 413) {
            return res.status(413).json({ success: false, error: dbErr.message });
          }
          throw dbErr;
        }

        res.json({
          success: true,
          file: { id: fileId, name: fileName, size: buffer.length, sha256, studentId: ownerStudentId },
        });
      } catch (e: any) {
        sendHubError(res, e);
      }
    },
  );

  // ── 文件列表 / 下载 / 删除 ───────────────────────────────────────────────
  app.get('/api/assignments/:assignmentId/files', requireAuth(), async (req, res) => {
    try {
      const { isPrivileged, studentId } = describeRequester(req);
      // H1: 挂班级的作业，学生必须属于该班
      const assignmentRow = kernelContainer.db
        .prepare('SELECT class_id FROM plugin_assignments WHERE id = ?')
        .get(req.params.assignmentId) as { class_id: string | null } | undefined;
      assertClassMembership(assignmentRow, isPrivileged, studentId);
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
      sendHubError(res, e);
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
      // 不存在与非本人同样返回 403，避免用状态码枚举文件是否存在；
      // 例外：被分配了互评任务的学生可以下载被评提交物里的附件（双盲，仅限该提交）。
      if (!isPrivileged && file.student_id !== studentId) {
        const assigned = kernelContainer.db
          .prepare(
            `SELECT 1 AS ok FROM plugin_assignment_files f
               JOIN plugin_submission_versions v ON v.id = f.version_id
               JOIN plugin_peer_review_tasks t ON t.submission_id = v.submission_id
              WHERE f.id = ? AND t.reviewer_id = ? LIMIT 1`,
          )
          .get(req.params.fileId, studentId) as { ok: number } | undefined;
        if (!assigned) {
          return res.status(403).json({ success: false, error: 'Forbidden: Cannot read another student file' });
        }
      }

      const absPath = path.resolve(process.cwd(), file.stored_path);
      // 尾部分隔符哨兵：startsWith 裸前缀会让 storage/assignments2/ 逃逸通过
      const root = path.join(process.cwd(), 'storage', 'assignments') + path.sep;
      if (!absPath.startsWith(root) || !fs.existsSync(absPath)) {
        return res.status(404).json({ success: false, error: 'File not found on disk' });
      }

      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.download(absPath, file.original_name);
    } catch (e: any) {
      sendHubError(res, e);
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
      // H1: 挂班级的作业，学生必须属于该班才能提交（防外班学生污染成绩册）
      const assignmentRow = kernelContainer.db
        .prepare('SELECT class_id FROM plugin_assignments WHERE id = ?')
        .get(req.params.assignmentId) as { class_id: string | null } | undefined;
      assertClassMembership(assignmentRow, isPrivileged, targetStudentId);
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

  // 学生提交互评：reviewerId 一律由会话决定，请求体不能冒充他人
  app.post('/api/assignments/:assignmentId/peer-review', requireAuth(), async (req, res) => {
    try {
      const { isPrivileged, studentId } = describeRequester(req);
      const body = req.body || {};
      const reviewerId = isPrivileged ? String(body.reviewerId || body.studentId || '') : String(studentId || '');
      if (!reviewerId) {
        return res.status(400).json({ success: false, error: 'Missing reviewerId' });
      }
      // H1: 互评人也必须属于作业班级（开放互评模式下防外班学生参与）
      const reviewAssignmentRow = kernelContainer.db
        .prepare('SELECT class_id FROM plugin_assignments WHERE id = ?')
        .get(req.params.assignmentId) as { class_id: string | null } | undefined;
      assertClassMembership(reviewAssignmentRow, isPrivileged, reviewerId);
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
