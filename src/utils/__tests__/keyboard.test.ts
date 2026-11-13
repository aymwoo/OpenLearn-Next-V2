import { describe, it, expect } from 'vitest';
import type React from 'react';
import { isPlainEnterSubmit } from '../keyboard';

function makeKeyEvent(overrides: {
  key: string;
  keyCode?: number;
  nativeIsComposing?: boolean;
  nativeKeyCode?: number;
}): React.KeyboardEvent {
  return {
    key: overrides.key,
    keyCode: overrides.keyCode ?? (overrides.key === 'Enter' ? 13 : 0),
    nativeEvent: {
      isComposing: overrides.nativeIsComposing ?? false,
      keyCode: overrides.nativeKeyCode ?? overrides.keyCode ?? (overrides.key === 'Enter' ? 13 : 0),
    },
  } as unknown as React.KeyboardEvent;
}

describe('isPlainEnterSubmit', () => {
  it('returns true for plain Enter outside IME composition', () => {
    expect(isPlainEnterSubmit(makeKeyEvent({ key: 'Enter' }))).toBe(true);
  });

  it('returns false for non-Enter keys', () => {
    expect(isPlainEnterSubmit(makeKeyEvent({ key: 'Escape' }))).toBe(false);
    expect(isPlainEnterSubmit(makeKeyEvent({ key: 'a' }))).toBe(false);
  });

  it('returns false when nativeEvent.isComposing is true', () => {
    expect(isPlainEnterSubmit(makeKeyEvent({ key: 'Enter', nativeIsComposing: true }))).toBe(false);
  });

  it('returns false when keyCode is 229 (Safari IME composition fallback)', () => {
    expect(isPlainEnterSubmit(makeKeyEvent({ key: 'Enter', keyCode: 229 }))).toBe(false);
    expect(isPlainEnterSubmit(makeKeyEvent({ key: 'Enter', keyCode: 13, nativeKeyCode: 229 }))).toBe(false);
  });
});
