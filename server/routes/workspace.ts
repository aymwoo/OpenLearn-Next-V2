import path from 'path';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getCookieToken, getValidSession, checkIsTeacherOrAdmin, requireAuth } from '../middleware/auth.js';
import type { ServerContext } from '../context.js';
import { sendSafeError } from '../utils/error-handler.js';

// ── SEC: 诊断上报轻量节流 ───────────────────────────────────────────────
// 该端点每次调用都会写一行 events 审计记录并向全体在线用户广播，
// 即便通过鉴权也需要限制频率，避免被单个账号放大为写库/广播风暴。
const DIAGNOSTIC_MIN_INTERVAL_MS = 1000;
const diagnosticLastReportAt = new Map<string, number>();

export function registerWorkspaceRoutes(ctx: ServerContext) {
  const { app, MF_REMOTE_CACHE } = ctx;

  app.get('/api/events', requireAuth('administrator', 'teacher'), (req, res) => {
    try {
      const events = kernelContainer.db.prepare('SELECT * FROM events ORDER BY timestamp DESC LIMIT 50').all();
      res.json(events);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // ── Client Diagnostics Fallback HTTP Report ─────────────────────────────
  // SEC-AUTH: 本端点是 WebSocket 路径（server/presence.ts 'student-client-error'）的
  // HTTP 回退。此前它既无鉴权、也丢掉了 WS 路径已有的防冒充校验（SEC-AUTH），
  // 使得回退路径成为绕过身份校验的后门。两者现在必须保持同等校验强度。
  app.post('/api/diagnostics/report', requireAuth(), (req, res) => {
    try {
      const data = req.body || {};
      const session = (req as any).session || {};
      const actorId: string = session.userId || session.studentId || 'unknown';

      // 无有效载荷时保持静默成功（与历史行为一致，避免触发前端重试）
      if (!data.studentId || !data.error) {
        return res.json({ success: true });
      }

      const isTeacherOrAdmin = session.role === 'teacher' || session.role === 'administrator';

      // SEC-AUTH: 阻止学生伪造他人 studentId 上报（与 presence.ts:164-168 一致）
      if (!isTeacherOrAdmin && actorId !== data.studentId) {
        console.warn(`[Diagnostics Security] ${actorId} attempted to report error as ${data.studentId}`);
        return res.status(403).json({ success: false, error: 'Forbidden: studentId mismatch' });
      }

      // 节流：同一账号 1 秒内只接受一次上报
      const now = Date.now();
      const last = diagnosticLastReportAt.get(actorId) || 0;
      if (now - last < DIAGNOSTIC_MIN_INTERVAL_MS) {
        return res.status(429).json({ success: false, error: 'Too many diagnostic reports' });
      }
      diagnosticLastReportAt.set(actorId, now);
      if (diagnosticLastReportAt.size > 5000) {
        for (const [k, v] of diagnosticLastReportAt) {
          if (now - v > 60_000) diagnosticLastReportAt.delete(k);
        }
      }

      const studentId = String(data.studentId).slice(0, 64);
      // SEC-AUTH: 学生上报时，显示名一律取服务端会话中的权威值，忽略客户端传入值，
      // 避免学生借 studentName 向全体教师广播任意文本（冒充 / 钓鱼）。
      const studentName = isTeacherOrAdmin
        ? String(data.studentName || studentId).slice(0, 100)
        : String(session.username || session.studentId || studentId).slice(0, 100);

      // 收敛 payload：仅保留已知字段并截断长度，防止超大包写入 events 表
      const errorPayload = {
        type: typeof data.error?.type === 'string' ? data.error.type.slice(0, 64) : 'runtime',
        message: typeof data.error?.message === 'string' ? data.error.message.slice(0, 2000) : undefined,
        title: typeof data.error?.title === 'string' ? data.error.title.slice(0, 200) : undefined,
        timestamp: Number(data.error?.timestamp) || now,
      };

      console.warn(
        `[Client Diagnostics HTTP] Student ${studentId} (${studentName}) reported error [${errorPayload.type}]: ${errorPayload.message || errorPayload.title || ''}`,
      );

      kernelContainer.eventBus.publish({
        id: `evt_err_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: 'student.client_error',
        source: 'student_client',
        payload: {
          studentId,
          studentName,
          lessonId: data.lessonId || null,
          classId: data.classId || null,
          error: errorPayload,
        },
        timestamp: errorPayload.timestamp,
        correlationId: data.lessonId || undefined,
      });

      if (ctx.io) {
        ctx.io.emit('student-error-alert', {
          studentId,
          studentName,
          lessonId: data.lessonId || null,
          classId: data.classId || null,
          error: errorPayload,
        });
      }

      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });


  // ── MFE Remote Entries ─────────────────────────────────────────────────
  app.get('/api/mfe/remotes', (req, res) => {
    try {
      const name = req.query.name as string | undefined;

      if (!name) {
        // Return all registered remotes
        const rows = kernelContainer.db.prepare('SELECT name, entry, meta FROM mfe_remotes').all() as Array<{
          name: string;
          entry: string;
          meta: string;
        }>;
        return res.json({ success: true, result: rows });
      }

      // Cache-first strategy (D-24)
      const cached = MF_REMOTE_CACHE.get(name);
      if (cached) {
        return res.json({ success: true, result: cached });
      }

      // Cache miss: query database
      const row = kernelContainer.db.prepare('SELECT name, entry, meta FROM mfe_remotes WHERE name = ?').get(name) as
        { name: string; entry: string; meta: string } | undefined;

      if (!row) {
        return res.status(404).json({
          success: false,
          error: `Remote "${name}" not registered`,
        });
      }

      const result = {
        entry: row.entry,
        meta: JSON.parse(row.meta || '{}'),
      };

      // Populate cache (D-24)
      MF_REMOTE_CACHE.set(name, result);

      res.json({ success: true, result });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // VFS APIs
  app.get('/api/vfs', requireAuth(), (req, res) => {
    try {
      const parentId = req.query.parentId === 'null' ? null : req.query.parentId || null;
      const isStaff = checkIsTeacherOrAdmin(req);
      const token = getCookieToken(req);
      const session = (req as any).session || (token ? getValidSession(token) : null);

      let nodes: any[] = [];

      if (parentId === 'virtual-lessons') {
        const lessons = kernelContainer.db.prepare('SELECT id, title, content FROM lessons').all() as any[];
        nodes = lessons.map((l) => ({
          id: `lesson-${l.id}`,
          parent_id: 'virtual-lessons',
          type: 'file',
          name: `${l.title}.md`,
          content: l.content,
        }));
      } else if (parentId === 'virtual-assignments') {
        const assignments = kernelContainer.db
          .prepare(
            'SELECT a.id, a.title, c.name as cname, a.content FROM assignments a JOIN classes c ON a.class_id = c.id',
          )
          .all() as any[];
        nodes = assignments.map((a) => ({
          id: `assgn-${a.id}`,
          parent_id: 'virtual-assignments',
          type: 'file',
          name: `[${a.cname}] ${a.title}.md`,
          content: a.content,
        }));
      } else if (parentId === 'virtual-submissions') {
        // SEC-FIX: 严格数据脱敏，普通学生仅可查看本人提交与成绩，严禁全量拉取全校作业与分数
        let submissions: any[] = [];
        if (isStaff) {
          submissions = kernelContainer.db
            .prepare(
              `
            SELECT sub.id, sub.content, a.title, s.name as sname, sub.score
            FROM assignment_submissions sub
            JOIN assignments a ON sub.assignment_id = a.id
            JOIN students s ON sub.student_id = s.id
          `,
            )
            .all() as any[];
        } else if (session?.userId || session?.studentId) {
          const studentOwnerId = session.userId || session.studentId;
          submissions = kernelContainer.db
            .prepare(
              `
            SELECT sub.id, sub.content, a.title, s.name as sname, sub.score
            FROM assignment_submissions sub
            JOIN assignments a ON sub.assignment_id = a.id
            JOIN students s ON sub.student_id = s.id
            WHERE sub.student_id = ?
          `,
            )
            .all(studentOwnerId) as any[];
        }
        nodes = submissions.map((sub) => ({
          id: `sub-${sub.id}`,
          parent_id: 'virtual-submissions',
          type: 'file',
          name: `${sub.sname} - ${sub.title}.md`,
          content: `# ${sub.title} by ${sub.sname}\n\nScore: ${sub.score || 'Ungraded'}\n\n---\n\n${sub.content}`,
        }));
      } else {
        let q = 'SELECT * FROM vfs_nodes WHERE parent_id IS ? ORDER BY type ASC, name ASC';
        nodes = kernelContainer.db.prepare(q).all(parentId);

        if (parentId === null) {
          nodes.unshift(
            { id: 'virtual-lessons', parent_id: null, type: 'dir', name: '📚 Lessons (Virtual)' },
            { id: 'virtual-assignments', parent_id: null, type: 'dir', name: '📝 Assignments (Virtual)' },
            { id: 'virtual-submissions', parent_id: null, type: 'dir', name: '🎓 Student Works (Virtual)' },
          );
        }
      }

      res.json(nodes);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // VFS File Download Router (V5.1+)
  app.get('/files/*', (req, res) => {
    try {
      let filePath = req.params[0] || '';
      if (!filePath.startsWith('/')) {
        filePath = '/' + filePath;
      }

      const parts = filePath.split('/').filter(Boolean);
      if (parts.length === 0) {
        return res.status(400).send('Invalid file path');
      }

      let currentParentId: string | null = null;
      let foundNode: any = null;

      for (let i = 0; i < parts.length; i++) {
        const name = parts[i];
        const isLast = i === parts.length - 1;
        const type = isLast ? 'file' : 'dir';

        const node = kernelContainer.db
          .prepare('SELECT * FROM vfs_nodes WHERE parent_id IS ? AND name = ? AND type = ?')
          .get(currentParentId, name, type) as any;

        if (!node) {
          return res.status(404).send(`File not found: ${filePath}`);
        }

        if (isLast) {
          foundNode = node;
        } else {
          currentParentId = node.id;
        }
      }

      if (!foundNode) {
        return res.status(404).send(`File not found: ${filePath}`);
      }

      const filename = parts[parts.length - 1];
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

      const ext = path.extname(filename).toLowerCase();
      const binaryExtensions = ['.pdf', '.xlsx', '.xls', '.zip', '.png', '.jpg', '.jpeg', '.gif', '.mp4', '.mp3'];

      const content = foundNode.content || '';
      if (binaryExtensions.includes(ext)) {
        try {
          const buffer = Buffer.from(content, 'base64');
          return res.send(buffer);
        } catch (e) {
          // fallback
        }
      }

      res.send(content);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });
}
