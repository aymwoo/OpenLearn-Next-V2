/**
 * 学案式课时包 API（Issue IKVO15 · P0 后端）。
 *
 * 路由清单：
 *   活动（lesson_activities）
 *     GET    /api/lessons/:lessonId/activities           列出课时的活动（按 order_index）
 *     POST   /api/lessons/:lessonId/activities           新增活动
 *     PUT    /api/activities/:id                          更新活动
 *     DELETE /api/activities/:id                          删除活动
 *     POST   /api/lessons/:lessonId/activities/reorder   批量重排（传 id 有序数组）
 *
 *   学案首页块（lesson_activity_blocks）
 *     GET    /api/lessons/:lessonId/blocks                列出首页块（按 order_index）
 *     POST   /api/lessons/:lessonId/blocks                新增首页块
 *     PUT    /api/blocks/:id                              更新首页块
 *     DELETE /api/blocks/:id                              删除首页块
 *
 *   学生端
 *     GET    /api/lessons/:lessonId/xuean                 学案聚合：blocks + activities + 我的 progress
 *     POST   /api/activities/:id/progress                 活动进度上报（自报，verified=0）
 *
 *   教师端
 *     GET    /api/lessons/:lessonId/activity-progress     活动级进度面板（各活动 × 学生）
 *     POST   /api/activities/:id/progress/verify          教师验证/批阅（写 verified + score + status=graded）
 *
 * 权限：
 *   - 学生：读学案聚合 / 写本人 activity_progress（仅本人 student_id 行）
 *   - 教师：lesson owner 或管理员可 CRUD 活动/blocks + 看进度面板 + 批阅
 *   - 活动完成不自动推进课堂门禁（issue 明确要求，与 timeline 并列）
 */
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import { sendSafeError } from '../utils/error-handler.js';
import { randomId } from '../utils/id.js';
import {
  authorizeLessonStaff,
  canSeeLesson,
  isAdministrator,
  isTeacher,
  rejectUnless,
  studentActorId,
} from '../services/class-access.js';
import type { ServerContext } from '../context.js';

// ── 内部常量 ─────────────────────────────────────────────────────────────
const VALID_ACTIVITY_TYPES = new Set([
  'reading',
  'submission',
  'quiz',
  'discussion',
  'courseware',
  'scratch',
  'form',
  'other',
]);

const VALID_BLOCK_TYPES = new Set([
  'learning_goals',
  'key_points',
  'resources',
  'operation_tips',
  'works_showcase',
  'reflection',
  'free_html',
]);

const VALID_PROGRESS_STATUS = new Set(['not_started', 'in_progress', 'submitted', 'graded']);

// ── 辅助函数 ─────────────────────────────────────────────────────────────
function now() {
  return Date.now();
}

function jsonOrNull<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v !== 'string') return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

function parseActivity(body: any): { ok: true; value: any } | { ok: false; error: string; status: number } {
  const { type, title, config, required, visible, peerReview, groupMode, submissionType, rubric, releaseAt, dueAt } =
    body || {};

  if (typeof type !== 'string' || !VALID_ACTIVITY_TYPES.has(type)) {
    return { ok: false, error: 'Invalid activity type', status: 400 };
  }
  if (typeof title !== 'string' || !title.trim()) {
    return { ok: false, error: 'Title is required', status: 400 };
  }
  let configJson: string | null = null;
  if (config != null) {
    try {
      configJson = typeof config === 'string' ? config : JSON.stringify(config);
    } catch {
      return { ok: false, error: 'Invalid config JSON', status: 400 };
    }
  }
  let rubricJson: string | null = null;
  if (rubric != null) {
    try {
      rubricJson = typeof rubric === 'string' ? rubric : JSON.stringify(rubric);
    } catch {
      return { ok: false, error: 'Invalid rubric JSON', status: 400 };
    }
  }
  return {
    ok: true,
    value: {
      type,
      title: title.trim(),
      configJson,
      required: required !== false ? 1 : 0,
      visible: visible !== false ? 1 : 0,
      peerReview: peerReview ? 1 : 0,
      groupMode: groupMode && typeof groupMode === 'string' ? groupMode : 'none',
      submissionType: submissionType && typeof submissionType === 'string' ? submissionType : null,
      rubricJson,
      releaseAt: Number.isFinite(releaseAt) ? Number(releaseAt) : null,
      dueAt: Number.isFinite(dueAt) ? Number(dueAt) : null,
    },
  };
}

function parseBlock(body: any): { ok: true; value: any } | { ok: false; error: string; status: number } {
  const { blockType, content } = body || {};
  if (typeof blockType !== 'string' || !VALID_BLOCK_TYPES.has(blockType)) {
    return { ok: false, error: 'Invalid block_type', status: 400 };
  }
  if (content == null) {
    return { ok: false, error: 'content is required', status: 400 };
  }
  let contentJson: string;
  try {
    contentJson = typeof content === 'string' ? content : JSON.stringify(content);
  } catch {
    return { ok: false, error: 'Invalid content JSON', status: 400 };
  }
  return { ok: true, value: { blockType, contentJson } };
}

// ── 注册函数 ─────────────────────────────────────────────────────────────
export function registerLessonActivitiesRoutes(ctx: ServerContext) {
  const { app } = ctx;
  const db = kernelContainer.db;
  const readDb = kernelContainer.getReadDb();

  // ══════════════════════════════════════════════════════════════════════
  // 活动（lesson_activities）
  // ══════════════════════════════════════════════════════════════════════

  // 列出课时的活动
  app.get('/api/lessons/:lessonId/activities', requireScopedAuth('authenticated'), (req, res) => {
    try {
      const lessonId = req.params.lessonId;
      const session = (req as any).session;
      if (!canSeeLesson(readDb, session, lessonId)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      const rows = readDb
        .prepare(
          'SELECT * FROM lesson_activities WHERE lesson_id = ? AND visible = 1 ORDER BY order_index ASC, created_at ASC',
        )
        .all(lessonId);
      res.json(rows);
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // 新增活动（教师/管理员）
  app.post('/api/lessons/:lessonId/activities', requireScopedAuth('class-staff'), (req, res) => {
    try {
      const lessonId = req.params.lessonId;
      const session = (req as any).session;
      if (rejectUnless(res, authorizeLessonStaff(readDb, session, lessonId))) return;

      const parsed = parseActivity(req.body);
      if (!parsed.ok) return res.status(parsed.status).json({ success: false, error: parsed.error });

      // 取当前最大 order_index，新活动追加到末尾
      const maxOrder = (
        readDb
          .prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM lesson_activities WHERE lesson_id = ?')
          .get(lessonId) as { m: number }
      ).m;

      const id = randomId();
      const nowTs = now();
      db.prepare(
        `INSERT INTO lesson_activities
          (id, lesson_id, order_index, type, title, config_json, required, visible,
           peer_review, group_mode, submission_type, rubric_json, release_at, due_at,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        lessonId,
        maxOrder + 1,
        parsed.value.type,
        parsed.value.title,
        parsed.value.configJson,
        parsed.value.required,
        parsed.value.visible,
        parsed.value.peerReview,
        parsed.value.groupMode,
        parsed.value.submissionType,
        parsed.value.rubricJson,
        parsed.value.releaseAt,
        parsed.value.dueAt,
        nowTs,
        nowTs,
      );

      res.status(201).json(db.prepare('SELECT * FROM lesson_activities WHERE id = ?').get(id));
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // 更新活动（教师/管理员）
  app.put('/api/activities/:id', requireScopedAuth('class-staff'), (req, res) => {
    try {
      const id = req.params.id;
      const session = (req as any).session;
      const existing = readDb.prepare('SELECT * FROM lesson_activities WHERE id = ?').get(id) as any | undefined;
      if (!existing) return res.status(404).json({ success: false, error: 'Activity not found' });
      if (rejectUnless(res, authorizeLessonStaff(readDb, session, existing.lesson_id))) return;

      const parsed = parseActivity({ ...existing, ...req.body });
      if (!parsed.ok) return res.status(parsed.status).json({ success: false, error: parsed.error });

      const orderIndex =
        (req.body?.order_index ?? req.body?.orderIndex ?? Number.isFinite(req.body?.order_index))
          ? Number(req.body.order_index)
          : existing.order_index;

      db.prepare(
        `UPDATE lesson_activities
         SET type = ?, title = ?, config_json = ?, required = ?, visible = ?,
             peer_review = ?, group_mode = ?, submission_type = ?, rubric_json = ?,
             release_at = ?, due_at = ?, order_index = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        parsed.value.type,
        parsed.value.title,
        parsed.value.configJson,
        parsed.value.required,
        parsed.value.visible,
        parsed.value.peerReview,
        parsed.value.groupMode,
        parsed.value.submissionType,
        parsed.value.rubricJson,
        parsed.value.releaseAt,
        parsed.value.dueAt,
        orderIndex,
        now(),
        id,
      );

      res.json(db.prepare('SELECT * FROM lesson_activities WHERE id = ?').get(id));
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // 删除活动（教师/管理员）
  app.delete('/api/activities/:id', requireScopedAuth('class-staff'), (req, res) => {
    try {
      const id = req.params.id;
      const session = (req as any).session;
      const existing = readDb.prepare('SELECT * FROM lesson_activities WHERE id = ?').get(id) as any | undefined;
      if (!existing) return res.status(404).json({ success: false, error: 'Activity not found' });
      if (rejectUnless(res, authorizeLessonStaff(readDb, session, existing.lesson_id))) return;

      // 级联删除 progress 行（activity 被删，progress 失去意义）
      db.prepare('DELETE FROM activity_progress WHERE activity_id = ?').run(id);
      db.prepare('DELETE FROM lesson_activities WHERE id = ?').run(id);

      res.json({ success: true });
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // 批量重排（传有序 id 数组；仅限同一 lesson 内）
  app.post('/api/lessons/:lessonId/activities/reorder', requireScopedAuth('class-staff'), (req, res) => {
    try {
      const lessonId = req.params.lessonId;
      const session = (req as any).session;
      if (rejectUnless(res, authorizeLessonStaff(readDb, session, lessonId))) return;

      const { ids } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, error: 'ids array required' });
      }
      for (const id of ids) {
        if (
          typeof id !== 'string' ||
          !readDb.prepare('SELECT 1 FROM lesson_activities WHERE id = ? AND lesson_id = ?').get(id, lessonId)
        ) {
          return res.status(400).json({ success: false, error: `Unknown activity id: ${id}` });
        }
      }

      const tx = db.transaction((ordered: string[]) => {
        const updateStmt = db.prepare('UPDATE lesson_activities SET order_index = ?, updated_at = ? WHERE id = ?');
        const ts = now();
        ordered.forEach((id, i) => updateStmt.run(i, ts, id));
      });
      tx(ids);

      const rows = readDb
        .prepare('SELECT id, order_index FROM lesson_activities WHERE lesson_id = ? ORDER BY order_index ASC')
        .all(lessonId);
      res.json(rows);
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // 学案首页块（lesson_activity_blocks）
  // ══════════════════════════════════════════════════════════════════════

  app.get('/api/lessons/:lessonId/blocks', requireScopedAuth('authenticated'), (req, res) => {
    try {
      const lessonId = req.params.lessonId;
      const session = (req as any).session;
      if (!canSeeLesson(readDb, session, lessonId)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      const rows = readDb
        .prepare('SELECT * FROM lesson_activity_blocks WHERE lesson_id = ? ORDER BY order_index ASC')
        .all(lessonId);
      res.json(rows);
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  app.post('/api/lessons/:lessonId/blocks', requireScopedAuth('class-staff'), (req, res) => {
    try {
      const lessonId = req.params.lessonId;
      const session = (req as any).session;
      if (rejectUnless(res, authorizeLessonStaff(readDb, session, lessonId))) return;

      const parsed = parseBlock(req.body);
      if (!parsed.ok) return res.status(parsed.status).json({ success: false, error: parsed.error });

      const maxOrder = (
        readDb
          .prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM lesson_activity_blocks WHERE lesson_id = ?')
          .get(lessonId) as { m: number }
      ).m;

      const id = randomId();
      const nowTs = now();
      db.prepare(
        `INSERT INTO lesson_activity_blocks
          (id, lesson_id, block_type, order_index, content_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, lessonId, parsed.value.blockType, maxOrder + 1, parsed.value.contentJson, nowTs, nowTs);

      res.status(201).json(db.prepare('SELECT * FROM lesson_activity_blocks WHERE id = ?').get(id));
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  app.put('/api/blocks/:id', requireScopedAuth('class-staff'), (req, res) => {
    try {
      const id = req.params.id;
      const session = (req as any).session;
      const existing = readDb.prepare('SELECT * FROM lesson_activity_blocks WHERE id = ?').get(id) as any | undefined;
      if (!existing) return res.status(404).json({ success: false, error: 'Block not found' });
      if (rejectUnless(res, authorizeLessonStaff(readDb, session, existing.lesson_id))) return;

      const parsed = parseBlock({ ...existing, ...req.body });
      if (!parsed.ok) return res.status(parsed.status).json({ success: false, error: parsed.error });

      const orderIndex =
        (req.body?.order_index ?? req.body?.orderIndex ?? Number.isFinite(req.body?.order_index))
          ? Number(req.body.order_index)
          : existing.order_index;

      db.prepare(
        `UPDATE lesson_activity_blocks
         SET block_type = ?, content_json = ?, order_index = ?, updated_at = ?
         WHERE id = ?`,
      ).run(parsed.value.blockType, parsed.value.contentJson, orderIndex, now(), id);

      res.json(db.prepare('SELECT * FROM lesson_activity_blocks WHERE id = ?').get(id));
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  app.delete('/api/blocks/:id', requireScopedAuth('class-staff'), (req, res) => {
    try {
      const id = req.params.id;
      const session = (req as any).session;
      const existing = readDb.prepare('SELECT * FROM lesson_activity_blocks WHERE id = ?').get(id) as any | undefined;
      if (!existing) return res.status(404).json({ success: false, error: 'Block not found' });
      if (rejectUnless(res, authorizeLessonStaff(readDb, session, existing.lesson_id))) return;

      db.prepare('DELETE FROM lesson_activity_blocks WHERE id = ?').run(id);
      res.json({ success: true });
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // ── 学案包导入导出（manifest + activities + blocks）──────────────────────
  // 导出：返回当前 lesson 的全部活动 + 首页块（不含进度）
  app.get('/api/lessons/:lessonId/xuean/export', requireScopedAuth('class-staff'), (req, res) => {
    try {
      const lessonId = req.params.lessonId;
      const session = (req as any).session;
      if (rejectUnless(res, authorizeLessonStaff(readDb, session, lessonId))) return;

      const activities = readDb
        .prepare(
          'SELECT type, title, config_json, required, visible, peer_review, group_mode, submission_type, rubric_json, release_at, due_at, order_index FROM lesson_activities WHERE lesson_id = ? ORDER BY order_index ASC',
        )
        .all(lessonId);
      const blocks = readDb
        .prepare(
          'SELECT block_type, content_json, order_index FROM lesson_activity_blocks WHERE lesson_id = ? ORDER BY order_index ASC',
        )
        .all(lessonId);

      res.json({
        manifest: {
          format: 'xuean-package',
          version: 1,
          exportedAt: Date.now(),
          activityCount: activities.length,
          blockCount: blocks.length,
        },
        activities,
        blocks,
      });
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // 导入：清空当前 lesson 的活动 + 首页块，按导入 JSON 重建
  app.post('/api/lessons/:lessonId/xuean/import', requireScopedAuth('class-staff'), (req, res) => {
    try {
      const lessonId = req.params.lessonId;
      const session = (req as any).session;
      if (rejectUnless(res, authorizeLessonStaff(readDb, session, lessonId))) return;

      const { activities, blocks } = req.body || {};
      if (!Array.isArray(activities) || !Array.isArray(blocks)) {
        return res.status(400).json({ success: false, error: 'activities and blocks arrays required' });
      }

      const tx = db.transaction(() => {
        // 清空现有活动 + 首页块（级联清理 activity_progress）
        db.prepare('DELETE FROM activity_progress WHERE activity_id IN (SELECT id FROM lesson_activities WHERE lesson_id = ?)').run(lessonId);
        db.prepare('DELETE FROM lesson_activities WHERE lesson_id = ?').run(lessonId);
        db.prepare('DELETE FROM lesson_activity_blocks WHERE lesson_id = ?').run(lessonId);

        // 重建活动
        for (const a of activities) {
          db.prepare(
            `INSERT INTO lesson_activities (id, lesson_id, order_index, type, title, config_json, required, visible, peer_review, group_mode, submission_type, rubric_json, release_at, due_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            randomId(),
            lessonId,
            a.order_index ?? 0,
            a.type ?? 'other',
            a.title ?? '未命名活动',
            a.config_json ?? null,
            a.required ? 1 : 0,
            a.visible ? 1 : 0,
            a.peer_review ? 1 : 0,
            a.group_mode ?? 'individual',
            a.submission_type ?? null,
            a.rubric_json ?? null,
            a.release_at ?? null,
            a.due_at ?? null,
            now(),
            now(),
          );
        }

        // 重建首页块
        for (const b of blocks) {
          db.prepare(
            `INSERT INTO lesson_activity_blocks (id, lesson_id, block_type, content_json, order_index, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            randomId(),
            lessonId,
            b.block_type ?? 'free',
            b.content_json ?? '{}',
            b.order_index ?? 0,
            now(),
            now(),
          );
        }
      });

      tx();
      res.json({ success: true, activityCount: activities.length, blockCount: blocks.length });
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // 学生端：学案聚合 + 活动进度上报
  // ══════════════════════════════════════════════════════════════════════

  // 学案聚合接口：blocks + activities + 我本人的 activity_progress
  app.get('/api/lessons/:lessonId/xuean', requireScopedAuth('authenticated'), (req, res) => {
    try {
      const lessonId = req.params.lessonId;
      const session = (req as any).session;
      if (!canSeeLesson(readDb, session, lessonId)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }

      const blocks = readDb
        .prepare('SELECT * FROM lesson_activity_blocks WHERE lesson_id = ? ORDER BY order_index ASC')
        .all(lessonId);

      // 学生端：只返回已发布（visible=1 且 release_at 为空或已到发布时间）的活动
      // 教师/管理员端：返回全部 visible=1 活动（预览未发布的）
      const isStaff = isAdministrator(session) || isTeacher(session);
      const ts = now();
      const activities = isStaff
        ? readDb
            .prepare(
              'SELECT * FROM lesson_activities WHERE lesson_id = ? AND visible = 1 ORDER BY order_index ASC, created_at ASC',
            )
            .all(lessonId)
        : readDb
            .prepare(
              'SELECT * FROM lesson_activities WHERE lesson_id = ? AND visible = 1 AND (release_at IS NULL OR release_at <= ?) ORDER BY order_index ASC, created_at ASC',
            )
            .all(lessonId, ts);

      // 学生 → 只取自己 progress；教师/管理员 → 可选学生视角 (query.studentId)
      let progressRows: any[] = [];
      const requestedStudentId = req.query.studentId as string | undefined;

      if (isStaff && requestedStudentId) {
        // 教师请求了特定学生的 progress → 权限已通过 canSeeLesson + authorizeLessonStaff 链路
        if (!authorizeLessonStaff(readDb, session, lessonId).ok) {
          return res.status(403).json({ success: false, error: 'Forbidden' });
        }
        progressRows = readDb
          .prepare(
            'SELECT * FROM activity_progress WHERE student_id = ? AND activity_id IN (SELECT id FROM lesson_activities WHERE lesson_id = ?)',
          )
          .all(requestedStudentId, lessonId);
      } else {
        const studentId = studentActorId(session);
        if (studentId) {
          progressRows = readDb
            .prepare(
              'SELECT * FROM activity_progress WHERE student_id = ? AND activity_id IN (SELECT id FROM lesson_activities WHERE lesson_id = ?)',
            )
            .all(studentId, lessonId);
        }
      }

      const progressByActivity: Record<string, any> = {};
      for (const p of progressRows) progressByActivity[p.activity_id] = p;

      res.json({ lessonId, blocks, activities, progressByActivity });
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // 活动进度上报（学生自报，verified 保持 0）
  app.post('/api/activities/:id/progress', requireScopedAuth('authenticated'), (req, res) => {
    try {
      const activityId = req.params.id;
      const session = (req as any).session;

      const activity = readDb
        .prepare(
          'SELECT la.*, l.creator_id FROM lesson_activities la JOIN lessons l ON l.id = la.lesson_id WHERE la.id = ?',
        )
        .get(activityId) as any | undefined;
      if (!activity) return res.status(404).json({ success: false, error: 'Activity not found' });

      if (!canSeeLesson(readDb, session, activity.lesson_id)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }

      // 只有本人能写自己的进度：学生强制用 session.studentId，教师/管理员才允许 body 覆盖
      const actorStudentId: string | null = studentActorId(session);
      const privileged = isAdministrator(session) || isTeacher(session);
      const { status, progressPercent, studentId, submission, selfEval } = req.body || {};

      let finalStudentId: string;
      if (actorStudentId && !privileged) {
        // 学生 session：强制不能改别人 — body.studentId 如果不匹配直接 403
        if (studentId != null && String(studentId) !== actorStudentId) {
          return res.status(403).json({ success: false, error: 'Forbidden: cannot write another student progress' });
        }
        finalStudentId = actorStudentId;
      } else if (actorStudentId && privileged) {
        // 教师/管理员但有 studentActorId（少见）：允许 body 覆盖
        finalStudentId = studentId != null ? String(studentId) : actorStudentId;
      } else {
        // 纯教师/管理员：必须显式传 studentId
        if (!privileged) {
          return res.status(403).json({ success: false, error: 'Forbidden: studentId required' });
        }
        if (studentId == null) {
          return res.status(400).json({ success: false, error: 'studentId required' });
        }
        finalStudentId = String(studentId);
      }

      if (!finalStudentId) {
        return res.status(400).json({ success: false, error: 'studentId required' });
      }

      let finalStatus: string;
      if (typeof status === 'string' && VALID_PROGRESS_STATUS.has(status)) {
        finalStatus = status;
      } else if (status != null) {
        return res.status(400).json({ success: false, error: 'Invalid status' });
      } else {
        finalStatus = 'in_progress';
      }

      const percent = Number.isFinite(progressPercent) ? Math.max(0, Math.min(100, Number(progressPercent))) : null;
      const ts = now();

      // submission: string | { type: 'text'|'file'|'link', content: string, url?: string }
      // 非空才写入；空字符串/undefined/null 不覆盖已有提交
      const hasSubmission =
        submission != null && submission !== '' && (typeof submission === 'string' || typeof submission === 'object');
      const submissionJson = hasSubmission ? JSON.stringify(submission) : undefined;

      // selfEval: { score: number, comment: string }
      const hasSelfEval = selfEval != null && typeof selfEval === 'object';
      const selfEvalJson = hasSelfEval ? JSON.stringify(selfEval) : undefined;

      // verified 只能由 verify 端点写入
      if (submissionJson && selfEvalJson) {
        db.prepare(
          `INSERT INTO activity_progress (activity_id, student_id, status, progress_percent, verified, last_activity_at, submission_json, self_eval_json)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?)
           ON CONFLICT(activity_id, student_id) DO UPDATE SET
             status = excluded.status,
             progress_percent = excluded.progress_percent,
             last_activity_at = excluded.last_activity_at,
             submission_json = excluded.submission_json,
             self_eval_json = excluded.self_eval_json`,
        ).run(activityId, finalStudentId, finalStatus, percent ?? 0, ts, submissionJson, selfEvalJson);
      } else if (submissionJson) {
        db.prepare(
          `INSERT INTO activity_progress (activity_id, student_id, status, progress_percent, verified, last_activity_at, submission_json)
           VALUES (?, ?, ?, ?, 0, ?, ?)
           ON CONFLICT(activity_id, student_id) DO UPDATE SET
             status = excluded.status,
             progress_percent = excluded.progress_percent,
             last_activity_at = excluded.last_activity_at,
             submission_json = excluded.submission_json`,
        ).run(activityId, finalStudentId, finalStatus, percent ?? 0, ts, submissionJson);
      } else if (selfEvalJson) {
        db.prepare(
          `INSERT INTO activity_progress (activity_id, student_id, status, progress_percent, verified, last_activity_at, self_eval_json)
           VALUES (?, ?, ?, ?, 0, ?, ?)
           ON CONFLICT(activity_id, student_id) DO UPDATE SET
             status = excluded.status,
             progress_percent = excluded.progress_percent,
             last_activity_at = excluded.last_activity_at,
             self_eval_json = excluded.self_eval_json`,
        ).run(activityId, finalStudentId, finalStatus, percent ?? 0, ts, selfEvalJson);
      } else {
        db.prepare(
          `INSERT INTO activity_progress (activity_id, student_id, status, progress_percent, verified, last_activity_at)
           VALUES (?, ?, ?, ?, 0, ?)
           ON CONFLICT(activity_id, student_id) DO UPDATE SET
             status = excluded.status,
             progress_percent = excluded.progress_percent,
             last_activity_at = excluded.last_activity_at`,
        ).run(activityId, finalStudentId, finalStatus, percent ?? 0, ts);
      }

      const row = readDb
        .prepare('SELECT * FROM activity_progress WHERE activity_id = ? AND student_id = ?')
        .get(activityId, finalStudentId);
      res.json(row);
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // 教师端：批阅 + 进度面板
  // ══════════════════════════════════════════════════════════════════════

  // 教师批阅/验证：写 verified + 可选 score + 状态置 graded/submitted
  app.post('/api/activities/:id/progress/verify', requireScopedAuth('class-staff'), (req, res) => {
    try {
      const activityId = req.params.id;
      const session = (req as any).session;
      const activity = readDb.prepare('SELECT * FROM lesson_activities WHERE id = ?').get(activityId) as
        any | undefined;
      if (!activity) return res.status(404).json({ success: false, error: 'Activity not found' });
      if (rejectUnless(res, authorizeLessonStaff(readDb, session, activity.lesson_id))) return;

      const { studentId, status, score } = req.body || {};
      if (typeof studentId !== 'string' || !studentId) {
        return res.status(400).json({ success: false, error: 'studentId required' });
      }

      const newStatus = typeof status === 'string' && VALID_PROGRESS_STATUS.has(status) ? status : undefined;
      const scoreVal = score != null ? Number(score) : undefined;
      const ts = now();

      // 没有现有行则先插入（verified=1）
      const existing = readDb
        .prepare('SELECT 1 FROM activity_progress WHERE activity_id = ? AND student_id = ?')
        .get(activityId, studentId);

      if (!existing) {
        db.prepare(
          `INSERT INTO activity_progress (activity_id, student_id, status, progress_percent, verified, score, graded_at, last_activity_at)
           VALUES (?, ?, ?, 100, 1, ?, ?, ?)`,
        ).run(activityId, studentId, newStatus ?? 'submitted', scoreVal ?? null, ts, ts);
      } else {
        db.prepare(
          `UPDATE activity_progress
           SET verified = 1,
               status = COALESCE(?, status),
               score = COALESCE(?, score),
               graded_at = ?,
               last_activity_at = ?
           WHERE activity_id = ? AND student_id = ?`,
        ).run(newStatus ?? null, scoreVal ?? null, ts, ts, activityId, studentId);
      }

      // 积分闭环：批阅给分时写入 student_point_logs
      if (scoreVal != null) {
        const classRow = readDb
          .prepare('SELECT class_id FROM schedules WHERE lesson_id = ? LIMIT 1')
          .get(activity.lesson_id) as { class_id: string } | undefined;
        if (classRow) {
          const pointId = `pt_${randomId()}`;
          db.prepare(
            `INSERT INTO student_point_logs (id, student_id, class_id, dimension_id, delta_points, reason, created_at)
             VALUES (?, ?, ?, 'xuean_activity', ?, ?, ?)`,
          ).run(
            pointId,
            studentId,
            classRow.class_id,
            scoreVal,
            `学案活动批阅加分：${activity.title}`,
            ts,
          );
        }
      }

      const row = readDb
        .prepare('SELECT * FROM activity_progress WHERE activity_id = ? AND student_id = ?')
        .get(activityId, studentId);
      res.json(row);
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // 一键催办：教师给未完成学生发催办，更新 nudged_at + nudge_count
  app.post('/api/activities/:id/nudge', requireScopedAuth('class-staff'), (req, res) => {
    try {
      const activityId = req.params.id;
      const session = (req as any).session;
      const activity = readDb.prepare('SELECT * FROM lesson_activities WHERE id = ?').get(activityId) as
        any | undefined;
      if (!activity) return res.status(404).json({ success: false, error: 'Activity not found' });
      if (rejectUnless(res, authorizeLessonStaff(readDb, session, activity.lesson_id))) return;

      const { studentId } = req.body || {};
      if (typeof studentId !== 'string' || !studentId) {
        return res.status(400).json({ success: false, error: 'studentId required' });
      }

      const ts = now();
      const existing = readDb
        .prepare('SELECT * FROM activity_progress WHERE activity_id = ? AND student_id = ?')
        .get(activityId, studentId);

      if (!existing) {
        db.prepare(
          `INSERT INTO activity_progress (activity_id, student_id, status, progress_percent, verified, nudged_at, nudge_count, last_activity_at)
           VALUES (?, ?, 'not_started', 0, 0, ?, 1, ?)`,
        ).run(activityId, studentId, ts, ts);
      } else {
        db.prepare(
          `UPDATE activity_progress SET nudged_at = ?, nudge_count = COALESCE(nudge_count, 0) + 1 WHERE activity_id = ? AND student_id = ?`,
        ).run(ts, activityId, studentId);
      }

      const row = readDb
        .prepare('SELECT * FROM activity_progress WHERE activity_id = ? AND student_id = ?')
        .get(activityId, studentId);
      res.json(row);
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // 互评：学生给同学的活动提交打分（仅 peer_review=1 的活动）
  app.post('/api/activities/:id/peer-review', requireScopedAuth('class-member'), (req, res) => {
    try {
      const activityId = req.params.id;
      const session = (req as any).session;
      const reviewerId = session.userId as string;
      const activity = readDb.prepare('SELECT * FROM lesson_activities WHERE id = ?').get(activityId) as
        any | undefined;
      if (!activity) return res.status(404).json({ success: false, error: 'Activity not found' });
      if (!activity.peer_review) {
        return res.status(400).json({ success: false, error: 'This activity does not enable peer review' });
      }

      const { revieweeId, score, comment } = req.body || {};
      if (!revieweeId || revieweeId === reviewerId) {
        return res.status(400).json({ success: false, error: 'Cannot review yourself' });
      }
      const scoreNum = Number(score);
      if (!Number.isFinite(scoreNum) || scoreNum < 0 || scoreNum > 100) {
        return res.status(400).json({ success: false, error: 'score must be 0-100' });
      }

      const id = `pr_${randomId()}`;
      const ts = now();
      db.prepare(
        `INSERT INTO activity_peer_reviews (id, activity_id, reviewer_id, reviewee_id, score, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(activity_id, reviewer_id, reviewee_id) DO UPDATE SET
           score = excluded.score, comment = excluded.comment, created_at = excluded.created_at`,
      ).run(id, activityId, reviewerId, revieweeId, scoreNum, comment ?? '', ts);

      res.json({ success: true, score: scoreNum });
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // 查看某学生在某活动收到的互评列表
  app.get('/api/activities/:id/peer-reviews', requireScopedAuth('class-member'), (req, res) => {
    try {
      const activityId = req.params.id;
      const revieweeId = req.query.revieweeId as string;
      if (!revieweeId) return res.status(400).json({ success: false, error: 'revieweeId required' });
      const rows = readDb
        .prepare(
          'SELECT * FROM activity_peer_reviews WHERE activity_id = ? AND reviewee_id = ? ORDER BY created_at DESC',
        )
        .all(activityId, revieweeId);
      res.json(rows);
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // ── 活动讨论区（IKVO15 P2）──────────────────────────────────────────────
  // 获取讨论列表（含回复嵌套）
  app.get('/api/activities/:id/discussions', requireScopedAuth('class-member'), (req, res) => {
    try {
      const activityId = req.params.id;
      const rows = readDb
        .prepare('SELECT * FROM lesson_discussions WHERE activity_id = ? ORDER BY created_at ASC')
        .all(activityId);
      res.json(rows);
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // 发帖 / 回复
  app.post('/api/activities/:id/discussions', requireScopedAuth('class-member'), (req, res) => {
    try {
      const activityId = req.params.id;
      const session = (req as any).session;
      const { content, parentId } = req.body || {};
      if (!content || !content.trim()) {
        return res.status(400).json({ success: false, error: 'content required' });
      }
      const id = `disc_${randomId()}`;
      const ts = now();
      db.prepare(
        `INSERT INTO lesson_discussions (id, activity_id, author_id, content, parent_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, activityId, session.userId, content.trim(), parentId ?? null, ts);
      const row = readDb.prepare('SELECT * FROM lesson_discussions WHERE id = ?').get(id);
      res.json(row);
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // 删除帖子（仅作者本人）
  app.delete('/api/discussions/:id', requireScopedAuth('class-member'), (req, res) => {
    try {
      const session = (req as any).session;
      const row = readDb.prepare('SELECT * FROM lesson_discussions WHERE id = ?').get(req.params.id) as any | undefined;
      if (!row) return res.status(404).json({ success: false, error: 'Not found' });
      if (row.author_id !== session.userId && !isAdministrator(session)) {
        return res.status(403).json({ success: false, error: 'Only author or admin can delete' });
      }
      db.prepare('DELETE FROM lesson_discussions WHERE id = ? OR parent_id = ?').run(req.params.id, req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // 活动级进度面板：返回每个活动 × 所有关联班级学生的进度聚合
  app.get('/api/lessons/:lessonId/activity-progress', requireScopedAuth('class-staff'), (req, res) => {
    try {
      const lessonId = req.params.lessonId;
      const session = (req as any).session;
      if (rejectUnless(res, authorizeLessonStaff(readDb, session, lessonId))) return;

      const activities = readDb
        .prepare('SELECT * FROM lesson_activities WHERE lesson_id = ? ORDER BY order_index ASC')
        .all(lessonId) as any[];

      if (activities.length === 0) {
        return res.json({ lessonId, activities: [], summary: { totalStudents: 0, totalActivities: 0 } });
      }

      // 找该 lesson 关联的 class_id（从 schedules / assignments 推断）
      const classIds = new Set<string>();
      const schRows = readDb.prepare('SELECT class_id FROM schedules WHERE lesson_id = ?').all(lessonId) as {
        class_id: string;
      }[];
      for (const r of schRows) classIds.add(r.class_id);
      const asgRows = readDb.prepare('SELECT DISTINCT class_id FROM assignments WHERE lesson_id = ?').all(lessonId) as {
        class_id: string;
      }[];
      for (const r of asgRows) classIds.add(r.class_id);

      // 收集所有关联班级的学生
      const allStudentIds = new Set<string>();
      for (const cid of classIds) {
        const sRows = readDb.prepare('SELECT student_id FROM class_students WHERE class_id = ?').all(cid) as {
          student_id: string;
        }[];
        for (const s of sRows) allStudentIds.add(s.student_id);
      }

      const activityIds = activities.map((a) => a.id);
      const placeholders = activityIds.map(() => '?').join(',');
      const progressRows = readDb
        .prepare(
          `SELECT * FROM activity_progress WHERE activity_id IN (${placeholders}) AND student_id IN (${Array.from(
            allStudentIds,
          )
            .map(() => '?')
            .join(',')})`,
        )
        .all(...activityIds, ...Array.from(allStudentIds)) as any[];

      const progressMap: Record<string, Record<string, any>> = {};
      for (const p of progressRows) {
        if (!progressMap[p.activity_id]) progressMap[p.activity_id] = {};
        progressMap[p.activity_id][p.student_id] = p;
      }

      const enrichedActivities = activities.map((a) => {
        const rows = Array.from(allStudentIds).map(
          (sid) =>
            progressMap[a.id]?.[sid] ?? {
              activity_id: a.id,
              student_id: sid,
              status: 'not_started',
              progress_percent: 0,
              verified: 0,
            },
        );
        const doneCount = rows.filter(
          (r: any) => r.status === 'graded' || (r.verified && r.status === 'submitted'),
        ).length;
        return {
          ...a,
          students: rows,
          summary: {
            total: rows.length,
            done: doneCount,
            pending: rows.length - doneCount,
          },
        };
      });

      res.json({
        lessonId,
        totalStudents: allStudentIds.size,
        activities: enrichedActivities,
      });
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // ── 课程层 CRUD（IKVO15 P2）──────────────────────────────────────────────
  // 课程列表
  app.get('/api/courses', requireScopedAuth('class-staff'), (_req, res) => {
    try {
      const courses = readDb.prepare('SELECT * FROM courses ORDER BY created_at DESC').all();
      res.json(courses);
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // 创建课程
  app.post('/api/courses', requireScopedAuth('class-staff'), (req, res) => {
    try {
      const session = (req as any).session;
      const { title, description, term, visibility } = req.body || {};
      if (!title || !title.trim()) return res.status(400).json({ success: false, error: 'title required' });
      const id = `course_${randomId()}`;
      const ts = now();
      db.prepare(
        `INSERT INTO courses (id, title, description, owner_user_id, term, visibility, thumbnail, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, title.trim(), description ?? '', session.userId ?? '', term ?? '', visibility ?? 'private', '', ts, ts);
      const row = readDb.prepare('SELECT * FROM courses WHERE id = ?').get(id);
      res.json(row);
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // 课程详情（含下属 lesson 列表）
  app.get('/api/courses/:id', requireScopedAuth('class-staff'), (req, res) => {
    try {
      const course = readDb.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id) as any | undefined;
      if (!course) return res.status(404).json({ success: false, error: 'Course not found' });
      const lessons = readDb
        .prepare('SELECT * FROM lessons WHERE course_id = ? ORDER BY created_at ASC')
        .all(req.params.id);
      const enrollments = readDb
        .prepare('SELECT * FROM course_enrollments WHERE course_id = ?')
        .all(req.params.id);
      res.json({ ...course, lessons, enrollments });
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // 更新课程
  app.put('/api/courses/:id', requireScopedAuth('class-staff'), (req, res) => {
    try {
      const { title, description, term, visibility } = req.body || {};
      const ts = now();
      db.prepare(
        `UPDATE courses SET title = COALESCE(?, title), description = COALESCE(?, description),
           term = COALESCE(?, term), visibility = COALESCE(?, visibility), updated_at = ? WHERE id = ?`,
      ).run(title ?? null, description ?? null, term ?? null, visibility ?? null, ts, req.params.id);
      const row = readDb.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
      res.json(row);
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // 删除课程（下属 lesson 的 course_id 置 NULL）
  app.delete('/api/courses/:id', requireScopedAuth('class-staff'), (req, res) => {
    try {
      const id = req.params.id;
      db.prepare('UPDATE lessons SET course_id = NULL WHERE course_id = ?').run(id);
      db.prepare('DELETE FROM course_enrollments WHERE course_id = ?').run(id);
      db.prepare('DELETE FROM courses WHERE id = ?').run(id);
      res.json({ success: true });
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // 把 lesson 挂到课程（或从课程移除：course_id 传 null）
  app.put('/api/courses/:courseId/lessons/:lessonId', requireScopedAuth('class-staff'), (req, res) => {
    try {
      const { courseId, lessonId } = req.params;
      // 校验课程存在
      const course = readDb.prepare('SELECT id FROM courses WHERE id = ?').get(courseId);
      if (!course) return res.status(404).json({ success: false, error: 'Course not found' });
      db.prepare('UPDATE lessons SET course_id = ? WHERE id = ?').run(courseId, lessonId);
      res.json({ success: true, courseId, lessonId });
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });

  // 课程选课
  app.post('/api/courses/:id/enroll', requireScopedAuth('class-staff'), (req, res) => {
    try {
      const { studentId, classId } = req.body || {};
      if (!studentId) return res.status(400).json({ success: false, error: 'studentId required' });
      db.prepare(
        `INSERT OR IGNORE INTO course_enrollments (course_id, student_id, class_id) VALUES (?, ?, ?)`,
      ).run(req.params.id, studentId, classId ?? null);
      res.json({ success: true });
    } catch (err: any) {
      sendSafeError(res, err);
    }
  });
}
