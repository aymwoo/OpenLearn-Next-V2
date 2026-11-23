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

interface AssignmentAggregateRow {
  total: number | null;
  graded: number | null;
  average_score: number | null;
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

    const assignments = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN asb.score IS NOT NULL THEN 1 ELSE 0 END) AS graded,
                AVG(asb.score) AS average_score
           FROM assignment_submissions asb
           JOIN assignments a ON a.id = asb.assignment_id
          WHERE a.lesson_id = ?`,
      )
      .get(id) as AssignmentAggregateRow | undefined;

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
      assignments: {
        total: Number(assignments?.total) || 0,
        graded: Number(assignments?.graded) || 0,
        averageScore: toNullableNumber(assignments?.average_score),
      },
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
