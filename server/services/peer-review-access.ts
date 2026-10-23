/**
 * 互评提交的对象级授权。
 *
 * 背景：互评有两条写入路径，历史上口径不一致 ——
 *   - 插件命令 `assignment.eval.submitReview`（packages/plugins/assignment-eval.ts）
 *   - HTTP 路由 `POST /api/lessons/:lessonId/eval-submissions/:submissionId/reviews`
 *     （server/routes/lessons.ts）
 *
 * 插件路径校验了「禁止自评」「必须持有互评任务」「截止时间」，HTTP 路径一条都没校验，
 * 导致学生可以给自己的作业提交互评，把互评均分刷满（Issue #217）。
 *
 * 本模块把插件路径的判定抽成可复用、可单测的纯函数，HTTP 路由改用它，
 * 两侧口径从此同源；后续若再新增互评入口，也必须走这里。
 */
import type Database from 'better-sqlite3';

export type PeerReviewAccessDecision =
  | { ok: true; assignmentId: string | null; taskId: string | null }
  | { ok: false; status: 403 | 404; error: string };

export interface PeerReviewAccessParams {
  /** 被评的提交 id */
  submissionId: string;
  /** 限定提交必须属于该课节（可选；传入时会一并校验 lesson_id） */
  lessonId?: string | null;
  /** 互评人 id（学生 id） */
  reviewerId: string;
  /**
   * 管理员代录：允许指定他人作为互评人，因此跳过「任务归属」与「截止时间」判定。
   * 但「禁止自评」对所有人一律生效 —— 代录也不允许造出自评记录。
   */
  privileged?: boolean;
  /** 当前时间戳（毫秒），便于测试注入 */
  now?: number;
}

interface SubmissionRow {
  id: string;
  student_id: string;
  assignment_id: string | null;
}

interface TaskRow {
  id: string;
  due_at: number | null;
  status: string;
}

/**
 * 判定某个互评人能否对某个提交提交互评。
 *
 * 判定顺序与插件路径保持一致：
 *   1. 提交必须存在（且属于指定课节）
 *   2. 禁止自评（提交人 === 互评人）
 *   3. 分配式互评：若该提交所属作业已建立互评任务，则必须持有其中一条任务
 *   4. 截止时间：任务截止时间优先，其次作业的互评截止时间
 */
export function authorizePeerReviewSubmission(
  db: Database.Database,
  params: PeerReviewAccessParams,
): PeerReviewAccessDecision {
  const { submissionId, reviewerId } = params;
  const privileged = params.privileged === true;
  const now = params.now ?? Date.now();

  if (!submissionId || !reviewerId) {
    return { ok: false, status: 403, error: 'Forbidden: missing submission or reviewer' };
  }

  // 1. 提交必须存在，且（传入 lessonId 时）必须属于该课节
  const submission = (
    params.lessonId
      ? db
          .prepare(
            'SELECT id, student_id, assignment_id FROM plugin_submissions WHERE id = ? AND lesson_id = ?',
          )
          .get(submissionId, params.lessonId)
      : db
          .prepare('SELECT id, student_id, assignment_id FROM plugin_submissions WHERE id = ?')
          .get(submissionId)
  ) as SubmissionRow | undefined;

  if (!submission) {
    return { ok: false, status: 404, error: 'Submission not found for this lesson' };
  }

  // 2. 禁止自评 —— 管理员代录同样适用
  if (submission.student_id === reviewerId) {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden: students are not allowed to evaluate their own assignments',
    };
  }

  const assignmentId = submission.assignment_id ?? null;

  // 管理员代录：跳过任务归属与截止时间判定
  if (privileged) {
    return { ok: true, assignmentId, taskId: null };
  }

  // 3. 分配式互评：作业已建立互评任务时，必须是任务持有人
  const task = db
    .prepare('SELECT id, due_at, status FROM plugin_peer_review_tasks WHERE submission_id = ? AND reviewer_id = ?')
    .get(submissionId, reviewerId) as TaskRow | undefined;

  if (!task && assignmentId) {
    const taskCount = (
      db
        .prepare('SELECT COUNT(*) AS c FROM plugin_peer_review_tasks WHERE assignment_id = ?')
        .get(assignmentId) as { c: number }
    ).c;
    if (taskCount > 0) {
      return {
        ok: false,
        status: 403,
        error: 'Forbidden: this submission is not assigned to you for peer review',
      };
    }
  }

  // 4. 截止时间：任务截止时间优先，其次作业的互评截止时间
  const dueAt = task?.due_at ?? loadAssignmentDueAt(db, assignmentId);
  if (dueAt !== null && dueAt !== undefined && now > Number(dueAt)) {
    return { ok: false, status: 403, error: 'Forbidden: the peer review deadline has passed' };
  }

  return { ok: true, assignmentId, taskId: task?.id ?? null };
}

/**
 * 读取作业的互评截止时间；作业不存在或未设置时返回 null。
 */
function loadAssignmentDueAt(db: Database.Database, assignmentId: string | null): number | null {
  if (!assignmentId) return null;
  try {
    const row = db
      .prepare('SELECT peer_review_due_at FROM plugin_assignments WHERE id = ?')
      .get(assignmentId) as { peer_review_due_at: number | null } | undefined;
    return row?.peer_review_due_at ?? null;
  } catch {
    // 旧库可能还没有 plugin_assignments 表 —— 视为未设置截止时间
    return null;
  }
}
