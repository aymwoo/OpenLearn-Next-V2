/**
 * 学案活动进度只读服务（P0）。
 *
 * `activity_progress` / `lesson_activities` 是学案运行数据；第三方插件没有写入口，
 * 也不应看到其他学生的进度。本服务只返回当前登录学生自己的进度与提交内容。
 *
 * 可见性：先按 activity 找到所属课节，再走 `canSeeLesson`，与 `GET /api/lessons/:id`
 * 同一口径；没有登录学生时直接拒绝。
 */
import type { Database } from 'better-sqlite3';
import type { IXueanActivityProgressService, XueanActivityProgressView } from './interfaces.js';
import { canSeeLesson } from './lesson-visibility.js';
import { currentLessonViewer, studentIdFromViewer, type LessonViewer } from './lesson-viewer.js';

export class XueanActivityProgressAccessError extends Error {
  readonly status = 403;
  readonly code = 'XUEAN_ACTIVITY_PROGRESS_FORBIDDEN';

  constructor(readonly reason: 'no_viewer' | 'not_student' | 'forbidden') {
    super(
      reason === 'no_viewer'
        ? 'Xuean activity progress requires the signed-in user who invoked this plugin'
        : reason === 'not_student'
          ? 'Only a student can read their own activity progress'
          : 'Xuean activity progress is not visible to the current user',
    );
    this.name = 'XueanActivityProgressAccessError';
  }
}

interface ProgressRow {
  activity_id: string;
  lesson_id: string;
  activity_title: string;
  student_id: string;
  status: string;
  progress_percent: number;
  verified: number;
  score: number | null;
  graded_at: number | null;
  last_activity_at: number | null;
  submission_json: string | null;
}

export class XueanActivityProgressService implements IXueanActivityProgressService {
  constructor(private readonly db: Database) {}

  async getMyActivityProgress(activityId: string): Promise<XueanActivityProgressView | null> {
    const studentId = this.requireStudentId();
    const id = typeof activityId === 'string' ? activityId.trim() : '';
    if (!id) return null;

    // 先定位活动所属课节并校验可见性：即使学生没有进度行，也不让它借
    // “null 还是 forbidden” 探测未授权活动是否存在。隐藏 / 未发布活动按
    // 不存在处理，与学生端活动列表的 visible / release_at 口径一致。
    const now = Date.now();
    const activity = this.db
      .prepare(
        `SELECT lesson_id FROM lesson_activities
          WHERE id = ? AND visible = 1 AND (release_at IS NULL OR release_at <= ?)`,
      )
      .get(id, now) as { lesson_id: string } | undefined;
    if (!activity) return null;
    this.assertLessonVisible(activity.lesson_id);

    const row = this.db
      .prepare(
        `SELECT p.activity_id,
                a.lesson_id,
                a.title AS activity_title,
                p.student_id,
                p.status,
                p.progress_percent,
                p.verified,
                p.score,
                p.graded_at,
                p.last_activity_at,
                p.submission_json
           FROM activity_progress p
           JOIN lesson_activities a ON a.id = p.activity_id
          WHERE p.activity_id = ? AND p.student_id = ?
            AND a.visible = 1 AND (a.release_at IS NULL OR a.release_at <= ?)
          LIMIT 1`,
      )
      .get(id, studentId, now) as ProgressRow | undefined;
    return row ? toView(row) : null;
  }

  async listMyActivityProgress(lessonId: string): Promise<XueanActivityProgressView[]> {
    const studentId = this.requireStudentId();
    const id = typeof lessonId === 'string' ? lessonId.trim() : '';
    if (!id) return [];

    this.assertLessonVisible(id);
    const now = Date.now();

    const rows = this.db
      .prepare(
        `SELECT p.activity_id,
                a.lesson_id,
                a.title AS activity_title,
                p.student_id,
                p.status,
                p.progress_percent,
                p.verified,
                p.score,
                p.graded_at,
                p.last_activity_at,
                p.submission_json
           FROM activity_progress p
           JOIN lesson_activities a ON a.id = p.activity_id
          WHERE a.lesson_id = ? AND p.student_id = ?
            AND a.visible = 1 AND (a.release_at IS NULL OR a.release_at <= ?)
          ORDER BY a.order_index ASC, p.activity_id ASC`,
      )
      .all(id, studentId, now) as ProgressRow[];
    return rows.map(toView);
  }

  private requireStudentId(): string {
    const viewer = currentLessonViewer();
    if (!viewer) throw new XueanActivityProgressAccessError('no_viewer');
    const studentId = studentIdFromViewer(viewer);
    if (!studentId) throw new XueanActivityProgressAccessError('not_student');
    return studentId;
  }

  private assertLessonVisible(lessonId: string): void {
    const viewer: LessonViewer | null = currentLessonViewer();
    if (!viewer) throw new XueanActivityProgressAccessError('no_viewer');
    if (!canSeeLesson(this.db, viewer, lessonId)) {
      throw new XueanActivityProgressAccessError('forbidden');
    }
  }
}

function toView(row: ProgressRow): XueanActivityProgressView {
  return {
    activityId: row.activity_id,
    lessonId: row.lesson_id,
    activityTitle: row.activity_title ?? '',
    studentId: row.student_id,
    status: row.status ?? 'not_started',
    progressPercent: Number(row.progress_percent) || 0,
    verified: Boolean(row.verified),
    score: row.score === null || row.score === undefined ? null : Number(row.score),
    gradedAt: row.graded_at === null || row.graded_at === undefined ? null : Number(row.graded_at),
    lastActivityAt:
      row.last_activity_at === null || row.last_activity_at === undefined ? null : Number(row.last_activity_at),
    submission: parseSubmission(row.submission_json),
  };
}

function parseSubmission(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
