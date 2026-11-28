/**
 * 互动课件成绩统一视图（Issue IKYP8P 阶段 G）。
 *
 * 背景：同一个学生在课件上的成绩可能同时存在于两条链路：
 * - `courseware_attempt + submission_result`：LMS Bridge / SCORM / xAPI 的官方成绩；
 * - `learning_surface_attempts`：白板元素 / 学案块 / 活动挂载的 Surface 作答。
 *
 * 两条链路各有写入方，历史上有漂移风险。本模块提供一个**只读**统一视图：
 * - 以 `(coursewareUuid, studentId)` 为键合并；
 * - Surface 作答存在且带分时，以 Surface 为准（新模型优先）；
 * - 同时返回 `hasSurfaceAttempt`，让 UI 能显式看到「两条链路是否一致」；
 * - 不改变任何写入路径，避免在未确认数据归属前破坏现有成绩。
 */
import type Database from 'better-sqlite3';
import { normalizeCompletionForDisplay } from '../../packages/courseware-adapters/completion.js';

export interface UnifiedCoursewareScoreRow {
  coursewareUuid: string;
  coursewareName: string;
  studentId: string;
  studentName: string;
  lessonId: string | null;
  score: number | null;
  completion: number | null;
  maxScore: number | null;
  status: string;
  /** 当前采用的主数据源 */
  source: 'learning-surface' | 'courseware-attempt';
  /** 是否存在同键的 Surface 作答（用于观察双写漂移） */
  hasSurfaceAttempt: boolean;
  updatedAt: number;
}

export interface UnifiedScoreViewOptions {
  coursewareUuid?: string;
  lessonId?: string;
  classId?: string;
  studentId?: string;
  /** 返回条数上限，默认 2000 */
  limit?: number;
}

type AttemptRow = {
  courseware_uuid: string;
  courseware_name: string;
  student_id: string;
  student_name: string | null;
  score: number | null;
  completion: number | null;
  status: string;
  started_at: number;
};

type SurfaceAttemptRow = {
  student_id: string;
  lesson_id: string;
  score: number | null;
  max_score: number | null;
  completion: number | null;
  status: string;
  updated_at: number;
  content_ref_json: string;
};

function parseCoursewareRef(contentRefJson: string | null): string | null {
  if (!contentRefJson) return null;
  try {
    const parsed = JSON.parse(contentRefJson) as { source?: { kind?: string; id?: string } };
    if (parsed?.source?.kind === 'courseware' && typeof parsed.source.id === 'string' && parsed.source.id) {
      return parsed.source.id;
    }
  } catch {
    /* 第三方渲染器的非法引用直接忽略 */
  }
  return null;
}

function keyOf(coursewareUuid: string, studentId: string): string {
  return `${coursewareUuid}::${studentId}`;
}

function classStudentIds(db: Database.Database, classId: string): Set<string> {
  try {
    const rows = db.prepare('SELECT student_id FROM class_students WHERE class_id = ?').all(classId) as Array<{
      student_id: string;
    }>;
    return new Set(rows.map((row) => row.student_id));
  } catch {
    return new Set();
  }
}

function loadCoursewareAttempts(
  db: Database.Database,
  options: UnifiedScoreViewOptions,
  allowedStudentIds: Set<string> | null,
): AttemptRow[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (options.coursewareUuid) {
    where.push('cw.uuid = ?');
    args.push(options.coursewareUuid);
  }
  if (options.studentId) {
    where.push('a.student_id = ?');
    args.push(options.studentId);
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  try {
    const rows = db
      .prepare(
        `SELECT cw.uuid AS courseware_uuid, cw.name AS courseware_name,
                a.student_id, a.status, a.started_at,
                s.name AS student_name,
                r.score, r.completion
           FROM courseware_attempt a
           JOIN courseware cw ON a.courseware_id = cw.id
           LEFT JOIN students s ON s.id = a.student_id
           LEFT JOIN submission_result r ON r.attempt_id = a.id
           ${whereSql}
          ORDER BY a.started_at DESC
          LIMIT ?`,
      )
      .all(...args, options.limit ?? 2000) as AttemptRow[];
    return allowedStudentIds ? rows.filter((row) => allowedStudentIds.has(row.student_id)) : rows;
  } catch {
    return [];
  }
}

function loadSurfaceAttempts(
  db: Database.Database,
  options: UnifiedScoreViewOptions,
  allowedStudentIds: Set<string> | null,
): SurfaceAttemptRow[] {
  const where: string[] = ['sa.is_preview = 0'];
  const args: unknown[] = [];
  if (options.lessonId) {
    where.push('sa.lesson_id = ?');
    args.push(options.lessonId);
  }
  if (options.studentId) {
    where.push('sa.student_id = ?');
    args.push(options.studentId);
  }
  try {
    const rows = db
      .prepare(
        `SELECT sa.student_id, sa.lesson_id, sa.score, sa.max_score, sa.completion,
                sa.status, sa.updated_at, s.content_ref_json
           FROM learning_surface_attempts sa
           JOIN learning_surfaces s ON s.id = sa.surface_id
          WHERE ${where.join(' AND ')}
          ORDER BY sa.updated_at DESC
          LIMIT ?`,
      )
      .all(...args, options.limit ?? 2000) as SurfaceAttemptRow[];
    const filtered = allowedStudentIds ? rows.filter((row) => allowedStudentIds.has(row.student_id)) : rows;
    // 只保留课件型 Surface（source.kind === 'courseware'）
    return filtered.filter((row) => parseCoursewareRef(row.content_ref_json) !== null);
  } catch {
    // learning_surface_attempts 尚未迁移 / 测试库无该表：静默降级
    return [];
  }
}

/**
 * 构建统一成绩视图。
 *
 * 合并规则：先放 courseware_attempt，再用 Surface 作答覆盖同键行；
 * Surface 没有分数时保留 courseware 分数，但仍标记 hasSurfaceAttempt。
 */
export function buildCoursewareScoreView(
  db: Database.Database,
  options: UnifiedScoreViewOptions = {},
): UnifiedCoursewareScoreRow[] {
  const allowedStudentIds = options.classId ? classStudentIds(db, options.classId) : null;
  if (allowedStudentIds && allowedStudentIds.size === 0) return [];

  const merged = new Map<string, UnifiedCoursewareScoreRow>();

  for (const row of loadCoursewareAttempts(db, options, allowedStudentIds)) {
    const key = keyOf(row.courseware_uuid, row.student_id);
    merged.set(key, {
      coursewareUuid: row.courseware_uuid,
      coursewareName: row.courseware_name,
      studentId: row.student_id,
      studentName: row.student_name || row.student_id,
      lessonId: null,
      score: row.score === null ? null : Number(row.score),
      completion: row.completion === null ? null : normalizeCompletionForDisplay(row.completion),
      maxScore: null,
      status: row.status,
      source: 'courseware-attempt',
      hasSurfaceAttempt: false,
      updatedAt: row.started_at,
    });
  }

  for (const row of loadSurfaceAttempts(db, options, allowedStudentIds)) {
    const coursewareUuid = parseCoursewareRef(row.content_ref_json);
    if (!coursewareUuid) continue;
    if (options.coursewareUuid && coursewareUuid !== options.coursewareUuid) continue;
    const key = keyOf(coursewareUuid, row.student_id);
    const existing = merged.get(key);
    const surfaceScore = row.score === null ? null : Number(row.score);
    const surfaceCompletion = row.completion === null ? null : normalizeCompletionForDisplay(row.completion);
    if (!existing) {
      // 只有 Surface 作答、没有 courseware_attempt 的学生也要出现在视图里
      merged.set(key, {
        coursewareUuid,
        coursewareName: coursewareUuid,
        studentId: row.student_id,
        studentName: row.student_id,
        lessonId: row.lesson_id || null,
        score: surfaceScore,
        completion: surfaceCompletion,
        maxScore: row.max_score === null ? null : Number(row.max_score),
        status: row.status,
        source: 'learning-surface',
        hasSurfaceAttempt: true,
        updatedAt: row.updated_at,
      });
      continue;
    }

    merged.set(key, {
      ...existing,
      lessonId: row.lesson_id || existing.lessonId,
      // Surface 是新模型：有分时以它为准；无分时保留旧链路分数但显式标记双写
      score: surfaceScore !== null ? surfaceScore : existing.score,
      completion: surfaceCompletion !== null ? surfaceCompletion : existing.completion,
      maxScore: row.max_score === null ? existing.maxScore : Number(row.max_score),
      status: surfaceScore !== null ? row.status : existing.status,
      source: surfaceScore !== null ? 'learning-surface' : existing.source,
      hasSurfaceAttempt: true,
      updatedAt: Math.max(existing.updatedAt, row.updated_at),
    });
  }

  return [...merged.values()].sort(
    (a, b) => a.coursewareName.localeCompare(b.coursewareName) || a.studentName.localeCompare(b.studentName),
  );
}
