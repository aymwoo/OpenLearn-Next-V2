import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React, { type ReactElement } from 'react';

vi.mock('react-konva', () => {
  const stub = (name: string) =>
    function KonvaStub({ children }: React.PropsWithChildren<Record<string, unknown>>) {
      return <div data-konva={name}>{children}</div>;
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
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';
import { PluginHostProvider } from '../../../plugin-host/plugin-host-context';
import { FrontendPluginHost, NullExtensionComponent } from '../../../plugin-host/plugin-host';
import { usePluginHostStore } from '../../../plugin-host/plugin-host-store';
import { frontendApi } from '../../../services/frontend-api';
import { setSocketInstance } from '../../../services/socket-service';
import type { Socket } from 'socket.io-client';
import { WhiteboardPageBar } from '../components/WhiteboardPageBar';
import { WhiteboardPropertiesSidebar } from '../components/WhiteboardPropertiesSidebar';
import { WhiteboardToolbar } from '../components/WhiteboardToolbar';
import { InteractiveWhiteboard } from '../InteractiveWhiteboard';

function lazyComponent(renderFn: (props: Record<string, unknown>) => ReactElement) {
  const factory = () => Promise.resolve({ default: renderFn });
  (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
  return factory;
}

function renderWithHost(ui: ReactElement) {
  const host = new FrontendPluginHost();
  return render(<PluginHostProvider host={host}>{ui}</PluginHostProvider>);
}

const originalResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  usePluginHostStore.setState({ extensionPoints: new Map() });
});

afterEach(() => {
  if (originalResizeObserver === undefined) {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  } else {
    globalThis.ResizeObserver = originalResizeObserver;
  }
  setSocketInstance(null);
  cleanup();
  vi.restoreAllMocks();
});

describe('whiteboard new extension slots & sandbox view rendering', () => {
  it('renders process-sandboxed view inside whiteboard.renderer via PluginSandboxIframeView', async () => {
    usePluginHostStore.getState().registerExtensionPoint('whiteboard.renderer', {
      id: 'mol-viewer',
      pluginId: 'ext-chem',
      label: '3D 分子模型',
      targetType: '3d-molecule',
      component: NullExtensionComponent,
      view: 'molecule.html',
    });

    renderWithHost(
      <ExtensionPointRenderer
        slot="whiteboard.renderer"
        slotProps={{
          element: { id: 'el-1', type: '3d-molecule', data: '{}' },
          elementId: 'el-1',
          elementType: '3d-molecule',
          data: {},
          width: 400,
          height: 300,
          lessonId: 'lesson-1',
        }}
      />,
    );

    const iframe = await screen.findByTitle('3D 分子模型');
    expect(iframe.tagName).toBe('IFRAME');
    expect(iframe.getAttribute('src')).toContain('/plugins/ext-chem/molecule.html');
  });

  it('filters whiteboard.selection.toolbar by targetType and runs data-driven commandType actions', async () => {
    const postSpy = vi.spyOn(frontendApi, 'post').mockResolvedValue({ success: true });

    usePluginHostStore.getState().registerExtensionPoint('whiteboard.selection.toolbar', {
      id: 'quiz-stats',
      pluginId: 'ext-quiz',
      label: '测验统计',
      targetType: 'quiz',
      component: NullExtensionComponent,
      slotProps: { commandType: 'quiz.open_stats', payload: { mode: 'live' } },
    });

    usePluginHostStore.getState().registerExtensionPoint('whiteboard.selection.toolbar', {
      id: 'rect-only',
      pluginId: 'ext-rect',
      label: '仅矩形可见',
      targetType: 'rect',
      component: lazyComponent(() => <span data-testid="rect-only-ext">Rect Only</span>),
    });

    usePluginHostStore.getState().registerExtensionPoint('whiteboard.selection.toolbar', {
      id: 'universal-pin',
      pluginId: 'ext-pin',
      label: '置顶',
      targetType: '*',
      component: lazyComponent((props) => <span data-testid="universal-ext">{String(props.elementId)}</span>),
    });

    renderWithHost(
      <ExtensionPointRenderer
        slot="whiteboard.selection.toolbar"
        slotProps={{
          element: { id: 'el-quiz', type: 'quiz', data: '{}' },
          elementId: 'el-quiz',
          elementType: 'quiz',
          data: {},
          lessonId: 'lesson-42',
        }}
      />,
    );

    const cmdBtn = screen.getByRole('button', { name: '测验统计' });
    expect(screen.queryByTestId('rect-only-ext')).toBeNull();
    expect((await screen.findByTestId('universal-ext')).textContent).toContain('el-quiz');

    fireEvent.click(cmdBtn);
    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith('/api/plugins/execute-command', {
        type: 'quiz.open_stats',
        payload: {
          mode: 'live',
          elementId: 'el-quiz',
          elementType: 'quiz',
          target: undefined,
          lessonId: 'lesson-42',
          pageId: undefined,
        },
      });
    });
  });

  it('filters whiteboard.context_menu by target (element vs canvas) and closes menu on click', async () => {
    const postSpy = vi.spyOn(frontendApi, 'post').mockResolvedValue({ success: true });
    const onClose = vi.fn();

    usePluginHostStore.getState().registerExtensionPoint('whiteboard.context_menu', {
      id: 'export-el',
      pluginId: 'ext-export',
      label: '导出组件快照',
      component: NullExtensionComponent,
      slotProps: { target: 'element', commandType: 'export.element' },
    });

    usePluginHostStore.getState().registerExtensionPoint('whiteboard.context_menu', {
      id: 'canvas-template',
      pluginId: 'ext-tpl',
      label: '套用画布模板',
      component: NullExtensionComponent,
      slotProps: { target: 'canvas', commandType: 'canvas.apply_template' },
    });

    const { rerender } = renderWithHost(
      <ExtensionPointRenderer
        slot="whiteboard.context_menu"
        slotProps={{
          target: 'canvas',
          element: null,
          elementId: null,
          elementType: null,
          data: null,
          point: { x: 100, y: 120 },
          lessonId: 'lesson-1',
          onClose,
        }}
      />,
    );

    expect(screen.queryByRole('button', { name: '导出组件快照' })).toBeNull();
    const canvasBtn = screen.getByRole('button', { name: '套用画布模板' });
    fireEvent.click(canvasBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith('/api/plugins/execute-command', {
        type: 'canvas.apply_template',
        payload: {
          elementId: null,
          elementType: null,
          target: 'canvas',
          lessonId: 'lesson-1',
          pageId: undefined,
        },
      });
    });

    rerender(
      <PluginHostProvider host={new FrontendPluginHost()}>
        <ExtensionPointRenderer
          slot="whiteboard.context_menu"
          slotProps={{
            target: 'element',
            element: { id: 'el-2', type: 'rect', data: '{}' },
            elementId: 'el-2',
            elementType: 'rect',
            data: {},
            point: { x: 100, y: 120 },
            lessonId: 'lesson-1',
            onClose,
          }}
        />
      </PluginHostProvider>,
    );

    expect(screen.getByRole('button', { name: '导出组件快照' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '套用画布模板' })).toBeNull();
  });

  it('mounts whiteboard.pagebar.action and whiteboard.page_drawer.action in WhiteboardPageBar', async () => {
    usePluginHostStore.getState().registerExtensionPoint('whiteboard.pagebar.action', {
      id: 'pagebar-btn',
      pluginId: 'ext-pages',
      label: 'Pagebar',
      component: lazyComponent(() => <button data-testid="pagebar-ext-btn">同步分页</button>),
    });
    usePluginHostStore.getState().registerExtensionPoint('whiteboard.page_drawer.action', {
      id: 'drawer-btn',
      pluginId: 'ext-pages',
      label: 'Drawer',
      component: lazyComponent(() => <button data-testid="drawer-ext-btn">导出大纲</button>),
    });

    const pages = [{ id: 'p1', title: '第1页', order: 0 }];
    renderWithHost(
      <WhiteboardPageBar
        pages={pages}
        currentPage={0}
        showPageDrawer={true}
        setShowPageDrawer={vi.fn()}
        editingPageIdx={null}
        setEditingPageIdx={vi.fn()}
        editingPageTitle=""
        setEditingPageTitle={vi.fn()}
        activeMenuPageIdx={null}
        setActiveMenuPageIdx={vi.fn()}
        safeElements={[]}
        handleSwitchPage={vi.fn()}
        handleRenamePage={vi.fn()}
        handleDuplicatePage={vi.fn()}
        handleMovePage={vi.fn()}
        handleDeletePage={vi.fn()}
        handleAddPage={vi.fn()}
      />,
    );

    expect(await screen.findByTestId('pagebar-ext-btn')).toBeTruthy();
    expect(await screen.findByTestId('drawer-ext-btn')).toBeTruthy();
  });

  it('mounts whiteboard.properties.addon inside WhiteboardPropertiesSidebar', async () => {
    usePluginHostStore.getState().registerExtensionPoint('whiteboard.properties.addon', {
      id: 'prop-addon',
      pluginId: 'ext-meta',
      label: 'Meta',
      component: lazyComponent((props) => (
        <div data-testid="prop-addon-panel">{`${String(props.elementType)}:${String(props.elementId)}`}</div>
      )),
    });

    renderWithHost(
      <WhiteboardPropertiesSidebar
        isEditMode={true}
        selectedShapeId="el-shape-1"
        setSelectedShapeId={vi.fn()}
        activePropertiesElementId={null}
        setActivePropertiesElementId={vi.fn()}
        safeElements={[{ id: 'el-shape-1', type: 'rect', data: JSON.stringify({ x: 10, y: 20 }) }]}
        editingProperties={{ x: 10, y: 20 }}
        handleLocalPropChange={vi.fn()}
        handlePropBlur={vi.fn()}
        handleNumericPropBlur={vi.fn()}
        handlePropsUpdate={vi.fn()}
        handleUpdateElementData={vi.fn().mockResolvedValue('saved')}
        handleElementDelete={vi.fn()}
        handleUndoProp={vi.fn()}
        handleRedoProp={vi.fn()}
        propertyUndoStack={{}}
        propertyRedoStack={{}}
        isSyncing={false}
        lessonId="lesson-9"
        coursewares={[]}
        fetchCoursewares={vi.fn()}
        setZipCandidates={vi.fn()}
        setZipUploadInfo={vi.fn()}
        setShowEntrySelector={vi.fn()}
        handleAddOption={vi.fn()}
        handleRemoveOption={vi.fn()}
        handleOptionChangeLocal={vi.fn()}
        handleOptionBlur={vi.fn()}
      />,
    );

    expect((await screen.findByTestId('prop-addon-panel')).textContent).toContain('rect:el-shape-1');
  });

  it('exposes design tokens and .wb-widget-container on InteractiveWhiteboard', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800);
    globalThis.ResizeObserver = class {
      private cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
      observe(target: Element) {
        this.cb(
          [
            {
              target,
              contentRect: { width: 1000, height: 800 } as DOMRectReadOnly,
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            },
          ],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    setSocketInstance({
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      connected: true,
    } as unknown as Socket);

    usePluginHostStore.getState().registerExtensionPoint('whiteboard.renderer', {
      id: 'custom-card',
      pluginId: 'ext-card',
      label: '卡片图元',
      targetType: 'custom-card',
      component: lazyComponent(() => <div data-testid="custom-card-body">Card</div>),
    });

    renderWithHost(
      <InteractiveWhiteboard
        lessonId="lesson-wb-1"
        elements={[
          {
            id: 'card-1',
            type: 'custom-card',
            data: JSON.stringify({ x: 40, y: 60, width: 320, height: 200, page: 0 }),
          },
        ]}
        onElementAdd={vi.fn().mockResolvedValue(undefined)}
        readOnly={true}
      />,
    );

    const viewport = screen.getByTestId('whiteboard-canvas-viewport');
    expect(viewport.classList.contains('wb-canvas-scope')).toBe(true);
    expect(viewport.classList.contains('wb-scoped-transition-root')).toBe(true);
    expect(viewport.getAttribute('data-wb-readonly')).toBe('true');
    expect(viewport.getAttribute('data-wb-layout')).toBe('free');
    expect(viewport.style.getPropertyValue('--wb-readonly')).toBe('true');

    const cardBody = await screen.findByTestId('custom-card-body');
    expect(cardBody.closest('.wb-widget-container')).not.toBeNull();
  });

  it('opens WhiteboardToolbar plugin tool dropdown cleanly with jsdom fallback', () => {
    const onExecuteTool = vi.fn();
    renderWithHost(
      <WhiteboardToolbar
        tool="cursor"
        setTool={vi.fn()}
        setSelectedShapeId={vi.fn()}
        highlighterColor="#facc15"
        setHighlighterColor={vi.fn()}
        onElementAdd={vi.fn().mockResolvedValue(undefined)}
        currentPage={0}
        lessonId="lesson-tb-1"
        safeElements={[]}
        selectedShapeId={null}
        showGrid={true}
        setShowGrid={vi.fn()}
        isSyncing={false}
        setIsSyncing={vi.fn()}
        handleClearBoard={vi.fn()}
        handleResetBoard={vi.fn()}
        handleElementDelete={vi.fn()}
        setDialog={vi.fn()}
        setDialogInput={vi.fn()}
        classroomTools={[
          {
            id: 'poll-tool',
            pluginId: 'ext-poll',
            name: '课堂快速投票',
            description: '一键发布选择题投票',
          },
        ]}
        onExecuteTool={onExecuteTool}
      />,
    );

    const trigger = screen.getByTitle('互动工具 (插件扩展)');
    expect(trigger.getAttribute('role')).toBeNull();
    expect(trigger.getAttribute('aria-haspopup')).toBeNull();
    fireEvent.click(trigger);

    const toolBtn = screen.getByText('课堂快速投票');
    fireEvent.click(toolBtn);
    expect(onExecuteTool).toHaveBeenCalledTimes(1);
  });
});
