/**
 * 统一窗口框架 · 白板全屏 + 整个浏览器全屏
 *
 * 覆盖需求：
 *  - 所有组件（含第三方 widget）都由宿主统一包一层 WidgetFrame，组件内容无需实现窗口逻辑；
 *  - 标题栏同时提供「白板全屏」与「整个浏览器全屏」两种能力；
 *  - 浏览器全屏：占满视口 + 调用原生 Fullscreen API，Esc / 悬浮按钮可退出。
 */
import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest';
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

vi.mock('../widgets/PluginCardRenderer', () => ({
  PluginCardRenderer: () => <div data-testid="third-party-widget">第三方组件内容</div>,
}));

const { fakeSocket } = vi.hoisted(() => ({
  fakeSocket: { id: 'sock-1', emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('../../../services/socket-service', () => ({
  getSocketInstance: () => fakeSocket,
  getOptionalSocket: () => null,
}));

import { InteractiveWhiteboard } from '../InteractiveWhiteboard';
import { WidgetFrame, BROWSER_FULLSCREEN_Z } from '../widgets/WidgetFrame';
import { BrowserFullscreenHost } from '../widgets/BrowserFullscreenHost';
import { isNativeFullscreenSupported, useBrowserFullscreen } from '../widgets/useBrowserFullscreen';
import { whiteboardViewStore } from '../../../store/whiteboardViewStore';

const ELEMENTS = [
  {
    id: 'el-plugin',
    type: 'plugin',
    data: JSON.stringify({ pluginId: 'ext-demo', title: '第三方组件', x: 20, y: 20, width: 420, height: 300 }),
  },
];

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
  whiteboardViewStore.getState().setRemoteBrowserFullscreenElementId(null);
  whiteboardViewStore.getState().setRemoteFullscreenElementId(null);
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

function getTitleBar(): HTMLElement {
  return document.querySelector('[data-widget-titlebar="true"]') as HTMLElement;
}

describe('统一窗口框架 · WidgetFrame', () => {
  it('第三方 widget 也被宿主框架包住（插件内容无需实现标题栏）', async () => {
    const { container } = renderBoard({ hidePageBar: true });
    await act(async () => {});

    expect(screen.getByTestId('third-party-widget')).toBeTruthy();
    expect(container.querySelector('[data-widget-frame="true"]')).toBeTruthy();
    expect(getTitleBar()).toBeTruthy();
  });

  it('标题栏同时提供「白板全屏」与「整个浏览器全屏」两个入口', async () => {
    renderBoard({ hidePageBar: true });
    await act(async () => {});

    const bar = getTitleBar();
    const buttons = Array.from(bar.querySelectorAll('button'));
    const titles = buttons.map((b) => b.getAttribute('title'));
    // 两种全屏是不同能力，标题栏必须同时提供
    expect(titles.some((t) => t?.includes('白板全屏'))).toBe(true);
    expect(titles.some((t) => t?.includes('整个浏览器全屏'))).toBe(true);
  });

  it('WidgetFrame 在浏览器全屏态隐藏标题栏，仅保留悬浮退出', () => {
    const onExit = vi.fn();
    render(
      <WidgetFrame title="X" isBrowserFullscreen onBrowserFullscreen={onExit} onMaximize={vi.fn()}>
        <div data-testid="frame-content">内容</div>
      </WidgetFrame>,
    );

    expect(screen.queryByTestId('frame-content')).toBeTruthy();
    expect(document.querySelector('[data-widget-titlebar="true"]')).toBeNull();
    const exitBtn = screen.getByTestId('widget-frame-exit-browser-fullscreen');
    fireEvent.click(exitBtn);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('浏览器全屏层级高于白板全屏', () => {
    expect(BROWSER_FULLSCREEN_Z).toBeGreaterThan(99999);
  });
});

describe('浏览器全屏 · 进入与退出', () => {
  it('点击「整个浏览器全屏」：挂载全屏宿主 + 调用原生全屏 API', async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });

    renderBoard({ hidePageBar: true });
    await act(async () => {});

    const btn = getTitleBar().querySelector('[data-testid="widget-titlebar-browser-fullscreen"]') as HTMLElement;
    expect(btn).toBeTruthy();

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(requestFullscreen).toHaveBeenCalled();
    const host = screen.getByTestId('browser-fullscreen-host');
    expect(host.getAttribute('data-element-id')).toBe('el-plugin');
    expect(host.getAttribute('data-dismissible')).toBe('true');
  });

  it('原生全屏不可用时静默降级为「仅占满视口」，不抛错', async () => {
    // 删除原生 API 模拟不支持
    const el = document.documentElement as any;
    const saved = el.requestFullscreen;
    delete el.requestFullscreen;

    renderBoard({ hidePageBar: true });
    await act(async () => {});

    const btn = getTitleBar().querySelector('[data-testid="widget-titlebar-browser-fullscreen"]') as HTMLElement;

    await act(async () => {
      fireEvent.click(btn);
    });

    // 仍然进入了「占满视口」，只是没有原生全屏
    expect(screen.getByTestId('browser-fullscreen-host')).toBeTruthy();

    if (saved) {
      Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: saved });
    }
  });

  it('悬浮退出按钮可退出浏览器全屏', async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen });

    renderBoard({ hidePageBar: true });
    await act(async () => {});

    await act(async () => {
      fireEvent.click(getTitleBar().querySelector('[data-testid="widget-titlebar-browser-fullscreen"]') as HTMLElement);
    });
    expect(screen.getByTestId('browser-fullscreen-host')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId('browser-fullscreen-exit'));
    });

    await act(async () => {});
    expect(screen.queryByTestId('browser-fullscreen-host')).toBeNull();
  });

  it('Esc 可退出浏览器全屏', async () => {
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });

    renderBoard({ hidePageBar: true });
    await act(async () => {});

    await act(async () => {
      fireEvent.click(getTitleBar().querySelector('[data-testid="widget-titlebar-browser-fullscreen"]') as HTMLElement);
    });
    expect(screen.getByTestId('browser-fullscreen-host')).toBeTruthy();

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    await act(async () => {});

    expect(screen.queryByTestId('browser-fullscreen-host')).toBeNull();
  });

  it('退出浏览器全屏不影响白板全屏状态（两者独立）', async () => {
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });

    renderBoard({ hidePageBar: true });
    await act(async () => {});

    // 进入浏览器全屏
    await act(async () => {
      fireEvent.click(getTitleBar().querySelector('[data-testid="widget-titlebar-browser-fullscreen"]') as HTMLElement);
    });
    expect(screen.getByTestId('browser-fullscreen-host')).toBeTruthy();

    // 退出后白板全屏状态不应被写入
    await act(async () => {
      fireEvent.click(screen.getByTestId('browser-fullscreen-exit'));
    });
    await act(async () => {});

    expect(whiteboardViewStore.getState().remoteFullscreenElementId).toBeNull();
  });
});

describe('浏览器全屏 · 学生端跟随', () => {
  it('学生端跟随教师时不可本地退出（不渲染退出按钮）', () => {
    const onExit = vi.fn();
    render(
      <BrowserFullscreenHost
        elementId="el-1"
        type="plugin"
        data={{}}
        lessonId="l1"
        dismissible={false}
        onExit={onExit}
        renderContent={() => <div>内容</div>}
      />,
    );

    expect(screen.getByTestId('browser-fullscreen-host').getAttribute('data-dismissible')).toBe('false');
    expect(screen.queryByTestId('browser-fullscreen-exit')).toBeNull();
    expect(screen.getByText('教师同步视图')).toBeTruthy();
  });

  it('不可退出时 Esc 也不生效', () => {
    const onExit = vi.fn();
    render(
      <BrowserFullscreenHost
        elementId="el-1"
        type="plugin"
        data={{}}
        lessonId="l1"
        dismissible={false}
        onExit={onExit}
        renderContent={() => <div>内容</div>}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onExit).not.toHaveBeenCalled();
  });

  it('原生全屏只在控制端发起（跟随端 enableNativeFullscreen=false 不调 API）', () => {
    let captured: any = null;
    function Probe({ native }: { native: boolean }) {
      captured = useBrowserFullscreen({ elementId: null, enableNativeFullscreen: native });
      return null;
    }
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });

    const { rerender } = render(<Probe native />);
    expect(typeof isNativeFullscreenSupported()).toBe('boolean');
    act(() => {
      void captured.enter('el-1');
    });
    expect(requestFullscreen).toHaveBeenCalledTimes(1);

    rerender(<Probe native={false} />);
    act(() => {
      void captured.enter('el-1');
    });
    // 跟随端不再调用原生全屏
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });
});
