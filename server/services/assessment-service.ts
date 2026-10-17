/**
 * 测评服务（Issue #100 / 子 issue #120）。
 *
 * 只做业务编排与 SQL；判分、快照、匿名、时间窗、序列化的规则全部来自
 * `packages/core/assessment`（前后端同源），这里不重复实现任何判分逻辑。
 *
 * 不变量：
 * - 标准答案只在服务端流转，对外一律走 `serialize.ts` 的白名单视图；
 * - 判分幂等，`manual_override = 1` 的作答行永不被自动判分覆盖；
 * - 超时用惰性结算（每次读 attempt 前结算），不依赖后台定时器；
 * - 匿名问卷的 `student_id` 为 NULL，`anon_key` 不对外。
 */
import type Database from 'better-sqlite3';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import {
  aggregateScores,
  anonymousLabel,
  buildItemSnapshot,
  canStudentSeeAnalysis,
  canStudentSeeScore,
  computeDeadline,
  deriveAnonKey,
  gradeAttempt,
  isAssessmentEditable,
  nextAssessmentStatus,
  parseAssessmentSettings,
  readWindowState,
  remainingSeconds,
  roundScore,
  serializeAssessmentSettings,
  settleAttempt,
  toPercent,
  toStudentItemView,
  toTeacherItemView,
  toStudentAttemptView,
  toTeacherAttemptView,
  validateItemSnapshot,
  type AssessmentItemRecord,
  type AssessmentKind,
  type AssessmentSettings,
  type AssessmentStatus,
  type AttemptStatus,
  type QuestionTypeRegistry,
} from '../../packages/core/assessment/index.js';
import { getEncryptionKey } from '../../packages/core/di/api-key-crypto.js';
import { getCurrentAcademicYear, normalizeAcademicYear } from '../utils/academic-year.js';
import { randomId } from '../utils/id.js';
import { assessmentGraderRegistry } from './assessment-grader-registry.js';

/* ────────────────────────────── 错误类型 ────────────────────────────── */

export class AssessmentError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'AssessmentError';
    this.status = status;
  }
}

const notFound = (what: string) => new AssessmentError(404, `${what} not found`);
const badRequest = (msg: string) => new AssessmentError(400, msg);
const conflict = (msg: string) => new AssessmentError(409, msg);
const forbidden = (msg: string) => new AssessmentError(403, msg);

/* ────────────────────────────── 行类型 ────────────────────────────── */

interface AssessmentRow {
  id: string;
  kind: AssessmentKind;
  title: string;
  description: string | null;
  owner_id: string;
  settings_json: string;
  status: AssessmentStatus;
  academic_year: string | null;
  published_at: number | null;
  created_at: number;
  updated_at: number;
}

interface ItemRow {
  id: string;
  assessment_id: string;
  bank_item_id: string | null;
  section: string | null;
  sort_order: number;
  type: string;
  stem: string;
  config_json: string;
  answer_key_json: string | null;
  max_score: number;
}

interface AssignmentRow {
  id: string;
  assessment_id: string;
  class_id: string;
  lesson_id: string | null;
  schedule_id: string | null;
  session_id: string | null;
  opens_at: number | null;
  closes_at: number | null;
  duration_sec: number | null;
  exam_id: string | null;
  academic_year: string | null;
  status: 'open' | 'closed';
  score_released: number;
  created_by: string | null;
  created_at: number;
}

interface AttemptRow {
  id: string;
  assignment_id: string;
  student_id: string | null;
  anon_key: string | null;
  attempt_no: number;
  status: AttemptStatus;
  started_at: number;
  submitted_at: number | null;
  deadline_at: number | null;
  score: number | null;
  max_score: number | null;
  needs_manual_review: number;
  proctor_json: string;
  academic_year: string | null;
}

interface AnswerRow {
  attempt_id: string;
  item_id: string;
  answer_json: string | null;
  score: number | null;
  max_score: number | null;
  is_correct: number | null;
  grader: string | null;
  feedback: string | null;
  graded_by: string | null;
  graded_at: number | null;
  manual_override: number;
  updated_at: number;
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toItemRecord(row: ItemRow): AssessmentItemRecord {
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    bankItemId: row.bank_item_id,
    section: row.section,
    sortOrder: row.sort_order,
    type: row.type,
    stem: row.stem,
    config: safeJsonParse<Record<string, unknown>>(row.config_json, {}),
    answerKey: safeJsonParse<unknown>(row.answer_key_json, null),
    maxScore: row.max_score,
  };
}

/** 导出时文本作答截断长度（CSV 里塞整篇论述没有意义，也会撑爆单元格）。 */
const EXPORT_TEXT_LIMIT = 500;

export interface AssessmentServiceOptions {
  db?: Database.Database;
  /** 时间源（测试注入） */
  now?: () => number;
  /** 匿名问卷 HMAC 密钥（默认复用 ENCRYPTION_KEY） */
  anonSecret?: () => string;
  /** 题型注册表（测试可注入） */
  registry?: QuestionTypeRegistry;
}

export class AssessmentService {
  private readonly db: Database.Database;
  private readonly now: () => number;
  private readonly anonSecret: () => string;
  private readonly registry: QuestionTypeRegistry;

  constructor(options: AssessmentServiceOptions = {}) {
    this.db = options.db ?? (kernelContainer.db as unknown as Database.Database);
    this.now = options.now ?? (() => Date.now());
    this.anonSecret = options.anonSecret ?? (() => getEncryptionKey().toString('hex'));
    this.registry = options.registry ?? assessmentGraderRegistry.underlying;
  }

  /* ───────────────────────── 试卷（教师） ───────────────────────── */

  listAssessments(ownerId: string, filter: { kind?: string; status?: string } = {}) {
    const conditions = ['owner_id = ?'];
    const params: unknown[] = [ownerId];
    if (filter.kind) {
      conditions.push('kind = ?');
      params.push(filter.kind);
    }
    if (filter.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    const rows = this.db
      .prepare(`SELECT * FROM assessments WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC`)
      .all(...params) as AssessmentRow[];
    return rows.map((row) => this.toSummary(row));
  }

  getAssessment(id: string, ownerId?: string) {
    const row = this.db.prepare('SELECT * FROM assessments WHERE id = ?').get(id) as AssessmentRow | undefined;
    if (!row) throw notFound('assessment');
    if (ownerId !== undefined && row.owner_id !== ownerId) throw forbidden('not the assessment owner');
    const items = this.readItems(id);
    return {
      ...this.toSummary(row),
      settings: parseAssessmentSettings(row.kind, safeJsonParse(row.settings_json, {})),
      items: items.map(toTeacherItemView),
    };
  }

  createAssessment(input: {
    ownerId: string;
    kind: AssessmentKind;
    title: string;
    description?: string | null;
    settings?: unknown;
    academicYear?: string | null;
  }) {
    if (!['quiz', 'exam', 'survey'].includes(input.kind)) throw badRequest('kind must be quiz | exam | survey');
    if (!input.title?.trim()) throw badRequest('title is required');
    const now = this.now();
    const id = randomId();
    const settings = parseAssessmentSettings(input.kind, input.settings);
    this.db
      .prepare(
        `INSERT INTO assessments (id, kind, title, description, owner_id, settings_json, status, academic_year, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
      )
      .run(
        id,
        input.kind,
        input.title.trim(),
        input.description ?? null,
        input.ownerId,
        serializeAssessmentSettings(settings),
        normalizeAcademicYear(input.academicYear) ?? getCurrentAcademicYear(),
        now,
        now,
      );
    return this.getAssessment(id);
  }

  updateAssessment(
    id: string,
    ownerId: string,
    patch: { title?: string; description?: string | null; settings?: unknown; academicYear?: string | null },
  ) {
    const row = this.requireOwnedAssessment(id, ownerId);
    if (!isAssessmentEditable(row.status)) throw conflict(`assessment is ${row.status}; only draft is editable`);
    const settings = patch.settings === undefined ? undefined : parseAssessmentSettings(row.kind, patch.settings);
    this.db
      .prepare(
        `UPDATE assessments SET
           title = COALESCE(?, title),
           description = COALESCE(?, description),
           settings_json = COALESCE(?, settings_json),
           academic_year = COALESCE(?, academic_year),
           updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.title?.trim() || null,
        patch.description === undefined ? null : patch.description,
        settings ? serializeAssessmentSettings(settings) : null,
        patch.academicYear === undefined ? null : normalizeAcademicYear(patch.academicYear),
        this.now(),
        id,
      );
    return this.getAssessment(id, ownerId);
  }

  deleteAssessment(id: string, ownerId: string): void {
    const row = this.requireOwnedAssessment(id, ownerId);
    if (row.status !== 'draft') throw conflict('only draft assessments can be deleted');
    this.db.prepare('DELETE FROM assessments WHERE id = ?').run(id);
  }

  /**
   * 整卷覆盖（组卷即快照）：每次调用都把 items 视为试卷的完整内容。
   * 只有草稿可改；每道题都会先在 core 层校验题型 / 配置 / 答案格式。
   */
  replaceItems(assessmentId: string, ownerId: string, items: unknown[]) {
    const row = this.requireOwnedAssessment(assessmentId, ownerId);
    if (!isAssessmentEditable(row.status)) throw conflict(`assessment is ${row.status}; only draft is editable`);
    if (!Array.isArray(items)) throw badRequest('items must be an array');

    const snapshots: AssessmentItemRecord[] = items.map((raw, index) => {
      const input = (raw ?? {}) as Record<string, any>;
      const candidate = {
        id: typeof input.id === 'string' && input.id.trim() ? input.id : randomId(),
        assessmentId,
        bankItemId: typeof input.bankItemId === 'string' ? input.bankItemId : null,
        section: typeof input.section === 'string' ? input.section : null,
        sortOrder: Number.isInteger(input.sortOrder) ? input.sortOrder : index,
        type: String(input.type ?? ''),
        stem: String(input.stem ?? ''),
        config: (input.config ?? {}) as Record<string, unknown>,
        answerKey: input.answerKey ?? null,
        maxScore: typeof input.maxScore === 'number' ? input.maxScore : Number(input.maxScore ?? 1),
      };
      const error = validateItemSnapshot(this.registry, candidate);
      if (error) throw badRequest(`items[${index}]：${error}`);
      return buildItemSnapshot(candidate);
    });

    const now = this.now();
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM assessment_items WHERE assessment_id = ?').run(assessmentId);
      const insert = this.db.prepare(
        `INSERT INTO assessment_items
           (id, assessment_id, bank_item_id, section, sort_order, type, stem, config_json, answer_key_json, max_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const item of snapshots) {
        insert.run(
          item.id,
          assessmentId,
          item.bankItemId,
          item.section,
          item.sortOrder,
          item.type,
          item.stem,
          JSON.stringify(item.config ?? {}),
          item.answerKey === null || item.answerKey === undefined ? null : JSON.stringify(item.answerKey),
          item.maxScore,
        );
      }
      this.db.prepare('UPDATE assessments SET updated_at = ? WHERE id = ?').run(now, assessmentId);
    });
    tx();
    return this.getAssessment(assessmentId, ownerId);
  }

  /** 发布到班级（可重复发布到多个班级；每次生成一条 assignment）。 */
  publish(
    assessmentId: string,
    ownerId: string,
    input: {
      classId: string;
      lessonId?: string | null;
      scheduleId?: string | null;
      opensAt?: number | null;
      closesAt?: number | null;
      durationSec?: number | null;
      academicYear?: string | null;
      createdBy: string;
    },
  ) {
    const row = this.requireOwnedAssessment(assessmentId, ownerId);
    const items = this.readItems(assessmentId);
    if (items.length === 0) throw conflict('cannot publish an assessment without items');
    if (row.status === 'archived') throw conflict('archived assessment cannot be published');
    if (!input.classId) throw badRequest('classId is required');
    if (input.opensAt && input.closesAt && input.opensAt >= input.closesAt) {
      throw badRequest('opensAt must be earlier than closesAt');
    }

    const now = this.now();
    const assignmentId = randomId();
    const targetStatus = nextAssessmentStatus(row.status, 'publish');
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO assessment_assignments
             (id, assessment_id, class_id, lesson_id, schedule_id, opens_at, closes_at, duration_sec,
              academic_year, status, score_released, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 0, ?, ?)`,
        )
        .run(
          assignmentId,
          assessmentId,
          input.classId,
          input.lessonId ?? null,
          input.scheduleId ?? null,
          input.opensAt ?? null,
          input.closesAt ?? null,
          input.durationSec ?? null,
          normalizeAcademicYear(input.academicYear) ?? row.academic_year ?? getCurrentAcademicYear(),
          input.createdBy,
          now,
        );
      if (targetStatus) {
        this.db
          .prepare(
            'UPDATE assessments SET status = ?, published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ?',
          )
          .run(targetStatus, now, now, assessmentId);
      }
    });
    tx();
    return this.getAssignment(assignmentId);
  }

  closeAssignment(assignmentId: string, ownerId: string) {
    const asg = this.requireOwnedAssignment(assignmentId, ownerId);
    this.db.prepare("UPDATE assessment_assignments SET status = 'closed' WHERE id = ?").run(asg.id);
    // 关闭时把所有作答中的尝试结算掉，避免"关闭了还能交卷"
    const now = this.now();
    const inProgress = this.db
      .prepare("SELECT * FROM assessment_attempts WHERE assignment_id = ? AND status = 'in_progress'")
      .all(asg.id) as AttemptRow[];
    for (const attempt of inProgress) {
      this.finalizeAttempt(attempt, now, { forced: true });
    }
    return this.getAssignment(asg.id);
  }

  releaseScores(assignmentId: string, ownerId: string) {
    const asg = this.requireOwnedAssignment(assignmentId, ownerId);
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE assessment_assignments SET score_released = 1 WHERE id = ?').run(asg.id);
      this.db
        .prepare(
          "UPDATE assessment_attempts SET status = 'released' WHERE assignment_id = ? AND status IN ('submitted','graded')",
        )
        .run(asg.id);
    });
    tx();
    return this.getAssignment(asg.id);
  }

  /* ───────────────────────── 题库（教师） ───────────────────────── */

  listBankItems(ownerId: string, filter: { type?: string } = {}) {
    const params: unknown[] = [ownerId];
    let sql = 'SELECT * FROM question_bank_items WHERE owner_id = ?';
    if (filter.type) {
      sql += ' AND type = ?';
      params.push(filter.type);
    }
    sql += ' ORDER BY updated_at DESC';
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, any>>;
    return rows.map((row) => this.toBankItemView(row));
  }

  createBankItem(input: {
    ownerId: string;
    type: string;
    stem: string;
    config?: unknown;
    answerKey?: unknown;
    tags?: string[];
    difficulty?: number | null;
    maxScore?: number;
  }) {
    const error = validateItemSnapshot(this.registry, {
      type: input.type,
      stem: input.stem,
      config: (input.config ?? {}) as Record<string, unknown>,
      answerKey: input.answerKey ?? null,
      maxScore: typeof input.maxScore === 'number' ? input.maxScore : 1,
    });
    if (error) throw badRequest(error);
    const now = this.now();
    const id = randomId();
    this.db
      .prepare(
        `INSERT INTO question_bank_items
           (id, owner_id, type, stem, config_json, answer_key_json, tags_json, difficulty, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.ownerId,
        input.type,
        input.stem,
        JSON.stringify(input.config ?? {}),
        input.answerKey === undefined || input.answerKey === null ? null : JSON.stringify(input.answerKey),
        JSON.stringify(Array.isArray(input.tags) ? input.tags : []),
        input.difficulty ?? null,
        now,
        now,
      );
    return this.getBankItem(id, input.ownerId);
  }

  getBankItem(id: string, ownerId: string) {
    const row = this.db.prepare('SELECT * FROM question_bank_items WHERE id = ?').get(id) as
      Record<string, any> | undefined;
    if (!row) throw notFound('bank item');
    if (row.owner_id !== ownerId) throw forbidden('not the bank item owner');
    return this.toBankItemView(row);
  }

  deleteBankItem(id: string, ownerId: string): void {
    this.getBankItem(id, ownerId); // 鉴权
    this.db.prepare('DELETE FROM question_bank_items WHERE id = ?').run(id);
  }

  /* ───────────────────────── 学生端：列表 / 开始 / 保存 / 交卷 ───────────────────────── */

  /** 学生在「我的测评」里看到的布置列表（已按讨论结论排序）。 */
  listStudentAssignments(studentId: string, classIds: string[]) {
    if (classIds.length === 0) return [];
    const placeholders = classIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT aa.*, a.kind, a.title, a.settings_json
           FROM assessment_assignments aa
           JOIN assessments a ON a.id = aa.assessment_id
          WHERE aa.class_id IN (${placeholders})
            AND a.status IN ('published','closed')
          ORDER BY aa.created_at DESC`,
      )
      .all(...classIds) as Array<AssignmentRow & { kind: AssessmentKind; title: string; settings_json: string }>;

    const now = this.now();
    const result = rows.map((row) => {
      const settings = parseAssessmentSettings(row.kind, safeJsonParse(row.settings_json, {}));
      const attempt = settings.anonymous
        ? this.findAttemptByIdentity(row.id, null, this.anonKeyFor(row.id, studentId))
        : this.findAttemptByIdentity(row.id, studentId, null);
      const settled = attempt ? this.settleIfExpired(attempt, now) : null;
      const completed = Boolean(settled && settled.status !== 'in_progress');
      return {
        assignmentId: row.id,
        assessmentId: row.assessment_id,
        kind: row.kind,
        title: row.title,
        classId: row.class_id,
        lessonId: row.lesson_id,
        opensAt: row.opens_at,
        closesAt: row.closes_at,
        durationSec: row.duration_sec,
        windowState:
          row.status === 'closed'
            ? 'after_close'
            : readWindowState(
                this.windowOf({
                  opensAt: row.opens_at,
                  closesAt: row.closes_at,
                  durationSec: row.duration_sec,
                }),
                now,
              ),
        completed,
        attempt: settled
          ? toStudentAttemptView(this.toAttemptViewRow(settled), now, {
              visibility: settings.resultVisibility,
              scoreReleased: Boolean(row.score_released),
              submitted: settled.status !== 'in_progress',
              remaining: remainingSeconds(settled.deadline_at, now),
            })
          : null,
      };
    });

    return result.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (!a.completed) {
        if (a.closesAt === null && b.closesAt === null) return 0;
        if (a.closesAt === null) return 1;
        if (b.closesAt === null) return -1;
        return a.closesAt - b.closesAt;
      }
      return (b.attempt?.submittedAt ?? 0) - (a.attempt?.submittedAt ?? 0);
    });
  }

  private anonKeyFor(assignmentId: string, studentId: string): string {
    return deriveAnonKey(this.anonSecret(), assignmentId, studentId);
  }

  /** 开始（或续答）一次作答。已超时的旧尝试会先被结算掉。 */
  startAttempt(assignmentId: string, studentId: string) {
    const asg = this.getAssignment(assignmentId);
    const assessment = this.db.prepare('SELECT * FROM assessments WHERE id = ?').get(asg.assessmentId) as
      AssessmentRow | undefined;
    if (!assessment) throw notFound('assessment');
    if (asg.status === 'closed') throw conflict('assignment is closed');
    const settings = parseAssessmentSettings(assessment.kind, safeJsonParse(assessment.settings_json, {}));

    const now = this.now();
    const windowState = readWindowState(this.windowOf(asg), now);
    if (windowState === 'before_open') throw conflict('assessment has not opened yet');
    if (windowState === 'after_close') throw conflict('assessment is closed for submission');

    const isAnonymous = settings.anonymous;
    const anonKey = isAnonymous ? this.anonKeyFor(assignmentId, studentId) : null;

    const existing = isAnonymous
      ? this.findAttemptByIdentity(assignmentId, null, anonKey)
      : this.findAttemptByIdentity(assignmentId, studentId, null);

    if (existing) {
      const settled = this.settleIfExpired(existing, now);
      if (settled.status === 'in_progress') {
        return this.buildAttemptPayload(settled, assessment, asg, settings, { newAttempt: false });
      }
      // 已有已交卷的尝试：允许再次作答仅当未达上限。
      // 注意：匿名问卷的身份是 anonKey，不能把 studentId 传给统计（attempt 行里是 NULL）。
      const used = this.countAttempts(assignmentId, isAnonymous ? null : studentId, anonKey);
      if (used >= settings.maxAttempts) throw conflict('no attempts left for this assessment');
    }

    const attemptNo = this.countAttempts(assignmentId, isAnonymous ? null : studentId, anonKey) + 1;
    const deadlineAt = computeDeadline(this.windowOf(asg), now);
    const id = randomId();
    this.db
      .prepare(
        `INSERT INTO assessment_attempts
           (id, assignment_id, student_id, anon_key, attempt_no, status, started_at, deadline_at, academic_year)
         VALUES (?, ?, ?, ?, ?, 'in_progress', ?, ?, ?)`,
      )
      .run(
        id,
        assignmentId,
        isAnonymous ? null : studentId,
        anonKey,
        attemptNo,
        now,
        deadlineAt,
        asg.academicYear ?? assessment.academic_year,
      );
    const row = this.requireAttempt(id);
    return this.buildAttemptPayload(row, assessment, asg, settings, { newAttempt: true });
  }

  /** 自动保存单题作答（不判分，判分在交卷时统一做）。 */
  saveAnswer(attemptId: string, studentId: string, itemId: string, answer: unknown) {
    const attempt = this.requireAttemptForStudent(attemptId, studentId);
    const settled = this.settleIfExpired(attempt, this.now());
    if (settled.status !== 'in_progress') throw conflict('attempt already submitted');

    const items = this.readItems(this.assignmentAssessmentId(settled.assignment_id));
    const item = items.find((i) => i.id === itemId);
    if (!item) throw notFound('item');
    const definition = this.registry.get(item.type);
    const validationError = definition?.validateAnswer?.(item.config, answer);
    if (validationError) throw badRequest(`作答格式非法：${validationError}`);

    this.db
      .prepare(
        `INSERT INTO assessment_answers (attempt_id, item_id, answer_json, max_score, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(attempt_id, item_id) DO UPDATE SET
           answer_json = excluded.answer_json,
           updated_at = excluded.updated_at`,
      )
      .run(attemptId, itemId, answer === undefined ? null : JSON.stringify(answer), item.maxScore, this.now());
    return { ok: true, itemId, savedAt: this.now() };
  }

  /** 交卷：惰性结算 + 自动判分（幂等，manual_override 行不覆盖）。 */
  submitAttempt(attemptId: string, studentId: string, options: { forceSubmit?: boolean } = {}) {
    const attempt = this.requireAttemptForStudent(attemptId, studentId);
    if (attempt.status === 'in_progress') {
      this.finalizeAttempt(attempt, this.now(), { forced: Boolean(options.forceSubmit) });
    }
    const fresh = this.requireAttempt(attemptId);
    return this.buildResultPayload(fresh);
  }

  /** 学生看结果（按 resultVisibility / showItemAnalysis 决定能看多少）。 */
  getAttemptResult(attemptId: string, studentId: string) {
    const attempt = this.requireAttemptForStudent(attemptId, studentId);
    const settled = this.settleIfExpired(attempt, this.now());
    return this.buildResultPayload(settled);
  }

  /* ───────────────────────── 教师：批改 / 统计 / 导出 ───────────────────────── */

  listAttempts(assignmentId: string, ownerId: string) {
    this.requireOwnedAssignment(assignmentId, ownerId);
    const rows = this.db
      .prepare('SELECT * FROM assessment_attempts WHERE assignment_id = ? ORDER BY started_at ASC')
      .all(assignmentId) as AttemptRow[];
    const now = this.now();
    const ordered: Array<{ row: AttemptRow; label: string | null }> = rows.map((row, index) => {
      const settled = this.settleIfExpired(row, now);
      return { row: settled, label: row.student_id === null ? anonymousLabel(row.anon_key ?? '', index) : null };
    });
    return ordered.map(({ row, label }) =>
      toTeacherAttemptView(this.toAttemptViewRow(row), { revealIdentity: false, anonymousLabel: label }),
    );
  }

  /** 教师手动批改单题。写入 `manual_override = 1`，此后自动判分不再覆盖。 */
  manualGrade(
    attemptId: string,
    ownerId: string,
    itemId: string,
    input: { score: number; feedback?: string | null; gradedBy: string },
  ) {
    const attempt = this.requireAttempt(attemptId);
    this.requireOwnedAssignment(attempt.assignment_id, ownerId);
    if (attempt.status === 'in_progress') throw conflict('attempt is still in progress');
    const items = this.readItems(this.assignmentAssessmentId(attempt.assignment_id));
    const item = items.find((i) => i.id === itemId);
    if (!item) throw notFound('item');
    if (
      typeof input.score !== 'number' ||
      !Number.isFinite(input.score) ||
      input.score < 0 ||
      input.score > item.maxScore
    ) {
      throw badRequest(`score must be between 0 and ${item.maxScore}`);
    }
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO assessment_answers
           (attempt_id, item_id, answer_json, score, max_score, is_correct, grader, feedback, graded_by, graded_at, manual_override, updated_at)
         VALUES (?, ?, (SELECT answer_json FROM assessment_answers WHERE attempt_id = ? AND item_id = ?), ?, ?, NULL, 'manual', ?, ?, ?, 1, ?)
         ON CONFLICT(attempt_id, item_id) DO UPDATE SET
           score = excluded.score,
           max_score = excluded.max_score,
           grader = 'manual',
           feedback = excluded.feedback,
           graded_by = excluded.graded_by,
           graded_at = excluded.graded_at,
           manual_override = 1,
           updated_at = excluded.updated_at`,
      )
      .run(
        attemptId,
        itemId,
        attemptId,
        itemId,
        roundScore(input.score),
        item.maxScore,
        input.feedback ?? null,
        input.gradedBy,
        now,
        now,
      );
    this.recomputeAttemptTotals(attemptId, now);
    const fresh = this.requireAttempt(attemptId);
    return { attempt: toTeacherAttemptView(this.toAttemptViewRow(fresh), { revealIdentity: false }) };
  }

  /** 重新判分（教师手动改过的题跳过）。 */
  regradeAttempt(attemptId: string, ownerId: string) {
    const attempt = this.requireAttempt(attemptId);
    this.requireOwnedAssignment(attempt.assignment_id, ownerId);
    if (attempt.status === 'in_progress') throw conflict('attempt is still in progress');
    this.regrade(attempt, this.now());
    const fresh = this.requireAttempt(attemptId);
    return { attempt: toTeacherAttemptView(this.toAttemptViewRow(fresh), { revealIdentity: false }) };
  }

  stats(assignmentId: string, ownerId: string) {
    const asg = this.requireOwnedAssignment(assignmentId, ownerId);
    const items = this.readItems(asg.assessmentId);
    const rows = this.db
      .prepare('SELECT * FROM assessment_attempts WHERE assignment_id = ?')
      .all(assignmentId) as AttemptRow[];
    const now = this.now();
    const settledRows = rows.map((r) => this.settleIfExpired(r, now));
    const submitted = settledRows.filter((r) => r.status !== 'in_progress');
    const scored = submitted.filter((r) => typeof r.score === 'number');

    const itemStats = items
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => {
        const answers = this.db
          .prepare(
            'SELECT * FROM assessment_answers WHERE item_id = ? AND attempt_id IN (SELECT id FROM assessment_attempts WHERE assignment_id = ?)',
          )
          .all(item.id, assignmentId) as AnswerRow[];
        const graded = answers.filter((a) => typeof a.score === 'number');
        const correct = answers.filter((a) => a.is_correct === 1);
        const distribution: Record<string, number> = {};
        for (const answer of answers) {
          const parsed = safeJsonParse<unknown>(answer.answer_json, null);
          const key = Array.isArray(parsed) ? parsed.join(',') : String(parsed);
          distribution[key] = (distribution[key] ?? 0) + 1;
        }
        return {
          itemId: item.id,
          type: item.type,
          stem: item.stem,
          maxScore: item.maxScore,
          answered: answers.length,
          graded: graded.length,
          correct: correct.length,
          correctRate: graded.length > 0 ? roundScore((correct.length / graded.length) * 100) : null,
          avgScore:
            graded.length > 0 ? roundScore(graded.reduce((s, a) => s + (a.score as number), 0) / graded.length) : null,
          distribution,
        };
      });

    const totalScore = scored.reduce((s, r) => s + (r.score as number), 0);
    return {
      assignmentId,
      assessmentId: asg.assessmentId,
      attemptCount: settledRows.length,
      submittedCount: submitted.length,
      gradedCount: scored.length,
      needsManualReviewCount: submitted.filter((r) => r.needs_manual_review === 1).length,
      averageScore: scored.length > 0 ? roundScore(totalScore / scored.length) : null,
      averagePercent: scored.length > 0 ? toPercent(totalScore / scored.length, scored[0].max_score) : null,
      maxScore: items.reduce((s, i) => s + i.maxScore, 0),
      items: itemStats,
    };
  }

  /**
   * 导出 CSV。
   *
   * 匿名问卷：不导出 `student_id` / `anon_key`，只用稳定编号（`匿名 3`）。
   * 文本作答截断到 {@link EXPORT_TEXT_LIMIT} 字符，避免 CSV 单元格被整篇作文撑爆。
   */
  exportCsv(assignmentId: string, ownerId: string): { filename: string; csv: string } {
    const asg = this.requireOwnedAssignment(assignmentId, ownerId);
    const assessment = this.db.prepare('SELECT * FROM assessments WHERE id = ?').get(asg.assessmentId) as AssessmentRow;
    const settings = parseAssessmentSettings(assessment.kind, safeJsonParse(assessment.settings_json, {}));
    const items = this.readItems(asg.assessmentId).sort((a, b) => a.sortOrder - b.sortOrder);
    const attempts = this.db
      .prepare('SELECT * FROM assessment_attempts WHERE assignment_id = ? ORDER BY started_at ASC')
      .all(assignmentId) as AttemptRow[];
    const now = this.now();

    const header = [
      '身份',
      '状态',
      '开考时间',
      '交卷时间',
      '得分',
      '满分',
      '是否待人工批改',
      ...items.map((item, index) => `Q${index + 1}(${item.maxScore}分)`),
    ];
    const lines = [header.map(csvCell).join(',')];

    attempts.forEach((raw, index) => {
      const row = this.settleIfExpired(raw, now);
      const identity = row.student_id === null ? anonymousLabel(row.anon_key ?? '', index) : row.student_id;
      const answerCells = items.map((item) => {
        const answerRow = this.db
          .prepare('SELECT * FROM assessment_answers WHERE attempt_id = ? AND item_id = ?')
          .get(row.id, item.id) as AnswerRow | undefined;
        if (!answerRow) return '';
        const parsed = safeJsonParse<unknown>(answerRow.answer_json, null);
        const text = Array.isArray(parsed) ? parsed.map((v) => String(v)).join(' | ') : String(parsed ?? '');
        // 未批改的题把分数留空，避免导出里出现"0 分"误导
        const scorePart = answerRow.score === null ? '' : ` [${answerRow.score}]`;
        const clipped = text.length > EXPORT_TEXT_LIMIT ? `${text.slice(0, EXPORT_TEXT_LIMIT)}…` : text;
        return `${clipped}${scorePart}`;
      });
      lines.push(
        [
          identity,
          row.status,
          new Date(row.started_at).toISOString(),
          row.submitted_at ? new Date(row.submitted_at).toISOString() : '',
          row.score === null ? '' : String(row.score),
          row.max_score === null ? '' : String(row.max_score),
          row.needs_manual_review === 1 ? 'yes' : 'no',
          ...answerCells,
        ]
          .map(csvCell)
          .join(','),
      );
    });

    const kindLabel = settings.anonymous ? 'survey-anonymous' : assessment.kind;
    return { filename: `assessment-${assignmentId}-${kindLabel}.csv`, csv: `${lines.join('\n')}\n` };
  }

  /**
   * 管理员反查匿名作答对应的学生（学生申诉 / 刷票调查用）。
   * 调用方必须是管理员，且**必须**写审计日志（route 层负责）。
   */
  revealAnonymousIdentity(attemptId: string, actorId: string): { attemptId: string; studentId: string } {
    const attempt = this.requireAttempt(attemptId);
    if (attempt.anon_key === null) throw badRequest('attempt is not anonymous');
    const asg = this.getAssignment(attempt.assignment_id);
    // 用候选人重算 anon_key 比对：服务端不存"key → student"的反向映射
    const classStudents = this.db
      .prepare('SELECT student_id FROM class_students WHERE class_id = ?')
      .all(asg.classId) as Array<{ student_id: string }>;
    for (const { student_id } of classStudents) {
      if (this.anonKeyFor(attempt.assignment_id, student_id) === attempt.anon_key) {
        void actorId;
        return { attemptId, studentId: student_id };
      }
    }
    throw notFound('matching student for anonymous attempt');
  }

  /* ───────────────────────── 内部实现 ───────────────────────── */

  private windowOf(row: { opensAt: number | null; closesAt: number | null; durationSec: number | null }) {
    return { opensAt: row.opensAt, closesAt: row.closesAt, durationSec: row.durationSec };
  }

  private requireOwnedAssessment(id: string, ownerId: string): AssessmentRow {
    const row = this.db.prepare('SELECT * FROM assessments WHERE id = ?').get(id) as AssessmentRow | undefined;
    if (!row) throw notFound('assessment');
    if (row.owner_id !== ownerId) throw forbidden('not the assessment owner');
    return row;
  }

  private requireOwnedAssignment(id: string, ownerId: string): AssignmentView {
    const asg = this.getAssignment(id);
    const assessment = this.db.prepare('SELECT owner_id FROM assessments WHERE id = ?').get(asg.assessmentId) as
      { owner_id: string } | undefined;
    if (!assessment) throw notFound('assessment');
    if (assessment.owner_id !== ownerId) throw forbidden('not the assessment owner');
    return asg;
  }

  private requireAttempt(id: string): AttemptRow {
    const row = this.db.prepare('SELECT * FROM assessment_attempts WHERE id = ?').get(id) as AttemptRow | undefined;
    if (!row) throw notFound('attempt');
    return row;
  }

  private requireAttemptForStudent(attemptId: string, studentId: string): AttemptRow {
    const row = this.requireAttempt(attemptId);
    if (row.student_id === null) {
      // 匿名：只能由能复现 anon_key 的学生本人访问
      const expected = this.anonKeyFor(row.assignment_id, studentId);
      if (row.anon_key !== expected) throw forbidden('not your attempt');
      return row;
    }
    if (row.student_id !== studentId) throw forbidden('not your attempt');
    return row;
  }

  private toSummary(row: AssessmentRow) {
    const items = this.readItems(row.id);
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      description: row.description,
      status: row.status,
      academicYear: row.academic_year,
      settings: parseAssessmentSettings(row.kind, safeJsonParse(row.settings_json, {})),
      itemCount: items.length,
      totalScore: roundScore(items.reduce((s, i) => s + i.maxScore, 0)),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private readItems(assessmentId: string): AssessmentItemRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM assessment_items WHERE assessment_id = ? ORDER BY sort_order ASC')
      .all(assessmentId) as ItemRow[];
    return rows.map(toItemRecord);
  }

  private toBankItemView(row: Record<string, any>) {
    return {
      id: row.id,
      type: row.type,
      stem: row.stem,
      config: safeJsonParse(row.config_json, {}),
      answerKey: safeJsonParse(row.answer_key_json, null),
      tags: safeJsonParse<string[]>(row.tags_json, []),
      difficulty: row.difficulty ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** 布置详情（公开：学生开始作答前需要知道 classId 以做成员校验）。 */
  getAssignment(id: string): AssignmentView {
    const row = this.db.prepare('SELECT * FROM assessment_assignments WHERE id = ?').get(id) as
      AssignmentRow | undefined;
    if (!row) throw notFound('assignment');
    return {
      id: row.id,
      assessmentId: row.assessment_id,
      classId: row.class_id,
      lessonId: row.lesson_id,
      scheduleId: row.schedule_id,
      sessionId: row.session_id,
      opensAt: row.opens_at,
      closesAt: row.closes_at,
      durationSec: row.duration_sec,
      examId: row.exam_id,
      academicYear: row.academic_year,
      status: row.status,
      scoreReleased: Boolean(row.score_released),
      createdBy: row.created_by,
      createdAt: row.created_at,
    };
  }

  private assignmentAssessmentId(assignmentId: string): string {
    const row = this.db.prepare('SELECT assessment_id FROM assessment_assignments WHERE id = ?').get(assignmentId) as
      { assessment_id: string } | undefined;
    if (!row) throw notFound('assignment');
    return row.assessment_id;
  }

  private findAttemptByIdentity(
    assignmentId: string,
    studentId: string | null,
    anonKey: string | null,
  ): AttemptRow | null {
    if (studentId !== null) {
      const row = this.db
        .prepare(
          'SELECT * FROM assessment_attempts WHERE assignment_id = ? AND student_id = ? ORDER BY attempt_no DESC LIMIT 1',
        )
        .get(assignmentId, studentId) as AttemptRow | undefined;
      return row ?? null;
    }
    if (anonKey !== null) {
      const row = this.db
        .prepare(
          'SELECT * FROM assessment_attempts WHERE assignment_id = ? AND anon_key = ? ORDER BY attempt_no DESC LIMIT 1',
        )
        .get(assignmentId, anonKey) as AttemptRow | undefined;
      return row ?? null;
    }
    return null;
  }

  private countAttempts(assignmentId: string, studentId: string | null, anonKey: string | null): number {
    const row =
      studentId !== null
        ? (this.db
            .prepare('SELECT COUNT(*) AS n FROM assessment_attempts WHERE assignment_id = ? AND student_id = ?')
            .get(assignmentId, studentId) as { n: number })
        : (this.db
            .prepare('SELECT COUNT(*) AS n FROM assessment_attempts WHERE assignment_id = ? AND anon_key = ?')
            .get(assignmentId, anonKey ?? '') as { n: number });
    return row?.n ?? 0;
  }

  private toAttemptViewRow(row: AttemptRow) {
    return {
      id: row.id,
      assignmentId: row.assignment_id,
      studentId: row.student_id,
      anonKey: row.anon_key,
      attemptNo: row.attempt_no,
      status: row.status,
      startedAt: row.started_at,
      submittedAt: row.submitted_at,
      deadlineAt: row.deadline_at,
      score: row.score,
      maxScore: row.max_score,
      needsManualReview: row.needs_manual_review === 1,
      proctor: safeJsonParse(row.proctor_json, {}),
    };
  }

  /** 惰性结算：过期未交卷的尝试在这里落成 submitted（并立即判分）。 */
  private settleIfExpired(row: AttemptRow, now: number): AttemptRow {
    const outcome = settleAttempt(
      { status: row.status, deadlineAt: row.deadline_at, submittedAt: row.submitted_at },
      now,
    );
    if (!outcome.shouldSettle) return row;
    this.finalizeAttempt(row, now, { forced: false });
    return this.requireAttempt(row.id);
  }

  /** 结算判分：写回逐题结果 + 尝试汇总。重复调用幂等。 */
  private finalizeAttempt(attempt: AttemptRow, now: number, options: { forced: boolean }): void {
    const deadline = attempt.deadline_at;
    const timedOut = deadline !== null && now > deadline;
    const submittedAt = options.forced ? now : timedOut ? deadline : now;
    this.regrade(attempt, now, submittedAt);
  }

  /** 重新判分：跳过 `manual_override = 1` 的行（教师手改的分不被覆盖）。 */
  private regrade(attempt: AttemptRow, now: number, submittedAt?: number): void {
    const assessmentId = this.assignmentAssessmentId(attempt.assignment_id);
    const assessment = this.db.prepare('SELECT * FROM assessments WHERE id = ?').get(assessmentId) as AssessmentRow;
    const settings = parseAssessmentSettings(assessment.kind, safeJsonParse(assessment.settings_json, {}));
    const items = this.readItems(assessmentId);

    const answerRows = this.db
      .prepare('SELECT * FROM assessment_answers WHERE attempt_id = ?')
      .all(attempt.id) as AnswerRow[];
    const answers: Record<string, unknown> = {};
    for (const row of answerRows) answers[row.item_id] = safeJsonParse<unknown>(row.answer_json, null);

    const summary = gradeAttempt(this.registry, items, answers, {
      assessmentId,
      attemptId: attempt.id,
      studentId: attempt.student_id,
      assessmentKind: assessment.kind,
      partialCredit: settings.partialCredit,
      caseSensitive: settings.caseSensitive,
    });

    const upsert = this.db.prepare(
      `INSERT INTO assessment_answers
         (attempt_id, item_id, answer_json, score, max_score, is_correct, grader, feedback, graded_at, manual_override, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(attempt_id, item_id) DO UPDATE SET
         score = excluded.score,
         max_score = excluded.max_score,
         is_correct = excluded.is_correct,
         grader = excluded.grader,
         feedback = excluded.feedback,
         graded_at = excluded.graded_at,
         updated_at = excluded.updated_at
       WHERE assessment_answers.manual_override = 0`,
    );

    const tx = this.db.transaction(() => {
      for (const { itemId, result } of summary.items) {
        const item = items.find((i) => i.id === itemId);
        if (!item) continue;
        upsert.run(
          attempt.id,
          itemId,
          answers[itemId] === undefined ? null : JSON.stringify(answers[itemId]),
          result.score,
          item.maxScore,
          result.isCorrect === undefined || result.isCorrect === null ? null : result.isCorrect ? 1 : 0,
          result.score === null ? null : 'auto',
          result.feedback ?? null,
          result.score === null ? null : now,
          now,
        );
      }
      this.recomputeAttemptTotals(attempt.id, now, submittedAt);
    });
    tx();
  }

  /** 重算 attempt 的 score / maxScore / needsManualReview（以 answers 表为准，单一口径）。 */
  private recomputeAttemptTotals(attemptId: string, now: number, submittedAt?: number): void {
    const rows = this.db.prepare('SELECT * FROM assessment_answers WHERE attempt_id = ?').all(attemptId) as AnswerRow[];
    const attempt = this.requireAttempt(attemptId);
    const assessmentId = this.assignmentAssessmentId(attempt.assignment_id);
    const items = this.readItems(assessmentId);

    let score = 0;
    let needsManualReview = false;
    for (const item of items) {
      const row = rows.find((r) => r.item_id === item.id);
      if (!row || row.score === null) {
        needsManualReview = true;
        continue;
      }
      score += row.score;
    }
    const maxScore = items.reduce((s, i) => s + i.maxScore, 0);
    const status: AttemptStatus = needsManualReview ? 'submitted' : 'graded';
    this.db
      .prepare(
        `UPDATE assessment_attempts
            SET score = ?, max_score = ?, needs_manual_review = ?, status = ?,
                submitted_at = COALESCE(submitted_at, ?)
          WHERE id = ?`,
      )
      .run(roundScore(score), roundScore(maxScore), needsManualReview ? 1 : 0, status, submittedAt ?? now, attemptId);
  }

  private buildAttemptPayload(
    attempt: AttemptRow,
    assessment: AssessmentRow,
    asg: {
      id: string;
      opensAt: number | null;
      closesAt: number | null;
      durationSec: number | null;
      scoreReleased: boolean;
    },
    settings: AssessmentSettings,
    meta: { newAttempt: boolean },
  ) {
    const items = this.readItems(assessment.id);
    const answerRows = this.db
      .prepare('SELECT * FROM assessment_answers WHERE attempt_id = ?')
      .all(attempt.id) as AnswerRow[];
    const answers: Record<string, unknown> = {};
    for (const row of answerRows) answers[row.item_id] = safeJsonParse<unknown>(row.answer_json, null);

    const now = this.now();
    return {
      newAttempt: meta.newAttempt,
      assignment: {
        id: asg.id,
        assessmentId: assessment.id,
        kind: assessment.kind,
        title: assessment.title,
        description: assessment.description,
        settings,
      },
      attempt: toStudentAttemptView(this.toAttemptViewRow(attempt), now, {
        visibility: settings.resultVisibility,
        scoreReleased: asg.scoreReleased,
        submitted: false,
        remaining: remainingSeconds(attempt.deadline_at, now),
      }),
      // 学生端只拿到「没有 answerKey」的题目快照
      items: items.sort((a, b) => a.sortOrder - b.sortOrder).map(toStudentItemView),
      answers,
    };
  }

  private buildResultPayload(attempt: AttemptRow) {
    const assignment = this.getAssignment(attempt.assignment_id);
    const assessment = this.db
      .prepare('SELECT * FROM assessments WHERE id = ?')
      .get(assignment.assessmentId) as AssessmentRow;
    const settings = parseAssessmentSettings(assessment.kind, safeJsonParse(assessment.settings_json, {}));
    const items = this.readItems(assessment.id).sort((a, b) => a.sortOrder - b.sortOrder);
    const answerRows = this.db
      .prepare('SELECT * FROM assessment_answers WHERE attempt_id = ?')
      .all(attempt.id) as AnswerRow[];
    const now = this.now();
    const submitted = attempt.status !== 'in_progress';

    const scoreInput = {
      visibility: settings.resultVisibility,
      scoreReleased: assignment.scoreReleased,
      submitted,
    };
    const showScore = canStudentSeeScore(scoreInput);
    const showAnalysis = canStudentSeeAnalysis({ ...scoreInput, showItemAnalysis: settings.showItemAnalysis });

    const views = items.map((item) => {
      const row = answerRows.find((a) => a.item_id === item.id);
      const base = {
        itemId: item.id,
        type: item.type,
        stem: item.stem,
        maxScore: item.maxScore,
        answer: row ? safeJsonParse<unknown>(row.answer_json, null) : null,
      };
      if (!showAnalysis) {
        return {
          ...base,
          score: null,
          isCorrect: null,
          needsManualReview: false,
          feedback: null,
        };
      }
      return {
        ...base,
        score: row?.score ?? null,
        isCorrect: row?.is_correct === null || row?.is_correct === undefined ? null : row.is_correct === 1,
        needsManualReview: (row?.score ?? null) === null,
        feedback: row?.feedback ?? null,
        answerKey: item.answerKey,
      };
    });

    // 学生本人查阅时同样不返回 student_id / anon_key（白名单视图天然不带这些字段）
    return {
      assignment: {
        id: assignment.id,
        assessmentId: assessment.id,
        kind: assessment.kind,
        title: assessment.title,
        classId: assignment.classId,
        scoreReleased: assignment.scoreReleased,
        academicYear: assignment.academicYear,
      },
      attempt: toStudentAttemptView(this.toAttemptViewRow(attempt), now, {
        ...scoreInput,
        remaining: remainingSeconds(attempt.deadline_at, now),
      }),
      showScore,
      showAnalysis,
      items: views,
      // 聚合口径（多次作答）：只对已交卷的尝试生效
      aggregate: this.aggregateForAttempt(attempt, settings),
    };
  }

  private aggregateForAttempt(attempt: AttemptRow, settings: AssessmentSettings) {
    const rows = this.db
      .prepare('SELECT * FROM assessment_attempts WHERE assignment_id = ?')
      .all(attempt.assignment_id) as AttemptRow[];
    const sameIdentity = rows.filter((r) => {
      if (attempt.student_id === null) return r.anon_key === attempt.anon_key;
      return r.student_id === attempt.student_id;
    });
    return aggregateScores(
      sameIdentity
        .filter((r) => r.status !== 'in_progress')
        .map((r) => ({
          id: r.id,
          score: r.score,
          maxScore: r.max_score,
          needsManualReview: r.needs_manual_review === 1,
          submittedAt: r.submitted_at,
          attemptNo: r.attempt_no,
        })),
      settings.scorePolicy,
    );
  }
}

/** 布置的对外视图（camelCase，SQL 行在 `getAssignment` 里映射）。 */
interface AssignmentView {
  id: string;
  assessmentId: string;
  classId: string;
  lessonId: string | null;
  scheduleId: string | null;
  sessionId: string | null;
  opensAt: number | null;
  closesAt: number | null;
  durationSec: number | null;
  examId: string | null;
  academicYear: string | null;
  status: 'open' | 'closed';
  scoreReleased: boolean;
  createdBy: string | null;
  createdAt: number;
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** 进程内单例（路由使用）。 */
export const assessmentService = new AssessmentService();
