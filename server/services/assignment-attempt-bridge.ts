/**
 * 作业域 → LearningSurface attempt 桥接（阶段 2）。
 *
 * 旧作业表（assignments / plugin_*）仍是读 API 的数据源；写 API 从本阶段起统一走
 * `learning-surface-assignments` 通道。本模块负责：
 *   - 按作业定义找到 / 创建 `kind='assignment'` 的 Surface；
 *   - 按学生找到 / 创建 attempt（一个学生在一个作业上复用同一条 attempt，
 *     重交仍写入版本表，保持旧作业「多版本、单 attempt」的语义）；
 *   - 把旧表的提交、版本、文件、互评、评分、成绩历史挂到 attempt_id；
 *   - 新写入完成后，把 legacy 行同步回 attempt 的统一状态。
 *
 * 迁移（073）会把存量数据回填成同样的形状，因此新老数据读取口径一致。
 */
import type Database from 'better-sqlite3';
import {
  authorizeClass,
  authorizeLessonParticipation,
  authorizeLessonStaff,
  isAdministrator,
  isTeacher,
  type AccessDecision,
  type AccessSession,
} from './class-access.js';
import {
  assignmentContentRef,
  createOrResumeAttempt,
  getLearningSurface,
  getLearningSurfaceAttempt,
  type LearningSurfaceAttemptRow,
  type LearningSurfaceRow,
  lessonEvalContentRef,
  upsertLearningSurface,
} from './learning-surface-service.js';

export interface AssignmentLocator {
  assignmentId: string;
  lessonId: string;
  classId: string | null;
  title: string;
  /** hub = plugin_assignments；traditional = assignments */
  origin: 'hub' | 'traditional';
}

type SqliteLike = Database.Database;

/**
 * 作业维度的写权限：
 *   - 挂班级 → authorizeClass（staff / member）；
 *   - 挂课时 → authorizeLessonStaff / authorizeLessonParticipation；
 *   - 都没挂 → 已登录即可（教师仍按 staff 处理）。
 */
export function authorizeAssignmentAccess(
  db: SqliteLike,
  session: AccessSession | null | undefined,
  locator: AssignmentLocator,
  level: 'staff' | 'member',
): AccessDecision {
  if (!session) return { ok: false, status: 403, error: 'Forbidden' };
  if (locator.classId) return authorizeClass(db, session, locator.classId, level);
  if (locator.lessonId) {
    return level === 'staff'
      ? authorizeLessonStaff(db, session, locator.lessonId)
      : authorizeLessonParticipation(db, session, locator.lessonId);
  }
  return { ok: true, level: isAdministrator(session) ? 'admin' : isTeacher(session) ? 'teacher' : 'student' };
}

function readJsonArray(value: string | null | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 按 id 查作业定义；hub 优先，其次传统作业。 */
export function findAssignmentLocator(db: SqliteLike, assignmentId: string): AssignmentLocator | null {
  const hub = db
    .prepare('SELECT id, lesson_id, class_id, title FROM plugin_assignments WHERE id = ?')
    .get(assignmentId) as { id: string; lesson_id: string | null; class_id: string | null; title: string } | undefined;
  if (hub) {
    return {
      assignmentId: hub.id,
      lessonId: hub.lesson_id ?? '',
      classId: hub.class_id ?? null,
      title: hub.title,
      origin: 'hub',
    };
  }

  const traditional = db
    .prepare('SELECT id, lesson_id, class_id, title FROM assignments WHERE id = ?')
    .get(assignmentId) as { id: string; lesson_id: string | null; class_id: string; title: string } | undefined;
  if (traditional) {
    return {
      assignmentId: traditional.id,
      lessonId: traditional.lesson_id ?? '',
      classId: traditional.class_id ?? null,
      title: traditional.title,
      origin: 'traditional',
    };
  }
  return null;
}

/** 找到已有的作业 Surface（含软删，便于恢复）。 */
export function findAssignmentSurface(db: SqliteLike, assignmentId: string): LearningSurfaceRow | undefined {
  return db.prepare("SELECT * FROM learning_surfaces WHERE kind = 'assignment' AND owner_id = ?").get(assignmentId) as
    LearningSurfaceRow | undefined;
}

/**
 * 确保作业有 Surface。作业定义创建后调用一次即可；重复调用只刷新标题。
 * 班级级作业的 lesson_id 为空字符串（阶段 2 已确认）。
 */
export function ensureAssignmentSurface(db: SqliteLike, locator: AssignmentLocator): LearningSurfaceRow {
  const existing = findAssignmentSurface(db, locator.assignmentId);
  if (existing) {
    if (!existing.deleted_at) return existing;
    // 恢复软删的 Surface，保留原 attempt 历史。
    db.prepare('UPDATE learning_surfaces SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(
      Date.now(),
      existing.id,
    );
    return getLearningSurface(db, existing.id, { includeDeleted: true })!;
  }

  let result = upsertLearningSurface(db, {
    lessonId: locator.lessonId,
    kind: 'assignment',
    ownerId: locator.assignmentId,
    contentRef: assignmentContentRef(locator.assignmentId, locator.title),
  });
  // 旧 assignment.create 不校验 lesson 是否存在；Surface 也不该因此拒绝建行。
  // 课时已不存在时退化为班级级（空 lesson_id），保留提交与成绩追溯。
  if (!result.ok && result.status === 404 && locator.lessonId) {
    result = upsertLearningSurface(db, {
      lessonId: '',
      kind: 'assignment',
      ownerId: locator.assignmentId,
      contentRef: assignmentContentRef(locator.assignmentId, locator.title),
    });
  }
  if (!result.ok) throw new Error(`Failed to create assignment surface: ${result.error}`);
  return result.surface;
}

function latestAttemptFor(db: SqliteLike, surfaceId: string, studentId: string): LearningSurfaceAttemptRow | undefined {
  return db
    .prepare(
      `SELECT * FROM learning_surface_attempts
        WHERE surface_id = ? AND student_id = ?
        ORDER BY attempt_no DESC LIMIT 1`,
    )
    .get(surfaceId, studentId) as LearningSurfaceAttemptRow | undefined;
}

/**
 * 找到 / 创建学生在某作业上的 attempt。
 *
 * 作业域的「重交」写版本表而不是新 attempt，因此这里复用最近一条 attempt，
 * 即使它已经 submitted / graded —— 新提交会把同一 attempt 重新置为 submitted。
 */
export function ensureAssignmentAttempt(
  db: SqliteLike,
  locator: AssignmentLocator,
  studentId: string,
): LearningSurfaceAttemptRow {
  const surface = ensureAssignmentSurface(db, locator);
  const existing = latestAttemptFor(db, surface.id, studentId);
  if (existing) return existing;
  return createOrResumeAttempt(db, surface, { studentId, isPreview: 0 }).attempt;
}

/** 新写入完成后，把 legacy 提交/版本/评分同步回 attempt。 */
export function syncAttemptFromHubSubmission(
  db: SqliteLike,
  input: { assignmentId: string; studentId: string },
): LearningSurfaceAttemptRow | undefined {
  const locator = findAssignmentLocator(db, input.assignmentId);
  if (!locator) return undefined;
  const attempt = ensureAssignmentAttempt(db, locator, input.studentId);

  const submission = db
    .prepare('SELECT * FROM plugin_submissions WHERE assignment_id = ? AND student_id = ?')
    .get(input.assignmentId, input.studentId) as
    { id: string; version: number; created_at: number; updated_at: number } | undefined;
  if (!submission) return attempt;

  const latestVersion = db
    .prepare(
      `SELECT * FROM plugin_submission_versions
        WHERE submission_id = ?
        ORDER BY version DESC LIMIT 1`,
    )
    .get(submission.id) as
    | {
        id: string;
        version: number;
        files_json: string;
        text_content: string | null;
        link_url: string | null;
        is_late: number;
        submitted_at: number;
      }
    | undefined;

  const grade = db.prepare('SELECT * FROM plugin_grades WHERE submission_id = ?').get(submission.id) as
    | {
        teacher_score: number | null;
        calculated_final_score: number | null;
        teacher_comment: string | null;
        status: string;
        graded_at: number | null;
        graded_by: string | null;
      }
    | undefined;

  const graded = Boolean(grade && (grade.status === 'confirmed' || grade.status === 'published'));
  const score = grade?.calculated_final_score ?? grade?.teacher_score ?? null;
  const files = latestVersion ? readJsonArray(latestVersion.files_json) : [];
  const now = Date.now();

  const stateJson = JSON.stringify({
    migratedFrom: 'plugin_submissions',
    submissionId: submission.id,
    version: latestVersion?.version ?? submission.version,
    textContent: latestVersion?.text_content ?? null,
    linkUrl: latestVersion?.link_url ?? null,
    files,
    isLate: latestVersion?.is_late === 1,
    feedback: grade?.teacher_comment ?? null,
  });

  db.prepare(
    `UPDATE learning_surface_attempts
        SET status = ?,
            score = ?,
            auto_score = COALESCE(auto_score, ?),
            max_score = COALESCE(max_score, 100),
            completion = 1,
            state_json = ?,
            submitted_at = COALESCE(?, submitted_at),
            graded_at = ?,
            graded_by = ?,
            updated_at = ?
      WHERE id = ?`,
  ).run(
    graded ? 'graded' : 'submitted',
    score,
    score,
    stateJson,
    latestVersion?.submitted_at ?? submission.created_at,
    grade?.graded_at ?? null,
    grade?.graded_by ?? null,
    now,
    attempt.id,
  );

  linkHubRecordsToAttempt(db, input.assignmentId, input.studentId, attempt.id);
  return getLearningSurfaceAttempt(db, attempt.id);
}

/** 传统班级作业提交 / 评分同步。 */
export function syncAttemptFromTraditionalSubmission(
  db: SqliteLike,
  input: { assignmentId: string; studentId: string },
): LearningSurfaceAttemptRow | undefined {
  const locator = findAssignmentLocator(db, input.assignmentId);
  if (!locator || locator.origin !== 'traditional') return undefined;
  const attempt = ensureAssignmentAttempt(db, locator, input.studentId);

  const submission = db
    .prepare('SELECT * FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
    .get(input.assignmentId, input.studentId) as
    | {
        content: string | null;
        score: number | null;
        feedback: string | null;
        submitted_at: number;
        graded_at: number | null;
        graded_by: string | null;
        status: string;
      }
    | undefined;
  if (!submission) return attempt;

  const graded = submission.status === 'graded' || (submission.score != null && submission.graded_at != null);
  const stateJson = JSON.stringify({
    migratedFrom: 'assignment_submissions',
    content: submission.content,
    feedback: submission.feedback,
  });

  db.prepare(
    `UPDATE learning_surface_attempts
        SET status = ?,
            score = ?,
            auto_score = COALESCE(auto_score, ?),
            max_score = COALESCE(max_score, 100),
            completion = 1,
            state_json = ?,
            submitted_at = COALESCE(?, submitted_at),
            graded_at = ?,
            graded_by = ?,
            updated_at = ?
      WHERE id = ?`,
  ).run(
    graded ? 'graded' : 'submitted',
    submission.score,
    submission.score,
    stateJson,
    submission.submitted_at,
    submission.graded_at,
    submission.graded_by,
    Date.now(),
    attempt.id,
  );

  db.prepare('UPDATE assignment_submissions SET attempt_id = ? WHERE assignment_id = ? AND student_id = ?').run(
    attempt.id,
    input.assignmentId,
    input.studentId,
  );
  db.prepare(
    `UPDATE assignment_grade_history SET attempt_id = ?
      WHERE assignment_id = ? AND student_id = ? AND (attempt_id IS NULL OR attempt_id <> ?)`,
  ).run(attempt.id, input.assignmentId, input.studentId, attempt.id);

  return getLearningSurfaceAttempt(db, attempt.id);
}

/** 把 hub 的提交、版本、文件、互评、评分明细统一挂到 attempt。 */
export function linkHubRecordsToAttempt(
  db: SqliteLike,
  assignmentId: string,
  studentId: string,
  attemptId: string,
): void {
  db.prepare(
    'UPDATE plugin_submissions SET attempt_id = ? WHERE assignment_id = ? AND student_id = ? AND (attempt_id IS NULL OR attempt_id <> ?)',
  ).run(attemptId, assignmentId, studentId, attemptId);
  db.prepare(
    'UPDATE plugin_submission_versions SET attempt_id = ? WHERE assignment_id = ? AND student_id = ? AND (attempt_id IS NULL OR attempt_id <> ?)',
  ).run(attemptId, assignmentId, studentId, attemptId);
  db.prepare(
    'UPDATE plugin_assignment_files SET attempt_id = ? WHERE assignment_id = ? AND student_id = ? AND (attempt_id IS NULL OR attempt_id <> ?)',
  ).run(attemptId, assignmentId, studentId, attemptId);
  db.prepare(
    `UPDATE plugin_peer_review_tasks SET attempt_id = ?
      WHERE assignment_id = ?
        AND submission_id IN (SELECT id FROM plugin_submissions WHERE assignment_id = ? AND student_id = ?)
        AND (attempt_id IS NULL OR attempt_id <> ?)`,
  ).run(attemptId, assignmentId, assignmentId, studentId, attemptId);
  db.prepare(
    `UPDATE plugin_peer_reviews SET attempt_id = ?
      WHERE assignment_id = ?
        AND submission_id IN (SELECT id FROM plugin_submissions WHERE assignment_id = ? AND student_id = ?)
        AND (attempt_id IS NULL OR attempt_id <> ?)`,
  ).run(attemptId, assignmentId, assignmentId, studentId, attemptId);
  db.prepare(
    `UPDATE plugin_grades SET attempt_id = ?
      WHERE assignment_id = ?
        AND submission_id IN (SELECT id FROM plugin_submissions WHERE assignment_id = ? AND student_id = ?)
        AND (attempt_id IS NULL OR attempt_id <> ?)`,
  ).run(attemptId, assignmentId, assignmentId, studentId, attemptId);
}

/** 文件上传后立即挂到归属学生的 attempt（提交前也可见）。 */
export function linkUploadedFileToAttempt(
  db: SqliteLike,
  input: { assignmentId: string; studentId: string; fileId: string },
): string | null {
  const locator = findAssignmentLocator(db, input.assignmentId);
  if (!locator) return null;
  const attempt = ensureAssignmentAttempt(db, locator, input.studentId);
  db.prepare('UPDATE plugin_assignment_files SET attempt_id = ? WHERE id = ?').run(attempt.id, input.fileId);
  return attempt.id;
}

/** 互评任务分配后，把该作业下所有任务 / 互评挂到对应 attempt。 */
export function linkAllPeerReviewRecordsForAssignment(db: SqliteLike, assignmentId: string): number {
  const taskResult = db
    .prepare(
      `UPDATE plugin_peer_review_tasks SET attempt_id = (
         SELECT ps.attempt_id FROM plugin_submissions ps
          WHERE ps.id = plugin_peer_review_tasks.submission_id AND ps.assignment_id = plugin_peer_review_tasks.assignment_id
       )
       WHERE assignment_id = ? AND attempt_id IS NULL`,
    )
    .run(assignmentId);
  db.prepare(
    `UPDATE plugin_peer_reviews SET attempt_id = (
       SELECT ps.attempt_id FROM plugin_submissions ps
        WHERE ps.id = plugin_peer_reviews.submission_id AND ps.assignment_id = plugin_peer_reviews.assignment_id
     )
     WHERE assignment_id = ? AND attempt_id IS NULL`,
  ).run(assignmentId);
  return taskResult.changes;
}

/** 互评任务分配 / 单条互评提交后，把 task / review 挂到 attempt。 */
export function linkPeerReviewToAttempt(
  db: SqliteLike,
  input: { assignmentId: string; submissionId?: string; taskId?: string },
): string | null {
  let attemptId: string | null = null;
  if (input.submissionId) {
    const row = db
      .prepare('SELECT attempt_id FROM plugin_submissions WHERE id = ? AND assignment_id = ?')
      .get(input.submissionId, input.assignmentId) as { attempt_id: string | null } | undefined;
    attemptId = row?.attempt_id ?? null;
  }
  if (!attemptId && input.taskId) {
    const row = db.prepare('SELECT attempt_id FROM plugin_peer_review_tasks WHERE id = ?').get(input.taskId) as
      { attempt_id: string | null } | undefined;
    attemptId = row?.attempt_id ?? null;
  }
  if (!attemptId) return null;

  if (input.taskId) {
    db.prepare('UPDATE plugin_peer_review_tasks SET attempt_id = ? WHERE id = ?').run(attemptId, input.taskId);
  }
  if (input.submissionId) {
    db.prepare(
      `UPDATE plugin_peer_review_tasks SET attempt_id = ?
        WHERE submission_id = ? AND assignment_id = ? AND (attempt_id IS NULL OR attempt_id <> ?)`,
    ).run(attemptId, input.submissionId, input.assignmentId, attemptId);
  }
  return attemptId;
}

// ── 课时级随堂提交（旧 /api/lessons/:lessonId/eval-submissions）────────────

/** 找到 / 创建课时级随堂提交的 Surface（kind='lesson_eval'，owner=lessonId）。 */
export function ensureLessonEvalSurface(db: SqliteLike, lessonId: string): LearningSurfaceRow {
  const existing = db
    .prepare("SELECT * FROM learning_surfaces WHERE kind = 'lesson_eval' AND owner_id = ?")
    .get(lessonId) as LearningSurfaceRow | undefined;
  if (existing) {
    if (!existing.deleted_at) return existing;
    db.prepare('UPDATE learning_surfaces SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(
      Date.now(),
      existing.id,
    );
    return getLearningSurface(db, existing.id, { includeDeleted: true })!;
  }

  const result = upsertLearningSurface(db, {
    lessonId,
    kind: 'lesson_eval',
    ownerId: lessonId,
    contentRef: lessonEvalContentRef(lessonId),
  });
  if (!result.ok) throw new Error(`Failed to create lesson eval surface: ${result.error}`);
  return result.surface;
}

/**
 * 学生随堂提交 → attempt。
 *
 * 课时级提交沿用旧语义：同一学生在同一课时只有一条提交，重复提交只递增版本；
 * attempt 复用最近一条，状态始终为 submitted。
 */
export function syncLessonEvalAttempt(
  db: SqliteLike,
  input: {
    lessonId: string;
    studentId: string;
    submissionId: string;
    version: number;
    filePath?: string | null;
    textContent?: string | null;
  },
): LearningSurfaceAttemptRow {
  const surface = ensureLessonEvalSurface(db, input.lessonId);
  const existing = latestAttemptFor(db, surface.id, input.studentId);
  const attempt = existing ?? createOrResumeAttempt(db, surface, { studentId: input.studentId, isPreview: 0 }).attempt;

  const stateJson = JSON.stringify({
    migratedFrom: 'plugin_submissions',
    submissionId: input.submissionId,
    version: input.version,
    filePath: input.filePath ?? null,
    textContent: input.textContent ?? null,
  });
  const now = Date.now();
  db.prepare(
    `UPDATE learning_surface_attempts
        SET status = 'submitted',
            completion = 1,
            max_score = COALESCE(max_score, 100),
            state_json = ?,
            submitted_at = COALESCE(submitted_at, ?),
            updated_at = ?
      WHERE id = ?`,
  ).run(stateJson, now, now, attempt.id);

  db.prepare('UPDATE plugin_submissions SET attempt_id = ? WHERE id = ?').run(attempt.id, input.submissionId);
  return getLearningSurfaceAttempt(db, attempt.id)!;
}

/** 课时级互评写入后，把 review / task 挂到被评提交的 attempt。 */
export function linkLessonEvalReviewToAttempt(
  db: SqliteLike,
  input: { submissionId: string; reviewId: string },
): string | null {
  const row = db.prepare('SELECT attempt_id FROM plugin_submissions WHERE id = ?').get(input.submissionId) as
    { attempt_id: string | null } | undefined;
  const attemptId = row?.attempt_id ?? null;
  if (!attemptId) return null;

  db.prepare('UPDATE plugin_peer_reviews SET attempt_id = ? WHERE id = ?').run(attemptId, input.reviewId);
  db.prepare(
    'UPDATE plugin_peer_review_tasks SET attempt_id = ? WHERE submission_id = ? AND assignment_id IS NULL',
  ).run(attemptId, input.submissionId);
  return attemptId;
}
