import { describe, it, expect } from 'vitest';
import { normalizeCompletionForDisplay, normalizeCompletionRatio } from '../completion.js';

describe('completion normalization', () => {
  it('0~1 比率原样保留', () => {
    expect(normalizeCompletionRatio(0)).toBe(0);
    expect(normalizeCompletionRatio(0.5)).toBe(0.5);
    expect(normalizeCompletionRatio(1)).toBe(1);
    expect(normalizeCompletionRatio('0.85')).toBe(0.85);
  });

  it('1~100 百分数折算为比率', () => {
    expect(normalizeCompletionRatio(85)).toBe(0.85);
    expect(normalizeCompletionRatio(100)).toBe(1);
    expect(normalizeCompletionRatio('85%')).toBe(0.85);
    expect(normalizeCompletionRatio('50')).toBe(0.5);
  });

  it('越界值截断', () => {
    expect(normalizeCompletionRatio(-3)).toBe(0);
    expect(normalizeCompletionRatio(150)).toBe(1);
  });

  it('布尔与空值', () => {
    expect(normalizeCompletionRatio(true)).toBe(1);
    expect(normalizeCompletionRatio(false)).toBe(0);
    expect(normalizeCompletionRatio(null)).toBeNull();
    expect(normalizeCompletionRatio(undefined)).toBeNull();
    expect(normalizeCompletionRatio('')).toBeNull();
    expect(normalizeCompletionRatio('abc')).toBeNull();
  });

  it('读取侧兼容历史 85 脏数据', () => {
    expect(normalizeCompletionForDisplay(85)).toBe(0.85);
    expect(normalizeCompletionForDisplay(1)).toBe(1);
    expect(normalizeCompletionForDisplay(0.85)).toBe(0.85);
    expect(normalizeCompletionForDisplay(null)).toBeNull();
  });
});
