import type { Express, Request, Response } from 'express';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import { sendSafeError } from '../utils/error-handler.js';
import { BUILTIN_TEACHING_MODES, TEACHING_MODE_ID_PATTERN, type TeachingMode } from '../services/teaching-modes.js';

interface TeachingModeRow {
  id: string;
  name: string;
  name_en: string | null;
  description: string | null;
  description_en: string | null;
  icon: string | null;
  color: string | null;
  is_builtin: number | boolean | null;
  sort_order: number | null;
  created_at: number;
  updated_at: number;
}

export { BUILTIN_TEACHING_MODES, TEACHING_MODE_ID_PATTERN, type TeachingMode };

export function registerClassroomTeachingModeRoutes(app: Express): void {
  const db = kernelContainer.db;

  // ── 教学模式 (Teaching Modes — 课堂启动门户的模式选择器) ──────────
  // 内置模式以代码常量兜底，数据库记录优先，便于管理员与插件在不发版的情况下扩展。
  app.get('/api/classroom/teaching-modes', requireScopedAuth('authenticated'), (_req: Request, res: Response) => {
    try {
      const rows = db
        .prepare(
          'SELECT id, name, name_en, description, description_en, icon, color, is_builtin, sort_order, created_at, updated_at FROM teaching_modes ORDER BY sort_order ASC, created_at ASC LIMIT 100',
        )
        .all() as TeachingModeRow[];

      const stored: TeachingMode[] = rows.map((r) => ({
        id: r.id,
        name: r.name,
        nameEn: r.name_en,
        description: r.description ?? '',
        descriptionEn: r.description_en,
        icon: r.icon ?? 'BookOpen',
        color: r.color ?? 'indigo',
        isBuiltin: !!r.is_builtin,
        sortOrder: r.sort_order ?? 100,
      }));

      // 内置模式保持顺序与存在性；同 id 的数据库记录覆盖其文案
      const merged = BUILTIN_TEACHING_MODES.map((b) => stored.find((s) => s.id === b.id) ?? b);
      const extra = stored.filter((s) => !BUILTIN_TEACHING_MODES.some((b) => b.id === s.id));

      res.json({ success: true, modes: [...merged, ...extra].sort((a, b) => a.sortOrder - b.sortOrder) });
    } catch (e: unknown) {
      sendSafeError(res, e, 500);
    }
  });

  app.post('/api/classroom/teaching-modes', requireAuth('administrator'), (req: Request, res: Response) => {
    try {
      const { id, name, nameEn, description, descriptionEn, icon, color, sortOrder } =
        (req.body as Record<string, unknown> | undefined) || {};
      if (typeof id !== 'string' || !TEACHING_MODE_ID_PATTERN.test(id)) {
        return res.status(400).json({ error: 'Invalid id：仅允许字母数字与 . _ -，以字母数字开头，最长 64 字符' });
      }
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'name is required' });
      }
      if (BUILTIN_TEACHING_MODES.some((b) => b.id === id)) {
        return res.status(409).json({ error: `"${id}" 是内置教学模式 id，请改用其他 id` });
      }
      if (db.prepare('SELECT id FROM teaching_modes WHERE id = ?').get(id)) {
        return res.status(409).json({ error: `Teaching mode "${id}" already exists` });
      }

      const now = Date.now();
      db.prepare(
        `INSERT INTO teaching_modes
           (id, name, name_en, description, description_en, icon, color, is_builtin, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      ).run(
        id,
        name.trim(),
        (nameEn as string) || null,
        (description as string) || null,
        (descriptionEn as string) || null,
        (icon as string) || null,
        (color as string) || null,
        typeof sortOrder === 'number' && Number.isFinite(sortOrder) ? sortOrder : 100,
        now,
      );
      res.json({ success: true, id });
    } catch (e: unknown) {
      sendSafeError(res, e, 500);
    }
  });

  app.put('/api/classroom/teaching-modes/:id', requireAuth('administrator'), (req: Request, res: Response) => {
    try {
      const id = decodeURIComponent(req.params.id);
      const { name, nameEn, description, descriptionEn, icon, color, sortOrder } =
        (req.body as Record<string, unknown> | undefined) || {};

      const builtin = BUILTIN_TEACHING_MODES.find((b) => b.id === id);
      const existing = db.prepare('SELECT id FROM teaching_modes WHERE id = ?').get(id);
      const now = Date.now();

      if (!existing) {
        // 首次改写内置模式的文案：以 upsert 落库，保留 is_builtin=1 语义
        if (!builtin) return res.status(404).json({ error: `Teaching mode "${id}" not found` });
        db.prepare(
          `INSERT INTO teaching_modes
             (id, name, name_en, description, description_en, icon, color, is_builtin, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        ).run(
          id,
          (name as string) || builtin.name,
          (nameEn as string) ?? builtin.nameEn,
          (description as string) ?? builtin.description,
          (descriptionEn as string) ?? builtin.descriptionEn,
          (icon as string) ?? builtin.icon,
          (color as string) ?? builtin.color,
          typeof sortOrder === 'number' && Number.isFinite(sortOrder) ? sortOrder : builtin.sortOrder,
          now,
        );
        return res.json({ success: true, id, created: true });
      }

      // 已有记录：只更新传入字段（内置记录不可被改动 is_builtin）
      const sets: string[] = [];
      const args: unknown[] = [];
      const assign = (col: string, value: unknown) => {
        if (value !== undefined) {
          sets.push(`${col} = ?`);
          args.push(value);
        }
      };
      assign('name', typeof name === 'string' && name.trim() ? name.trim() : undefined);
      assign('name_en', nameEn);
      assign('description', description);
      assign('description_en', descriptionEn);
      assign('icon', icon);
      assign('color', color);
      assign('sort_order', typeof sortOrder === 'number' && Number.isFinite(sortOrder) ? sortOrder : undefined);

      if (!sets.length) return res.status(400).json({ error: '没有可更新的字段' });
      sets.push('updated_at = ?');
      args.push(now, id);
      db.prepare(`UPDATE teaching_modes SET ${sets.join(', ')} WHERE id = ?`).run(...args);

      res.json({ success: true, id, created: false });
    } catch (e: unknown) {
      sendSafeError(res, e, 500);
    }
  });

  app.delete('/api/classroom/teaching-modes/:id', requireAuth('administrator'), (req: Request, res: Response) => {
    try {
      const id = decodeURIComponent(req.params.id);
      if (BUILTIN_TEACHING_MODES.some((b) => b.id === id)) {
        return res.status(403).json({ error: `内置教学模式 "${id}" 不可删除（可改写其文案）` });
      }
      const info = db.prepare('DELETE FROM teaching_modes WHERE id = ?').run(id) as { changes?: number };
      if (!info.changes) return res.status(404).json({ error: `Teaching mode "${id}" not found` });
      res.json({ success: true, id });
    } catch (e: unknown) {
      sendSafeError(res, e, 500);
    }
  });
}
