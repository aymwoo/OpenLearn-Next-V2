import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';

/**
 * Issue #485：互动白板滚动条反复显隐导致界面抖动。
 *
 * 这里锁定容器布局契约（稳定测量 + 流式占位 + flex 可收缩），
 * 以及「内容溢出时滚动范围一次到位」。jsdom 没有真实滚动条排版，
 * 反馈环的数值回归在 canvas-bounds.test.ts。
 */

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

vi.mock('pptx-react-viewer', () => ({ PowerPointViewer: () => <div data-testid="mock-pptx-viewer" /> }));
vi.mock('pptx-react-viewer/styles', () => ({}));

vi.mock('../../../plugin-host/extension-point-renderer', () => ({
  ExtensionPointRenderer: () => <div data-testid="mock-extension-point" />,
}));

const { fakeSocket } = vi.hoisted(() => ({
  fakeSocket: { id: 'sock-1', emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('../../../services/socket-service', () => ({
  getSocketInstance: () => fakeSocket,
}));

vi.mock('../utils/scrollbar-thickness', async () => {
  const actual = await vi.importActual<typeof import('../utils/scrollbar-thickness')>('../utils/scrollbar-thickness');
  return {
    ...actual,
    measureScrollbarThickness: () => 15,
  };
});

import { InteractiveWhiteboard } from '../InteractiveWhiteboard';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 802 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 602 });
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    private cb: (entries: any[]) => void;
    constructor(cb: (entries: any[]) => void) {
      this.cb = cb;
    }
    observe(target: Element) {
      this.cb([{ target }]);
    }
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  const original = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
    const style = original.call(window, el);
    return new Proxy(style, {
      get(target, prop, receiver) {
        if (
          prop === 'borderLeftWidth' ||
          prop === 'borderRightWidth' ||
          prop === 'borderTopWidth' ||
          prop === 'borderBottomWidth'
        ) {
          return '1px';
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function renderBoard(elements: any[] = []) {
  return render(
    <InteractiveWhiteboard
      lessonId="l1"
      elements={elements}
      userRole="teacher"
      readOnly={false}
      onElementAdd={vi.fn(async () => {})}
      onRefresh={vi.fn()}
    />,
  );
}

describe('InteractiveWhiteboard scrollbar layout (#485)', () => {
  it('viewport 可在 flex 布局中收缩，并由 overflow-auto 承担滚动', () => {
    const { container } = renderBoard();
    const viewport = container.querySelector('[data-testid="whiteboard-canvas-viewport"]') as HTMLElement;
    expect(viewport).toBeTruthy();
    expect(viewport.className).toContain('overflow-auto');
    expect(viewport.className).toContain('min-h-0');
    expect(viewport.className).toContain('min-w-0');
    expect(viewport.className).not.toContain('overflow-hidden');
  });

  it('用流式占位元素撑开滚动范围，内容装得下时等于稳定 padding box', () => {
    const { container } = renderBoard();
    const sizer = container.querySelector('[data-testid="whiteboard-stage-sizer"]') as HTMLElement;
    expect(sizer).toBeTruthy();
    // offset 802x602，四边 1px 边框 → padding box 800x600
    expect(sizer.style.width).toBe('800px');
    expect(sizer.style.height).toBe('600px');
  });

  it('内容纵向溢出时一次预留垂直滚动条宽度，并保持可滚动高度', () => {
    const { container } = renderBoard([
      {
        id: 'widget-1',
        type: 'text',
        data: JSON.stringify({ x: 0, y: 0, width: 300, height: 1600, text: 'tall' }),
      },
    ]);
    const sizer = container.querySelector('[data-testid="whiteboard-stage-sizer"]') as HTMLElement;
    // needH = 1600 + 80 padding，canvas 宽 = 800 - 15 滚动条
    expect(sizer.style.width).toBe('785px');
    expect(sizer.style.height).toBe('1680px');

    const viewport = container.querySelector('[data-testid="whiteboard-canvas-viewport"]') as HTMLElement;
    expect(viewport.className).toContain('overflow-auto');
  });
});
