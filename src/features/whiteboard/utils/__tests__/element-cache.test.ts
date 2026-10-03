import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseElementData, clearElementDataCache, getElementDataCacheSize } from '../element-cache';

describe('element-cache (parseElementData)', () => {
  beforeEach(() => {
    clearElementDataCache();
  });

  it('parses JSON string and returns object', () => {
    const raw = JSON.stringify({ x: 10, y: 20, text: 'Hello' });
    const parsed = parseElementData(raw);

    expect(parsed).toEqual({ x: 10, y: 20, text: 'Hello' });
  });

  it('accepts an element-like object containing .data property', () => {
    const el = { id: 'el-1', data: JSON.stringify({ width: 300, height: 200 }) };
    const parsed = parseElementData(el);

    expect(parsed).toEqual({ width: 300, height: 200 });
  });

  it('returns cached reference on subsequent calls with identical data string', () => {
    const raw = JSON.stringify({ a: 1, b: 2 });
    const first = parseElementData(raw);
    const second = parseElementData(raw);

    // Exact reference equality
    expect(first).toBe(second);
  });

  it('safely handles invalid JSON and returns fallback without throwing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const invalid = '{ broken json: ';

    const result = parseElementData(invalid, { default: true });
    expect(result).toEqual({ default: true });
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('handles null and undefined gracefully', () => {
    expect(parseElementData(null)).toEqual({});
    expect(parseElementData(undefined, { fallback: 123 })).toEqual({ fallback: 123 });
  });

  it('respects LRU eviction when exceeding maximum capacity', () => {
    // Insert 1005 items
    for (let i = 0; i < 1005; i++) {
      parseElementData(JSON.stringify({ index: i }));
    }

    // Size should be capped at 1000
    expect(getElementDataCacheSize()).toBe(1000);
  });
});
