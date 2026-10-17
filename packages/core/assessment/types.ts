/**
 * 测评子系统 · 领域类型（Issue #100 / 子 issue #120）。
 *
 * 这里只有**纯数据与纯函数**：不 import express、不 import React、不碰数据库。
 * 前端（教师出题页 / 学生作答页）与服务端（判分、发布、统计）共用同一套类型与规则，
 * 避免出现 #107 那种「前端按索引判、后端按文本判」的双口径。
 */

/** 三种测评类型：只通过配置区分行为，共用同一套试卷 / 题目 / 作答 / 判分模型。 */
export type AssessmentKind = 'quiz' | 'exam' | 'survey';

/** 试卷状态机：draft → published → closed → archived。发布后试卷只读。 */
export type AssessmentStatus = 'draft' | 'published' | 'closed' | 'archived';

/** 布置状态：教师可主动关闭（关闭后不再接受新作答）。 */
export type AssignmentStatus = 'open' | 'closed';

/**
 * 单次作答状态：
 * - `in_progress` 作答中（可自动保存）
 * - `submitted` 已交卷（可能仍有题待人工批改）
 * - `graded` 全部题判分完成
 * - `released` 成绩已发布（教师发布或配置为交卷即显示）
 */
export type AttemptStatus = 'in_progress' | 'submitted' | 'graded' | 'released';

/** 多次作答的聚合口径。survey 与 exam 强制单次，见 `settings.ts`。 */
export type ScorePolicy = 'first' | 'last' | 'highest' | 'average';

/** 结果可见性：`immediate` 交卷即显示对错与解析；`after_release` 教师发布后才可见。 */
export type ResultVisibility = 'immediate' | 'after_release' | 'score_only';

/** 判分来源。`plugin:<id>` 表示由插件题型 grader 判分。 */
export type GraderSource = 'auto' | 'manual' | 'ai_suggested' | `plugin:${string}`;

/** 题型类别：客观题（可自动判分）/ 主观题（人工）/ 问卷专用 / 插件自定义。 */
export type QuestionCategory = 'objective' | 'subjective' | 'survey' | 'custom';

/** 题型支持的测评类型。 */
export interface QuestionTypeCapabilities {
  supports: AssessmentKind[];
  /** 是否有服务端 grader（问卷题一律 false） */
  autoGradable: boolean;
  category: QuestionCategory;
}

/** 题目在试卷中的快照形态（`assessment_items` 一行）。 */
export interface AssessmentItemRecord {
  id: string;
  assessmentId: string;
  /** 溯源用，题库条目被删后仍保留快照，故可为 null */
  bankItemId: string | null;
  section: string | null;
  sortOrder: number;
  /** 题型 type（内置或插件题型，插件题型形如 `ext-code:python`） */
  type: string;
  stem: string;
  /** 题型的展示配置（选项、占位符、空位数量等），**不含答案** */
  config: Record<string, unknown>;
  /** 标准答案，**仅服务端可见**，绝不进入学生端响应 */
  answerKey: unknown;
  maxScore: number;
}

/** 单题作答。`answer` 的形状由题型决定，服务端只做透传与判分。 */
export interface AssessmentAnswerRecord {
  attemptId: string;
  itemId: string;
  answer: unknown;
  score: number | null;
  maxScore: number;
  isCorrect: boolean | null;
  grader: GraderSource | null;
  feedback: string | null;
  gradedBy: string | null;
  gradedAt: number | null;
  /** 教师手动改过的行不再被自动判分覆盖 */
  manualOverride: boolean;
  updatedAt: number;
}

/** 单题判分结果。`score: null` 表示无法自动判分 → 进入人工批改队列。 */
export interface ItemGradeResult {
  score: number | null;
  isCorrect?: boolean | null;
  feedback?: string;
  /** grader 明确要求人工复核（简答类、插件题型返回 null 时自动置 true） */
  needsManualReview?: boolean;
}

/** 整卷判分汇总。 */
export interface AttemptGradeSummary {
  /** 已判分部分的合计分 */
  score: number;
  /** 全卷满分 */
  maxScore: number;
  /** 是否还有题在等人工批改 */
  needsManualReview: boolean;
  /** 每题结果，按题号顺序 */
  items: Array<{ itemId: string; result: ItemGradeResult }>;
}

/** 聚合口径下的有效分：多次作答里"算数"的那一次。 */
export interface AggregatedScore {
  score: number | null;
  maxScore: number | null;
  attemptId: string | null;
  /** 参与聚合的已判分尝试数 */
  consideredAttempts: number;
  /** true 表示存在待人工批改的尝试，聚合结果可能是暂定的 */
  provisional: boolean;
}
