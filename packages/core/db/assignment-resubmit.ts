/**
 * 学生重交的唯一入口（Issue #248）。
 *
 * ## 为什么单独抽一个模块
 *
 * 重交有两条写入路径 —— `server/services/assignment-service.ts` 的
 * `submitTraditionalAssignment` 与 `management` 插件的 `assignment.submit` ——
 * 此前各自写一份 `INSERT ... ON CONFLICT DO UPDATE`。口径迟早会漂，
 * 而「重交」正是**分数与内容最容易脱钩**的地方（见下）。
 *
 * ## 口径
 *
 * 1. **重交不降级**（#215 已确立，不可回退）：
 *    已批改（`graded`）或已缺考（`absent`）的行，重交后**状态与分数都不变**，
 *    只更新作答内容。学生重交不得冲掉待复核的成绩。
 * 2. **内容替换要留痕**（Issue #248 补的缺口）：
 *    保留分数意味着「分数是针对**旧内容**给的」这个事实不能被悄悄抹掉。
 *    重交把已批改行的内容换掉时，写一行 `assignment_grade_history`
 *    （`reason='resubmit-content-replaced'`），并把**被替换掉的那份内容**
 *    存进 `old_content` —— 新内容就在成绩行里，不必再存一份。
 *
 * 于是教师看到「新内容 + 旧分数」时，审计历史里能查到那次替换，
 * 也不会误以为分数是针对新内容给的。
 */
import crypto from 'node:crypto';

/** 重交审计留痕的原因码。 */
export const RESUBMIT_CONTENT_REPLACED_REASON = 'resubmit-content-replaced';

export interface ResubmitDb {
  prepare(sql: string): {
    get(...params: any[]): any;
    all(...params: any[]): any[];
    run(...params: any[]): any;
  };
  transaction?: (fn: () => void) => () => void;
}

export interface ResubmitInput {
  assignmentId: string;
  studentId: string;
  content: string;
  /** 操作者（学生本人）；用于审计历史。 */
  actorId?: string | null;
  actorRole?: string | null;
  /** 提交时间戳。 */
  now?: number;
}

export interface ResubmitResult {
  ok: boolean;
  /** 这次重交是否替换了已批改行的作答内容。 */
  contentReplaced: boolean;
  /** 留痕的历史行 id（仅 contentReplaced 为 true 时有值）。 */
  historyId?: string;
  /** 重交后的行状态。 */
  status?: string;
}

interface ExistingSubmissionRow {
  content: string | null;
  score: number | null;
  feedback: string | null;
  status: string | null;
  source: string | null;
  academic_year: string | null;
}

/** 已批改 / 已缺考的行：重交不得降级其状态与分数。 */
function keepStatus(current: string | null): string {
  return current === 'graded' || current === 'absent' ? current : 'submitted';
}

/**
 * 记录一次「已批改行的作答内容被重交替换」。
 *
 * 分数与状态没变（重交不降级），所以这一行的 old/new 分数、状态、来源相同 ——
 * 它记的是**内容替换这件事**，靠 `reason` 与 `old_content` 表达。
 */
function writeContentReplacementHistory(
  db: ResubmitDb,
  input: {
    assignmentId: string;
    studentId: string;
    oldContent: string | null;
    score: number | null;
    status: string | null;
    source: string | null;
    actorId?: string | null;
    actorRole?: string | null;
    now: number;
  },
): string | undefined {
  const historyId = `agh-${crypto.randomUUID()}`;
  try {
    db.prepare(
      `INSERT INTO assignment_grade_history
         (id, assignment_id, student_id, old_score, new_score, old_status, new_status,
          old_source, new_source, actor_id, actor_role, reason, created_at, old_content)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      historyId,
      input.assignmentId,
      input.studentId,
      input.score,
      input.score,
      input.status,
      input.status,
      input.source,
      input.source,
      input.actorId ?? null,
      input.actorRole ?? null,
      RESUBMIT_CONTENT_REPLACED_REASON,
      input.now,
      input.oldContent,
    );
    return historyId;
  } catch (err) {
    // 留痕失败**不能**阻断重交本身 —— 学生交作业是主流程，
    // 审计是次要的（缺失会被「审计历史缺口」类巡检发现）。
    console.warn('[assignment.resubmit] 内容替换留痕失败:', (err as Error).message);
    return undefined;
  }
}

/**
 * 执行一次学生重交。
 *
 * @returns `contentReplaced` 为 true 表示这次重交换掉了已批改行的内容
 *          （分数按 #215 保留，不降级）。
 */
export function applyResubmission(db: ResubmitDb, input: ResubmitInput): ResubmitResult {
  const assignmentId = String(input.assignmentId ?? '').trim();
  const studentId = String(input.studentId ?? '').trim();
  if (!assignmentId || !studentId) {
    return { ok: false, contentReplaced: false };
  }
  const now = input.now ?? Date.now();
  const content = input.content ?? '';

  let result: ResubmitResult = { ok: false, contentReplaced: false };

  const write = (): void => {
    const existing = db
      .prepare(
        `SELECT content, score, feedback, status, source, academic_year
         FROM assignment_submissions
         WHERE assignment_id = ? AND student_id = ?
         LIMIT 1`,
      )
      .get(assignmentId, studentId) as ExistingSubmissionRow | undefined;

    if (!existing) {
      db.prepare(
        `INSERT INTO assignment_submissions
           (assignment_id, student_id, content, score, feedback, submitted_at, status)
         VALUES (?, ?, ?, NULL, NULL, ?, 'submitted')`,
      ).run(assignmentId, studentId, content, now);
      result = { ok: true, contentReplaced: false, status: 'submitted' };
      return;
    }

    const nextStatus = keepStatus(existing.status);
    const contentChanged = (existing.content ?? '') !== content;
    // 只有「已批改 / 已缺考」的行被换内容时才需要留痕 ——
    // 未评分的行换内容是常态，不需要每次都写审计。
    const gradedRow = existing.status === 'graded' || existing.status === 'absent';
    const contentReplaced = gradedRow && contentChanged;

    let historyId: string | undefined;
    if (contentReplaced) {
      historyId = writeContentReplacementHistory(db, {
        assignmentId,
        studentId,
        oldContent: existing.content,
        score: existing.score,
        status: existing.status,
        source: existing.source,
        actorId: input.actorId ?? null,
        actorRole: input.actorRole ?? null,
        now,
      });
    }

    // 重交只更新内容与提交时间：分数、反馈、批改时间、来源、批改人一律不动。
    db.prepare(
      `UPDATE assignment_submissions
         SET content = ?, submitted_at = ?, status = ?
       WHERE assignment_id = ? AND student_id = ?`,
    ).run(content, now, nextStatus, assignmentId, studentId);

    result = { ok: true, contentReplaced, historyId, status: nextStatus };
  };

  const tx = typeof db.transaction === 'function' ? db.transaction(write) : null;
  if (typeof tx === 'function') tx();
  else write();

  return result;
}
