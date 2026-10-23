/**
 * 成绩写入的唯一入口（P1 审计修复）。
 *
 * 所有会改 `assignment_submissions.score` 的路径都必须经过这里：
 *   - 教师手动录入 / 改判（courseware promote、学期成绩页、management 插件）
 *   - 课件自动录入与考勤缺考（auto-record-score）
 *   - AI 批改（ai.apply_grade）
 *   - 插件成绩投影（assignment-eval / SemesterGradeService）
 *
 * 统一保证三件事：
 *   1. **手动分保护**：自动/AI 写入不得覆盖教师手动分、插件确认分与缺考标记；
 *      只有显式 `overrideProtected`（已鉴权的教师操作）才能越过。
 *   2. **审计留痕**：分数/状态/来源真正变化时写一行 `assignment_grade_history`，
 *      记录旧值、新值、操作者与原因。
 *   3. **口径一致**：分数取整并限定 0~100；缺考之外不允许空分。
 */
import crypto from 'node:crypto';

export type GradeSource = 'manual' | 'auto' | 'ai' | 'plugin' | 'system';

/** 自动写入来源：默认受手动分/缺考保护约束。 */
const AUTOMATED_SOURCES: ReadonlySet<string> = new Set(['auto', 'ai', 'system']);

export interface GradeWriteDb {
  prepare(sql: string): {
    get(...params: any[]): any;
    all(...params: any[]): any[];
    run(...params: any[]): any;
  };
  transaction?: (fn: () => void) => () => void;
}

export interface GradeWriteInput {
  assignmentId: string;
  studentId: string;
  score: number | string | null;
  status?: string;
  feedback?: string | null;
  content?: string | null;
  submittedAt?: number | null;
  gradedAt?: number | null;
  source: GradeSource;
  actorId?: string | null;
  actorRole?: string | null;
  reason?: string | null;
  academicYear?: string | null;
  /** 越过「手动分/缺考」保护。仅限已鉴权的教师显式操作，自动路径必须保持 false。 */
  overrideProtected?: boolean;
  /** false 时只更新已存在的成绩行（默认 true：不存在则创建）。 */
  createIfMissing?: boolean;
}

export type GradeWriteReason =
  | 'assignment-not-found'
  | 'submission-not-found'
  | 'manual-protected'
  | 'absent-protected'
  | 'invalid-score'
  | 'invalid-target';

export interface GradeWriteResult {
  ok: boolean;
  reason?: GradeWriteReason;
  assignmentId: string;
  studentId: string;
  historyId?: string;
  /** 分数/状态/来源是否真正发生变化（false 表示幂等刷新） */
  changed?: boolean;
  oldScore?: number | null;
  newScore?: number | null;
}

interface ExistingGradeRow {
  score: number | null;
  feedback: string | null;
  status: string | null;
  source: string | null;
  academic_year: string | null;
}

/** 解析 `user:<id>:<role>` 的 role 部分；系统/Agent actor 返回 null。 */
export function gradeActorRole(actorId?: string | null): string | null {
  const match = /^user:[^:]+:(administrator|admin|teacher|student)$/.exec(String(actorId ?? ''));
  return match ? match[1] : null;
}

/** 教师/管理员等特权操作者：允许显式越过手动分保护。 */
export function isPrivilegedGradeActor(actorId?: string | null): boolean {
  const role = gradeActorRole(actorId);
  return role === 'teacher' || role === 'administrator' || role === 'admin';
}

function parseScore(raw: number | string | null | undefined): { ok: true; value: number | null } | { ok: false } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === 'string' && raw.trim() === '') return { ok: false };
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num)) return { ok: false };
  const rounded = Math.round(num);
  if (rounded < 0 || rounded > 100) return { ok: false };
  return { ok: true, value: rounded };
}

const UPSERT_SUBMISSION = `
  INSERT INTO assignment_submissions
    (assignment_id, student_id, content, score, feedback, submitted_at, graded_at, status, source, academic_year, graded_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(assignment_id, student_id) DO UPDATE SET
    content = COALESCE(excluded.content, assignment_submissions.content),
    score = excluded.score,
    feedback = COALESCE(excluded.feedback, assignment_submissions.feedback),
    submitted_at = COALESCE(assignment_submissions.submitted_at, excluded.submitted_at),
    graded_at = COALESCE(excluded.graded_at, assignment_submissions.graded_at),
    status = excluded.status,
    source = excluded.source,
    academic_year = COALESCE(excluded.academic_year, assignment_submissions.academic_year),
    graded_by = COALESCE(excluded.graded_by, assignment_submissions.graded_by)
`;

const INSERT_HISTORY = `
  INSERT INTO assignment_grade_history
    (id, assignment_id, student_id, old_score, new_score, old_status, new_status,
     old_source, new_source, actor_id, actor_role, reason, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/**
 * 写入一条成绩并记录审计历史。
 *
 * 保护规则（`overrideProtected` 为 false 时）：
 *   - 任何非 manual 来源（auto/ai/system/plugin）改判已存在的缺考行 → absent-protected；
 *   - 非 manual 来源遇到 manual/plugin/历史 NULL 的已出分行 → manual-protected；
 *   - 同来源刷新（ai→ai、plugin→plugin）与对自动分（auto）的覆盖不受此限。
 * 只有教师/管理员显式操作（`overrideProtected`）才能越过缺考与手动分。
 */
export function applyGradeChange(db: GradeWriteDb, input: GradeWriteInput): GradeWriteResult {
  const assignmentId = String(input.assignmentId ?? '').trim();
  const studentId = String(input.studentId ?? '').trim();
  if (!assignmentId || !studentId) {
    return { ok: false, reason: 'invalid-target', assignmentId, studentId };
  }

  const parsed = parseScore(input.score);
  if (!parsed.ok) {
    return { ok: false, reason: 'invalid-score', assignmentId, studentId };
  }
  const newScore = parsed.value;
  const newStatus = input.status ?? (newScore === null ? 'absent' : 'graded');
  if (newScore === null && newStatus !== 'absent') {
    return { ok: false, reason: 'invalid-score', assignmentId, studentId };
  }

  const now = input.gradedAt ?? Date.now();
  const submittedAt = input.submittedAt ?? now;
  const createIfMissing = input.createIfMissing !== false;
  const automatedIncoming = AUTOMATED_SOURCES.has(input.source);
  // 自动写入之外，「插件确认分」同样不得静默覆盖教师手动分；只有 manual（教师直接操作）
  // 天然是改判，或显式 overrideProtected 才放行。
  const protectedIncoming = input.source !== 'manual';
  const actorId = input.actorId ?? (automatedIncoming ? 'system' : null);
  const actorRole = input.actorRole ?? gradeActorRole(actorId) ?? (actorId === 'system' ? 'system' : null);

  let result: GradeWriteResult = { ok: false, reason: 'invalid-target', assignmentId, studentId };

  const write = () => {
    const existing = db
      .prepare(
        `SELECT score, feedback, status, source, academic_year
         FROM assignment_submissions
         WHERE assignment_id = ? AND student_id = ?
         LIMIT 1`,
      )
      .get(assignmentId, studentId) as ExistingGradeRow | undefined;

    if (!existing && !createIfMissing) {
      result = { ok: false, reason: 'submission-not-found', assignmentId, studentId };
      return;
    }

    if (existing && !input.overrideProtected && protectedIncoming) {
      if (existing.status === 'absent' && newStatus !== 'absent') {
        result = { ok: false, reason: 'absent-protected', assignmentId, studentId, oldScore: existing.score };
        return;
      }
      // 只有「已出分」的行才受手动分保护：学生刚提交（status='submitted'、
      // score=NULL）的行必须允许 AI/自动批改，否则正常批改流程会被自身的保护挡住。
      const existingHasGrade = existing.status === 'graded' || existing.status === 'absent' || existing.score !== null;
      // manual / plugin / 历史 NULL 都视为「人工确认过」；同来源刷新（plugin→plugin）
      // 与机器来源（auto/ai/system）之间的覆盖不受此限。
      const existingProtected =
        existing.source === null || existing.source === 'manual' || existing.source === 'plugin';
      if (existingHasGrade && existingProtected && existing.source !== input.source) {
        result = { ok: false, reason: 'manual-protected', assignmentId, studentId, oldScore: existing.score };
        return;
      }
    }

    const assignment = db.prepare('SELECT academic_year FROM assignments WHERE id = ?').get(assignmentId) as
      { academic_year: string | null } | undefined;
    if (!existing && !assignment) {
      result = { ok: false, reason: 'assignment-not-found', assignmentId, studentId };
      return;
    }

    const academicYear = input.academicYear ?? existing?.academic_year ?? assignment?.academic_year ?? null;
    const gradedBy = actorId ?? null;

    db.prepare(UPSERT_SUBMISSION).run(
      assignmentId,
      studentId,
      input.content ?? null,
      newScore,
      input.feedback ?? null,
      submittedAt,
      now,
      newStatus,
      input.source,
      academicYear,
      gradedBy,
    );

    const oldScore = existing?.score ?? null;
    const oldStatus = existing?.status ?? null;
    const oldSource = existing?.source ?? null;
    const scoreChanged = newScore === null ? oldScore !== null : oldScore === null || Number(oldScore) !== newScore;
    const changed = !existing || scoreChanged || oldStatus !== newStatus || oldSource !== input.source;

    let historyId: string | undefined;
    if (changed) {
      historyId = `agh-${crypto.randomUUID()}`;
      db.prepare(INSERT_HISTORY).run(
        historyId,
        assignmentId,
        studentId,
        oldScore,
        newScore,
        oldStatus,
        newStatus,
        oldSource,
        input.source,
        actorId,
        actorRole,
        input.reason ?? null,
        now,
      );
    }

    result = {
      ok: true,
      assignmentId,
      studentId,
      historyId,
      changed,
      oldScore,
      newScore,
    };
  };

  const tx = typeof db.transaction === 'function' ? db.transaction(write) : null;
  if (typeof tx === 'function') tx();
  else write();

  return result;
}
