import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { usePluginHostStore } from '../../../plugin-host/plugin-host-store';
import { frontendEventBus } from '../../../services/event-bus';
import { PluginHostProvider } from '../../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../../plugin-host/plugin-host';

const { fakeSocket } = vi.hoisted(() => ({
  fakeSocket: { id: 'sock-1', emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('../../../services/socket-service', () => ({
  getSocketInstance: () => fakeSocket,
}));

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

import { InteractiveWhiteboard } from '../InteractiveWhiteboard';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 1000 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 800 });
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

function renderWithHost(ui: React.ReactElement) {
  const host = new FrontendPluginHost();
  return render(<PluginHostProvider host={host}>{ui}</PluginHostProvider>);
}

describe('InteractiveWhiteboard — whiteboard.renderer 自定义图元一等公民挂载', () => {
  beforeEach(() => {
    usePluginHostStore.setState({ extensionPoints: new Map() });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('当画板存在第三方自定义图元时，成功命中 whiteboard.renderer 扩展点并渲染', async () => {
    const CustomMoleculeComponent = (props: any) => (
      <div data-testid="custom-molecule-viewer" data-element-id={props.elementId}>
        <span>3D Molecule: {props.data?.pdbId}</span>
        <button
          data-testid="molecule-rotate-btn"
          onClick={() => props.onElementUpdate?.(props.elementId, { ...props.data, rotated: true })}
        >
          Rotate
        </button>
      </div>
    );
    const factory = () => Promise.resolve({ default: CustomMoleculeComponent });
    (factory as any).__isLazyFactory = true;

    usePluginHostStore.getState().registerExtensionPoint('whiteboard.renderer', {
      id: 'ext-molecule-3d',
      label: '分子结构 3D 渲染器',
      pluginId: 'plugin-biochem',
      targetType: 'molecule-3d',
      component: factory,
    });

    const mockOnUpdate = vi.fn().mockResolvedValue(undefined);
    const busPublishSpy = vi.spyOn(frontendEventBus, 'publish');

    const elements = [
      {
        id: 'mol-1',
        type: 'molecule-3d',
        data: JSON.stringify({
          x: 100,
          y: 100,
          page: 0,
          width: 400,
          height: 300,
          title: '血红蛋白分子模型',
          pdbId: '1A3N',
        }),
      },
    ];

    renderWithHost(
      <InteractiveWhiteboard
        lessonId="lesson-wb-test"
        elements={elements}
        onElementAdd={vi.fn()}
        onElementUpdate={mockOnUpdate}
        onElementDelete={vi.fn()}
        onClearBoard={vi.fn()}
        isEditMode={true}
        readOnly={false}
      />,
    );

    // 标题栏展示自定义标题
    expect(await screen.findByText('血红蛋白分子模型')).toBeTruthy();

    // 内部自定义组件正确渲染
    const viewer = await screen.findByTestId('custom-molecule-viewer');
    expect(viewer).toBeTruthy();
    expect(viewer.getAttribute('data-element-id')).toBe('mol-1');
    expect(screen.getByText('3D Molecule: 1A3N')).toBeTruthy();

    // 点击更新按钮，触发 onElementUpdate 与 eventBus 发布
    const rotateBtn = screen.getByTestId('molecule-rotate-btn');
    fireEvent.click(rotateBtn);

    expect(mockOnUpdate).toHaveBeenCalledWith(
      'mol-1',
      expect.objectContaining({
        pdbId: '1A3N',
        rotated: true,
      }),
    );

    // 验证事件总线广播了 whiteboard.element_updated
    await vi.waitFor(() => {
      expect(busPublishSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'whiteboard.element_updated',
          source: 'whiteboard',
        }),
      );
    });
  });

  it('支持无边框无标题栏模式 (frameless: true)', async () => {
    const CustomChartComponent = () => <div data-testid="frameless-chart">Frameless Chart</div>;
    const factory = () => Promise.resolve({ default: CustomChartComponent });
    (factory as any).__isLazyFactory = true;

    usePluginHostStore.getState().registerExtensionPoint('whiteboard.renderer', {
      id: 'ext-frameless-chart',
      label: '无边框图表',
      pluginId: 'plugin-chart',
      targetType: 'custom-chart',
      component: factory,
    });

    const elements = [
      {
        id: 'chart-1',
        type: 'custom-chart',
        data: JSON.stringify({
          x: 50,
          y: 50,
          page: 0,
          width: 500,
          height: 400,
          title: 'Should be hidden',
          frameless: true,
        }),
      },
    ];

    renderWithHost(
      <InteractiveWhiteboard
        lessonId="lesson-frameless"
        elements={elements}
        onElementAdd={vi.fn()}
        onElementUpdate={vi.fn()}
        onElementDelete={vi.fn()}
        onClearBoard={vi.fn()}
        isEditMode={true}
        readOnly={false}
      />,
    );

    expect(await screen.findByTestId('frameless-chart')).toBeTruthy();
    // 标题栏应当被隐藏
    expect(screen.queryByText('Should be hidden')).toBeNull();
  });
});
