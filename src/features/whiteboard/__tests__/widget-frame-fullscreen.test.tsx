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

vi.mock('../components/HtmlAppletFrame', () => ({
  HtmlAppletFrame: () => <div data-testid="applet">互动课件内容</div>,
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
import { FullscreenOverlay, fullscreenRendererRegistry } from '../fullscreen/FullscreenRendererRegistry';
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
  // 白板全屏的内容区用 clientWidth/clientHeight 实测尺寸（jsdom 恒为 0），
  // 不桩化的话 Stage 会因 0 尺寸不挂载，测不到「内容被 Stage 包裹」
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 900 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
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

/**
 * 集成路径回归（走 InteractiveWhiteboard 真实渲染，而非直接测 WidgetFrame 组件）。
 *
 * 为什么必须单独测：浏览器全屏的实际渲染是 `BrowserFullscreenHost` + `renderElement(el)`，
 * 它**不经过** WidgetFrame 的 isBrowserFullscreen 分支。只测组件契约会全部通过，
 * 但真实链路上「隐藏标题栏」与「铺满视口」都可能完全没生效 —— 这类假通过已经发生过一次。
 */
describe('浏览器全屏 · 集成路径（宿主真实渲染）', () => {
  const CASES = [
    { type: 'plugin', extra: { pluginId: 'ext-demo' }, label: '第三方 widget' },
    { type: 'html-applet', extra: { title: '互动课件' }, label: '互动课件' },
    { type: 'assignment', extra: { title: '作业' }, label: '作业' },
    { type: 'rollcall', extra: { title: '点名' }, label: '随机点名' },
    { type: 'quiz', extra: { title: '快问快答', options: ['A', 'B'] }, label: '快问快答' },
  ];

  for (const c of CASES) {
    it(`${c.label}：全屏内无标题栏（沉浸展示）`, async () => {
      Object.defineProperty(document.documentElement, 'requestFullscreen', {
        configurable: true,
        value: vi.fn().mockResolvedValue(undefined),
      });

      render(
        <InteractiveWhiteboard
          lessonId="l1"
          elements={[
            {
              id: 'el-1',
              type: c.type,
              data: JSON.stringify({ ...c.extra, x: 20, y: 20, width: 400, height: 300 }),
            },
          ]}
          onElementAdd={vi.fn(async () => {}) as any}
          onElementUpdate={vi.fn(async () => {}) as any}
          userRole="teacher"
          hidePageBar
        />,
      );
      await act(async () => {});

      // 画布内标题栏存在（前提：按钮可点）
      expect(getTitleBar()).toBeTruthy();

      await act(async () => {
        fireEvent.click(document.querySelector('[data-testid="widget-titlebar-browser-fullscreen"]') as HTMLElement);
      });

      const host = screen.getByTestId('browser-fullscreen-host');
      // 关键断言：全屏内不得残留任何标题栏
      expect(host.querySelectorAll('[data-widget-titlebar="true"]').length).toBe(0);
      // 退出出口必须保留，否则学生会被困在沉浸态
      expect(host.querySelector('[data-testid="browser-fullscreen-exit"]')).toBeTruthy();
    });
  }

  it('全屏内元素铺满视口（而非保持画布内的原始尺寸）', async () => {
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });

    render(
      <InteractiveWhiteboard
        lessonId="l1"
        elements={[
          {
            id: 'el-1',
            type: 'html-applet',
            data: JSON.stringify({ title: '互动课件', x: 20, y: 20, width: 400, height: 300 }),
          },
        ]}
        onElementAdd={vi.fn(async () => {}) as any}
        onElementUpdate={vi.fn(async () => {}) as any}
        userRole="teacher"
        hidePageBar
      />,
    );
    await act(async () => {});

    await act(async () => {
      fireEvent.click(document.querySelector('[data-testid="widget-titlebar-browser-fullscreen"]') as HTMLElement);
    });

    const host = screen.getByTestId('browser-fullscreen-host');
    const content = host.querySelector('[data-testid="browser-fullscreen-content"]') as HTMLElement;
    expect(content.style.width).toBe('1024px');
    expect(content.style.height).toBe('768px');
  });

  it('html-applet 也被宿主 WidgetFrame 包裹（与第三方 widget 同一套窗口能力）', async () => {
    const { container } = render(
      <InteractiveWhiteboard
        lessonId="l1"
        elements={[
          {
            id: 'el-1',
            type: 'html-applet',
            data: JSON.stringify({ title: '互动课件', x: 20, y: 20, width: 400, height: 300 }),
          },
        ]}
        onElementAdd={vi.fn(async () => {}) as any}
        onElementUpdate={vi.fn(async () => {}) as any}
        userRole="teacher"
        hidePageBar
      />,
    );
    await act(async () => {});

    expect(container.querySelector('[data-widget-frame="true"]')).toBeTruthy();
  });
});

/**
 * 白板全屏（board fullscreen）与浏览器全屏的内容来源统一。
 *
 * 此前白板全屏走 DefaultFullscreenRenderer 的字段预览兜底（注册表从未被注册），
 * 于是互动课件变源码文本、作业退化成不可提交 —— 与画布内的真实组件不是同一个东西。
 */
describe('白板全屏 · 渲染真实组件', () => {
  async function enterBoardFullscreen(type: string, data: Record<string, unknown>) {
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });

    render(
      <InteractiveWhiteboard
        lessonId="l1"
        elements={[{ id: 'el-1', type, data: JSON.stringify({ x: 20, y: 20, width: 400, height: 300, ...data }) }]}
        onElementAdd={vi.fn(async () => {}) as any}
        onElementUpdate={vi.fn(async () => {}) as any}
        userRole="teacher"
        hidePageBar
      />,
    );
    await act(async () => {});

    const btn = getTitleBar().querySelector('[data-testid="widget-titlebar-board-fullscreen"]') as HTMLElement;
    expect(btn).toBeTruthy();
    await act(async () => {
      fireEvent.click(btn);
    });
  }

  for (const c of [
    { type: 'html-applet', data: { title: '互动课件' } },
    { type: 'assignment', data: { title: '作业', description: '作业内容', assignmentId: 'a-1' } },
  ]) {
    it(`${c.type}：白板全屏渲染真实组件，而非字段预览兜底`, async () => {
      await enterBoardFullscreen(c.type, c.data);

      const overlay = document.querySelector('[data-testid="fullscreen-content"]') as HTMLElement;
      expect(overlay).toBeTruthy();
      if (c.type === 'assignment') {
        expect(overlay.textContent).toContain('作业内容');
        // 真实组件渲染的是带 onClick 的「提交作业」（点击打开真实提交弹窗）；
        // 旧的全屏渲染器给的是个没有任何 handler 的「Upload File」假按钮。
        // 这最能说明「逐类型手写的第二套实现必然漂移」
        expect(overlay.querySelector('[data-testid="assignment-submit-button"]')).toBeTruthy();
        expect(overlay.textContent).not.toContain('Upload File');
      } else {
        // 课件 iframe 被真实渲染（mock 提供）
        expect(overlay.querySelector('[data-testid="applet"]')).toBeTruthy();
      }
    });
  }

  it('白板全屏内容被 Stage 包裹（konva 节点离开 Stage 会抛 FiberProvider 错误）', async () => {
    await enterBoardFullscreen('html-applet', { title: '互动课件' });

    const overlay = document.querySelector('[data-testid="fullscreen-content"]') as HTMLElement;
    // 关键：renderElement 返回 konva 节点，必须有 <Stage> 提供 FiberProvider 上下文，
    // 否则真机上进入全屏瞬间整页白屏（useFiber must be called within a <FiberProvider />）
    expect(overlay.querySelector('[data-testid="widget-fullscreen-stage"]')).toBeTruthy();
    expect(overlay.querySelector('[data-konva="Stage"]')).toBeTruthy();
  });

  it('浏览器全屏内容同样被 Stage 包裹', async () => {
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });

    renderBoard({ hidePageBar: true });
    await act(async () => {});

    await act(async () => {
      fireEvent.click(document.querySelector('[data-testid="widget-titlebar-browser-fullscreen"]') as HTMLElement);
    });

    const host = screen.getByTestId('browser-fullscreen-host');
    expect(host.querySelector('[data-testid="widget-fullscreen-stage"]')).toBeTruthy();
  });

  it('插件注册的自定义全屏渲染器优先级高于宿主注入（保留插件通道）', () => {
    const { unmount } = render(
      <FullscreenOverlay
        type="plugin-custom"
        title="插件全屏"
        data={{}}
        containerSize={{ width: 1024, height: 768 }}
        onClose={vi.fn()}
        lessonId="l1"
        renderContent={() => <div data-testid="host-render">宿主渲染</div>}
      />,
    );
    expect(screen.getByTestId('host-render')).toBeTruthy();
    unmount();

    fullscreenRendererRegistry.register(
      'plugin-custom',
      () => <div data-testid="plugin-render">插件渲染</div>,
      'ext-demo',
    );
    try {
      render(
        <FullscreenOverlay
          type="plugin-custom"
          title="插件全屏"
          data={{}}
          containerSize={{ width: 1024, height: 768 }}
          onClose={vi.fn()}
          lessonId="l1"
          renderContent={() => <div data-testid="host-render">宿主渲染</div>}
        />,
      );
      expect(screen.getByTestId('plugin-render')).toBeTruthy();
      expect(screen.queryByTestId('host-render')).toBeNull();
    } finally {
      fullscreenRendererRegistry.unregister('plugin-custom', 'ext-demo');
    }
  });
});
