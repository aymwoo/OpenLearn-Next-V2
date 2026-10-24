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
import { recordSecurityAudit } from '../../packages/core/observability/audit-log.js';
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
  computeItemAnalysis,
  DEFAULT_MIN_SAMPLE_SIZE,
  ITEM_ANALYSIS_COLUMNS,
  toItemAnalysisCsv,
  type AssessmentItemRecord,
  type AssessmentKind,
  type AssessmentSettings,
  type AssessmentStatus,
  type AttemptStatus,
  type QuestionTypeRegistry,
} from '../../packages/core/assessment/index.js';
import { getEncryptionKey } from '../../packages/core/di/api-key-crypto.js';
import { getCurrentAcademicYear, normalizeAcademicYear, deriveAcademicYear } from '../utils/academic-year.js';
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
  /** Issue #186：每个人的卷面（{ seed, itemIds }），未配置抽题规则时为 null */
  paper_json: string | null;
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

/* ── Issue #187：AI 批改建议的 prompt 与解析（纯函数，便于单测） ── */

export interface AiGradingSuggestion {
  suggestedScore: number;
  rationale: string;
  confidence: number | null;
}

/** 构造批改建议 prompt：只包含本题题干/满分/评分参考/学生作答。 */
export function buildAiGradingPrompt(input: {
  stem: string;
  maxScore: number;
  answerKey: unknown;
  studentAnswer: unknown;
}): string {
  const answerText =
    typeof input.studentAnswer === `string` ? input.studentAnswer : JSON.stringify(input.studentAnswer);
  const keyText = input.answerKey == null ? `（无）` : JSON.stringify(input.answerKey);
  return [
    `你是一名严谨的教师，正在批改一道主观题。请只输出一个 JSON 对象，不要输出任何解释或代码块。`,
    `题目：` + input.stem,
    `满分：` + String(input.maxScore),
    `评分参考（标准答案/要点）：` + keyText,
    `学生作答：` + answerText,
    `输出格式：{"suggestedScore":<0 到满分之间的数字>,"rationale":"<不超过 200 字的中文评分理由>","confidence":<0 到 1 的数字>}`,
  ].join(`\n`);
}

/**
 * 解析 AI 输出为建议。任何不合法的输出返回 null —— 调用方据此提示教师，
 * 绝不能把随意文本当成分数。
 */
export function parseAiGradingSuggestion(text: string, maxScore: number): AiGradingSuggestion | null {
  if (typeof text !== `string`) return null;
  // 去掉可能的 ```json 围栏，取第一个 { 到最后一个 }
  const start = text.indexOf(`{`);
  const end = text.lastIndexOf(`}`);
  if (start < 0 || end <= start) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== `object`) return null;
  const score = Number(parsed.suggestedScore);
  if (!Number.isFinite(score) || score < 0 || score > maxScore) return null;
  const rationale = typeof parsed.rationale === `string` ? parsed.rationale.trim() : ``;
  if (!rationale) return null;
  let confidence: number | null = null;
  if (parsed.confidence !== undefined && parsed.confidence !== null) {
    const c = Number(parsed.confidence);
    if (Number.isFinite(c) && c >= 0 && c <= 1) confidence = c;
  }
  return { suggestedScore: Math.round(score * 100) / 100, rationale, confidence };
}

/**
 * 字符串种子 → 32 位状态。
 *
 * 为什么不用 `h = imul(31, h) + c`（Java String.hashCode 那一套）：那个哈希
 * **雪崩不足**。实测真实种子格式 `assignmentId:studentId:attemptNo` 改一个字符只有
 * 6/32 个比特发生变化，短种子甚至只有 1/32；而 LCG 的低位演化与高位无关，两个只在
 * 低位相同的初始状态会产出相关的随机流。可观测后果：同一学生相邻两次 attempt 的
 * 卷面碰撞率 1.63%，是理论值（1/120 ≈ 0.83%）的近两倍。
 *
 * 这里换成 xmur3 风格的多轮混合，实测改一个字符有 13~21/32 个比特变化，
 * 相邻 attempt 碰撞率回落到 0.89%（≈ 理论值）。
 */
function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/**
 * splitmix32：小、快、分布均匀的 32 位 PRNG（splitmix64 的 32 位变体）。
 *
 * 替代原先的 `h = imul(48271, h) + 1; (h >>> 0) % 10000`。旧写法的边际分布实测
 * 也过关（排列卡方 627 vs 新实现 636，df=719），但把状态截到 10000 个刻度白丢精度，
 * 且与弱种子哈希叠加后放大了相近种子之间的相关性。
 */
function makeSeededRandom(seed: string): () => number {
  let a = hashSeed(seed) | 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return ((t = t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

/**
 * 基于字符串种子的确定性打乱算法 (Fisher-Yates)。
 *
 * 契约：同一 seed 必得同一排列 —— 已持久化的 `paper_json` 依赖这一点（学生重入
 * 未交卷的 attempt 必须看到同一卷面）；不同 seed 得近似独立的均匀排列。
 *
 * 导出以供单元测试直接验证上述两条性质（原先不导出，只能隔着服务层间接测）。
 */
export function seededShuffle<T>(array: T[], seed: string): T[] {
  const result = [...array];
  const nextRandom = makeSeededRandom(seed);

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
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
  /**
   * AI 建议生成器（Issue #187）。
   * 缺省在首次调用时取 `kernelContainer.aiService`；显式传 null 表示禁用（测试/无 AI 环境）。
   */
  ai?: { generateText: (prompt: string) => Promise<string> } | null;
  /** 单次 AI 建议的超时（毫秒），默认 15000。 */
  aiTimeoutMs?: number;
}

export class AssessmentService {
  private readonly db: Database.Database;
  private readonly now: () => number;
  private readonly anonSecret: () => string;
  private readonly registry: QuestionTypeRegistry;
  /** Issue #187：AI 建议生成器（undefined = 未注入，运行时取 kernelContainer.aiService）。 */
  private readonly aiOverride?: { generateText: (prompt: string) => Promise<string> } | null;
  private readonly aiTimeoutMs: number;
  /** Issue #187：建议接口的简单限流（actor → 最近调用时间戳）。 */
  private readonly aiSuggestCalls = new Map<string, number[]>();

  constructor(options: AssessmentServiceOptions = {}) {
    this.db = options.db ?? (kernelContainer.db as unknown as Database.Database);
    this.now = options.now ?? (() => Date.now());
    this.anonSecret = options.anonSecret ?? (() => getEncryptionKey().toString('hex'));
    this.registry = options.registry ?? assessmentGraderRegistry.underlying;
    this.aiOverride = options.ai;
    this.aiTimeoutMs = options.aiTimeoutMs ?? 15_000;
  }

  /** 解析 AI 生成器：显式注入优先；null = 禁用；undefined = 运行时取内核服务。 */
  private resolveAi(): { generateText: (prompt: string) => Promise<string> } | null {
    if (this.aiOverride !== undefined) return this.aiOverride;
    return (
      (kernelContainer as unknown as { aiService?: { generateText: (p: string) => Promise<string> } }).aiService ?? null
    );
  }

  /** Issue #187：每个操作者 60 秒内最多 20 次建议请求（内存级，多实例部署下为每进程口径）。 */
  private enforceAiSuggestRateLimit(actorId: string): void {
    const now = this.now();
    const recent = (this.aiSuggestCalls.get(actorId) ?? []).filter((ts) => now - ts < 60_000);
    if (recent.length >= 20) {
      const err: any = new Error('AI 建议请求过于频繁，请稍后再试');
      err.status = 429;
      throw err;
    }
    recent.push(now);
    this.aiSuggestCalls.set(actorId, recent);
  }

  /** 把 Promise 包一层超时，避免 AI Provider 卡住教师批改。 */
  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(label)), ms);
      promise.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
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

  /** 某份试卷的全部发布记录（含班级名），供测评中心列出可批改/可统计的布置。 */
  listAssignments(assessmentId: string, ownerId: string) {
    this.requireOwnedAssessment(assessmentId, ownerId);
    const rows = this.db
      .prepare(
        `SELECT aa.*, c.name AS class_name
           FROM assessment_assignments aa
           LEFT JOIN classes c ON c.id = aa.class_id
          WHERE aa.assessment_id = ?
          ORDER BY aa.created_at DESC`,
      )
      .all(assessmentId) as Array<AssignmentRow & { class_name: string | null }>;
    const now = this.now();
    return rows.map((row) => {
      const counts = this.db
        .prepare(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN status != 'in_progress' THEN 1 ELSE 0 END) AS submitted,
             SUM(CASE WHEN needs_manual_review = 1 THEN 1 ELSE 0 END) AS pending
           FROM assessment_attempts WHERE assignment_id = ?`,
        )
        .get(row.id) as { total: number | null; submitted: number | null; pending: number | null };
      return {
        ...this.getAssignment(row.id),
        className: row.class_name,
        attemptCount: counts?.total ?? 0,
        submittedCount: counts?.submitted ?? 0,
        pendingReviewCount: counts?.pending ?? 0,
        // 惰性超时结算的提示：学生端读取时会结算，教师端只做展示
        now,
      };
    });
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
    // 自动回写成绩到 exams / exam_scores（防覆盖教师手工录入成绩）
    try {
      this.syncScoresToGradebook(asg.id, ownerId);
    } catch (e) {
      console.warn('[AssessmentService] Failed to auto sync scores to gradebook on release:', e);
    }
    return this.getAssignment(asg.id);
  }

  /**
   * 将已批改/已提交的成绩回写到 exams / exam_scores 表，联动学期成绩总评 (Issue #123)
   * 严格防护：不覆盖教师手工录入的同名成绩。
   */
  syncScoresToGradebook(
    assignmentId: string,
    ownerId: string,
  ): { examId: string; syncedCount: number; skippedCount: number } {
    const asg = this.requireOwnedAssignment(assignmentId, ownerId);
    const assessment = this.db.prepare('SELECT * FROM assessments WHERE id = ?').get(asg.assessmentId) as
      AssessmentRow | undefined;
    if (!assessment) throw notFound('assessment');

    return this.db.transaction(() => {
      let examId = asg.examId;
      const now = this.now();

      // 1. 若当前 assignment 尚未关联 exam_id，在 exams 表中新建或查找对应考试
      if (!examId) {
        const existingExam = this.db
          .prepare('SELECT id FROM exams WHERE class_id = ? AND title = ?')
          .get(asg.classId, assessment.title) as { id: string } | undefined;

        if (existingExam) {
          examId = existingExam.id;
        } else {
          examId = randomId('exam');
          const maxScore = this.readItems(assessment.id).reduce((sum, it) => sum + (it.maxScore || 1), 0);
          // 学年必须落库（Issue #219）：此前这里创建的考试 academic_year 恒为 NULL，
          // 连带下方的 exam_scores 也没有学年 —— 按学年查看学期总评时整段成绩会被过滤掉。
          const examAcademicYear = asg.academicYear ?? deriveAcademicYear(now);
          this.db
            .prepare(
              `INSERT INTO exams (id, class_id, title, description, max_score, created_at, academic_year)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              examId,
              asg.classId,
              assessment.title,
              assessment.description || '',
              maxScore > 0 ? Math.round(maxScore) : 100,
              now,
              examAcademicYear,
            );
        }

        this.db.prepare('UPDATE assessment_assignments SET exam_id = ? WHERE id = ?').run(examId, asg.id);
      }

      // 2. 查询该 assignment 下所有实名学生且已有成绩的 attempts
      const attempts = this.db
        .prepare(
          `SELECT student_id, score, max_score FROM assessment_attempts 
           WHERE assignment_id = ? AND student_id IS NOT NULL AND status IN ('submitted', 'graded', 'released') AND score IS NOT NULL`,
        )
        .all(asg.id) as Array<{ student_id: string; score: number; max_score: number | null }>;

      let syncedCount = 0;
      let skippedCount = 0;

      // 学年以父考试为准（Issue #219）：exam_scores.academic_year 必须与 exams 一致，
      // 否则按学年过滤学期总评时，这批成绩会被整段丢掉。
      const examYearRow = this.db.prepare('SELECT academic_year FROM exams WHERE id = ?').get(examId) as
        { academic_year: string | null } | undefined;
      const scoreAcademicYear = examYearRow?.academic_year ?? asg.academicYear ?? deriveAcademicYear(now);

      const checkExistingScore = this.db.prepare(
        'SELECT score, notes FROM exam_scores WHERE exam_id = ? AND student_id = ?',
      );

      const upsertScore = this.db.prepare(
        `INSERT INTO exam_scores (exam_id, student_id, score, notes, academic_year, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(exam_id, student_id) DO UPDATE SET
           score = excluded.score,
           notes = excluded.notes,
           academic_year = excluded.academic_year,
           recorded_at = excluded.recorded_at`,
      );

      for (const att of attempts) {
        const existing = checkExistingScore.get(examId, att.student_id) as
          { score: number; notes: string | null } | undefined;

        // 验收标准：不覆盖教师手工录入的同名成绩！
        // 若已有成绩且 notes 不是以 'assessment:' 开头，说明是教师手工在成绩表直接录入的，跳过
        if (existing && existing.notes && !existing.notes.startsWith('assessment:')) {
          skippedCount++;
          continue;
        }

        const finalScore = roundScore(att.score);
        upsertScore.run(examId, att.student_id, finalScore, `assessment:${asg.id}`, scoreAcademicYear, now);
        syncedCount++;
      }

      return { examId, syncedCount, skippedCount };
    })();
  }

  /**
   * 记录学生考试监考事件（失焦、切屏、退出全屏）(Issue #123)
   */
  recordProctor(
    attemptId: string,
    studentId: string,
    event: { type: 'blur' | 'visibility_hidden' | 'fullscreen_exit'; at?: number; detail?: string },
  ): {
    ok: boolean;
    blurCount: number;
    switchTabCount: number;
    fullscreenExitCount: number;
    summary?: { blur: number; visibility_hidden: number; fullscreen_exit: number; total: number };
  } {
    const attempt = this.requireAttemptForStudent(attemptId, studentId);
    if (attempt.status !== 'in_progress') {
      throw badRequest('作答已提交或结束，无法记录监考事件');
    }

    const currentProctor = safeJsonParse<any>(attempt.proctor_json, {
      blurCount: 0,
      switchTabCount: 0,
      fullscreenExitCount: 0,
      events: [] as Array<{ type: string; at: number; detail?: string }>,
      summary: { blur: 0, visibility_hidden: 0, fullscreen_exit: 0, total: 0 },
      lastEventAt: null as number | null,
    });

    const at = event.at || this.now();
    if (event.type === 'blur') {
      currentProctor.blurCount = (currentProctor.blurCount || 0) + 1;
    } else if (event.type === 'visibility_hidden') {
      currentProctor.switchTabCount = (currentProctor.switchTabCount || 0) + 1;
    } else if (event.type === 'fullscreen_exit') {
      currentProctor.fullscreenExitCount = (currentProctor.fullscreenExitCount || 0) + 1;
    }

    const total =
      (currentProctor.blurCount || 0) +
      (currentProctor.switchTabCount || 0) +
      (currentProctor.fullscreenExitCount || 0);

    const summary = {
      blur: currentProctor.blurCount || 0,
      visibility_hidden: currentProctor.switchTabCount || 0,
      fullscreen_exit: currentProctor.fullscreenExitCount || 0,
      total,
    };
    currentProctor.summary = summary;
    currentProctor.lastEventAt = at;
    if (!Array.isArray(currentProctor.events)) currentProctor.events = [];
    if (currentProctor.events.length >= 50) {
      currentProctor.events.shift();
    }
    currentProctor.events.push({ type: event.type, at, detail: event.detail });

    this.db
      .prepare('UPDATE assessment_attempts SET proctor_json = ? WHERE id = ?')
      .run(JSON.stringify(currentProctor), attemptId);

    return {
      ok: true,
      blurCount: currentProctor.blurCount,
      switchTabCount: currentProctor.switchTabCount,
      fullscreenExitCount: currentProctor.fullscreenExitCount,
      summary,
    };
  }

  /**
   * 获取测评实时作答进度与大屏统计卡片数据 (Issue #123)
   */
  getProgressSummary(assignmentId: string, ownerId?: string) {
    const asg = ownerId ? this.requireOwnedAssignment(assignmentId, ownerId) : this.getAssignment(assignmentId);
    const assessment = this.db.prepare('SELECT title, kind FROM assessments WHERE id = ?').get(asg.assessmentId) as
      { title: string; kind: string } | undefined;

    const roster = this.db
      .prepare(
        `SELECT s.id as student_id, s.name, s.student_number 
         FROM class_students cs
         JOIN students s ON cs.student_id = s.id
         WHERE cs.class_id = ?
         ORDER BY s.student_number ASC, s.name ASC`,
      )
      .all(asg.classId) as Array<{ student_id: string; name: string; student_number: string }>;

    const attempts = this.db
      .prepare('SELECT * FROM assessment_attempts WHERE assignment_id = ?')
      .all(asg.id) as AttemptRow[];

    const attemptMap = new Map<string, AttemptRow>();
    for (const att of attempts) {
      if (att.student_id) {
        attemptMap.set(att.student_id, att);
      }
    }

    let submittedCount = 0;
    let inProgressCount = 0;
    let notStartedCount = 0;
    let totalScore = 0;
    let scoredStudents = 0;

    const studentList = roster.map((stu) => {
      const att = attemptMap.get(stu.student_id);
      let status: 'not_started' | 'in_progress' | 'submitted' | 'graded' = 'not_started';
      let score: number | null = null;
      let proctor: any = null;
      let submittedAt: number | null = null;

      if (!att) {
        notStartedCount++;
      } else {
        proctor = safeJsonParse(att.proctor_json, {});
        submittedAt = att.submitted_at;
        if (att.status === 'in_progress') {
          inProgressCount++;
          status = 'in_progress';
        } else {
          submittedCount++;
          status = att.status === 'graded' || att.status === 'released' ? 'graded' : 'submitted';
          if (att.score !== null && att.score !== undefined) {
            score = att.score;
            totalScore += att.score;
            scoredStudents++;
          }
        }
      }

      return {
        studentId: stu.student_id,
        name: stu.name,
        studentNumber: stu.student_number,
        status,
        score,
        proctor,
        submittedAt,
      };
    });

    const avgScore = scoredStudents > 0 ? Math.round((totalScore / scoredStudents) * 10) / 10 : null;
    return {
      assignmentId: asg.id,
      assignment: asg,
      title: assessment?.title || '随堂测评',
      kind: assessment?.kind || 'quiz',
      totalStudents: roster.length,
      submittedCount,
      inProgressCount,
      notStartedCount,
      unstartedCount: notStartedCount,
      avgScore,
      averageScore: avgScore,
      students: studentList,
    };
  }

  /* ───────────────────────── 题库（教师） ───────────────────────── */

  listBankItems(ownerId: string, filter: { type?: string } = {}) {
    const params: unknown[] = [ownerId];
    // Issue #186：自己的条目 + 同实例教师共享（visibility='school'）的条目
    let sql = "SELECT * FROM question_bank_items WHERE (owner_id = ? OR visibility = 'school')";
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
    /** Issue #186：私有（默认）或同校教师共享 */
    visibility?: 'private' | 'school';
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
           (id, owner_id, type, stem, config_json, answer_key_json, tags_json, difficulty, visibility, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        input.visibility === 'school' ? 'school' : 'private',
        now,
        now,
      );
    return this.getBankItem(id, input.ownerId);
  }

  getBankItem(id: string, ownerId: string) {
    const row = this.db.prepare('SELECT * FROM question_bank_items WHERE id = ?').get(id) as
      Record<string, any> | undefined;
    if (!row) throw notFound('bank item');
    // Issue #186：共享条目允许同实例教师读取（写/删仍限 owner）
    if (row.owner_id !== ownerId && row.visibility !== 'school') throw forbidden('not the bank item owner');
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
    // Issue #186：按学生种子成卷（同学生稳定、不同学生不同卷）；题库不足在此抛 409
    const paperJson = settings.draw
      ? this.buildPaper(
          assessment.id,
          settings.draw,
          assignmentId + ':' + (isAnonymous ? anonKey : studentId) + ':' + attemptNo,
        )
      : null;
    this.db
      .prepare(
        `INSERT INTO assessment_attempts
           (id, assignment_id, student_id, anon_key, attempt_no, status, started_at, deadline_at, academic_year, paper_json)
         VALUES (?, ?, ?, ?, ?, 'in_progress', ?, ?, ?, ?)`,
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
        paperJson,
      );
    const row = this.requireAttempt(id);
    return this.buildAttemptPayload(row, assessment, asg, settings, { newAttempt: true });
  }

  /** 自动保存单题作答（不判分，判分在交卷时统一做）。 */
  saveAnswer(attemptId: string, studentId: string, itemId: string, answer: unknown) {
    const attempt = this.requireAttemptForStudent(attemptId, studentId);
    const settled = this.settleIfExpired(attempt, this.now());
    if (settled.status !== 'in_progress') throw conflict('attempt already submitted');

    // Issue #186：只能作答本卷题目（抽题规则下不存在的题目按 404 处理）
    const items = this.itemsForAttempt(settled, this.readItems(this.assignmentAssessmentId(settled.assignment_id)));
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

  /**
   * 教师视角的一次作答详情：逐题作答原文 + 评分状态（批改 UI 的数据源）。
   *
   * 与学生结果视图的区别：**始终包含标准答案**（教师本来就能改答案），
   * 且忽略 resultVisibility（教师不需要等"发布成绩"）。
   */
  getAttemptForTeacher(attemptId: string, ownerId: string) {
    const attempt = this.requireAttempt(attemptId);
    this.requireOwnedAssignment(attempt.assignment_id, ownerId);
    const settled = this.settleIfExpired(attempt, this.now());
    const assessmentId = this.assignmentAssessmentId(settled.assignment_id);
    const items = this.readItems(assessmentId).sort((a, b) => a.sortOrder - b.sortOrder);
    const answerRows = this.db
      .prepare('SELECT * FROM assessment_answers WHERE attempt_id = ?')
      .all(settled.id) as AnswerRow[];

    return {
      attempt: toTeacherAttemptView(this.toAttemptViewRow(settled), { revealIdentity: false }),
      items: items.map((item) => {
        const row = answerRows.find((a) => a.item_id === item.id);
        return {
          itemId: item.id,
          type: item.type,
          stem: item.stem,
          maxScore: item.maxScore,
          answer: row ? safeJsonParse<unknown>(row.answer_json, null) : null,
          answerKey: item.answerKey,
          score: row?.score ?? null,
          isCorrect: row?.is_correct === null || row?.is_correct === undefined ? null : row.is_correct === 1,
          needsManualReview: (row?.score ?? null) === null,
          feedback: row?.feedback ?? null,
          grader: row?.grader ?? null,
          manualOverride: row?.manual_override === 1,
          config: item.config,
        };
      }),
    };
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

  /**
   * Issue #187：为一道主观题生成 AI 批改建议。
   *
   * **只写建议，不改分**：结果落到 ai_suggestion_json；score/feedback/manual_override 一概不动。
   * 教师确认（可修改后确认）走 manualGrade —— 那条路径本来就写 manual_override = 1。
   * AI Provider 缺失/超时/输出非法时抛 503/502，前端提示但不阻塞人工批改。
   */
  async suggestAiGrade(
    attemptId: string,
    ownerId: string,
    itemId: string,
    options: { actorId?: string } = {},
  ): Promise<{
    itemId: string;
    maxScore: number;
    suggestedScore: number;
    rationale: string;
    confidence: number | null;
    generatedAt: number;
  }> {
    const attempt = this.requireAttempt(attemptId);
    this.requireOwnedAssignment(attempt.assignment_id, ownerId);
    if (attempt.status === 'in_progress') throw conflict('attempt is still in progress');
    const items = this.readItems(this.assignmentAssessmentId(attempt.assignment_id));
    const item = items.find((i) => i.id === itemId);
    if (!item) throw notFound('item');
    // 题型定义（内置或插件）声明 category；未注册的题型不提供 AI 建议（保守拒绝）
    const definition = this.registry.get(item.type) as
      | {
          category?: string;
          /** Issue #196：插件题型可自带提示词组装（返回 null = 本题型不提供 AI 建议） */
          getAiGradingPrompt?: (config: unknown, answerKey: unknown, answer: unknown) => string | null;
        }
      | undefined;
    if (definition?.category !== 'subjective') throw badRequest('AI 建议仅适用于主观题');

    const answerRow = this.db
      .prepare('SELECT answer_json FROM assessment_answers WHERE attempt_id = ? AND item_id = ?')
      .get(attemptId, itemId) as { answer_json: string | null } | undefined;
    const studentAnswer = answerRow?.answer_json
      ? safeJsonParse<unknown>(answerRow.answer_json, answerRow.answer_json)
      : null;
    if (
      studentAnswer === null ||
      studentAnswer === undefined ||
      (typeof studentAnswer === 'string' && studentAnswer.trim() === '')
    ) {
      throw badRequest('该题尚无学生作答，无法生成批改建议');
    }

    const ai = this.resolveAi();
    if (!ai) {
      const err: any = new Error('AI Provider 未配置，无法生成批改建议');
      err.status = 503;
      throw err;
    }

    this.enforceAiSuggestRateLimit(options.actorId ?? ownerId);

    // Issue #196：题型自带提示词优先。
    //
    // 内置通用提示词只看得见题干/满分/答案/学生作答；对插件题型（代码题、语音题、
    // 实验仿真题）则看不到测试用例与判分细则，建议质量只能泛泛。题型自己知道
    // `config` 里有什么，因此把组装权交给它；没实现该钩子的题型（含全部内置题型）
    // 继续走通用模板，行为不变。
    let prompt: string;
    if (typeof definition.getAiGradingPrompt === 'function') {
      const custom = definition.getAiGradingPrompt(item.config, item.answerKey, studentAnswer);
      if (custom === null) throw badRequest('该题型不提供 AI 批改建议');
      if (typeof custom !== 'string' || custom.trim() === '') {
        throw badRequest('该题型的 AI 批改提示词为空');
      }
      prompt = custom;
    } else {
      prompt = buildAiGradingPrompt({
        stem: item.stem,
        maxScore: item.maxScore,
        answerKey: item.answerKey,
        studentAnswer,
      });
    }

    let text: string;
    try {
      text = await this.withTimeout(ai.generateText(prompt), this.aiTimeoutMs, 'AI 建议生成超时');
    } catch (e: any) {
      const err: any = new Error('AI 建议生成失败：' + (e?.message ?? String(e)));
      err.status = 503;
      throw err;
    }

    const parsed = parseAiGradingSuggestion(text, item.maxScore);
    if (!parsed) {
      const err: any = new Error('AI 返回内容无法解析为有效建议（已忽略，不影响人工批改）');
      err.status = 502;
      throw err;
    }

    const generatedAt = this.now();
    const suggestion = { ...parsed, generatedAt };
    this.db
      .prepare(
        'INSERT INTO assessment_answers' +
          ' (attempt_id, item_id, answer_json, score, max_score, is_correct, grader, feedback, graded_by, graded_at, manual_override, ai_suggestion_json, updated_at)' +
          " VALUES (?, ?, NULL, NULL, ?, NULL, 'ai_suggested', NULL, NULL, NULL, 0, ?, ?)" +
          ' ON CONFLICT(attempt_id, item_id) DO UPDATE SET' +
          ' ai_suggestion_json = excluded.ai_suggestion_json,' +
          " grader = CASE WHEN assessment_answers.score IS NULL THEN 'ai_suggested' ELSE assessment_answers.grader END," +
          ' updated_at = excluded.updated_at',
      )
      .run(attemptId, itemId, item.maxScore, JSON.stringify(suggestion), generatedAt);

    recordSecurityAudit('assessment.ai_grading_suggested', {
      actorId: options.actorId ?? ownerId,
      attemptId,
      itemId,
      suggestedScore: parsed.suggestedScore,
      confidence: parsed.confidence,
    });

    return { itemId, maxScore: item.maxScore, ...suggestion };
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

  /* ────────────────────── 试卷导出 / 导入（Issue #196）────────────────────── */

  /**
   * 试卷导出（JSON / CSV / XLSX）。
   *
   * ## 对插件题型的关键点
   *
   * 必须整份带走两样东西：
   * 1. `type` —— 就是题型标记 `<pluginId>:<name>`（如 `ext-code:python`）；
   * 2. `config` —— 插件自己定义的结构（测试用例、判分细则…）。
   *
   * CSV 里 `config` / `answerKey` 以 **JSON 字符串** 存放：不展平成列（每类题型的
   * config 形状都不同，展平等于把插件题型塞回内置题型的形状，必然丢字段），
   * 也不拆成多文件（再导入时对齐成本高）。
   */
  async exportPaper(
    assessmentId: string,
    ownerId: string,
    format: 'json' | 'csv' | 'xlsx',
  ): Promise<{ filename: string; contentType: string; body: string | Buffer }> {
    const assessment = this.requireOwnedAssessment(assessmentId, ownerId);
    const items = this.readItems(assessmentId).sort((a, b) => a.sortOrder - b.sortOrder);
    const settings = parseAssessmentSettings(assessment.kind, safeJsonParse(assessment.settings_json, {}));
    const base = `assessment-${assessmentId}-paper`;

    const paper: PaperExport = {
      schema: PAPER_EXPORT_SCHEMA,
      exportedAt: this.now(),
      assessment: {
        title: assessment.title,
        kind: assessment.kind,
        description: assessment.description ?? null,
        settings,
      },
      items: items.map((item, index) => ({
        order: index + 1,
        section: item.section,
        type: item.type,
        stem: item.stem,
        config: item.config,
        answerKey: item.answerKey,
        maxScore: item.maxScore,
      })),
    };

    if (format === 'json') {
      return {
        filename: `${base}.json`,
        contentType: 'application/json; charset=utf-8',
        body: `${JSON.stringify(paper, null, 2)}\n`,
      };
    }

    const rows = paper.items.map((item) => [
      String(item.order),
      item.section ?? '',
      item.type,
      item.stem,
      JSON.stringify(item.config ?? {}),
      item.answerKey === null || item.answerKey === undefined ? '' : JSON.stringify(item.answerKey),
      String(item.maxScore),
    ]);

    if (format === 'csv') {
      const lines = [PAPER_CSV_COLUMNS.join(','), ...rows.map((row) => row.map(csvCell).join(','))];
      return { filename: `${base}.csv`, contentType: 'text/csv; charset=utf-8', body: `${lines.join('\n')}\n` };
    }

    // XLSX：动态 import，避免把 exceljs 拉进每次服务启动的主路径。
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    // 汇总页：人读元信息（导入只认明细页，不依赖这里的文字）
    const meta = workbook.addWorksheet('试卷');
    meta.addRow(['标题', paper.assessment.title]);
    meta.addRow(['类型', paper.assessment.kind]);
    meta.addRow(['说明', paper.assessment.description ?? '']);
    meta.addRow(['导出协议', PAPER_EXPORT_SCHEMA]);
    const sheet = workbook.addWorksheet('题目');
    sheet.addRow([...PAPER_CSV_COLUMNS]);
    for (const row of rows) sheet.addRow(row);
    const headerRow = typeof (sheet as any).getRow === 'function' ? sheet.getRow(1) : null;
    if (headerRow) headerRow.font = { bold: true };
    if (Array.isArray(sheet.columns)) {
      sheet.columns.forEach((column) => {
        column.width = 24;
      });
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return {
      filename: `${base}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: Buffer.from(buffer as ArrayBuffer),
    };
  }

  /**
   * 试卷导入（JSON / CSV）—— 建一份**新的草稿**试卷。
   *
   * ## 为什么必须校验题型是否已安装
   *
   * 导出包里可能包含别人环境装的插件题型（`ext-code:python`）。导入方没装那个插件时，
   * 直接落库会得到一个**渲染不出来、也判不了分**的题 —— 学生打开就是白屏。
   * 所以这里先逐题核对 `QuestionTypeRegistry`，缺题型就带上**缺失清单**报错：
   * `400 QUESTION_TYPE_NOT_INSTALLED`，而不是解析崩掉或静默丢题。
   *
   * 配置与标准答案同样用题型自己的 `validateConfig` / `validateAnswerKey` 验一遍：
   * 导入是外部数据进入系统的主要入口，不能因为“格式看起来对”就信任。
   */
  importPaper(
    ownerId: string,
    payload: string,
    format: 'json' | 'csv',
    options: { title?: string } = {},
  ): { assessmentId: string; title: string; kind: AssessmentKind; itemCount: number; warnings: string[] } {
    let raw: unknown;
    let parsedTitle: string | undefined;
    let parsedKind: string | undefined;
    let parsedDescription: string | null | undefined;
    let parsedSettings: unknown;
    let rawItems: unknown[];
    const warnings: string[] = [];

    if (format === 'json') {
      try {
        raw = JSON.parse(payload);
      } catch {
        throw codedError(400, '导入内容不是合法 JSON', 'PAPER_IMPORT_INVALID_JSON');
      }
      const doc = raw as Partial<PaperExport> & { items?: unknown };
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
        throw codedError(400, '导入内容必须是试卷对象', 'PAPER_IMPORT_INVALID_SHAPE');
      }
      if (doc.schema && doc.schema !== PAPER_EXPORT_SCHEMA) {
        warnings.push(`试卷协议版本为 ${String(doc.schema)}，当前支持 ${PAPER_EXPORT_SCHEMA}`);
      }
      if (!Array.isArray(doc.items)) {
        throw codedError(400, '导入内容缺少 items 数组', 'PAPER_IMPORT_INVALID_SHAPE');
      }
      rawItems = doc.items;
      parsedTitle = (doc.assessment?.title as string | undefined) ?? undefined;
      parsedKind = doc.assessment?.kind as string | undefined;
      parsedDescription = (doc.assessment?.description as string | null | undefined) ?? null;
      parsedSettings = doc.assessment?.settings;
    } else {
      const rows = parseCsvRows(payload);
      if (rows.length === 0) throw codedError(400, 'CSV 内容为空', 'PAPER_IMPORT_INVALID_CSV');
      const header = rows[0].map((cell) => cell.trim());
      const missingColumns = PAPER_CSV_COLUMNS.filter((column) => !header.includes(column));
      if (missingColumns.length > 0) {
        throw codedError(400, `CSV 缺少必需列：${missingColumns.join(', ')}`, 'PAPER_IMPORT_INVALID_CSV');
      }
      const index = (name: string) => header.indexOf(name);
      rawItems = rows
        .slice(1)
        .filter((cells) => cells.some((cell) => cell.trim() !== ''))
        .map((cells) => ({
          order: Number(cells[index('order')] ?? 0) || undefined,
          section: cells[index('section')] ?? null,
          type: cells[index('type')],
          stem: cells[index('stem')],
          config: optionalJsonCell(cells[index('config')]),
          answerKey: optionalJsonCell(cells[index('answerKey')]),
          maxScore: Number(cells[index('maxScore')] ?? 1),
        }));
      // CSV 不适合放长元信息：标题缺省时由调用方补，缺失在第 7 步统一报错
      parsedTitle = undefined;
      parsedKind = 'quiz';
      parsedDescription = null;
    }

    if (rawItems.length === 0) throw codedError(400, '导入内容不含任何题目', 'PAPER_IMPORT_EMPTY');

    // 1. 先把每道题归一化（类型/满分/配置）
    const normalized = rawItems.map((entry, idx) => {
      const item = entry as Record<string, unknown>;
      const type = typeof item.type === 'string' ? item.type.trim() : '';
      const stem = typeof item.stem === 'string' ? item.stem : '';
      if (!type) throw codedError(400, `第 ${idx + 1} 题缺少题型`, 'PAPER_IMPORT_INVALID_ITEM');
      if (!stem.trim()) throw codedError(400, `第 ${idx + 1} 题（${type}）缺少题干`, 'PAPER_IMPORT_INVALID_ITEM');
      const maxScore = typeof item.maxScore === 'number' && Number.isFinite(item.maxScore) ? item.maxScore : 1;
      if (maxScore <= 0) throw codedError(400, `第 ${idx + 1} 题满分必须大于 0`, 'PAPER_IMPORT_INVALID_ITEM');
      return {
        section: typeof item.section === 'string' && item.section.trim() !== '' ? item.section : null,
        type,
        stem,
        config: item.config ?? {},
        answerKey: item.answerKey ?? null,
        maxScore,
      };
    });

    // 2. 题型是否已安装（插件未装时给明确清单，而不是让题目落库后渲染成白屏）
    const missingTypes = Array.from(
      new Set(normalized.map((item) => item.type).filter((type) => !this.registry.has(type))),
    );
    if (missingTypes.length > 0) {
      throw Object.assign(
        codedError(
          400,
          `导入包中包含未安装的题型：${missingTypes.join('、')}。请先在「插件中心」安装对应插件后重试。`,
          'QUESTION_TYPE_NOT_INSTALLED',
        ),
        { missingTypes },
      );
    }

    // 3. 用题型自己的校验器验配置与标准答案（外部数据不能因为“看起来对”就信任）
    const invalidItems: Array<{ order: number; type: string; reason: string }> = [];
    normalized.forEach((item, idx) => {
      const definition = this.registry.get(item.type)!;
      const configError = definition.validateConfig(item.config);
      if (configError) invalidItems.push({ order: idx + 1, type: item.type, reason: `配置非法：${configError}` });
      const keyError = definition.validateAnswerKey?.(item.config as never, item.answerKey) ?? null;
      if (keyError) invalidItems.push({ order: idx + 1, type: item.type, reason: `标准答案非法：${keyError}` });
    });
    if (invalidItems.length > 0) {
      throw Object.assign(
        codedError(
          400,
          `导入包中有 ${invalidItems.length} 处题目内容不合法：${invalidItems
            .slice(0, 5)
            .map((it) => `第 ${it.order} 题(${it.type}) ${it.reason}`)
            .join('；')}`,
          'PAPER_IMPORT_INVALID_ITEM',
        ),
        { invalidItems },
      );
    }

    // 4. 创建草稿试卷 + 逐题写入（组卷即物化快照，与手工组卷一致）
    const kind = (['quiz', 'exam', 'survey'].includes(String(parsedKind)) ? parsedKind : 'quiz') as AssessmentKind;
    // CSV 不携带长元信息：标题由调用方补（JSON 包自带时以包内为准）
    const title = (parsedTitle ?? options.title ?? '').trim() || undefined;
    if (!title) {
      throw codedError(400, '导入包缺少试卷标题（CSV 导入请在请求体里提供 title）', 'PAPER_IMPORT_MISSING_TITLE');
    }

    const created = this.createAssessment({
      ownerId,
      kind,
      title,
      description: parsedDescription ?? null,
      settings: parsedSettings,
    });

    const now = this.now();
    const insert = this.db.prepare(
      `INSERT INTO assessment_items
         (id, assessment_id, bank_item_id, section, sort_order, type, stem, config_json, answer_key_json, max_score)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    );
    normalized.forEach((item, index) => {
      insert.run(
        randomId(),
        created.id,
        item.section,
        index + 1,
        item.type,
        item.stem,
        JSON.stringify(item.config ?? {}),
        item.answerKey === null || item.answerKey === undefined ? null : JSON.stringify(item.answerKey),
        item.maxScore,
      );
    });
    this.db.prepare('UPDATE assessments SET updated_at = ? WHERE id = ?').run(now, created.id);

    return { assessmentId: created.id, title, kind, itemCount: normalized.length, warnings };
  }

  /**
   * 逐题项分析：难度 (p) 与区分度 (r)（Issue #184）。
   *
   * 只统计**已交卷且已判分**的 attempt；未判分（含待人工批改的简答）的作答不参与，
   * 否则「没批的题」会被当成 0 分，把难度和区分度都拉偏。
   */
  itemAnalysis(assignmentId: string, ownerId: string) {
    const asg = this.requireOwnedAssignment(assignmentId, ownerId);
    const items = this.readItems(asg.assessmentId).sort((a, b) => a.sortOrder - b.sortOrder);
    const rows = this.db
      .prepare('SELECT * FROM assessment_attempts WHERE assignment_id = ?')
      .all(assignmentId) as AttemptRow[];
    const now = this.now();
    const settled = rows
      .map((row) => this.settleIfExpired(row, now))
      .filter((row) => row.status !== 'in_progress' && typeof row.score === 'number');

    const attempts = settled.map((row) => {
      const answers = this.db
        .prepare('SELECT item_id, score FROM assessment_answers WHERE attempt_id = ?')
        .all(row.id) as Array<{ item_id: string; score: number | null }>;
      const scores: Record<string, number | null> = {};
      for (const answer of answers) scores[answer.item_id] = answer.score;
      return { totalScore: row.score as number, scores };
    });

    const analysis = computeItemAnalysis(
      items.map((item) => ({
        id: item.id,
        type: item.type,
        maxScore: item.maxScore,
        sortOrder: item.sortOrder,
      })),
      attempts,
    );

    return {
      assignmentId,
      assessmentId: asg.assessmentId,
      sampleSize: attempts.length,
      minSampleSize: DEFAULT_MIN_SAMPLE_SIZE,
      items: analysis,
    };
  }

  /**
   * 导出项分析（Issue #184）：CSV / JSON / XLSX，列序与 {@link ITEM_ANALYSIS_COLUMNS} 一致。
   */
  async exportItemAnalysis(
    assignmentId: string,
    ownerId: string,
    format: 'csv' | 'json' | 'xlsx',
  ): Promise<{ filename: string; contentType: string; body: string | Buffer }> {
    const analysis = this.itemAnalysis(assignmentId, ownerId);
    const base = `assessment-${assignmentId}-item-analysis`;

    if (format === 'json') {
      return {
        filename: `${base}.json`,
        contentType: 'application/json; charset=utf-8',
        body: `${JSON.stringify(analysis, null, 2)}\n`,
      };
    }

    if (format === 'csv') {
      return {
        filename: `${base}.csv`,
        contentType: 'text/csv; charset=utf-8',
        body: `${toItemAnalysisCsv(analysis.items)}\n`,
      };
    }

    // XLSX：动态 import，避免把 exceljs 拉进每次服务启动的主路径。
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('项分析');
    sheet.addRow(ITEM_ANALYSIS_COLUMNS.map((column) => column.label));
    for (const row of analysis.items) {
      sheet.addRow(
        ITEM_ANALYSIS_COLUMNS.map((column) => {
          if (column.key === 'order') return row.order + 1;
          const value = row[column.key as keyof typeof row];
          return value === null ? '' : value;
        }),
      );
    }
    // 样式是锦上添花：测试环境把 exceljs 换成最小 stub（没有 getRow/columns），
    // 真实环境才有。缺这些方法时仍然返回一个可打开的 xlsx。
    const headerRow = typeof (sheet as any).getRow === 'function' ? sheet.getRow(1) : null;
    if (headerRow) headerRow.font = { bold: true };
    if (Array.isArray(sheet.columns)) {
      sheet.columns.forEach((column) => {
        column.width = 16;
      });
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return {
      filename: `${base}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: Buffer.from(buffer),
    };
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

  /**
   * Issue #186：按抽题规则为某个种子确定性地挑题，返回 { seed, itemIds } 的 JSON。
   * 供 startAttempt 写入 assessment_attempts.paper_json：同一学生重入复用同一条 attempt，
   * 因此卷面稳定；不同学生种子不同 → 卷不同。题库不足时抛 409（不静默少题）。
   */
  private buildPaper(assessmentId: string, rules: NonNullable<AssessmentSettings['draw']>, seed: string): string {
    const items = this.readItems(assessmentId);
    let pool = items;
    if (
      rules.type ||
      (rules.tags && rules.tags.length > 0) ||
      rules.difficultyMin !== undefined ||
      rules.difficultyMax !== undefined
    ) {
      const bankRows = this.db
        .prepare('SELECT id, type, tags_json, difficulty FROM question_bank_items')
        .all() as Array<{ id: string; type: string; tags_json: string; difficulty: number | null }>;
      const byId = new Map(bankRows.map((row) => [row.id, row]));
      pool = items.filter((item) => {
        const bank = item.bankItemId ? byId.get(item.bankItemId) : undefined;
        if (!bank) return false;
        if (rules.type && bank.type !== rules.type) return false;
        if (rules.difficultyMin !== undefined && (bank.difficulty === null || bank.difficulty < rules.difficultyMin)) {
          return false;
        }
        if (rules.difficultyMax !== undefined && (bank.difficulty === null || bank.difficulty > rules.difficultyMax)) {
          return false;
        }
        if (rules.tags && rules.tags.length > 0) {
          const tags = safeJsonParse<string[]>(bank.tags_json, []);
          if (!rules.tags.some((tag) => tags.includes(tag))) return false;
        }
        return true;
      });
    }
    if (pool.length < rules.count) {
      throw conflict('题库题目不足：需要 ' + rules.count + ' 道，可用 ' + pool.length + ' 道');
    }
    const picked = seededShuffle(pool, seed).slice(0, rules.count);
    return JSON.stringify({ seed, itemIds: picked.map((item) => item.id) });
  }

  /** 本次作答的卷面题目顺序；null = 整卷（未配置抽题规则）。 */
  private paperItemIds(attempt: { paper_json?: string | null }): string[] | null {
    const raw = attempt.paper_json;
    if (!raw) return null;
    const parsed = safeJsonParse<{ itemIds?: unknown }>(raw, {});
    if (!Array.isArray(parsed.itemIds)) return null;
    const ids = parsed.itemIds.filter((id): id is string => typeof id === 'string');
    return ids.length > 0 ? ids : null;
  }

  /** 按卷面过滤并排序题目；未配置抽题时保持原样。 */
  private itemsForAttempt<T extends { id: string }>(attempt: { paper_json?: string | null }, items: T[]): T[] {
    const paperIds = this.paperItemIds(attempt);
    if (!paperIds) return items;
    const byId = new Map(items.map((item) => [item.id, item]));
    return paperIds.map((id) => byId.get(id)).filter((item): item is T => Boolean(item));
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
    // Issue #186：判分只针对本卷题目（每人一卷时不把未抽到的题算成全错）
    const items = this.itemsForAttempt(attempt, this.readItems(assessmentId));

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
    // Issue #186：配置抽题规则时只给学生本次抽到的题目（按卷面顺序）
    const items = this.itemsForAttempt(attempt, this.readItems(assessment.id));
    const answerRows = this.db
      .prepare('SELECT * FROM assessment_answers WHERE attempt_id = ?')
      .all(attempt.id) as AnswerRow[];
    const answers: Record<string, unknown> = {};
    for (const row of answerRows) answers[row.item_id] = safeJsonParse<unknown>(row.answer_json, null);

    let sortedItems = items.sort((a, b) => a.sortOrder - b.sortOrder);
    if (settings.shuffleItems) {
      sortedItems = seededShuffle(sortedItems, attempt.id);
    }
    let studentItems = sortedItems.map(toStudentItemView);
    if (settings.shuffleOptions) {
      studentItems = studentItems.map((it) => {
        if (it.config && Array.isArray((it.config as any).options)) {
          return {
            ...it,
            config: {
              ...it.config,
              options: seededShuffle((it.config as any).options, `${attempt.id}_${it.id}`),
            },
          };
        }
        return it;
      });
    }

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
      // 学生端只拿到「没有 answerKey」的题目快照（支持按配置乱序）
      items: studentItems,
      answers,
    };
  }

  private buildResultPayload(attempt: AttemptRow) {
    const assignment = this.getAssignment(attempt.assignment_id);
    const assessment = this.db
      .prepare('SELECT * FROM assessments WHERE id = ?')
      .get(assignment.assessmentId) as AssessmentRow;
    const settings = parseAssessmentSettings(assessment.kind, safeJsonParse(assessment.settings_json, {}));
    // Issue #186：结果页同样只展示本卷题目
    const items = this.itemsForAttempt(attempt, this.readItems(assessment.id)).sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
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

/* ────────────────────── 试卷导出 / 导入辅助（Issue #196）────────────────────── */

/** 导出协议标识。导入时版本不匹配只告警不报错（向前兼容），字段顺序与语义保持不变。 */
export const PAPER_EXPORT_SCHEMA = 'openlearn.assessment.paper/v1';

/** CSV/XLSX 明细页的列序。导出与导入共用同一份定义，避免两边逐字码。 */
export const PAPER_CSV_COLUMNS = ['order', 'section', 'type', 'stem', 'config', 'answerKey', 'maxScore'] as const;

export interface PaperExportItem {
  order: number;
  section: string | null;
  /** 题型标记：内置如 `single_choice`，插件题型为 `<pluginId>:<name>` */
  type: string;
  stem: string;
  config: unknown;
  answerKey: unknown;
  maxScore: number;
}

export interface PaperExport {
  schema: typeof PAPER_EXPORT_SCHEMA;
  exportedAt: number;
  assessment: { title: string; kind: AssessmentKind; description: string | null; settings: unknown };
  items: PaperExportItem[];
}

/**
 * 带机器可读 `code` 的错误（路由层会透传 4xx 的 code）。
 *
 * 导入是外部数据入口，前端需要按 code 分支处理（`QUESTION_TYPE_NOT_INSTALLED` 要引导去
 * 装插件，`PAPER_IMPORT_INVALID_JSON` 要提示文件坏了），不能靠中文文案做字符串嗅探。
 */
function codedError(status: number, message: string, code: string): AssessmentError & { code: string } {
  return Object.assign(new AssessmentError(status, message), { code });
}

/** CSV 单元格 → JSON。空串视为缺失（`undefined`），不是 `null` —— 两款语义不同：
 *  `undefined` = 导出时就没写，`null` = 明确无标准答案（进人工批改队列）。 */
function optionalJsonCell(cell: string | undefined): unknown {
  const text = (cell ?? '').trim();
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    // 不是 JSON 就当纯字符串用（例如老师手工填的参考答案）
    return text;
  }
}

/**
 * 最小 RFC4180 CSV 解析（支持引号、转义双引号、CRLF）。
 *
 * 不引第三方库：这里只需要“把自家导出的文件读回来”，而仓库已有 csv 写入侧
 * 的 `csvCell`；引一个解析库会让插件题型的 config（含嵌套 JSON）多一层依赖面。
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  // 去掉 BOM：Excel 另存后的 CSV 开头会带 U+FEFF，否则首列表头永远匹配不上
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      // CRLF 当单个换行：`\r` 后紧跟 `\n` 时跳过后一个
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** 进程内单例（路由使用）。 */
export const assessmentService = new AssessmentService();
