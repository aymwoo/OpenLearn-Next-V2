/**
 * 组件标题栏「双击导致组件消失」的回归测试。
 *
 * 缺陷：双击组件标题栏会触发两轮完整的 pointerdown/up（位移均为 0），
 * 而 `onPointerUp` 无条件调用 `onElementDropCheck`。当组件恰好覆盖在环节栏 /
 * 页面栏上方时（鼠标正落在某个节点矩形内），双击会被判定为「把组件拖到了那个
 * 环节/页」，组件的 segmentId/page 被改写并持久化，随即从当前视图消失。
 *
 * 修复：只有指针实际移动过（超过 DRAG_ACTIVATION_THRESHOLD_PX）才允许外部接管。
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import React from 'react';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';

vi.mock('react-konva', () => {
  const stub = (name: string) =>
    function KonvaStub({ children, ...rest }: React.PropsWithChildren<Record<string, unknown>>) {
      return (
        <div data-konva={name} {...rest}>
          {children}
        </div>
      );
    };
  return {
    Stage: stub('Stage'),
    Layer: stub('Layer'),
    Group: stub('Group'),
    Rect: stub('Rect'),
    Circle: stub('Circle'),
    Line: stub('Line'),
    Text: stub('Text'),
  };
});

vi.mock('react-konva-utils', () => ({
  Html: ({ children }: React.PropsWithChildren) => <div data-konva="Html">{children}</div>,
}));

vi.mock('reveal.js', () => ({ default: class RevealStub {} }));
vi.mock('reveal.js/reveal.css', () => ({}));
vi.mock('reveal.js/theme/white.css', () => ({}));
vi.mock('reveal.js/plugin/markdown', () => ({ default: {} }));
vi.mock('pptx-preview', () => ({ init: vi.fn() }));

vi.mock('../../../plugin-host/extension-point-renderer', () => ({
  ExtensionPointRenderer: () => <div data-testid="mock-extension-point" />,
}));

const { fakeSocket } = vi.hoisted(() => ({
  fakeSocket: { id: 'sock-1', emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('../../../services/socket-service', () => ({
  getSocketInstance: () => fakeSocket,
  getOptionalSocket: () => null,
}));

import { InteractiveWhiteboard, DRAG_ACTIVATION_THRESHOLD_PX } from '../InteractiveWhiteboard';

// 用一个会渲染标题栏（WidgetTitleBar）的类型：assignment 分支带全屏/删除按钮
const ELEMENT = {
  id: 'el-1',
  type: 'assignment',
  data: JSON.stringify({ title: '作业一', x: 20, y: 20, width: 400, height: 300 }),
};

const ELEMENTS = [ELEMENT];

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 1024 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 768 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderBoard(overrides: Record<string, unknown> = {}) {
  return render(
    <InteractiveWhiteboard
      lessonId="l1"
      elements={ELEMENTS}
      onElementAdd={vi.fn(async () => {}) as any}
      onElementUpdate={vi.fn(async () => {}) as any}
      userRole="teacher"
      {...overrides}
    />,
  );
}

/**
 * 在标题栏上执行一轮 pointerdown → （可选位移）→ pointerup。
 *
 * 每一步都单独包在 act 里：window 级 pointermove/pointerup 监听是在
 * setActiveDragElement 触发**下一次渲染**后才由 useEffect 注册的，若把三个事件
 * 同步连续派发，监听器尚未挂上，事件会被丢弃 —— 测试就会「什么都没发生」而假通过。
 */
async function clickTitleBar(
  titleBar: HTMLElement,
  opts: { clientX: number; clientY: number; moveTo?: { clientX: number; clientY: number } },
) {
  await act(async () => {
    fireEvent.pointerDown(titleBar, { clientX: opts.clientX, clientY: opts.clientY, pointerId: 1 });
  });
  if (opts.moveTo) {
    await act(async () => {
      fireEvent.pointerMove(window, {
        clientX: opts.moveTo!.clientX,
        clientY: opts.moveTo!.clientY,
        pointerId: 1,
      });
    });
  }
  await act(async () => {
    fireEvent.pointerUp(window, {
      clientX: opts.moveTo?.clientX ?? opts.clientX,
      clientY: opts.moveTo?.clientY ?? opts.clientY,
      pointerId: 1,
    });
  });
}

function getTitleBar(): HTMLElement {
  return document.querySelector('[data-widget-titlebar="true"]') as HTMLElement;
}

describe('白板组件标题栏 · 双击不应让组件消失', () => {
  it('【核心回归】零位移的双击不得触发「拖放到页/环节」接管', async () => {
    const onElementDropCheck = vi.fn().mockReturnValue(true);
    renderBoard({ onElementDropCheck, hidePageBar: true });

    const bar = getTitleBar();
    expect(bar).toBeTruthy();

    // 双击 = 两轮 pointerdown/up，位移均为 0（鼠标停在环节栏节点矩形内的情形）
    await act(async () => {
      await clickTitleBar(bar, { clientX: 300, clientY: 220 });
      await clickTitleBar(bar, { clientX: 300, clientY: 220 });
    });

    expect(onElementDropCheck).not.toHaveBeenCalled();
  });

  it('【核心回归】零位移的单击同样不触发接管', async () => {
    const onElementDropCheck = vi.fn().mockReturnValue(true);
    renderBoard({ onElementDropCheck, hidePageBar: true });

    await act(async () => {
      await clickTitleBar(getTitleBar(), { clientX: 300, clientY: 220 });
    });

    expect(onElementDropCheck).not.toHaveBeenCalled();
  });

  it('真正拖动到目标后仍正常触发接管（不能把功能改坏）', async () => {
    const onElementDropCheck = vi.fn().mockReturnValue(true);
    renderBoard({ onElementDropCheck, hidePageBar: true });

    await act(async () => {
      await clickTitleBar(getTitleBar(), {
        clientX: 300,
        clientY: 220,
        moveTo: { clientX: 300 + DRAG_ACTIVATION_THRESHOLD_PX + 20, clientY: 220 },
      });
    });

    expect(onElementDropCheck).toHaveBeenCalledTimes(1);
  });

  it('小于阈值的抖动（1~3px）不触发接管', async () => {
    const onElementDropCheck = vi.fn().mockReturnValue(true);
    renderBoard({ onElementDropCheck, hidePageBar: true });

    await act(async () => {
      await clickTitleBar(getTitleBar(), {
        clientX: 300,
        clientY: 220,
        moveTo: { clientX: 300 + DRAG_ACTIVATION_THRESHOLD_PX - 1, clientY: 220 },
      });
    });

    expect(onElementDropCheck).not.toHaveBeenCalled();
  });

  it('双击后组件仍在（元素数据未被移走），且标题栏仍渲染', async () => {
    const onElementDropCheck = vi.fn().mockReturnValue(true);
    const { container } = renderBoard({ onElementDropCheck, hidePageBar: true });

    await act(async () => {
      const bar = getTitleBar();
      await clickTitleBar(bar, { clientX: 300, clientY: 220 });
      await clickTitleBar(bar, { clientX: 300, clientY: 220 });
    });

    // 标题栏仍在（未被移走 / 未被最小化）
    expect(container.querySelector('[data-widget-titlebar="true"]')).toBeTruthy();
    // 外部接管从未发生 → 组件没有被搬到别的页/环节
    expect(onElementDropCheck).not.toHaveBeenCalled();
  });

  it('零位移双击不会把元素标记为最小化（标题栏按钮区不受影响）', async () => {
    const onElementUpdate = vi.fn(async () => {});
    renderBoard({ onElementUpdate, hidePageBar: true });

    await act(async () => {
      const bar = getTitleBar();
      await clickTitleBar(bar, { clientX: 300, clientY: 220 });
      await clickTitleBar(bar, { clientX: 300, clientY: 220 });
    });

    const minimisedWrites = onElementUpdate.mock.calls.filter(
      (call: any[]) => (call[1] as any)?.isMinimized !== undefined,
    );
    expect(minimisedWrites).toHaveLength(0);
  });
});
