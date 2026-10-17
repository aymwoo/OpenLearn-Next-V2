/**
 * 判分引擎：单题判分 → 整卷汇总 → 多次作答聚合。
 *
 * 三条不变量（来自 issue #100 验收标准，全部有单测锁死）：
 * 1. **无法判分的题返回 `null`，不兜底成 0 或满分**；
 * 2. **判分幂等**：同样的输入永远得到同样的输出（纯函数、不依赖时间/随机）；
 * 3. **教师手动改过的分不被自动判分覆盖**（由调用方按 `manualOverride` 跳过，见
 *    `server/services/assessment-service.ts` 的 regrade 逻辑）。
 */
import { roundScore } from './question-types/types.js';
import type { GradeContext } from './question-types/types.js';
import type { QuestionTypeRegistry } from './question-types/registry.js';
import type {
  AggregatedScore,
  AssessmentItemRecord,
  AttemptGradeSummary,
  ItemGradeResult,
  ScorePolicy,
} from './types.js';

/** 判一题。题型未注册视为"无法判分"（进人工队列），而不是判 0 —— 插件被卸载不冤枉学生。 */
export function gradeItem(
  registry: QuestionTypeRegistry,
  item: Pick<AssessmentItemRecord, 'id' | 'type' | 'config' | 'answerKey' | 'maxScore'>,
  answer: unknown,
  ctx: Omit<GradeContext, 'maxScore'>,
): ItemGradeResult {
  const definition = registry.get(item.type);
  if (!definition) {
    return {
      score: null,
      isCorrect: null,
      needsManualReview: true,
      feedback: `未注册的题型：${item.type}`,
    };
  }
  if (!definition.autoGradable) {
    return { score: null, isCorrect: null, needsManualReview: true, feedback: '待人工批改' };
  }
  const result = definition.grade(item.config, item.answerKey, answer, {
    ...ctx,
    maxScore: item.maxScore,
  });
  // 防御：题型的 grade 自己越界/返回 NaN 时不能污染总分
  if (result.score === null || result.score === undefined) {
    return { ...result, score: null, needsManualReview: true };
  }
  const maxScore = item.maxScore;
  const score = Number.isFinite(result.score) ? Math.min(Math.max(result.score, 0), maxScore) : 0;
  return { ...result, score: roundScore(score) };
}

/**
 * 判一整卷。
 *
 * `answers` 用 itemId → 作答 的映射；缺答的题按"空作答"判（客观题得 0，主观题仍进人工队列）。
 */
export function gradeAttempt(
  registry: QuestionTypeRegistry,
  items: AssessmentItemRecord[],
  answers: Record<string, unknown>,
  ctx: Omit<GradeContext, 'maxScore'>,
): AttemptGradeSummary {
  const ordered = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  let score = 0;
  let maxScore = 0;
  let needsManualReview = false;
  const results: AttemptGradeSummary['items'] = [];

  for (const item of ordered) {
    maxScore += item.maxScore;
    const hasAnswer = Object.prototype.hasOwnProperty.call(answers, item.id);
    const result = gradeItem(registry, item, hasAnswer ? answers[item.id] : null, ctx);
    if (result.score === null) {
      needsManualReview = true;
    } else {
      score += result.score;
    }
    results.push({ itemId: item.id, result });
  }

  return { score: roundScore(score), maxScore: roundScore(maxScore), needsManualReview, items: results };
}

/**
 * 多次作答的聚合（`first` / `last` / `highest` / `average`）。
 *
 * 只考虑 **已交卷**的尝试；`submitted` 但仍有待批改题的尝试会给结果打上 `provisional`。
 * 无任何有效尝试时返回 `score: null`（不是 0 —— 没作答和有作答是两件事）。
 */
export function aggregateScores(
  attempts: Array<{
    id: string;
    score: number | null;
    maxScore: number | null;
    needsManualReview: boolean;
    submittedAt: number | null;
    attemptNo: number;
  }>,
  policy: ScorePolicy,
): AggregatedScore {
  const valid = attempts
    .filter((a) => typeof a.score === 'number')
    .sort((a, b) => {
      if (a.attemptNo !== b.attemptNo) return a.attemptNo - b.attemptNo;
      return (a.submittedAt ?? 0) - (b.submittedAt ?? 0);
    });

  if (valid.length === 0) {
    return { score: null, maxScore: null, attemptId: null, consideredAttempts: 0, provisional: false };
  }

  const provisional = valid.some((a) => a.needsManualReview);

  const pick = (): { attempt: (typeof valid)[number]; score: number } => {
    switch (policy) {
      case 'first':
        return { attempt: valid[0], score: valid[0].score as number };
      case 'highest': {
        let best = valid[0];
        for (const a of valid) if ((a.score as number) > (best.score as number)) best = a;
        return { attempt: best, score: best.score as number };
      }
      case 'average': {
        const sum = valid.reduce((acc, a) => acc + (a.score as number), 0);
        // 平均分代表"整卷整体"，没有单个 attempt 可指认
        return { attempt: valid[valid.length - 1], score: roundScore(sum / valid.length) };
      }
      case 'last':
      default:
        return { attempt: valid[valid.length - 1], score: valid[valid.length - 1].score as number };
    }
  };

  const chosen = pick();
  return {
    score: roundScore(chosen.score),
    maxScore: chosen.attempt.maxScore,
    attemptId: policy === 'average' ? null : chosen.attempt.id,
    consideredAttempts: valid.length,
    provisional,
  };
}

/** 按百分比折算到 0–100（导出与成绩回写用）。满分 0 时返回 null，避免除零。 */
export function toPercent(score: number | null, maxScore: number | null): number | null {
  if (score === null || maxScore === null || maxScore <= 0) return null;
  return roundScore((score / maxScore) * 100);
}
