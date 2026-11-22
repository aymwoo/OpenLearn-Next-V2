// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { isTypingTarget, shouldHandleSurfaceShortcut } from '../keyboard';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isTypingTarget', () => {
  it('识别输入框、下拉与 contentEditable', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('select'))).toBe(true);

    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    expect(isTypingTarget(editable)).toBe(true);

    const textbox = document.createElement('div');
    textbox.setAttribute('role', 'textbox');
    expect(isTypingTarget(textbox)).toBe(true);

    expect(isTypingTarget(document.createElement('div'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('shouldHandleSurfaceShortcut', () => {
  it('非 Surface 保持全局方向键行为，但仍不抢输入框', () => {
    expect(shouldHandleSurfaceShortcut({ key: 'ArrowRight', isSurface: false, activeElement: document.body })).toBe(
      true,
    );
    expect(shouldHandleSurfaceShortcut({ key: 'ArrowLeft', isSurface: false, activeElement: document.body })).toBe(
      true,
    );

    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(shouldHandleSurfaceShortcut({ key: 'ArrowRight', isSurface: false, activeElement: input })).toBe(false);
    expect(shouldHandleSurfaceShortcut({ key: 'Tab', isSurface: false, activeElement: document.body })).toBe(false);
  });

  it('Surface 只响应焦点在本 scope 内的导航键', () => {
    const scope = document.createElement('div');
    scope.setAttribute('data-surface-scope', 'surface-a');
    const inner = document.createElement('button');
    scope.appendChild(inner);
    document.body.appendChild(scope);

    const outside = document.createElement('div');
    document.body.appendChild(outside);

    expect(
      shouldHandleSurfaceShortcut({
        key: 'PageDown',
        isSurface: true,
        scopeId: 'surface-a',
        activeElement: inner,
      }),
    ).toBe(true);
    expect(
      shouldHandleSurfaceShortcut({
        key: 'End',
        isSurface: true,
        scopeId: 'surface-a',
        activeElement: scope,
      }),
    ).toBe(true);
    expect(
      shouldHandleSurfaceShortcut({
        key: 'ArrowRight',
        isSurface: true,
        scopeId: 'surface-b',
        activeElement: inner,
      }),
    ).toBe(false);
    expect(
      shouldHandleSurfaceShortcut({
        key: 'ArrowRight',
        isSurface: true,
        scopeId: 'surface-a',
        activeElement: outside,
      }),
    ).toBe(false);
    expect(
      shouldHandleSurfaceShortcut({
        key: 'ArrowRight',
        isSurface: true,
        scopeId: null,
        activeElement: inner,
      }),
    ).toBe(false);
  });
});
