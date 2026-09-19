import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';

/**
 * 全班专注锁定 → 白板只读跟随模式的回归测试。
 *
 * 只读模式必须满足：
 *   1. 工具栏（画笔/图形/清空/重置）与页面栏整体隐藏；
 *   2. 画布不接受绘制操作（容器 pointer-events: none）；
 *   3. 插件组件本体仍然可交互（其内部显式 pointer-events: auto）。
 *
 * Konva / reveal.js / pptx-preview 在 jsdom 下无法真实渲染，故以最薄的方式替身。
 * vi.mock 工厂会被提升到文件顶部，因此所有桩件都在工厂内部或 vi.hoisted 中定义。
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
}));

import { InteractiveWhiteboard } from '../InteractiveWhiteboard';

beforeAll(() => {
  // jsdom 没有 ResizeObserver，白板用它测量画布尺寸
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderBoard(readOnly: boolean) {
  return render(
    <InteractiveWhiteboard
      lessonId="l1"
      elements={[]}
      userRole="student"
      readOnly={readOnly}
      onElementAdd={vi.fn(async () => {})}
      onRefresh={vi.fn()}
    />,
  );
}

describe('InteractiveWhiteboard readOnly (全班专注锁定)', () => {
  it('renders the authoring toolbar and page bar for a normal student', () => {
    renderBoard(false);
    expect(screen.getByTitle('画笔工具 (Pen)')).toBeTruthy();
    expect(screen.getByTitle('重置白板 (Reset Board)')).toBeTruthy();
  });

  it('hides the toolbar and page bar when readOnly', () => {
    renderBoard(true);
    expect(screen.queryByTitle('画笔工具 (Pen)')).toBeNull();
    expect(screen.queryByTitle('重置白板 (Reset Board)')).toBeNull();
    // 页面栏的页面切换入口
    expect(screen.queryByText(/P1 · 引入导入/)).toBeNull();
  });

  it('disables canvas pointer events when readOnly so drawing cannot start', () => {
    const { container } = renderBoard(true);
    const canvasHost = container.querySelector('.absolute.inset-0.w-full.h-full.overflow-hidden');
    expect(canvasHost).toBeTruthy();
    expect((canvasHost as HTMLElement).style.pointerEvents).toBe('none');
  });

  it('keeps canvas pointer events enabled when not readOnly', () => {
    const { container } = renderBoard(false);
    const canvasHost = container.querySelector('.absolute.inset-0.w-full.h-full.overflow-hidden');
    expect((canvasHost as HTMLElement).style.pointerEvents).toBe('auto');
  });
});
