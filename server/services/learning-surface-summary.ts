/**
 * LearningSurface 学习分析聚合（阶段 7.3）。
 *
 * 口径：
 * - 排除教师预览（`is_preview = 1`）；
 * - 每个 `(surface, student)` 只取最新一次 attempt；
 * - 已交 = `submitted` / `graded`；
 * - 分数优先取教师覆盖分 `score`，否则取 `auto_score`，并按 `max_score` 归一为百分比。
 *
 * 名单来源：
 * - 显式 `classId`：`class_students`；
 * - 课时：`schedules` / `classroom_sessions` / `assignments` / `plugin_assignments` 关联的班级；
 * - 都没有时回落 `student_lesson_progress`；仍为空则只返回聚合数。
 */
import type Database from 'better-sqlite3';
import {
  type LearningSurfaceAttemptView,
  type LearningSurfaceKind,
  type LearningSurfaceRow,
  listLessonAttempts,
  parseLearningContentRef,
} from './learning-surface-service.js';

export interface SurfaceSummaryStudent {
  studentId: string;
  name: string | null;
}

export interface SurfaceAttemptSummary {
  surfaceId: string;
  rendererId: string;
  kind: LearningSurfaceKind;
  ownerId: string;
  title: string;
  /** 白板元素所属教学环节；学案活动 / 首页块为 null。 */
  segmentId: string | null;
  /** 名单人数；无名单时等于参与过的学生数。 */
  rosterCount: number;
  startedCount: number;
  submittedCount: number;
  gradedCount: number;
  /** 0–1，取最新 attempt 的 completion 均值。 */
  avgCompletion: number;
  /** 按满分归一的平均分（0–100）。 */
  avgScorePercent: number | null;
  avgScore: number | null;
  maxScore: number | null;
  pendingStudents: SurfaceSummaryStudent[];
}

export interface LessonSurfaceSummary {
  lessonId: string;
  classId: string | null;
  rosterCount: number;
  generatedAt: number;
  surfaces: SurfaceAttemptSummary[];
  totals: {
    surfaceCount: number;
    submittedCount: number;
    gradedCount: number;
    avgCompletion: number;
    avgScorePercent: number | null;
  };
}

interface RosterEntry {
  studentId: string;
  name: string | null;
}

function loadRoster(db: Database.Database, lessonId: string, classId: string | null): RosterEntry[] {
  if (classId) {
    return db
      .prepare(
        `SELECT cs.student_id AS studentId, s.name AS name
           FROM class_students cs
           LEFT JOIN students s ON s.id = cs.student_id
          WHERE cs.class_id = ?
          ORDER BY cs.student_id ASC`,
      )
      .all(classId) as RosterEntry[];
  }

  const linked = db
    .prepare(
      `SELECT DISTINCT cs.student_id AS studentId, s.name AS name
         FROM class_students cs
         LEFT JOIN students s ON s.id = cs.student_id
        WHERE cs.class_id IN (
          SELECT class_id FROM schedules WHERE lesson_id = ? AND class_id IS NOT NULL
          UNION SELECT class_id FROM classroom_sessions WHERE lesson_id = ? AND class_id IS NOT NULL
          UNION SELECT class_id FROM assignments WHERE lesson_id = ? AND class_id IS NOT NULL
          UNION SELECT class_id FROM plugin_assignments WHERE lesson_id = ? AND class_id IS NOT NULL
        )
        ORDER BY cs.student_id ASC`,
    )
    .all(lessonId, lessonId, lessonId, lessonId) as RosterEntry[];
  if (linked.length > 0) return linked;

  return db
    .prepare(
      `SELECT slp.student_id AS studentId, s.name AS name
         FROM student_lesson_progress slp
         LEFT JOIN students s ON s.id = slp.student_id
        WHERE slp.lesson_id = ?
        ORDER BY slp.student_id ASC`,
    )
    .all(lessonId) as RosterEntry[];
}

/** 白板 Surface → 教学环节：`owner_id` 就是元素 id。 */
function loadSegmentMap(db: Database.Database, lessonId: string): Map<string, string | null> {
  const rows = db
    .prepare(`SELECT data FROM whiteboard_elements WHERE lesson_id = ? AND type = 'learning_surface'`)
    .all(lessonId) as Array<{ data: string }>;
  const map = new Map<string, string | null>();
  for (const row of rows) {
    try {
      const data = JSON.parse(row.data) as Record<string, unknown>;
      if (typeof data.surfaceId !== 'string') continue;
      map.set(data.surfaceId, typeof data.segmentId === 'string' ? data.segmentId : null);
    } catch {
      // 坏 JSON 不影响其它元素
    }
  }
  return map;
}

function loadTitles(db: Database.Database, surfaces: readonly LearningSurfaceRow[]): Map<string, string> {
  const assignmentIds: string[] = [];
  const activityIds: string[] = [];
  for (const surface of surfaces) {
    const ref = parseLearningContentRef(surface.content_ref_json);
    const sourceId = ref?.source.id;
    if (!sourceId || ref?.config?.title) continue;
    if (ref.source.kind === 'assignment') assignmentIds.push(sourceId);
    if (ref.source.kind === 'activity') activityIds.push(sourceId);
  }

  const titles = new Map<string, string>();
  const load = (table: 'plugin_assignments' | 'lesson_activities', ids: string[]) => {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(`SELECT id, title FROM ${table} WHERE id IN (${placeholders})`).all(...ids) as Array<{
      id: string;
      title: string;
    }>;
    for (const row of rows) titles.set(row.id, row.title);
  };
  load('plugin_assignments', Array.from(new Set(assignmentIds)));
  load('lesson_activities', Array.from(new Set(activityIds)));
  return titles;
}

function latestByStudent(attempts: readonly LearningSurfaceAttemptView[]): Map<string, LearningSurfaceAttemptView> {
  const latest = new Map<string, LearningSurfaceAttemptView>();
  for (const attempt of attempts) {
    const previous = latest.get(attempt.student_id);
    if (!previous || attempt.attempt_no > previous.attempt_no) latest.set(attempt.student_id, attempt);
  }
  return latest;
}

function numeric(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarizeSurface(input: {
  surface: LearningSurfaceRow;
  attempts: readonly LearningSurfaceAttemptView[];
  roster: readonly RosterEntry[];
  segmentId: string | null;
  title: string;
}): SurfaceAttemptSummary {
  const latest = latestByStudent(input.attempts);
  const participantIds = new Set(Array.from(latest.keys()));
  const rosterIds = new Set(input.roster.map((entry) => entry.studentId));
  const total = rosterIds.size > 0 ? rosterIds.size : participantIds.size;

  let submittedCount = 0;
  let gradedCount = 0;
  const completionValues: number[] = [];
  const scorePercents: number[] = [];
  const rawScores: number[] = [];
  const maxScores: number[] = [];
  const submittedIds = new Set<string>();

  for (const [studentId, attempt] of latest) {
    const submitted = attempt.status === 'submitted' || attempt.status === 'graded';
    if (submitted) {
      submittedCount += 1;
      submittedIds.add(studentId);
    }
    if (attempt.status === 'graded') gradedCount += 1;

    const completion = numeric(attempt.completion);
    completionValues.push(completion == null ? 0 : Math.min(1, Math.max(0, completion)));

    const score = numeric(attempt.score) ?? numeric(attempt.auto_score);
    const maxScore = numeric(attempt.max_score);
    if (score != null) rawScores.push(score);
    if (maxScore != null && maxScore > 0) {
      maxScores.push(maxScore);
      if (score != null) scorePercents.push((score / maxScore) * 100);
    }
  }

  const pendingStudents =
    rosterIds.size === 0
      ? []
      : input.roster
          .filter((entry) => !submittedIds.has(entry.studentId))
          .map((entry) => ({
            studentId: entry.studentId,
            name: entry.name,
          }));

  return {
    surfaceId: input.surface.id,
    rendererId: parseLearningContentRef(input.surface.content_ref_json)?.rendererId ?? 'unknown',
    kind: input.surface.kind,
    ownerId: input.surface.owner_id,
    title: input.title,
    segmentId: input.segmentId,
    rosterCount: total,
    startedCount: participantIds.size,
    submittedCount,
    gradedCount,
    avgCompletion: average(completionValues) ?? 0,
    avgScorePercent: average(scorePercents),
    avgScore: average(rawScores),
    maxScore: average(maxScores),
    pendingStudents,
  };
}

export function summarizeLessonSurfaces(
  db: Database.Database,
  input: { lessonId: string; classId?: string | null; now?: number },
): LessonSurfaceSummary {
  const lessonId = input.lessonId;
  const classId = input.classId ?? null;

  const surfaces = db
    .prepare(
      `SELECT * FROM learning_surfaces
        WHERE lesson_id = ? AND deleted_at IS NULL
        ORDER BY kind ASC, owner_id ASC`,
    )
    .all(lessonId) as LearningSurfaceRow[];

  const roster = loadRoster(db, lessonId, classId);
  const segmentMap = loadSegmentMap(db, lessonId);
  const titles = loadTitles(db, surfaces);
  const attempts = listLessonAttempts(db, lessonId);

  const bySurface = new Map<string, LearningSurfaceAttemptView[]>();
  for (const attempt of attempts) {
    const list = bySurface.get(attempt.surface_id);
    if (list) list.push(attempt);
    else bySurface.set(attempt.surface_id, [attempt]);
  }

  const summaries = surfaces.map((surface) => {
    const ref = parseLearningContentRef(surface.content_ref_json);
    const sourceId = ref?.source.id;
    const title =
      ref?.config?.title ??
      (sourceId ? titles.get(sourceId) : undefined) ??
      (surface.kind === 'lesson_block' ? '学案区块' : (ref?.rendererId ?? '内容'));
    return summarizeSurface({
      surface,
      attempts: bySurface.get(surface.id) ?? [],
      roster,
      segmentId: surface.kind === 'whiteboard_element' ? (segmentMap.get(surface.id) ?? null) : null,
      title,
    });
  });

  const completionWeights = summaries.filter((item) => item.rosterCount > 0);
  const weightedCompletion =
    completionWeights.length === 0
      ? null
      : average(
          completionWeights.flatMap((item) =>
            item.avgCompletion == null ? [] : Array.from({ length: item.rosterCount }, () => item.avgCompletion),
          ),
        );
  const scorePercents = summaries.map((item) => item.avgScorePercent).filter((value): value is number => value != null);

  return {
    lessonId,
    classId,
    rosterCount: roster.length,
    generatedAt: input.now ?? Date.now(),
    surfaces: summaries,
    totals: {
      surfaceCount: summaries.length,
      submittedCount: summaries.reduce((sum, item) => sum + item.submittedCount, 0),
      gradedCount: summaries.reduce((sum, item) => sum + item.gradedCount, 0),
      avgCompletion: weightedCompletion ?? 0,
      avgScorePercent: average(scorePercents),
    },
  };
}
