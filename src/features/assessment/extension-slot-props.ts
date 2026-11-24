/**
 * 测评扩展槽的安全 props 投影（Issue #183）。
 *
 * **白名单**，不靠删除敏感字段：插件扩展只拿到显式列出的摘要字段。
 * 标准答案（`answerKey` / `answer_key_json`）、学生身份、逐个学生作答一律不进入 props。
 * 新增字段默认不可见 —— 与 `packages/core/assessment/serialize.ts` 的同一条原则一致。
 *
 * 回归测试：`__tests__/assessment-extension-slots.test.tsx` 用哨兵字段断言。
 */
import type {
  AssessmentEditorItemSummary,
  BankItemSummary,
  StudentAssessmentAttemptSummary,
  TeacherAssessmentCardSummary,
} from '../../plugin-host/types';
import type { AssessmentItemView, AssessmentStats, AssessmentSummary, BankItem, StudentAssignmentEntry } from './api';

/** 教师列表卡片摘要：只含卷面摘要，不含题目/答案。 */
export function toAssessmentListCardProps(item: AssessmentSummary): TeacherAssessmentCardSummary {
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

/**
 * 学生列表卡片 props（Q1）。
 *
 * 注意 `assessment.id` 是 **assignmentId**；`settings` 刻意不下发，
 * `score` 由服务端按可见性置 null，扩展不得自行推断。
 */
export function toStudentAssessmentListCardProps(entry: StudentAssignmentEntry): {
  viewer: 'student';
  assessment: {
    id: string;
    assessmentId: string;
    kind: string;
    title: string;
    classId: string;
    lessonId: string | null;
    windowState: StudentAssignmentEntry['windowState'];
    completed: boolean;
    opensAt: number | null;
    closesAt: number | null;
    durationSec: number | null;
  };
  attempt: StudentAssessmentAttemptSummary | null;
} {
  return {
    viewer: 'student',
    assessment: {
      id: entry.assignmentId,
      assessmentId: entry.assessmentId,
      kind: entry.kind,
      title: entry.title,
      classId: entry.classId,
      lessonId: entry.lessonId,
      windowState: entry.windowState,
      completed: entry.completed,
      opensAt: entry.opensAt,
      closesAt: entry.closesAt,
      durationSec: entry.durationSec,
    },
    attempt: entry.attempt
      ? {
          attemptNo: entry.attempt.attemptNo,
          status: entry.attempt.status,
          submittedAt: entry.attempt.submittedAt,
          score: entry.attempt.score,
          maxScore: entry.attempt.maxScore,
          needsManualReview: entry.attempt.needsManualReview,
        }
      : null,
  };
}

/** 题库条目只读投影：不含 config / answerKey / ownerId。 */
export function toBankItemSummary(item: BankItem): BankItemSummary {
  return {
    id: item.id,
    type: item.type,
    stem: item.stem,
    tags: Array.isArray(item.tags) ? item.tags : [],
    difficulty: item.difficulty ?? null,
    visibility: item.visibility === 'school' ? 'school' : 'private',
    ownerIsSelf: Boolean(item.ownerIsSelf),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/** 组卷逐题只读投影（L2 敏感字段由调用方经 sensitive-props 追加）。 */
export function toEditorItemSummary(
  item: Pick<AssessmentItemView, 'id' | 'type' | 'stem' | 'maxScore'> & {
    section?: string | null;
    sortOrder?: number;
  },
  index: number,
): AssessmentEditorItemSummary {
  return {
    id: item.id,
    type: item.type,
    stem: item.stem,
    maxScore: item.maxScore,
    section: item.section ?? null,
    sortOrder: item.sortOrder ?? index,
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
