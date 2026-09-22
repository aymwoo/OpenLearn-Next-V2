import { describe, it, expect, beforeEach } from 'vitest';
import {
  useFontSizeStore,
  FONT_SCALE_STORAGE_KEY,
  FONT_SCALE_DEFAULT,
  FONT_SCALE_MIN,
  FONT_SCALE_MAX,
  FONT_SCALE_STEP,
  applyFontScaleToDOM,
} from '../fontSizeStore';

describe('fontSizeStore (Accessibility Font Scaling Engine)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-font-scale');
    document.documentElement.style.fontSize = '';
    document.documentElement.style.removeProperty('--app-font-scale');
    useFontSizeStore.setState({
      scale: FONT_SCALE_DEFAULT,
      minScale: FONT_SCALE_MIN,
      maxScale: FONT_SCALE_MAX,
      step: FONT_SCALE_STEP,
    });
  });

  it('initializes with default 100% scale', () => {
    const state = useFontSizeStore.getState();
    expect(state.scale).toBe(100);
    expect(state.minScale).toBe(85);
    expect(state.maxScale).toBe(140);
  });

  it('applyFontScaleToDOM modifies html style and data attribute', () => {
    applyFontScaleToDOM(120);
    expect(document.documentElement.style.fontSize).toBe('120%');
    expect(document.documentElement.style.getPropertyValue('--app-font-scale')).toBe('1.20');
    expect(document.documentElement.getAttribute('data-font-scale')).toBe('120');
  });

  it('setScale updates store, DOM, and localStorage', () => {
    useFontSizeStore.getState().setScale(115);

    expect(useFontSizeStore.getState().scale).toBe(115);
    expect(document.documentElement.style.fontSize).toBe('115%');
    expect(document.documentElement.getAttribute('data-font-scale')).toBe('115');
    expect(localStorage.getItem(FONT_SCALE_STORAGE_KEY)).toBe('115');
  });

  it('clamps values within [minScale, maxScale]', () => {
    useFontSizeStore.getState().setScale(200);
    expect(useFontSizeStore.getState().scale).toBe(FONT_SCALE_MAX);

    useFontSizeStore.getState().setScale(50);
    expect(useFontSizeStore.getState().scale).toBe(FONT_SCALE_MIN);
  });

  it('increaseScale increments scale by step', () => {
    useFontSizeStore.getState().setScale(100);
    useFontSizeStore.getState().increaseScale();
    expect(useFontSizeStore.getState().scale).toBe(105);

    // Can not exceed maxScale
    useFontSizeStore.getState().setScale(FONT_SCALE_MAX);
    useFontSizeStore.getState().increaseScale();
    expect(useFontSizeStore.getState().scale).toBe(FONT_SCALE_MAX);
  });

  it('decreaseScale decrements scale by step', () => {
    useFontSizeStore.getState().setScale(100);
    useFontSizeStore.getState().decreaseScale();
    expect(useFontSizeStore.getState().scale).toBe(95);

    // Can not go below minScale
    useFontSizeStore.getState().setScale(FONT_SCALE_MIN);
    useFontSizeStore.getState().decreaseScale();
    expect(useFontSizeStore.getState().scale).toBe(FONT_SCALE_MIN);
  });

  it('resetScale restores default 100%', () => {
    useFontSizeStore.getState().setScale(130);
    expect(useFontSizeStore.getState().scale).toBe(130);

    useFontSizeStore.getState().resetScale();
    expect(useFontSizeStore.getState().scale).toBe(FONT_SCALE_DEFAULT);
    expect(document.documentElement.style.fontSize).toBe('100%');
  });

  it('initFontSize restores persisted scale from localStorage', () => {
    localStorage.setItem(FONT_SCALE_STORAGE_KEY, '125');
    useFontSizeStore.getState().initFontSize();

    expect(useFontSizeStore.getState().scale).toBe(125);
    expect(document.documentElement.style.fontSize).toBe('125%');
    expect(document.documentElement.getAttribute('data-font-scale')).toBe('125');
  });

  it('initFontSize ignores invalid values in localStorage', () => {
    localStorage.setItem(FONT_SCALE_STORAGE_KEY, 'invalid_number');
    useFontSizeStore.getState().initFontSize();

    expect(useFontSizeStore.getState().scale).toBe(FONT_SCALE_DEFAULT);
    expect(document.documentElement.style.fontSize).toBe('100%');
  });
});
