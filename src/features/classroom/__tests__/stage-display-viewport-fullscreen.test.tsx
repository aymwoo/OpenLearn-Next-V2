/**
 * 大屏展台 · 全屏控制
 *
 * 覆盖原生全屏被浏览器拒绝时的降级路径 —— 这是本模块原先的缺口：
 * 展台只监听 document.fullscreenElement，而原生全屏被拒时既不会进入原生全屏、
 * 也不会有 fullscreenchange 事件，导致「点了全屏按钮没反应，且 Esc 也退不出」。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useViewportFullscreen } from '../stage-display/useViewportFullscreen';

function Probe() {
  const { isFullscreen, nativeActive, toggle } = useViewportFullscreen();
  return (
    <div>
      <span data-testid="state">{isFullscreen ? 'fullscreen' : 'normal'}</span>
      <span data-testid="native">{nativeActive ? 'native' : 'not-native'}</span>
      <button data-testid="toggle" onClick={toggle} />
    </div>
  );
}

const readState = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.textContent;

function pressEsc() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
}

beforeEach(() => {
  // 每次重置为「未全屏」：fullscreenElement 是只读属性，用 defineProperty 覆盖
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  Object.defineProperty(document, 'webkitFullscreenElement', { configurable: true, value: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('展台全屏 · 原生全屏可用', () => {
  it('进入：调用 requestFullscreen 并置为全屏', async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });

    render(<Probe />);
    await act(async () => {
      document.querySelector<HTMLElement>('[data-testid="toggle"]')!.click();
    });

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(readState('state')).toBe('fullscreen');
    expect(readState('native')).toBe('native');
  });

  it('用户用系统 Esc 退出原生全屏（fullscreenchange）时状态同步退回', async () => {
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });

    render(<Probe />);
    await act(async () => {
      document.querySelector<HTMLElement>('[data-testid="toggle"]')!.click();
    });
    expect(readState('state')).toBe('fullscreen');

    // 浏览器侧退出原生全屏：fullscreenElement 变 null 并派发 fullscreenchange
    await act(async () => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    // 若不反向同步，界面会停留在一个已不存在的全屏态（黑屏且按钮图标失真）
    expect(readState('state')).toBe('normal');
  });
});

describe('展台全屏 · 原生全屏被拒 / 不支持（降级为占满视口）', () => {
  it('requestFullscreen 被拒：仍进入全屏态，且 Esc 能退出', async () => {
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error('gesture required')),
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<Probe />);
    await act(async () => {
      document.querySelector<HTMLElement>('[data-testid="toggle"]')!.click();
    });

    // 降级：没有原生全屏，但界面已是全屏展示
    expect(readState('state')).toBe('fullscreen');
    expect(readState('native')).toBe('not-native');

    // 关键：浏览器在非原生全屏下不会接管 Esc，必须由我们自己处理，
    // 否则用户被卡在「看似全屏、实则退不出」的状态
    pressEsc();
    expect(readState('state')).toBe('normal');
  });

  it('环境完全不支持原生全屏：同样可进可退', async () => {
    const el = document.documentElement as unknown as { requestFullscreen?: unknown };
    const saved = el.requestFullscreen;
    delete el.requestFullscreen;
    Object.defineProperty(document.documentElement, 'webkitRequestFullscreen', {
      configurable: true,
      value: undefined,
    });

    try {
      render(<Probe />);
      await act(async () => {
        document.querySelector<HTMLElement>('[data-testid="toggle"]')!.click();
      });
      expect(readState('state')).toBe('fullscreen');

      pressEsc();
      expect(readState('state')).toBe('normal');
    } finally {
      if (saved)
        Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: saved });
    }
  });

  it('未处于全屏时按 Esc 不产生任何状态变化', () => {
    render(<Probe />);
    pressEsc();
    expect(readState('state')).toBe('normal');
  });
});
