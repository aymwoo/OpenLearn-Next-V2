/**
 * 课节标题只读服务。
 *
 * `lessons` 在 sql-guard 黑名单里，进程插件不能 SELECT。本服务是宿主侧的替代通道：
 * 只返回 id、标题，以及 `lessons.timeline` 里每个环节的 id / title。
 * 可见性与 `GET /api/lessons/:id` 相同（先看课节是否存在，再 `canSeeLesson`）。
 * 没有当前登录用户时直接拒绝，不探测课节是否存在。
 */
import type { ILessonOutlineService, LessonOutline, LessonSegmentTitle } from './interfaces.js';
import { canSeeLesson, type LessonVisibilityDb } from './lesson-visibility.js';
import { currentLessonViewer } from './lesson-viewer.js';

export class LessonOutlineAccessError extends Error {
  readonly code = 'LESSON_OUTLINE_FORBIDDEN';
  readonly status = 403;

  constructor(readonly reason: 'no_viewer' | 'forbidden') {
    super(
      reason === 'no_viewer'
        ? 'Lesson outline requires the signed-in user who invoked this plugin'
        : 'Lesson outline is not visible to the current user',
    );
    this.name = 'LessonOutlineAccessError';
  }
}

export class LessonOutlineService implements ILessonOutlineService {
  constructor(private readonly db: LessonVisibilityDb) {}

  async getOutline(lessonId: string): Promise<LessonOutline | null> {
    const id = typeof lessonId === 'string' ? lessonId.trim() : '';
    if (!id) return null;

    const viewer = currentLessonViewer();
    if (!viewer) {
      throw new LessonOutlineAccessError('no_viewer');
    }

    const row = this.db.prepare('SELECT id, title, timeline FROM lessons WHERE id = ?').get(id) as
      { id: string; title: string; timeline: string | null } | undefined;
    if (!row) return null;

    if (!canSeeLesson(this.db, viewer, id)) {
      throw new LessonOutlineAccessError('forbidden');
    }

    return {
      id: row.id,
      title: row.title,
      segments: parseTimelineSegments(row.timeline),
    };
  }
}

function parseTimelineSegments(raw: unknown): LessonSegmentTitle[] {
  let value = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      value = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];

  const segments: LessonSegmentTitle[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    const title = typeof record.title === 'string' ? record.title : '';
    if (!id && !title) continue;
    segments.push({ id, title });
  }
  return segments;
}
