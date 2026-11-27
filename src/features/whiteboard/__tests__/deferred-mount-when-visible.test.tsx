import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { DeferredMountWhenVisible } from '../components/DeferredMountWhenVisible';

/**
 * 白板插件渲染器的懒挂载：
 * - 未启用时直接挂载；
 * - 启用（默认，可编辑 / 只读均适用）时先进视口再挂载，挂载后不再卸载；
 * - 首帧已在视口内的图元同步挂载，不出现「占位 → 内容」的闪空。
 */
describe('DeferredMountWhenVisible', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** 让占位块落在视口外（jsdom 默认 rect 全 0，会被判定为已在视口内）。 */
  function stubOffscreenRect() {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 5000,
      top: 5000,
      left: 0,
      bottom: 5100,
      right: 100,
      width: 100,
      height: 100,
      toJSON: () => ({}),
    } as DOMRect);
  }

  it('显式禁用时立即渲染子节点', () => {
    render(
      <DeferredMountWhenVisible enabled={false}>
        <div data-testid="plugin-body">plugin</div>
      </DeferredMountWhenVisible>,
    );
    expect(screen.getByTestId('plugin-body')).toBeTruthy();
  });

  it('默认启用，环境没有 IntersectionObserver 时回退为立即挂载', () => {
    // jsdom 默认没有 IntersectionObserver —— 不能把插件渲染吞掉
    render(
      <DeferredMountWhenVisible>
        <div data-testid="plugin-body">plugin</div>
      </DeferredMountWhenVisible>,
    );
    expect(screen.getByTestId('plugin-body')).toBeTruthy();
  });

  it('首帧已在视口内时同步挂载（不等 IntersectionObserver 回调）', () => {
    const observe = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = observe;
        disconnect = vi.fn();
      },
    );

    render(
      <DeferredMountWhenVisible>
        <div data-testid="plugin-body">plugin</div>
      </DeferredMountWhenVisible>,
    );

    // 同步挂载：render() 返回时首帧就是真实内容，没有占位帧
    expect(screen.getByTestId('plugin-body')).toBeTruthy();
    expect(observe).not.toHaveBeenCalled();
  });

  it('视口外的图元进入视口后才挂载，随后保持挂载', () => {
    stubOffscreenRect();
    let trigger: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
          trigger = cb;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );

    render(
      <DeferredMountWhenVisible>
        <div data-testid="plugin-body">plugin</div>
      </DeferredMountWhenVisible>,
    );

    expect(screen.queryByTestId('plugin-body')).toBeNull();
    expect(observe).toHaveBeenCalled();

    act(() => {
      trigger?.([{ isIntersecting: true }]);
    });

    expect(screen.getByTestId('plugin-body')).toBeTruthy();
    expect(disconnect).toHaveBeenCalled();
  });
});
