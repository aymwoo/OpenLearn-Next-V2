import { describe, it, expect } from 'vitest';
import { measurePaddingBox, measureScrollbarThickness } from '../scrollbar-thickness';

describe('scrollbar-thickness', () => {
  it('measureScrollbarThickness 返回非负有限值', () => {
    const thickness = measureScrollbarThickness();
    expect(Number.isFinite(thickness)).toBe(true);
    expect(thickness).toBeGreaterThanOrEqual(0);
  });

  it('measurePaddingBox 扣除边框、不随非法边框变成负数', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'offsetWidth', { value: 802 });
    Object.defineProperty(el, 'offsetHeight', { value: 602 });
    const original = window.getComputedStyle;
    window.getComputedStyle = () =>
      ({
        borderLeftWidth: '1px',
        borderRightWidth: '1px',
        borderTopWidth: '1px',
        borderBottomWidth: '1px',
      }) as CSSStyleDeclaration;
    try {
      expect(measurePaddingBox(el)).toEqual({ width: 800, height: 600 });
    } finally {
      window.getComputedStyle = original;
    }
  });
});
