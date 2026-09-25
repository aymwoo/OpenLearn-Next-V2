import { describe, it, expect } from 'vitest';
import { clusterPuzzledConcepts } from '../concept-clustering-engine';

describe('concept-clustering-engine', () => {
  it('当输入为空数组时给出高频物理核心概念优雅回退', () => {
    const result = clusterPuzzledConcepts([]);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].concept).toContain('变力做功');
    expect(result[0].remediationAdvice).toBeTruthy();
  });

  it('能精准映射规范概念并累计词频与权重', () => {
    const rawInputs = [
      '今天变力微元做功还是有点绕',
      '我想问微积分微元累加怎么算',
      '微元法的几何面积含义是什么',
      '斜面滑动临界条件摩擦突变没听懂',
      '动量守恒和能量守恒转化边界',
    ];

    const clusters = clusterPuzzledConcepts(rawInputs, 3);
    expect(clusters.length).toBe(3);

    // 微元出现 3 次，应为 Top 1
    expect(clusters[0].concept).toBe('变力做功与微元累加法');
    expect(clusters[0].frequency).toBe(3);
    expect(clusters[0].weight).toBeGreaterThan(0.4);
    expect(clusters[0].remediationAdvice).toContain('F-s 图象下的面积');
  });

  it('能过滤日常语气停用词（老师、感觉、这个、请问）', () => {
    const rawInputs = [
      '老师请问这个概念感觉大家可以',
      '老师请问这个概念感觉大家可以',
    ];

    const clusters = clusterPuzzledConcepts(rawInputs, 3);
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    // 停用词不应作为高频词出现
    expect(clusters.some((c) => c.concept === '老师')).toBe(false);
    expect(clusters.some((c) => c.concept === '这个')).toBe(false);
  });
});
