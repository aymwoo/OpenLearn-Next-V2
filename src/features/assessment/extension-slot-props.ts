/**
 * 测评扩展槽的安全 props 投影（Issue #183）。
 *
 * **白名单**，不靠删除敏感字段：插件扩展只拿到显式列出的摘要字段。
 * 标准答案（`answerKey` / `answer_key_json`）、学生身份、逐个学生作答一律不进入 props。
 * 新增字段默认不可见 —— 与 `packages/core/assessment/serialize.ts` 的同一条原则一致。
 *
 * 回归测试：`__tests__/assessment-extension-slots.test.tsx` 用哨兵字段断言。
 */
import type { AssessmentStats, AssessmentSummary } from './api';

export interface AssessmentListCardProps {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  status: string;
  itemCount: number;
  totalScore: number;
  settings: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** 列表卡片槽 props：只含卷面摘要，不含题目/答案。 */
export function toAssessmentListCardProps(item: AssessmentSummary): AssessmentListCardProps {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    description: item.description,
    status: item.status,
    itemCount: item.itemCount,
    totalScore: item.totalScore,
    settings: item.settings as unknown as Record<string, unknown>,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export interface AssessmentStatsCardProps {
  attemptCount: number;
  submittedCount: number;
  gradedCount: number;
  needsManualReviewCount: number;
  averageScore: number | null;
  averagePercent: number | null;
  maxScore: number;
  items: Array<{
    itemId: string;
    type: string;
    stem: string;
    maxScore: number;
    answered: number;
    graded: number;
    correct: number;
    correctRate: number | null;
    avgScore: number | null;
    distribution: Record<string, number>;
  }>;
}

/**
 * 统计卡片槽 props：逐题只给聚合计数与分布，**不含标准答案**。
 * 题干（stem）是学生可见内容，安全。
 */
export function toAssessmentStatsCardProps(stats: AssessmentStats): AssessmentStatsCardProps {
  return {
    attemptCount: stats.attemptCount,
    submittedCount: stats.submittedCount,
    gradedCount: stats.gradedCount,
    needsManualReviewCount: stats.needsManualReviewCount,
    averageScore: stats.averageScore,
    averagePercent: stats.averagePercent,
    maxScore: stats.maxScore,
    items: stats.items.map((item) => ({
      itemId: item.itemId,
      type: item.type,
      stem: item.stem,
      maxScore: item.maxScore,
      answered: item.answered,
      graded: item.graded,
      correct: item.correct,
      correctRate: item.correctRate,
      avgScore: item.avgScore,
      distribution: item.distribution,
    })),
  };
}
