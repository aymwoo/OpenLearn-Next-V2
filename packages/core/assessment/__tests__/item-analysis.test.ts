/**
 * 项分析：难度 / 区分度（Issue #184）。
 */
import { describe, expect, it } from 'vitest';
import {
  computeItemAnalysis,
  DEFAULT_MIN_SAMPLE_SIZE,
  discriminationLevelOf,
  pearsonCorrelation,
  toItemAnalysisCsv,
} from '../item-analysis.js';

const ITEMS = [
  { id: 'i1', type: 'single_choice', maxScore: 10, sortOrder: 1 },
  { id: 'i2', type: 'short_answer', maxScore: 20, sortOrder: 2 },
];

describe('难度 (p 值)', () => {
  it('平均得分 / 满分，支持部分得分', () => {
    const rows = computeItemAnalysis(ITEMS, [
      { totalScore: 30, scores: { i1: 10, i2: 20 } },
      { totalScore: 10, scores: { i1: 5, i2: 5 } },
    ]);
    // i1: (10+5)/2 = 7.5 / 10 = 0.75
    expect(rows[0].meanScore).toBe(7.5);
    expect(rows[0].difficulty).toBe(0.75);
    // i2: (20+5)/2 = 12.5 / 20 = 0.625
    expect(rows[1].difficulty).toBe(0.625);
  });

  it('未判分的作答不计入难度（不把待批改当成 0 分）', () => {
    const rows = computeItemAnalysis(ITEMS, [
      { totalScore: 10, scores: { i1: 10, i2: null } },
      { totalScore: 5, scores: { i1: 5 } },
    ]);
    expect(rows[1].answered).toBe(1);
    expect(rows[1].sampleSize).toBe(0);
    expect(rows[1].difficulty).toBeNull();
  });

  it('全部满分时难度为 1，全部 0 分时为 0', () => {
    const full = computeItemAnalysis(
      [ITEMS[0]],
      [
        { totalScore: 10, scores: { i1: 10 } },
        { totalScore: 10, scores: { i1: 10 } },
      ],
    );
    expect(full[0].difficulty).toBe(1);

    const zero = computeItemAnalysis(
      [ITEMS[0]],
      [
        { totalScore: 0, scores: { i1: 0 } },
        { totalScore: 0, scores: { i1: 0 } },
      ],
    );
    expect(zero[0].difficulty).toBe(0);
  });
});

describe('区分度 (r)', () => {
  it('样本量低于阈值时返回 null', () => {
    const attempts = Array.from({ length: DEFAULT_MIN_SAMPLE_SIZE - 1 }, (_, index) => ({
      totalScore: index + 1,
      scores: { i1: index },
    }));
    const rows = computeItemAnalysis([ITEMS[0]], attempts);
    expect(rows[0].sampleSize).toBe(DEFAULT_MIN_SAMPLE_SIZE - 1);
    expect(rows[0].discrimination).toBeNull();
    expect(rows[0].discriminationLevel).toBeNull();
  });

  it('题目得分与剩余卷面分正相关时区分度为正', () => {
    // item 得分 [0,0,0,1,1,1]，剩余分 [0,0,1,1,2,2]
    // item 得分 [0,0,0,1,1,1]，剩余分 [0,0,1,1,2,2] → 总分 [0,0,1,2,3,3]
    const attempts = [
      { totalScore: 0, scores: { i1: 0 } },
      { totalScore: 0, scores: { i1: 0 } },
      { totalScore: 1, scores: { i1: 0 } },
      { totalScore: 2, scores: { i1: 1 } },
      { totalScore: 3, scores: { i1: 1 } },
      { totalScore: 3, scores: { i1: 1 } },
    ];
    const rows = computeItemAnalysis([ITEMS[0]], attempts);
    // 手算：ρ = 0.3333 / sqrt(0.25 * 0.6667) ≈ 0.8165
    expect(rows[0].discrimination).toBeCloseTo(0.8165, 3);
    expect(rows[0].discriminationLevel).toBe('high');
  });

  it('全对/全错（题目方差为 0）时区分度为 null，而不是 NaN', () => {
    const allRight = computeItemAnalysis(
      [ITEMS[0]],
      [
        { totalScore: 10, scores: { i1: 10 } },
        { totalScore: 12, scores: { i1: 10 } },
        { totalScore: 14, scores: { i1: 10 } },
        { totalScore: 16, scores: { i1: 10 } },
        { totalScore: 18, scores: { i1: 10 } },
      ],
    );
    expect(allRight[0].discrimination).toBeNull();
    expect(allRight[0].discriminationLevel).toBeNull();

    const allWrong = computeItemAnalysis(
      [ITEMS[0]],
      [
        { totalScore: 0, scores: { i1: 0 } },
        { totalScore: 2, scores: { i1: 0 } },
        { totalScore: 4, scores: { i1: 0 } },
        { totalScore: 6, scores: { i1: 0 } },
        { totalScore: 8, scores: { i1: 0 } },
      ],
    );
    expect(allWrong[0].discrimination).toBeNull();
  });

  it('剩余卷面分方差为 0 时区分度为 null', () => {
    // item [0,1,0,1,0]，剩余分恒为 5 → 总分 [5,6,5,6,5]
    const attempts = [0, 1, 0, 1, 0].map((score) => ({
      totalScore: score + 5,
      scores: { i1: score },
    }));
    const rows = computeItemAnalysis([ITEMS[0]], attempts);
    expect(rows[0].discrimination).toBeNull();
  });
});

describe('辅助函数', () => {
  it('pearsonCorrelation 对非法输入返回 null', () => {
    expect(pearsonCorrelation([1, 2], [1, 2, 3])).toBeNull();
    expect(pearsonCorrelation([1], [1])).toBeNull();
    expect(pearsonCorrelation([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(pearsonCorrelation([1, 2, 3], [2, 2, 2])).toBeNull();
  });

  it('区分度分级阈值', () => {
    expect(discriminationLevelOf(0.4)).toBe('high');
    expect(discriminationLevelOf(-0.45)).toBe('high');
    expect(discriminationLevelOf(0.2)).toBe('medium');
    expect(discriminationLevelOf(0.19)).toBe('low');
    expect(discriminationLevelOf(null)).toBeNull();
  });

  it('按 sortOrder 输出并保留原题号顺序', () => {
    const rows = computeItemAnalysis(
      [
        { id: 'b', type: 'boolean', maxScore: 5, sortOrder: 2 },
        { id: 'a', type: 'single_choice', maxScore: 5, sortOrder: 1 },
      ],
      [{ totalScore: 10, scores: { a: 5, b: 5 } }],
    );
    expect(rows.map((row) => row.itemId)).toEqual(['a', 'b']);
    expect(rows.map((row) => row.order)).toEqual([0, 1]);
  });

  it('CSV 导出带中文表头，null 输出为空单元格', () => {
    const rows = computeItemAnalysis([ITEMS[0]], [{ totalScore: 10, scores: { i1: 10 } }]);
    const csv = toItemAnalysisCsv(rows);
    const [header, first] = csv.split('\n');
    expect(header).toContain('题号');
    expect(header).toContain('难度 (p)');
    expect(header).toContain('区分度 (r)');
    expect(first).toMatch(/^1,single_choice,10,1,1,10,1,,$/);
  });
});
