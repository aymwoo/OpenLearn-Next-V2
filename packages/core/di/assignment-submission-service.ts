/**
 * 作业提交只读服务（P0）。
 *
 * `assignments` / `assignment_submissions` 与作业中心的
 * `plugin_assignments` / `plugin_submissions` 都是插件不能直查的受管数据。
 * 本服务是宿主侧的替代通道：只返回提交本身，身份由当前会话派生。
 *
 * 访问口径：
 * - 学生：`getSubmissionForViewer` 只能读自己；
 * - 教师：只能读自己名下班级的提交；
 * - 管理员：不限。
 */
import type { Database } from 'better-sqlite3';
import type { AssignmentSubmissionView, IAssignmentSubmissionService } from './interfaces.js';
import { currentLessonViewer, normalizeViewerRole, studentIdFromViewer, type LessonViewer } from './lesson-viewer.js';

export class AssignmentSubmissionAccessError extends Error {
  readonly status = 403;
  readonly code = 'ASSIGNMENT_SUBMISSION_FORBIDDEN';

  constructor(readonly reason: 'no_viewer' | 'not_student' | 'forbidden') {
    super(
      reason === 'no_viewer'
        ? 'Assignment submission requires the signed-in user who invoked this plugin'
        : reason === 'not_student'
          ? 'Only a student can read their own assignment submission'
          : 'Assignment submission is not visible to the current user',
    );
    this.name = 'AssignmentSubmissionAccessError';
  }
}

interface SubmissionRow {
  assignment_id: string;
  class_id: string | null;
  lesson_id: string | null;
  student_id: string;
  content: string | null;
  score: number | null;
  feedback: string | null;
  submitted_at: number;
  graded_at: number | null;
  status: string | null;
}

interface HubSubmissionRow {
  assignment_id: string;
  class_id: string | null;
  lesson_id: string | null;
  student_id: string;
  text_content: string | null;
  link_url: string | null;
  files_json: string | null;
  submitted_at: number | null;
  updated_at: number;
  score: number | null;
  feedback: string | null;
  graded_at: number | null;
  grade_status: string | null;
}

export class AssignmentSubmissionService implements IAssignmentSubmissionService {
  constructor(private readonly db: Database) {}

  async getMySubmission(assignmentId: string): Promise<AssignmentSubmissionView | null> {
    const viewer = this.requireViewer();
    const studentId = studentIdFromViewer(viewer);
    if (!studentId) throw new AssignmentSubmissionAccessError('not_student');
    return this.load(assignmentId, studentId);
  }

  async getSubmissionForViewer(assignmentId: string, studentId: string): Promise<AssignmentSubmissionView | null> {
    const viewer = this.requireViewer();
    const target = typeof studentId === 'string' ? studentId.trim() : '';
    if (!target) return null;

    const row = this.load(assignmentId, target);
    if (!row) return null;

    this.assertVisible(viewer, row, target);
    return row;
  }

  async canShareSubmission(assignmentId: string, studentId: string): Promise<boolean> {
    const submission = await this.getSubmissionForViewer(assignmentId, studentId);
    if (!submission) return false;
    const hasBody =
      submission.content.trim().length > 0 ||
      Boolean(submission.textContent?.trim()) ||
      Boolean(submission.linkUrl) ||
      (submission.files?.length ?? 0) > 0;
    return hasBody && submission.status !== 'draft';
  }

  private requireViewer(): LessonViewer {
    const viewer = currentLessonViewer();
    if (!viewer) throw new AssignmentSubmissionAccessError('no_viewer');
    return viewer;
  }

  private assertVisible(viewer: LessonViewer, row: AssignmentSubmissionView, targetStudentId: string): void {
    const role = normalizeViewerRole(viewer);
    if (role === 'administrator') return;

    if (role === 'student') {
      if (studentIdFromViewer(viewer) === targetStudentId) return;
      throw new AssignmentSubmissionAccessError('forbidden');
    }

    if (role === 'teacher' && row.classId && this.isClassOwner(viewer, row.classId)) return;
    throw new AssignmentSubmissionAccessError('forbidden');
  }

  private isClassOwner(viewer: LessonViewer, classId: string): boolean {
    const userId = viewer.userId || '';
    const username = viewer.username || '';
    if (!userId && !username) return false;
    const row = this.db
      .prepare('SELECT 1 AS ok FROM classes WHERE id = ? AND (owner_user_id = ? OR owner_user_id = ?) LIMIT 1')
      .get(classId, userId, username) as { ok: number } | undefined;
    return Boolean(row);
  }

  private load(assignmentId: string, studentId: string): AssignmentSubmissionView | null {
    const id = typeof assignmentId === 'string' ? assignmentId.trim() : '';
    if (!id) return null;
    // 作业中心优先：graded 后宿主会把成绩投影到 legacy 表，而投影行 content 为空，
    // 不能让它遮住 plugin_submission_versions 里的真实作答。
    return this.loadHub(id, studentId) ?? this.loadLegacy(id, studentId);
  }

  private loadLegacy(assignmentId: string, studentId: string): AssignmentSubmissionView | null {
    const row = this.db
      .prepare(
        `SELECT asb.assignment_id,
                a.class_id,
                a.lesson_id,
                asb.student_id,
                asb.content,
                asb.score,
                asb.feedback,
                asb.submitted_at,
                asb.graded_at,
                asb.status
           FROM assignment_submissions asb
           JOIN assignments a ON a.id = asb.assignment_id
          WHERE asb.assignment_id = ? AND asb.student_id = ?
          LIMIT 1`,
      )
      .get(assignmentId, studentId) as SubmissionRow | undefined;
    return row ? toLegacyView(row) : null;
  }

  private loadHub(assignmentId: string, studentId: string): AssignmentSubmissionView | null {
    const row = this.db
      .prepare(
        `SELECT ps.assignment_id,
                pa.class_id,
                COALESCE(ps.lesson_id, pa.lesson_id) AS lesson_id,
                ps.student_id,
                v.text_content,
                v.link_url,
                v.files_json,
                v.submitted_at,
                ps.updated_at,
                g.calculated_final_score AS score,
                g.teacher_comment AS feedback,
                g.graded_at,
                g.status AS grade_status
           FROM plugin_submissions ps
           LEFT JOIN plugin_assignments pa ON pa.id = ps.assignment_id
           LEFT JOIN plugin_submission_versions v ON v.submission_id = ps.id AND v.version = ps.version
           LEFT JOIN plugin_grades g ON g.submission_id = ps.id
          WHERE ps.assignment_id = ? AND ps.student_id = ?
          LIMIT 1`,
      )
      .get(assignmentId, studentId) as HubSubmissionRow | undefined;
    return row ? toHubView(row) : null;
  }
}

function toLegacyView(row: SubmissionRow): AssignmentSubmissionView {
  return {
    assignmentId: row.assignment_id,
    classId: row.class_id ?? null,
    lessonId: row.lesson_id ?? null,
    studentId: row.student_id,
    content: row.content ?? '',
    score: row.score === null || row.score === undefined ? null : Number(row.score),
    feedback: row.feedback ?? null,
    submittedAt: Number(row.submitted_at),
    gradedAt: row.graded_at === null || row.graded_at === undefined ? null : Number(row.graded_at),
    status: row.status ?? 'submitted',
    source: 'legacy',
  };
}

function toHubView(row: HubSubmissionRow): AssignmentSubmissionView {
  const score = row.score === null || row.score === undefined ? null : Number(row.score);
  const gradedAt = row.graded_at === null || row.graded_at === undefined ? null : Number(row.graded_at);
  const status = gradedAt !== null || row.grade_status === 'confirmed' ? 'graded' : 'submitted';
  return {
    assignmentId: row.assignment_id,
    classId: row.class_id ?? null,
    lessonId: row.lesson_id ?? null,
    studentId: row.student_id,
    content: row.text_content ?? '',
    score,
    feedback: row.feedback ?? null,
    submittedAt: Number(row.submitted_at ?? row.updated_at),
    gradedAt,
    status,
    source: 'assignment_hub',
    textContent: row.text_content ?? null,
    linkUrl: row.link_url ?? null,
    files: parseFiles(row.files_json),
  };
}

function parseFiles(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
