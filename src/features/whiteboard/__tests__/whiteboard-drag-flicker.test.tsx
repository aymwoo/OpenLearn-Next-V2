import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import React from 'react';
import { render, fireEvent, act, cleanup } from '@testing-library/react';

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
  Html: ({ children, divProps }: React.PropsWithChildren<{ divProps?: any }>) => (
    <div data-konva="Html" {...divProps}>
      {children}
    </div>
  ),
}));

vi.mock('reveal.js', () => ({ default: class RevealStub {} }));
vi.mock('reveal.js/reveal.css', () => ({}));
vi.mock('reveal.js/theme/white.css', () => ({}));
vi.mock('reveal.js/plugin/markdown', () => ({ default: {} }));
vi.mock('pptx-react-viewer', () => ({ PowerPointViewer: () => <div data-testid="mock-pptx-viewer" /> }));
vi.mock('pptx-react-viewer/styles', () => ({}));

const { fakeSocket } = vi.hoisted(() => ({
  fakeSocket: { id: 'sock-1', emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('../../../services/socket-service', () => ({
  getSocketInstance: () => fakeSocket,
  getOptionalSocket: () => null,
}));

vi.mock('../../../plugin-host/extension-point-renderer', () => ({
  ExtensionPointRenderer: () => null,
}));

import { InteractiveWhiteboard } from '../InteractiveWhiteboard';

const ELEMENT = {
  id: 'el-drag-test-1',
  type: 'assignment',
  data: JSON.stringify({ title: '测试任务卡片', x: 20, y: 30, width: 400, height: 300 }),
};

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

function getTitleBar(): HTMLElement {
  const el = document.querySelector('[data-widget-titlebar="true"]') as HTMLElement;
  if (!el) throw new Error('data-widget-titlebar not found');
  return el;
}

function getCardWrapper(): HTMLElement {
  const bar = getTitleBar();
  // 查找 Html 注入的绝对定位父容器
  let cur: HTMLElement | null = bar;
  while (cur && cur !== document.body) {
    if (cur.style && cur.style.position === 'absolute' && cur.style.left) {
      return cur;
    }
    cur = cur.parentElement;
  }
  throw new Error('Absolute positioning wrapper not found');
}

function renderBoard(overrides: Record<string, unknown> = {}) {
  return render(
    <InteractiveWhiteboard
      lessonId="l1"
      elements={[ELEMENT]}
      onElementAdd={vi.fn(async () => {}) as any}
      onElementUpdate={vi.fn(async () => {}) as any}
      userRole="teacher"
      hidePageBar={true}
      {...overrides}
    />,
  );
}

describe('Issue #99: 白板组件拖拽闪烁/空窗与二次起跳缺陷回归测试', () => {
  it('【核心修复】拖拽松手后首帧立即保持新坐标，绝无旧坐标闪回/短暂消失空窗', async () => {
    let resolveUpdate: () => void = () => {};
    const pendingUpdatePromise = new Promise<void>((res) => {
      resolveUpdate = res;
    });
    const onElementUpdate = vi.fn().mockImplementation(() => pendingUpdatePromise);

    renderBoard({ onElementUpdate });

    const titleBar = getTitleBar();
    const wrapper = getCardWrapper();
    expect(wrapper.style.left).toBe('20px');
    expect(wrapper.style.top).toBe('30px');

    // 1. 按下标题栏开始拖拽
    await act(async () => {
      fireEvent.pointerDown(titleBar, { clientX: 100, clientY: 100, pointerId: 1 });
    });

    // 2. 移动鼠标 (+150px, +200px)
    await act(async () => {
      fireEvent.pointerMove(window, { clientX: 250, clientY: 300, pointerId: 1 });
    });

    expect(wrapper.style.left).toBe('170px'); // 20 + 150
    expect(wrapper.style.top).toBe('230px'); // 30 + 200

    // 3. 松开鼠标。关键断言：在 onElementUpdate 的 Promise 尚未 resolve 之前，
    //    组件首帧必须通过同步 setLocalGeometry 保持在 (170px, 230px)，绝对不能回滚到 (20px, 30px)
    await act(async () => {
      fireEvent.pointerUp(window, { clientX: 250, clientY: 300, pointerId: 1 });
    });

    expect(wrapper.style.left).toBe('170px');
    expect(wrapper.style.top).toBe('230px');
    expect(onElementUpdate).toHaveBeenCalledTimes(1);
    expect(onElementUpdate).toHaveBeenCalledWith('el-drag-test-1', expect.objectContaining({ x: 170, y: 230 }));

    // 4. 后续服务端异步保存完成，坐标依然稳定在新位置
    await act(async () => {
      resolveUpdate();
    });
    expect(wrapper.style.left).toBe('170px');
    expect(wrapper.style.top).toBe('230px');
  });

  it('【二次起跳修复】在服务端数据未回传前立即发起二次拖拽，起点从最新覆盖层继承', async () => {
    const onElementUpdate = vi.fn().mockResolvedValue(undefined);
    renderBoard({ onElementUpdate });

    const titleBar = getTitleBar();
    const wrapper = getCardWrapper();

    // 第一次拖拽：从 20, 30 移动到 120, 130 (+100, +100)
    await act(async () => {
      fireEvent.pointerDown(titleBar, { clientX: 50, clientY: 50, pointerId: 1 });
    });
    await act(async () => {
      fireEvent.pointerMove(window, { clientX: 150, clientY: 150, pointerId: 1 });
    });
    await act(async () => {
      fireEvent.pointerUp(window, { clientX: 150, clientY: 150, pointerId: 1 });
    });

    expect(wrapper.style.left).toBe('120px');
    expect(wrapper.style.top).toBe('130px');

    // 立即发起第二次拖拽（此时 props.elements 仍是旧的 x=20, y=30）
    // 鼠标从 (150, 150) 拖动到 (180, 190) (+30, +40)
    await act(async () => {
      fireEvent.pointerDown(titleBar, { clientX: 150, clientY: 150, pointerId: 1 });
    });
    await act(async () => {
      fireEvent.pointerMove(window, { clientX: 180, clientY: 190, pointerId: 1 });
    });

    // 关键断言：坐标必须从 120, 130 起步叠加，变成 150px, 170px，绝不能从原始 20, 30 起跳变成 50px, 70px！
    expect(wrapper.style.left).toBe('150px');
    expect(wrapper.style.top).toBe('170px');

    await act(async () => {
      fireEvent.pointerUp(window, { clientX: 180, clientY: 190, pointerId: 1 });
    });

    expect(wrapper.style.left).toBe('150px');
    expect(wrapper.style.top).toBe('170px');
    expect(onElementUpdate).toHaveBeenLastCalledWith('el-drag-test-1', expect.objectContaining({ x: 150, y: 170 }));
  });

  it('【失败容灾回滚】onElementUpdate 抛错时覆盖层安全回滚到旧位置', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onElementUpdate = vi.fn().mockRejectedValue(new Error('Network disconnected'));

    renderBoard({ onElementUpdate });

    const titleBar = getTitleBar();
    const wrapper = getCardWrapper();
    expect(wrapper.style.left).toBe('20px');
    expect(wrapper.style.top).toBe('30px');

    await act(async () => {
      fireEvent.pointerDown(titleBar, { clientX: 50, clientY: 50, pointerId: 1 });
    });
    await act(async () => {
      fireEvent.pointerMove(window, { clientX: 100, clientY: 100, pointerId: 1 });
    });
    await act(async () => {
      fireEvent.pointerUp(window, { clientX: 100, clientY: 100, pointerId: 1 });
    });

    // 失败后应回滚到原位
    expect(wrapper.style.left).toBe('20px');
    expect(wrapper.style.top).toBe('30px');

    consoleSpy.mockRestore();
  });

  it('【缩放无闪烁】缩放手柄释放后首帧立即保留新尺寸与坐标', async () => {
    let resolveUpdate: () => void = () => {};
    const pendingPromise = new Promise<void>((res) => {
      resolveUpdate = res;
    });
    const onElementUpdate = vi.fn().mockImplementation(() => pendingPromise);

    renderBoard({ onElementUpdate });

    // 选中卡片以显示缩放手柄
    const titleBar = getTitleBar();
    const card = titleBar.closest('.group') as HTMLElement;
    expect(card).toBeTruthy();

    await act(async () => {
      fireEvent.pointerDown(card);
    });

    // 找到右下角缩放手柄
    const handle = document.querySelector('.cursor-nwse-resize:last-child') as HTMLElement;
    expect(handle).toBeTruthy();

    // 拖动右下角手柄放大 (+80px, +60px)
    await act(async () => {
      fireEvent.pointerDown(handle, { clientX: 420, clientY: 330, pointerId: 1 });
    });
    await act(async () => {
      fireEvent.pointerMove(window, { clientX: 500, clientY: 390, pointerId: 1 });
    });

    // 松开缩放手柄，断言在 onElementUpdate 尚未 resolve 时，尺寸立即生效
    await act(async () => {
      fireEvent.pointerUp(window, { clientX: 500, clientY: 390, pointerId: 1 });
    });

    expect(card.style.width).toBe('480px'); // 400 + 80
    expect(card.style.height).toBe('360px'); // 300 + 60
    expect(onElementUpdate).toHaveBeenCalledWith(
      'el-drag-test-1',
      expect.objectContaining({ width: 480, height: 360 }),
    );

    await act(async () => {
      resolveUpdate();
    });
    expect(card.style.width).toBe('480px');
    expect(card.style.height).toBe('360px');
  });
});
