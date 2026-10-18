/**
 * 测评设置（`assessments.settings_json`）：解析、校验、按类型补默认值。
 *
 * 关键规则：
 * - 三种类型（quiz/exam/survey）只通过本配置区分行为，因此这里是"行为差异"的唯一出处。
 * - survey 无标准答案、不计分 → 强制 `maxAttempts = 1`、`scorePolicy = 'last'`（占位，不参与统计）。
 * - exam 一次作答、交卷后不即时公布成绩。
 * - 任何未识别的取值落到**更安全/更严格**的一侧（与仓库 `normalizeMaxHeapMb`、
 *   `normalizePermissionPolicy` 的原则一致：拼错一个值不能静默放宽约束）。
 */
import type { AssessmentKind, ResultVisibility, ScorePolicy } from './types.js';

export interface AssessmentSettings {
  /** 是否整卷限时（配合 `assessment_assignments.duration_sec`） */
  timed: boolean;
  /** 允许的作答次数；exam/survey 恒为 1 */
  maxAttempts: number;
  /** 多次作答的聚合口径 */
  scorePolicy: ScorePolicy;
  /** 题目顺序乱序 */
  shuffleItems: boolean;
  /** 选项顺序乱序 */
  shuffleOptions: boolean;
  /** 匿名（仅 survey 可用；quiz/exam 强制 false） */
  anonymous: boolean;
  /** 结果可见性 */
  resultVisibility: ResultVisibility;
  /** 多选少选是否给部分分（错选恒为 0） */
  partialCredit: boolean;
  /** 填空题是否大小写敏感 */
  caseSensitive: boolean;
  /** 是否计入成绩（quiz 可选；exam 恒 true；survey 恒 false） */
  countsTowardGrade: boolean;
  /** 是否允许交卷后查看逐题解析 */
  showItemAnalysis: boolean;
  /** 严格监考模式（失焦/切屏/退出全屏记录与全屏锁定） */
  strictProctor?: boolean;
}

const DEFAULT_SETTINGS: AssessmentSettings = {
  timed: false,
  maxAttempts: 1,
  scorePolicy: 'last',
  shuffleItems: false,
  shuffleOptions: false,
  anonymous: false,
  resultVisibility: 'immediate',
  partialCredit: true,
  caseSensitive: false,
  countsTowardGrade: false,
  showItemAnalysis: true,
  strictProctor: false,
};

const SCORE_POLICIES: readonly ScorePolicy[] = ['first', 'last', 'highest', 'average'];
const RESULT_VISIBILITIES: readonly ResultVisibility[] = ['immediate', 'after_release', 'score_only'];

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1) return true;
  if (value === 'false' || value === 0) return false;
  return fallback;
}

function asPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return fallback;
  return n;
}

/**
 * 解析设置。`kind` 决定强制项，因此必须传入。
 * 非法值一律回落到该类型的默认（而不是 `undefined` 或"无限"）。
 */
export function parseAssessmentSettings(kind: AssessmentKind, raw: unknown): AssessmentSettings {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const scorePolicy = SCORE_POLICIES.includes(input.scorePolicy as ScorePolicy)
    ? (input.scorePolicy as ScorePolicy)
    : DEFAULT_SETTINGS.scorePolicy;
  const resultVisibility = RESULT_VISIBILITIES.includes(input.resultVisibility as ResultVisibility)
    ? (input.resultVisibility as ResultVisibility)
    : DEFAULT_SETTINGS.resultVisibility;

  const parsed: AssessmentSettings = {
    timed: asBool(input.timed, DEFAULT_SETTINGS.timed),
    maxAttempts: asPositiveInt(input.maxAttempts, DEFAULT_SETTINGS.maxAttempts),
    scorePolicy,
    shuffleItems: asBool(input.shuffleItems, DEFAULT_SETTINGS.shuffleItems),
    shuffleOptions: asBool(input.shuffleOptions, DEFAULT_SETTINGS.shuffleOptions),
    anonymous: asBool(input.anonymous, DEFAULT_SETTINGS.anonymous),
    resultVisibility,
    partialCredit: asBool(input.partialCredit, DEFAULT_SETTINGS.partialCredit),
    caseSensitive: asBool(input.caseSensitive, DEFAULT_SETTINGS.caseSensitive),
    countsTowardGrade: asBool(input.countsTowardGrade, DEFAULT_SETTINGS.countsTowardGrade),
    showItemAnalysis: asBool(input.showItemAnalysis, DEFAULT_SETTINGS.showItemAnalysis),
    strictProctor: asBool(input.strictProctor, kind === 'exam'),
  };

  // ── 按类型强制收敛行为差异 ──────────────────────────────────────────
  if (kind === 'survey') {
    // 问卷不计分、无标准答案；匿名只对问卷开放
    parsed.maxAttempts = 1;
    parsed.countsTowardGrade = false;
    parsed.resultVisibility = 'score_only';
    parsed.showItemAnalysis = false;
    parsed.strictProctor = false;
  } else if (kind === 'exam') {
    parsed.maxAttempts = 1;
    parsed.countsTowardGrade = true;
    parsed.strictProctor = true;
    // 考试必须"教师发布后"才出分，避免学生提前看到答案互相传
    if (parsed.resultVisibility === 'immediate') parsed.resultVisibility = 'after_release';
  } else {
    // quiz：实名，匿名配置无效
    parsed.anonymous = false;
  }

  return parsed;
}

/** 序列化回 `settings_json`（只写归一化后的值，避免脏值反复流转）。 */
export function serializeAssessmentSettings(settings: AssessmentSettings): string {
  return JSON.stringify(settings);
}

/** 该类型的默认设置（校验时的比较基准）。 */
export function defaultAssessmentSettings(kind: AssessmentKind): AssessmentSettings {
  return parseAssessmentSettings(kind, {});
}
