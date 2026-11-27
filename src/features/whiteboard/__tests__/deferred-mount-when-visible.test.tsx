import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { DeferredMountWhenVisible } from '../components/DeferredMountWhenVisible';

/**
 * 只读白板的插件渲染器懒挂载：
 * - 可编辑态直接挂载（首屏零延迟）；
 * - 只读态先进视口再挂载，挂载后不再卸载。
 */
describe('DeferredMountWhenVisible', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('未启用时立即渲染子节点', () => {
    render(
      <DeferredMountWhenVisible enabled={false}>
        <div data-testid="plugin-body">plugin</div>
      </DeferredMountWhenVisible>,
    );
    expect(screen.getByTestId('plugin-body')).toBeTruthy();
  });

  it('启用但环境没有 IntersectionObserver 时回退为立即挂载', () => {
    // jsdom 默认没有 IntersectionObserver —— 与测试环境行为一致，不能把插件渲染吞掉
    render(
      <DeferredMountWhenVisible enabled>
        <div data-testid="plugin-body">plugin</div>
      </DeferredMountWhenVisible>,
    );
    expect(screen.getByTestId('plugin-body')).toBeTruthy();
  });

  it('启用且图元进入视口后才挂载，随后保持挂载', () => {
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
      <DeferredMountWhenVisible enabled>
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
