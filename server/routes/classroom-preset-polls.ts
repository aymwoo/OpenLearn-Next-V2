import type { Express, Request, Response } from 'express';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { requireAuth } from '../middleware/auth.js';
import { authorizeLessonStaff, isAdministrator } from '../services/class-access.js';
import { randomId } from '../utils/id.js';
import { sendSafeError } from '../utils/error-handler.js';

interface PresetPollRow {
  id: string;
  lesson_id: string;
  title: string;
  question_type: string;
  options_json: string;
  correct_option: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

function getSession(req: Request): Record<string, unknown> | undefined {
  return (req as unknown as { session?: Record<string, unknown> })?.session;
}

export function registerClassroomPresetPollRoutes(app: Express): void {
  const db = kernelContainer.db;

  // ── 课程预设极速投票 CRUD (Lesson Preset Polls) ──────────────────────

  /** 获取指定课程下的所有预设投票题 */
  app.get(
    '/api/lessons/:lessonId/preset-polls',
    requireAuth('teacher', 'administrator'),
    (req: Request, res: Response) => {
      try {
        const { lessonId } = req.params;
        const httpSession = getSession(req);
        if (!authorizeLessonStaff(db, httpSession, lessonId).ok && !isAdministrator(httpSession)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        const rows = db
          .prepare(
            'SELECT id, lesson_id, title, question_type, options_json, correct_option, sort_order, created_at, updated_at FROM lesson_preset_polls WHERE lesson_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 200',
          )
          .all(lessonId) as PresetPollRow[];

        function safeParsePollOptions(raw: string): unknown[] {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        }

        const presets = rows.map((r) => ({
          id: r.id,
          lessonId: r.lesson_id,
          title: r.title,
          questionType: r.question_type,
          options: safeParsePollOptions(r.options_json),
          correctOption: r.correct_option,
          sortOrder: r.sort_order,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }));

        res.json({ success: true, presets });
      } catch (e: unknown) {
        sendSafeError(res, e, 500);
      }
    },
  );

  /** 新增预设投票题到指定课程 */
  app.post(
    '/api/lessons/:lessonId/preset-polls',
    requireAuth('teacher', 'administrator'),
    (req: Request, res: Response) => {
      try {
        const { lessonId } = req.params;
        const {
          title,
          questionType = 'ABCD',
          options,
          correctOption,
          sortOrder = 0,
        } = (req.body as Record<string, unknown> | undefined) || {};
        const httpSession = getSession(req);
        if (!authorizeLessonStaff(db, httpSession, lessonId).ok && !isAdministrator(httpSession)) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        if (!title || !options || !Array.isArray(options) || options.length < 2) {
          res.status(400).json({ error: 'title and options (array with >= 2 items) are required' });
          return;
        }

        const id = randomId('preset_');
        const now = Date.now();

        db.prepare(
          `
        INSERT INTO lesson_preset_polls (id, lesson_id, title, question_type, options_json, correct_option, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        ).run(
          id,
          lessonId,
          (title as string).trim(),
          questionType as string,
          JSON.stringify(options),
          (correctOption as string) || null,
          sortOrder as number,
          now,
          now,
        );

        res.json({
          success: true,
          preset: {
            id,
            lessonId,
            title,
            questionType,
            options,
            correctOption: (correctOption as string) || null,
            sortOrder,
            createdAt: now,
            updatedAt: now,
          },
        });
      } catch (e: unknown) {
        sendSafeError(res, e, 500);
      }
    },
  );

  /** 修改预设投票题 */
  app.put(
    '/api/lessons/:lessonId/preset-polls/:id',
    requireAuth('teacher', 'administrator'),
    (req: Request, res: Response) => {
      try {
        const { lessonId, id } = req.params;
        const { title, questionType, options, correctOption, sortOrder } =
          (req.body as Record<string, unknown> | undefined) || {};
        const httpSession = getSession(req);
        if (!authorizeLessonStaff(db, httpSession, lessonId).ok && !isAdministrator(httpSession)) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const existing = db
          .prepare('SELECT id FROM lesson_preset_polls WHERE id = ? AND lesson_id = ?')
          .get(id, lessonId);
        if (!existing) {
          res.status(404).json({ error: 'Preset poll not found' });
          return;
        }

        const updates: string[] = [];
        const params: unknown[] = [];

        if (title !== undefined) {
          updates.push('title = ?');
          params.push(title);
        }
        if (questionType !== undefined) {
          updates.push('question_type = ?');
          params.push(questionType);
        }
        if (options !== undefined) {
          updates.push('options_json = ?');
          params.push(JSON.stringify(options));
        }
        if (correctOption !== undefined) {
          updates.push('correct_option = ?');
          params.push(correctOption || null);
        }
        if (sortOrder !== undefined) {
          updates.push('sort_order = ?');
          params.push(sortOrder);
        }

        if (updates.length === 0) {
          res.status(400).json({ error: 'No fields to update' });
          return;
        }

        updates.push('updated_at = ?');
        params.push(Date.now());
        params.push(id);
        params.push(lessonId);

        db.prepare(`UPDATE lesson_preset_polls SET ${updates.join(', ')} WHERE id = ? AND lesson_id = ?`).run(
          ...params,
        );

        const updated = db
          .prepare(
            'SELECT id, lesson_id, title, question_type, options_json, correct_option, sort_order, created_at, updated_at FROM lesson_preset_polls WHERE id = ?',
          )
          .get(id) as PresetPollRow;
        res.json({
          success: true,
          preset: {
            id: updated.id,
            lessonId: updated.lesson_id,
            title: updated.title,
            questionType: updated.question_type,
            options: (() => {
              try {
                const parsed = JSON.parse(updated.options_json);
                return Array.isArray(parsed) ? parsed : [];
              } catch {
                return [];
              }
            })(),
            correctOption: updated.correct_option,
            sortOrder: updated.sort_order,
            createdAt: updated.created_at,
            updatedAt: updated.updated_at,
          },
        });
      } catch (e: unknown) {
        sendSafeError(res, e, 500);
      }
    },
  );

  /** 删除预设投票题 */
  app.delete(
    '/api/lessons/:lessonId/preset-polls/:id',
    requireAuth('teacher', 'administrator'),
    (req: Request, res: Response) => {
      try {
        const { lessonId, id } = req.params;
        const httpSession = getSession(req);
        if (!authorizeLessonStaff(db, httpSession, lessonId).ok && !isAdministrator(httpSession)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        const result = db
          .prepare('DELETE FROM lesson_preset_polls WHERE id = ? AND lesson_id = ?')
          .run(id, lessonId) as { changes?: number };
        if (result.changes === 0) {
          res.status(404).json({ error: 'Preset poll not found' });
          return;
        }
        res.json({ success: true });
      } catch (e: unknown) {
        sendSafeError(res, e, 500);
      }
    },
  );
}
