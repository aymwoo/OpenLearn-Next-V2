/**
 * 自动录入成绩（auto-record）核心逻辑
 *
 * 背景：教师此前只能在「学生提交数据」页逐条点击「录入成绩」，
 * 40 人 × 5 个课件 = 200 次点击，在课堂场景下不可持续。
 * 本模块把这一步改为「按可配置规则自动执行」，并保留手动按钮处理例外。
 *
 * 三条铁律（都源于历史缺陷，任何改动都不得放宽）：
 *   1. **没有分数就不录**。历史 promote 的 `let finalScore = 100` 会在
 *      submission_result.score 为 NULL 时直接给满分，把「没作答」记成「满分」。
 *   2. **自动录入只处理已完成的 attempt**。进行中（active）的提交不录。
 *   3. **幂等**。重复触发（实时 + 补录双路径）只更新同一条 assignment_submissions，
 *      不产生重复行、不叠加总分。
 */

import crypto from 'crypto';
import type { SqliteLike } from '../../packages/plugins/courseware-score.js';
import { resolveScoreConfig, type CoursewareScoreConfig } from '../../packages/plugins/courseware-score.js';

/** 视为「已完成」的 attempt 终态。
 *  注意与前端 LiveClassroomView 的 FINISHED_STATUSES 保持一致 —— 曾因前端漏掉
 *  'completed'（数据库实际写入的终态）导致「录入成绩」按钮长期灰着。 */
export const FINISHED_ATTEMPT_STATUSES = ['completed', 'submitted', 'finished'] as const;

/** 不应记入学期成绩的占位身份：无登录会话的访客 / 教师预览 */
const PLACEHOLDER_STUDENT_IDS = new Set(['guest', 'teacher', 'teacher_preview', '']);

export interface PromoteResult {
  ok: boolean;
  /** 失败/跳过原因，供 UI 解释「为什么这条没录」 */
  reason?:
    | 'attempt-not-found'
    | 'not-finished'
    | 'placeholder-student'
    | 'missing-score'
    | 'below-min-completion'
    | 'rule-disabled'
    | 'already-recorded'
    | 'manual-protected'
    | 'absent-protected'
    | 'not-higher';
  score?: number;
  assignmentId?: string;
  studentId?: string;
  coursewareName?: string;
}

/**
 * 归一化分数到 0~100 的百分制。
 * 返回 null 表示「没有可用分数」—— 调用方必须拒绝录入，绝不能兜底成 0 或 100。
 */
export function normalizePercentScore(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num)) return null;
  // 课件常以 0~1 的比率上报分数（0.85 → 85 分）。0 保持为 0，不能当成比率。
  const percent = num > 0 && num <= 1 ? Math.round(num * 100) : Math.round(num);
  return Math.max(0, Math.min(100, percent));
}

interface AttemptRow {
  id: string;
  courseware_id: string;
  student_id: string;
  status: string;
  score: number | null;
  completion: number | null;
  extra_json: string | null;
  comment: string | null;
  courseware_name: string | null;
  courseware_uuid: string | null;
}

function loadAttempt(db: SqliteLike, attemptId: string): AttemptRow | null {
  try {
    const row = db
      .prepare(
        `SELECT a.id, a.courseware_id, a.student_id, a.status,
                r.score, r.completion, r.extra_json, r.comment,
                cw.name AS courseware_name, cw.uuid AS courseware_uuid
         FROM courseware_attempt a
         JOIN courseware cw ON a.courseware_id = cw.id
         LEFT JOIN submission_result r ON a.id = r.attempt_id
         WHERE a.id = ?`,
      )
      .get(attemptId) as AttemptRow | undefined;
    return row ?? null;
  } catch (e) {
    return null;
  }
}

export interface PromoteOptions {
  lessonId: string;
  classId: string;
  /** 完成度门槛（0~1）。不满足则拒绝录入。 */
  minCompletion?: number;
  /** 记入学期成绩时写入的反馈说明前缀，用于区分「自动」与「教师手动」 */
  sourceLabel?: string;
  /** 强制忽略完成度门槛（手动录入时教师已自行判断） */
  ignoreMinCompletion?: boolean;
  /**
   * 成绩来源（migration 013 的 assignment_submissions.source 列）：
   * - 'manual'（默认）：教师录入/改判，落库后受自动规则保护（auto 路径遇 manual 行跳过）；
   * - 'auto'：规则自动录入，遇 manual/缺考行跳过，auto 行按 strategy 刷新。
   */
  source?: 'manual' | 'auto';
  /**
   * 自动录入的分数更新策略（仅 source='auto' 时生效）：
   * - 'latest'（默认）：取最新 attempt 分数覆盖；
   * - 'highest'：仅新分高于已录分数才覆盖（鼓励重做）。
   */
  strategy?: 'latest' | 'highest';
  /**
   * 忽略「必须已完成」的状态校验。
   * 仅供**手动**录入使用：教师显式点「录入成绩」本身就是判断，不应被规则收窄能力
   * （历史上教师可以对 SAVE_PROGRESS 中途的 attempt 手工录入）。
   * 自动路径永远不设此选项 —— 规则只自动化「确定性足够」的记录。
   */
  ignoreNotFinished?: boolean;
}

/**
 * 把一条 attempt 的成绩写入学期成绩（assignment_submissions）。
 * 手动按钮与自动规则共用此实现，保证两条路径的落库口径完全一致。
 */
export function promoteAttemptToGrade(db: SqliteLike, attemptId: string, options: PromoteOptions): PromoteResult {
  const { lessonId, classId } = options;
  if (!lessonId || !classId) {
    return { ok: false, reason: 'attempt-not-found' };
  }

  const attempt = loadAttempt(db, attemptId);
  if (!attempt) return { ok: false, reason: 'attempt-not-found' };

  if (
    !options.ignoreNotFinished &&
    !FINISHED_ATTEMPT_STATUSES.includes(attempt.status as (typeof FINISHED_ATTEMPT_STATUSES)[number])
  ) {
    return { ok: false, reason: 'not-finished', studentId: attempt.student_id };
  }
  if (PLACEHOLDER_STUDENT_IDS.has(attempt.student_id)) {
    return { ok: false, reason: 'placeholder-student', studentId: attempt.student_id };
  }

  // 铁律 1：没有聚合分就不录
  const finalScore = normalizePercentScore(attempt.score);
  if (finalScore === null) {
    return { ok: false, reason: 'missing-score', studentId: attempt.student_id };
  }

  const completion = Number.isFinite(attempt.completion as number) ? (attempt.completion as number) : 0;
  const minCompletion = options.ignoreMinCompletion ? 0 : (options.minCompletion ?? 0);
  if (completion < minCompletion) {
    return {
      ok: false,
      reason: 'below-min-completion',
      score: finalScore,
      studentId: attempt.student_id,
    };
  }

  const coursewareName = attempt.courseware_name || '互动课件';
  const assignmentTitle = `互动课件: ${coursewareName}`;
  const now = Date.now();
  const sourceLabel = options.sourceLabel ?? '教师在课堂中保存录入';
  const source = options.source ?? 'manual';
  const strategy = options.strategy ?? 'latest';

  type RunOutcome = { assignmentId?: string; skipReason?: PromoteResult['reason'] };

  const run = (): RunOutcome => {
    // 自动路径守卫：先查已有成绩行（经 assignments 的课节/班级/课件标题定位，无需建行）
    if (source === 'auto') {
      const existing = db
        .prepare(
          `SELECT s.score, s.status, s.source FROM assignment_submissions s
           JOIN assignments a ON a.id = s.assignment_id
           WHERE a.class_id = ? AND a.lesson_id = ? AND a.title = ? AND s.student_id = ?
           LIMIT 1`,
        )
        .get(classId, lessonId, assignmentTitle, attempt.student_id) as
        | { score: number | null; status: string | null; source: string | null }
        | undefined;
      if (existing) {
        // 教师标记的缺考行受保护（自动规则不覆盖；教师改判走手动路径显式覆盖）。
        // 注意缺考行（含考勤联动生成）的 source 也是 'manual'，必须先于 source 判定。
        if (existing.status === 'absent') return { skipReason: 'absent-protected' };
        // 教师手动录入/改判的分数受保护，自动规则绝不覆盖（否则手改分会被课件分冲掉）
        if (existing.source === 'manual') return { skipReason: 'manual-protected' };
        // highest 策略：仅新分更高才覆盖（无已录分数视为可覆盖）
        if (
          strategy === 'highest' &&
          existing.score !== null &&
          existing.score !== undefined &&
          finalScore <= existing.score
        ) {
          return { skipReason: 'not-higher' };
        }
      }
    }

    const assignmentId = findOrCreateCoursewareAssignment(
      db,
      classId,
      lessonId,
      coursewareName,
      JSON.stringify({ type: 'interactive_courseware', attemptId, coursewareUuid: attempt.courseware_uuid }),
      now,
    );

    // 幂等：同一 assignment + student 只保留一行，重跑即覆盖（source 随本次写入刷新）
    db.prepare(
      `INSERT INTO assignment_submissions (assignment_id, student_id, content, score, feedback, submitted_at, graded_at, status, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'graded', ?)
       ON CONFLICT(assignment_id, student_id) DO UPDATE SET
         content = excluded.content,
         score = excluded.score,
         feedback = excluded.feedback,
         submitted_at = excluded.submitted_at,
         graded_at = excluded.graded_at,
         status = 'graded',
         source = excluded.source`,
    ).run(
      assignmentId,
      attempt.student_id,
      attempt.extra_json || '{}',
      finalScore,
      `由${sourceLabel}。课件完成度: ${Math.round(completion * 100)}%。课件原始反馈: ${attempt.comment || '—'}`,
      now,
      now,
      source,
    );

    db.prepare(
      `INSERT INTO student_lesson_progress (student_id, lesson_id, completed, progress_percent, completed_segments, assigned_at)
       VALUES (?, ?, 1, 100, '[]', ?)
       ON CONFLICT(student_id, lesson_id) DO UPDATE SET
         completed = 1,
         progress_percent = 100`,
    ).run(attempt.student_id, lessonId, now);

    return { assignmentId };
  };

  // better-sqlite3 风格的 transaction；非事务环境（Worker RPC 代理）直接执行。
  // 必须以 db.transaction(run)() 调用：解构出 transaction 再调会丢失 this 绑定。
  const outcome: RunOutcome =
    typeof (db as any).transaction === 'function' ? (db as any).transaction(run)() : run();

  // 跳过时整体不落库（含 student_lesson_progress 不推进），
  // 避免「分数被保护但进度被自动置 100」的不一致。
  if (outcome.skipReason) {
    return {
      ok: false,
      reason: outcome.skipReason,
      score: finalScore,
      studentId: attempt.student_id,
    };
  }

  return {
    ok: true,
    score: finalScore,
    assignmentId: outcome.assignmentId,
    studentId: attempt.student_id,
    coursewareName,
  };
}

/** 教师把学生标记为缺考的结果 */
export interface MarkAbsentResult {
  ok: boolean;
  /** 失败原因：课件不存在 / 学生不在该班级 */
  reason?: 'courseware-not-found' | 'student-not-in-class';
  studentId?: string;
  coursewareName?: string;
}

/**
 * 教师手动标记缺考：写一行 status='absent'、score=NULL、source='manual' 的成绩。
 * source='manual' 使其受自动规则保护 —— 学生之后补交课件也不会冲掉缺考标记；
 * 教师改判（允许该生成绩）走手动「录入成绩」路径显式覆盖。
 */
export function markStudentAbsent(
  db: SqliteLike,
  options: { lessonId: string; classId: string; studentId: string; coursewareId: string },
): MarkAbsentResult {
  const { lessonId, classId, studentId, coursewareId } = options;
  if (!lessonId || !classId || !studentId || !coursewareId) {
    return { ok: false, reason: 'courseware-not-found' };
  }
  if (PLACEHOLDER_STUDENT_IDS.has(studentId)) {
    return { ok: false, reason: 'student-not-in-class', studentId };
  }

  let coursewareName: string | null = null;
  try {
    const cw = db.prepare('SELECT name FROM courseware WHERE id = ?').get(coursewareId) as
      | { name: string }
      | undefined;
    coursewareName = cw?.name ?? null;
  } catch {
    coursewareName = null;
  }
  if (!coursewareName) {
    return { ok: false, reason: 'courseware-not-found', studentId };
  }

  try {
    const inClass = db
      .prepare('SELECT 1 AS hit FROM class_students WHERE class_id = ? AND student_id = ?')
      .get(classId, studentId);
    if (!inClass) {
      return { ok: false, reason: 'student-not-in-class', studentId, coursewareName };
    }
  } catch {
    return { ok: false, reason: 'student-not-in-class', studentId, coursewareName };
  }

  const run = (): void => {
    const now = Date.now();
    const assignmentId = findOrCreateCoursewareAssignment(db, classId, lessonId, coursewareName as string, '{}', now);
    // 幂等：重复标记只更新同一行；教师重复点击不会产生重复成绩
    db.prepare(
      `INSERT INTO assignment_submissions (assignment_id, student_id, content, score, feedback, submitted_at, graded_at, status, source)
       VALUES (?, ?, '{}', NULL, ?, ?, ?, 'absent', 'manual')
       ON CONFLICT(assignment_id, student_id) DO UPDATE SET
         score = excluded.score,
         feedback = excluded.feedback,
         graded_at = excluded.graded_at,
         status = 'absent',
         source = 'manual'`,
    ).run(assignmentId, studentId, '教师标记缺考（无分数，学期结算按 0 分计）', now, now);
  };
  if (typeof (db as any).transaction === 'function') (db as any).transaction(run)();
  else run();

  return { ok: true, studentId, coursewareName };
}

function randomHex(bytes: number): string {
  // Phase B3: 改用 crypto 随机源（Math.random 可预测，生成的 assignment 主键
  // 存在枚举/伪造风险）。Node 与 Worker 两侧均可用 node:crypto。
  return crypto.randomBytes(bytes).toString('hex');
}

/** 查找或创建「互动课件: {name}」作业壳行（自动录入与缺考标记共用同一套作业定位口径） */
function findOrCreateCoursewareAssignment(
  db: SqliteLike,
  classId: string,
  lessonId: string,
  coursewareName: string,
  content: string,
  createdAt: number,
): string {
  const title = `互动课件: ${coursewareName}`;
  const existing = db
    .prepare('SELECT id FROM assignments WHERE class_id = ? AND lesson_id = ? AND title = ?')
    .get(classId, lessonId, title) as { id: string } | undefined;
  if (existing?.id) return existing.id;
  const id = 'ast-cw-' + randomHex(8);
  db.prepare(
    'INSERT INTO assignments (id, class_id, lesson_id, title, description, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    classId,
    lessonId,
    title,
    `来自互动课件 [${coursewareName}] 的随堂学习提交数据记录`,
    content,
    createdAt,
  );
  return id;
}

// ---------------------------------------------------------------------------
// 规则引擎
// ---------------------------------------------------------------------------

export interface AutoRecordDecision {
  /** 规则是否命中（开关 + 门槛都满足） */
  shouldRecord: boolean;
  rule: CoursewareScoreConfig;
  /** 规则来源，便于 UI 告诉教师「这个规则来自全局默认还是课件专属」 */
  ruleSource: 'courseware' | 'global' | 'builtin';
  reason?: PromoteResult['reason'];
}

/**
 * 判定某条 attempt 是否应自动录入。
 * 纯判定，不落库 —— 便于单测，也便于批量补录时先筛选再执行。
 */
export function evaluateAutoRecord(db: SqliteLike, attemptId: string): AutoRecordDecision {
  const attempt = loadAttempt(db, attemptId);
  const resolved = resolveScoreConfig(db, attempt?.courseware_id ?? null);
  const rule = resolved.config;

  if (!attempt) {
    return { shouldRecord: false, rule, ruleSource: resolved.source, reason: 'attempt-not-found' };
  }
  if (!rule.auto_record_enabled) {
    return { shouldRecord: false, rule, ruleSource: resolved.source, reason: 'rule-disabled' };
  }
  if (!FINISHED_ATTEMPT_STATUSES.includes(attempt.status as (typeof FINISHED_ATTEMPT_STATUSES)[number])) {
    return { shouldRecord: false, rule, ruleSource: resolved.source, reason: 'not-finished' };
  }
  if (PLACEHOLDER_STUDENT_IDS.has(attempt.student_id)) {
    return { shouldRecord: false, rule, ruleSource: resolved.source, reason: 'placeholder-student' };
  }
  if (normalizePercentScore(attempt.score) === null) {
    return { shouldRecord: false, rule, ruleSource: resolved.source, reason: 'missing-score' };
  }
  const completion = Number.isFinite(attempt.completion as number) ? (attempt.completion as number) : 0;
  if (completion < rule.auto_record_min_completion) {
    return { shouldRecord: false, rule, ruleSource: resolved.source, reason: 'below-min-completion' };
  }

  return { shouldRecord: true, rule, ruleSource: resolved.source };
}

/** 按规则自动录入单条 attempt */
export function autoRecordAttempt(
  db: SqliteLike,
  attemptId: string,
  context: { lessonId: string; classId: string },
): PromoteResult & { ruleSource?: AutoRecordDecision['ruleSource'] } {
  const decision = evaluateAutoRecord(db, attemptId);
  if (!decision.shouldRecord) {
    return { ok: false, reason: decision.reason, ruleSource: decision.ruleSource };
  }
  const result = promoteAttemptToGrade(db, attemptId, {
    lessonId: context.lessonId,
    classId: context.classId,
    minCompletion: decision.rule.auto_record_min_completion,
    sourceLabel: '自动录入规则',
    source: 'auto',
    strategy: decision.rule.auto_record_strategy,
  });
  return { ...result, ruleSource: decision.ruleSource };
}

export interface AutoRecordReport {
  /** 实际录入条数 */
  recorded: number;
  /** 因规则/数据原因未录入的条数 */
  skipped: number;
  /** 明细：attemptId / studentName / coursewareName / 分数 / 未录原因 */
  details: Array<{
    attemptId: string;
    studentId: string;
    studentName: string;
    coursewareName: string;
    score: number | null;
    recorded: boolean;
    reason?: PromoteResult['reason'];
  }>;
  /** 考勤联动：为本课节缺考且无成绩行的学生自动生成的缺考成绩行数 */
  absentGenerated?: number;
}

/**
 * 批量补录：把某个课节 + 班级下已提交的 attempt 按规则补录/刷新。
 *
 * 来源判定（migration 013）：manual 行与缺考行跳过（受保护）；
 * auto 行按配置策略刷新 —— 'latest' 取最新 attempt 分覆盖，'highest' 仅更高才覆盖。
 * 同一 (学生, 课件) 的多条 attempt 只处理最新一条。
 */
export function autoRecordForLesson(
  db: SqliteLike,
  context: { lessonId: string; classId: string; limit?: number },
): AutoRecordReport {
  const { lessonId, classId } = context;
  const limit = Math.max(1, Math.min(context.limit ?? 1000, 5000));

  let rows: any[] = [];
  try {
    rows = db
      .prepare(
        `SELECT a.id AS attempt_id, a.student_id, cw.id AS courseware_id, cw.name AS courseware_name,
                r.score, r.completion
         FROM courseware_attempt a
         JOIN courseware cw ON a.courseware_id = cw.id
         JOIN class_students cst ON cst.student_id = a.student_id AND cst.class_id = ?
         LEFT JOIN submission_result r ON r.attempt_id = a.id
         WHERE a.status IN ('completed', 'submitted', 'finished')
           AND a.student_id NOT IN ('guest', 'teacher', 'teacher_preview', '')
         ORDER BY a.finished_at DESC, a.started_at DESC
         LIMIT ?`,
      )
      .all(classId, limit) as any[];
  } catch (e) {
    return { recorded: 0, skipped: 0, details: [] };
  }

  const report: AutoRecordReport = { recorded: 0, skipped: 0, details: [] };

  // 同一 (学生, 课件) 只补录最新一条 attempt：latest 策略刷新为最新分，
  // highest 策略也只应与最新 attempt 比较（旧行已按 finished_at DESC 排序，首个即最新）。
  const seenPairs = new Set<string>();
  const dedupedRows = rows.filter((row) => {
    const key = `${row.student_id}::${row.courseware_name ?? ''}`;
    if (seenPairs.has(key)) return false;
    seenPairs.add(key);
    return true;
  });

  // 学生姓名：仅用于报告可读性，查询失败不阻断录入。
  // 注意 students 表没有 class_id 列，必须经 class_students 关联（本项目的老坑）。
  const studentNames = new Map<string, string>();
  try {
    const nameRows = db
      .prepare(
        `SELECT cst.student_id, s.name
         FROM class_students cst
         JOIN students s ON s.id = cst.student_id
         WHERE cst.class_id = ?`,
      )
      .all(classId) as any[];
    for (const r of nameRows) studentNames.set(r.student_id, r.name);
  } catch {
    /* 名单查询失败不阻断 */
  }

  for (const row of dedupedRows) {
    const attemptId = String(row.attempt_id);
    const studentId = String(row.student_id);
    const coursewareName = String(row.courseware_name ?? '互动课件');

    // 已有成绩行时按状态/来源判定：缺考行与手动行受保护（缺考行 source 也是
    // 'manual'，故先判 status）；auto 行不再硬跳过 —— latest 策略需要刷新为最新分。
    const existingGrade = getRecordedGrade(db, classId, lessonId, coursewareName, studentId);
    if (existingGrade?.status === 'absent') {
      report.skipped += 1;
      report.details.push({
        attemptId,
        studentId,
        studentName: studentNames.get(studentId) ?? studentId,
        coursewareName,
        score: normalizePercentScore(row.score),
        recorded: false,
        reason: 'absent-protected',
      });
      continue;
    }
    if (existingGrade?.source === 'manual') {
      report.skipped += 1;
      report.details.push({
        attemptId,
        studentId,
        studentName: studentNames.get(studentId) ?? studentId,
        coursewareName,
        score: normalizePercentScore(row.score),
        recorded: false,
        reason: 'manual-protected',
      });
      continue;
    }

    const result = autoRecordAttempt(db, attemptId, { lessonId, classId });
    if (result.ok) {
      report.recorded += 1;
    } else {
      report.skipped += 1;
    }
    report.details.push({
      attemptId,
      studentId,
      studentName: studentNames.get(studentId) ?? studentId,
      coursewareName,
      score: result.score ?? normalizePercentScore(row.score),
      recorded: result.ok,
      reason: result.reason,
    });
  }

  // 考勤联动：把本课节缺考且无成绩行的学生生成为缺考成绩行（见 generateAttendanceAbsentRows）
  const involvedCoursewares = new Map<string, string>();
  for (const row of dedupedRows) {
    if (row.courseware_id && !involvedCoursewares.has(String(row.courseware_name ?? ''))) {
      involvedCoursewares.set(String(row.courseware_name ?? ''), String(row.courseware_id));
    }
  }
  generateAttendanceAbsentRows(
    db,
    classId,
    lessonId,
    Array.from(involvedCoursewares, ([name, id]) => ({ id, name })),
    studentNames,
    report,
  );

  return report;
}

/**
 * 考勤联动：对本批涉及的每个课件，把本课节考勤为缺考（attendance.status='absent'）
 * 且没有任何成绩行的学生生成为缺考成绩行（status='absent'、score=NULL、source='manual'）。
 *
 * source='manual' 使缺考标记受自动规则保护 —— 学生之后补交课件不会冲掉标记；
 * 教师改判走手动「录入成绩」路径显式覆盖。缺席行计入 report.absentGenerated。
 */
function generateAttendanceAbsentRows(
  db: SqliteLike,
  classId: string,
  lessonId: string,
  involvedCoursewares: Array<{ id: string; name: string }>,
  studentNames: Map<string, string>,
  report: AutoRecordReport,
): void {
  if (involvedCoursewares.length === 0) return;
  let absentStudents: Array<{ student_id: string }>;
  try {
    absentStudents = db
      .prepare(
        `SELECT DISTINCT cs.student_id
         FROM schedules s
         JOIN attendance att ON att.schedule_id = s.id
         JOIN class_students cs ON cs.class_id = s.class_id AND cs.student_id = att.student_id
         WHERE s.class_id = ? AND s.lesson_id = ? AND att.status = 'absent'`,
      )
      .all(classId, lessonId) as Array<{ student_id: string }>;
  } catch (e) {
    // schedules/attendance 表缺失（老库未建考勤数据）时静默跳过，不阻断补录
    return;
  }
  if (absentStudents.length === 0) return;

  const now = Date.now();
  let generated = 0;
  for (const cw of involvedCoursewares) {
    for (const { student_id: studentId } of absentStudents) {
      if (getRecordedGrade(db, classId, lessonId, cw.name, studentId)) continue;
      try {
        const assignmentId = findOrCreateCoursewareAssignment(db, classId, lessonId, cw.name, '{}', now);
        db.prepare(
          `INSERT INTO assignment_submissions (assignment_id, student_id, content, score, feedback, submitted_at, graded_at, status, source)
           VALUES (?, ?, '{}', NULL, ?, ?, ?, 'absent', 'manual')`,
        ).run(assignmentId, studentId, '由考勤缺考记录自动生成（教师改判请手动录入覆盖）', now, now);
        generated += 1;
        report.details.push({
          attemptId: `absent:${cw.id}:${studentId}`,
          studentId,
          studentName: studentNames.get(studentId) ?? studentId,
          coursewareName: cw.name,
          score: null,
          recorded: true,
        });
      } catch (e) {
        // 单行生成失败不阻断其余缺考行
      }
    }
  }
  if (generated > 0) report.absentGenerated = (report.absentGenerated ?? 0) + generated;
}

/** 该（课节, 班级, 课件, 学生）的已有成绩行（含来源/状态，供自动路径守卫判定；无则 null） */
function getRecordedGrade(
  db: SqliteLike,
  classId: string,
  lessonId: string,
  coursewareName: string,
  studentId: string,
): { score: number | null; status: string | null; source: string | null } | null {
  try {
    const row = db
      .prepare(
        `SELECT s.score, s.status, s.source FROM assignment_submissions s
         JOIN assignments a ON a.id = s.assignment_id
         WHERE a.class_id = ? AND a.lesson_id = ? AND a.title = ? AND s.student_id = ?
         LIMIT 1`,
      )
      .get(classId, lessonId, `互动课件: ${coursewareName}`, studentId) as
      | { score: number | null; status: string | null; source: string | null }
      | undefined;
    return row ?? null;
  } catch (e) {
    return null;
  }
}

/** 未录入原因的中文说明。服务端与前端共用同一份文案，避免解释不一致。 */
export const PROMOTE_REASON_TEXT: Record<NonNullable<PromoteResult['reason']>, string> = {
  'attempt-not-found': '提交记录不存在',
  'not-finished': '该提交尚未完成（进行中），无法录入学期成绩',
  'placeholder-student': '访客/教师预览记录，不记入学生成绩',
  'missing-score': '该提交没有可用分数，不自动录入（避免凭空记分）',
  'below-min-completion': '完成度未达到规则设定的门槛',
  'rule-disabled': '自动录入规则未开启',
  'already-recorded': '已录入学期成绩，无需重复录入',
  'manual-protected': '教师已手动录入/调整过该分数，自动规则不覆盖',
  'absent-protected': '该生已被标记缺考，自动规则不覆盖（教师改判请走手动录入）',
  'not-higher': '本次分数未高于已录分数（最高分策略），保持原分',
};

export function describePromoteReason(reason: PromoteResult['reason'] | undefined): string {
  if (!reason) return '未知原因';
  return PROMOTE_REASON_TEXT[reason] ?? '未知原因';
}

/**
 * 反查某个学生当前正在上的课节（用于学生提交时触发实时自动录入）。
 *
 * 刻意不让前端上报 lessonId：服务端从「班级 + 正在进行的课堂会话」推导，
 * 避免伪造/错配。上课之外查不到会话 → 返回 null → 不触发实时录入，
 * 由教师打开「学生提交数据」页时的补录兜底。
 */
export function findActiveLessonForStudent(
  db: SqliteLike,
  studentId: string,
): { lessonId: string; classId: string } | null {
  try {
    const row = db
      .prepare(
        `SELECT cs.lesson_id, cs.class_id
         FROM classroom_sessions cs
         JOIN class_students cst ON cst.class_id = cs.class_id
         WHERE cst.student_id = ?
           AND cs.stage = 'IN_CLASS_TEACHING'
         ORDER BY cs.created_at DESC
         LIMIT 1`,
      )
      .get(studentId) as { lesson_id: string; class_id: string } | undefined;
    if (!row?.lesson_id || !row?.class_id) return null;
    return { lessonId: row.lesson_id, classId: row.class_id };
  } catch (e) {
    return null;
  }
}
