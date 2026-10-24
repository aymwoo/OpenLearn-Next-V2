// @vitest-environment node
/**
 * 测评扩展槽的安全 props 投影（Issue #183）。
 *
 * 扩展点最重要的安全约束：插件拿到的 props 走**白名单**，标准答案绝不外泄。
 * 这里用哨兵字段做全量断言 —— 与 packages/core/assessment/serialize.ts 的单测同一条原则。
 */
import { describe, expect, it } from 'vitest';
import { toAssessmentListCardProps, toAssessmentStatsCardProps } from '../extension-slot-props';
import type { AssessmentStats, AssessmentSummary } from '../api';

const SENTINEL = 'SENTINEL_ANSWER_KEY_DO_NOT_LEAK';

function summaryWithSentinel(): AssessmentSummary & Record<string, unknown> {
  return {
    id: 'asm-1',
    kind: 'quiz',
    title: '单元小测',
    description: '第一章',
    status: 'published',
    academicYear: '2026',
    settings: { anonymous: false, maxAttempts: 1 } as never,
    itemCount: 3,
    totalScore: 30,
    createdAt: 1,
    updatedAt: 2,
    // 故意塞入敏感字段，验证投影不会透传
    answerKey: SENTINEL,
    answer_key_json: SENTINEL,
    studentId: SENTINEL,
  } as never;
}

function statsWithSentinel(): AssessmentStats & Record<string, unknown> {
  return {
    assignmentId: 'asg-1',
    attemptCount: 10,
    submittedCount: 8,
    gradedCount: 6,
    needsManualReviewCount: 2,
    averageScore: 80,
    averagePercent: 80,
    maxScore: 100,
    items: [
      {
        itemId: 'it-1',
        type: 'single_choice',
        stem: '1 + 1 = ?',
        maxScore: 10,
        answered: 10,
        graded: 10,
        correct: 9,
        correctRate: 0.9,
        avgScore: 9,
        distribution: { '10': 9, '0': 1 },
        answerKey: SENTINEL,
        answer_key_json: SENTINEL,
      } as never,
    ],
    answerKey: SENTINEL,
  } as never;
}

describe('测评扩展槽 props 白名单（Issue #183）', () => {
  it('list.card props 不含 answerKey / answer_key_json / studentId', () => {
    const props = toAssessmentListCardProps(summaryWithSentinel());
    const json = JSON.stringify(props);
    expect(json).not.toContain(SENTINEL);
    expect(json).not.toContain('answerKey');
    expect(json).not.toContain('answer_key_json');
    expect(json).not.toContain('studentId');
    // 白名单字段齐全
    expect(props.id).toBe('asm-1');
    expect(props.itemCount).toBe(3);
    expect(props.totalScore).toBe(30);
    expect(Object.keys(props).sort()).toEqual(
      [
        'createdAt',
        'description',
        'id',
        'itemCount',
        'kind',
        'settings',
        'status',
        'title',
        'totalScore',
        'updatedAt',
      ].sort(),
    );
  });

  it('stats.card props 逐题统计不含标准答案，仅保留聚合字段', () => {
    const props = toAssessmentStatsCardProps(statsWithSentinel());
    const json = JSON.stringify(props);
    expect(json).not.toContain(SENTINEL);
    expect(json).not.toContain('answerKey');
    expect(json).not.toContain('answer_key_json');
    expect(props.items).toHaveLength(1);
    expect(Object.keys(props.items[0]).sort()).toEqual(
      [
        'answered',
        'avgScore',
        'correct',
        'correctRate',
        'distribution',
        'graded',
        'itemId',
        'maxScore',
        'stem',
        'type',
      ].sort(),
    );
  });
});
