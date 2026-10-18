/**
 * 题型定义契约（`QuestionTypeRegistry` 的元素类型）。
 *
 * 前端与服务端共用同一个定义对象：服务端只关心 `autoGradable` / `grade` / 校验，
 * 前端在 PR B 里用同一份 `type` + `createDefaultConfig` 渲染 `Editor` / `Answer`。
 * 这样「题型」这个概念只存在一处，插件注册一次两端都生效。
 */
import type { AssessmentKind, ItemGradeResult, QuestionCategory } from '../types.js';

/** 判分时可用的上下文。故意只暴露必要字段，避免 grader 顺手读数据库。 */
export interface GradeContext {
  assessmentId: string;
  attemptId: string;
  /** 匿名问卷为 null */
  studentId: string | null;
  assessmentKind: AssessmentKind;
  maxScore: number;
  /** 来自 `assessments.settings_json` 的判分相关开关 */
  partialCredit: boolean;
  caseSensitive: boolean;
}

export interface QuestionTypeDefinition<TConfig = Record<string, unknown>, TAnswer = unknown> {
  /** 题型标识。插件题型必须以插件前缀命名，形如 `ext-code:python`。 */
  type: string;
  label: { zh: string; en: string };
  category: QuestionCategory;
  /** 该题型可用于哪些测评类型 */
  supports: AssessmentKind[];
  /** 是否有确定性判分实现；false 表示一律进人工批改队列 */
  autoGradable: boolean;

  /** 新题的默认展示配置 */
  createDefaultConfig(): TConfig;
  /** 校验展示配置；返回字符串表示错误原因，`null` 表示通过。 */
  validateConfig(config: unknown): string | null;
  /** 校验学生作答格式；返回字符串表示错误原因，`null` 表示通过。 */
  validateAnswer?(config: TConfig, answer: unknown): string | null;
  /**
   * 校验标准答案（`answer_key_json`）的格式。
   *
   * 返回字符串 = 格式非法（拒绝保存）；`null` = 通过。
   * 题目**允许没有标准答案**（此时判分进人工队列），因此 `undefined`/`null` 一律视为通过。
   */
  validateAnswerKey?(config: TConfig, answerKey: unknown): string | null;

  /**
   * 判分。
   *
   * 契约（不可违反）：
   * - `score` 必须在 `[0, ctx.maxScore]` 内；
   * - **无法判分时必须返回 `score: null`**，不得兜底成 0 或满分；
   * - 纯函数：不得读库、不得依赖时间/随机数。
   */
  grade(config: TConfig, answerKey: unknown, answer: TAnswer, ctx: GradeContext): ItemGradeResult;
}

/** 注册项：`pluginId` 非空表示插件拥有的题型，卸载时按 pluginId 批量清理。 */
export interface QuestionTypeRegistration {
  definition: QuestionTypeDefinition<any, any>;
  pluginId?: string;
}

/** 分数四舍五入到 2 位小数，避免 0.30000000000000004 这类噪音进入数据库。 */
export function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 把 grader 给出的分数夹到 `[0, maxScore]`，并统一取两位小数。 */
export function clampScore(score: number, maxScore: number): number {
  if (!Number.isFinite(score)) return 0;
  return roundScore(Math.min(Math.max(score, 0), maxScore));
}
