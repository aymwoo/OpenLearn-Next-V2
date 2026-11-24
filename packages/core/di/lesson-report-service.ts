/**
 * 课后报告只读服务（P0）。
 *
 * 第三方插件需要课后摘要（课堂会话、作业完成度、学案活动参与度）时，不应直查
 * `classroom_sessions` / `assignment_submissions` / `activity_progress`（均在
 * sql-guard 禁读表里）。本服务只返回**聚合摘要**，不返回原始行与个人明细。
 *
 * 访问口径：仅教师与管理员；仍受 `canSeeLesson` 约束。学生调用直接拒绝。
 */
import type { Database } from 'better-sqlite3';
import type { ClassroomReportSessionSummary, ILessonReportService, LessonReportSummary } from './interfaces.js';
import { canSeeLesson } from './lesson-visibility.js';
import { currentLessonViewer, normalizeViewerRole, type LessonViewer } from './lesson-viewer.js';
import { resolveGradeItemKey } from './grade-item-key.js';

export class LessonReportAccessError extends Error {
  readonly status = 403;
  readonly code = 'LESSON_REPORT_FORBIDDEN';

  constructor(readonly reason: 'no_viewer' | 'not_staff' | 'forbidden') {
    super(
      reason === 'no_viewer'
        ? 'Lesson report requires the signed-in user who invoked this plugin'
        : reason === 'not_staff'
          ? 'Only a teacher or administrator can read lesson reports'
          : 'Lesson report is not visible to the current user',
    );
    this.name = 'LessonReportAccessError';
  }
}

interface LessonRow {
  id: string;
  title: string;
}

interface SessionRow {
  id: string;
  class_id: string | null;
  stage: string | null;
  started_at: number | null;
  ended_at: number | null;
  student_count: number | null;
}

interface SessionWithLessonRow extends SessionRow {
  lesson_id: string;
}

interface ActivityAggregateRow {
  total: number | null;
  submitted: number | null;
  completed: number | null;
}

const SESSION_COLUMNS = `
  s.id,
  s.class_id,
  s.stage,
  s.started_at,
  s.ended_at,
  (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = s.class_id) AS student_count
`;

export class LessonReportService implements ILessonReportService {
  constructor(private readonly db: Database) {}

  async getLessonReport(lessonId: string): Promise<LessonReportSummary | null> {
    const viewer = this.requireStaff();
    const id = typeof lessonId === 'string' ? lessonId.trim() : '';
    if (!id) return null;

    const lesson = this.db.prepare('SELECT id, title FROM lessons WHERE id = ?').get(id) as LessonRow | undefined;
    if (!lesson) return null;

    this.assertVisible(viewer, id);

    const sessions = this.db
      .prepare(`SELECT ${SESSION_COLUMNS} FROM classroom_sessions s WHERE s.lesson_id = ? ORDER BY s.created_at DESC`)
      .all(id) as SessionRow[];

    const assignments = this.aggregateAssignments(id);

    const activities = this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM lesson_activities WHERE lesson_id = ?) AS total,
           (SELECT COUNT(DISTINCT p.activity_id)
              FROM activity_progress p
              JOIN lesson_activities a ON a.id = p.activity_id
             WHERE a.lesson_id = ?
               AND (p.progress_percent > 0 OR p.status IN ('submitted', 'completed'))) AS submitted,
           (SELECT COUNT(DISTINCT p.activity_id)
              FROM activity_progress p
              JOIN lesson_activities a ON a.id = p.activity_id
             WHERE a.lesson_id = ?
               AND (p.status = 'completed' OR p.verified = 1 OR p.progress_percent >= 100)) AS completed`,
      )
      .get(id, id, id) as ActivityAggregateRow | undefined;

    return {
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      sessions: sessions.map(toSessionSummary),
      assignments,
      activities: {
        total: Number(activities?.total) || 0,
        submitted: Number(activities?.submitted) || 0,
        completed: Number(activities?.completed) || 0,
      },
    };
  }

  async getSessionReport(sessionId: string): Promise<ClassroomReportSessionSummary | null> {
    const viewer = this.requireStaff();
    const id = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!id) return null;

    const row = this.db
      .prepare(`SELECT ${SESSION_COLUMNS}, s.lesson_id FROM classroom_sessions s WHERE s.id = ?`)
      .get(id) as SessionWithLessonRow | undefined;
    if (!row) return null;

    this.assertVisible(viewer, row.lesson_id);
    return toSessionSummary(row);
  }

  /**
   * 作业聚合：先按「学生 + 成绩项键」去重再计数。
   *
   * 历史实现直接对提交行做 COUNT / AVG，课件改名或学案重复补壳产生的重复作业行
   * 会让作业总数、已批改数与均分被重复统计（第三方插件读到的正是这份摘要）。
   */
  private aggregateAssignments(lessonId: string): LessonReportSummary['assignments'] {
    const rows = this.db
      .prepare(
        `SELECT asb.student_id, asb.assignment_id, asb.score,
                asb.graded_at, asb.submitted_at,
                a.class_id, a.lesson_id, a.content
           FROM assignment_submissions asb
           JOIN assignments a ON a.id = asb.assignment_id
          WHERE a.lesson_id = ?`,
      )
      .all(lessonId) as Array<{
      student_id: string;
      assignment_id: string;
      score: number | null;
      graded_at: number | null;
      submitted_at: number | null;
      class_id: string | null;
      lesson_id: string | null;
      content: string | null;
    }>;

    type DedupedSubmission = { score: number | null; at: number };
    const byStudentItem = new Map<string, Map<string, DedupedSubmission>>();
    for (const row of rows) {
      const key = resolveGradeItemKey({
        id: row.assignment_id,
        classId: row.class_id,
        lessonId: row.lesson_id,
        content: row.content,
      });
      let byItem = byStudentItem.get(row.student_id);
      if (!byItem) {
        byItem = new Map();
        byStudentItem.set(row.student_id, byItem);
      }
      const at = Number(row.graded_at ?? row.submitted_at ?? 0);
      const prev = byItem.get(key);
      // 同一成绩项保留最新一条；时间相同优先已出分的较高分，避免旧壳覆盖新成绩。
      const replace =
        !prev ||
        at > prev.at ||
        (at === prev.at && row.score !== null && (prev.score === null || row.score > prev.score));
      if (replace) byItem.set(key, { score: row.score, at });
    }

    let total = 0;
    let graded = 0;
    let scoreSum = 0;
    for (const byItem of byStudentItem.values()) {
      for (const item of byItem.values()) {
        total += 1;
        if (typeof item.score === 'number' && Number.isFinite(item.score)) {
          graded += 1;
          scoreSum += item.score;
        }
      }
    }

    return {
      total,
      graded,
      averageScore: graded > 0 ? Math.round((scoreSum / graded) * 10) / 10 : null,
    };
  }

  private requireStaff(): LessonViewer {
    const viewer = currentLessonViewer();
    if (!viewer) throw new LessonReportAccessError('no_viewer');
    const role = normalizeViewerRole(viewer);
    if (role !== 'teacher' && role !== 'administrator') throw new LessonReportAccessError('not_staff');
    return viewer;
  }

  private assertVisible(viewer: LessonViewer, lessonId: string): void {
    if (!canSeeLesson(this.db, viewer, lessonId)) {
      throw new LessonReportAccessError('forbidden');
    }
  }
}

function toSessionSummary(row: SessionRow): ClassroomReportSessionSummary {
  return {
    sessionId: row.id,
    classId: row.class_id ?? null,
    stage: row.stage ?? '',
    startedAt: toNullableNumber(row.started_at),
    endedAt: toNullableNumber(row.ended_at),
    studentCount: Number(row.student_count) || 0,
  };
}

function toNullableNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
