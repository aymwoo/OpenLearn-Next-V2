import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PluginTabPanel } from '../PluginTabPanel';
import { NullExtensionComponent } from '../../plugin-host/plugin-host';
import { usePluginHostStore } from '../../plugin-host/plugin-host-store';
import { appStore } from '../../store/appStore';

beforeEach(() => {
  appStore.setState({ lang: 'zh' });
  usePluginHostStore.setState({ extensionPoints: new Map() });
});

afterEach(() => {
  cleanup();
});

describe('PluginTabPanel', () => {
  it('shows the zh empty state when no plugin tab is active', () => {
    render(<PluginTabPanel activeNavPlugin={null} />);
    expect(screen.getByText('此插件未提供页面组件')).toBeTruthy();
    expect(screen.getByText('插件已注册导航条目，但未提供对应的界面渲染逻辑。')).toBeTruthy();
  });

  it('shows the en empty state when lang is en', () => {
    appStore.setState({ lang: 'en' });
    render(<PluginTabPanel activeNavPlugin={null} />);
    expect(screen.getByText('This plugin has no page component')).toBeTruthy();
    expect(
      screen.getByText('The plugin registered a navigation entry but did not provide a render component.'),
    ).toBeTruthy();
  });

  it('renders the active tab component when provided', () => {
    usePluginHostStore.setState({
      extensionPoints: new Map<string, any>([
        ['teacher.tab', [{ pluginId: 'p1', component: () => <div>Plugin Content</div> }]],
      ]),
    });
    render(<PluginTabPanel activeNavPlugin={null} />);
    expect(screen.getByText('Plugin Content')).toBeTruthy();
  });
});

/**
 * 同一插件的 Tab 条目选取优先级。
 *
 * 背景：一个插件在 `teacher.tab` 上可能留下**两条**条目 ——
 * 1. manifest 声明式贡献（`registerManifestContributions`），component 是
 *    `NullExtensionComponent` 占位（贡献本体是数据：label / icon / commandType）；
 * 2. 运行时 `ctx.ui.registerExtensionPoint`，component 是真实组件（或 `render`）。
 *
 * manifest 先注册，所以朴素的 `find(pluginId === active)` 会拿到占位项 → 面板白屏。
 * 修复后优先级为：真实组件 > render 渲染函数 > 占位项。
 */
describe('PluginTabPanel — Tab 条目选取优先级', () => {
  const PLUGIN_ID = 'p-courseware';

  function RealPanel() {
    return <div data-testid="real-panel">real</div>;
  }

  beforeEach(() => {
    usePluginHostStore.setState({ extensionPoints: new Map(), activePlugins: [], pluginErrors: new Map() });
    appStore.setState({ lang: 'zh', selectedLesson: null, liveClassSelectedClassId: null });
  });

  it('manifest 占位项与运行时真实组件并存时，渲染真实组件', () => {
    const register = usePluginHostStore.getState().registerExtensionPoint;
    // manifest 声明式贡献（先注册，component 是占位空组件）
    register('teacher.tab' as never, {
      id: 'tab_grade',
      label: '互动网页课件',
      pluginId: PLUGIN_ID,
      component: NullExtensionComponent,
      origin: 'manifest',
    });
    // 运行时注册（真实组件，id 不同）
    register('teacher.tab' as never, {
      id: 'tab_grade_panel',
      label: '互动网页课件',
      pluginId: PLUGIN_ID,
      component: RealPanel as never,
      origin: 'runtime',
    });

    render(<PluginTabPanel activeNavPlugin={PLUGIN_ID} />);

    expect(screen.getByTestId('real-panel')).toBeTruthy();
    expect(screen.queryByText('此插件未提供页面组件')).toBeNull();
  });

  it('只有占位项 + 同插件 render 函数时，优先走 render（DOMExtensionWrapper）', () => {
    const register = usePluginHostStore.getState().registerExtensionPoint;
    register('teacher.tab' as never, {
      id: 'tab_grade',
      label: '互动网页课件',
      pluginId: PLUGIN_ID,
      component: NullExtensionComponent,
      origin: 'manifest',
    });
    register('teacher.tab' as never, {
      id: 'tab_grade_panel',
      label: '互动网页课件',
      pluginId: PLUGIN_ID,
      // 非组件式扩展点：把 DOM 画进宿主容器
      component: NullExtensionComponent,
      render: (container?: unknown) => {
        const el = document.createElement('div');
        el.setAttribute('data-testid', 'dom-panel');
        (container as HTMLElement | undefined)?.appendChild?.(el);
        return null;
      },
      origin: 'runtime',
    });

    render(<PluginTabPanel activeNavPlugin={PLUGIN_ID} />);

    expect(screen.getByTestId('dom-panel')).toBeTruthy();
  });

  it('既无真实组件也无 render 时，给出显式空态而不是白屏', () => {
    usePluginHostStore.getState().registerExtensionPoint('teacher.tab' as never, {
      id: 'tab_grade',
      label: '互动网页课件',
      pluginId: PLUGIN_ID,
      component: NullExtensionComponent,
      origin: 'manifest',
    });

    render(<PluginTabPanel activeNavPlugin={PLUGIN_ID} />);

    expect(screen.getByText('此插件未提供页面组件')).toBeTruthy();
  });

  it('manifest 声明 view 时，渲染沙箱 iframe 且优先级高于纯占位项', () => {
    usePluginHostStore.getState().registerExtensionPoint('teacher.tab' as never, {
      id: 'tab_dashboard',
      label: '插件看板',
      pluginId: PLUGIN_ID,
      component: NullExtensionComponent,
      view: 'dashboard.html',
      slotProps: { view: 'dashboard.html' },
      origin: 'manifest',
    });

    render(<PluginTabPanel activeNavPlugin={PLUGIN_ID} />);

    expect(screen.queryByText('此插件未提供页面组件')).toBeNull();
    const iframe = screen.getByTitle('插件看板') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    expect(iframe.tagName.toLowerCase()).toBe('iframe');
    expect(iframe.getAttribute('src')).toBe(`/plugins/${PLUGIN_ID}/dashboard.html`);
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-downloads');
  });

  it('真实组件存在时，优先级高于 manifest 声明式 view', () => {
    const register = usePluginHostStore.getState().registerExtensionPoint;
    register('teacher.tab' as never, {
      id: 'tab_view',
      label: '插件看板',
      pluginId: PLUGIN_ID,
      component: NullExtensionComponent,
      view: 'dashboard.html',
      origin: 'manifest',
    });
    register('teacher.tab' as never, {
      id: 'tab_real',
      label: '插件看板',
      pluginId: PLUGIN_ID,
      component: RealPanel as never,
      origin: 'runtime',
    });

    render(<PluginTabPanel activeNavPlugin={PLUGIN_ID} />);

    expect(screen.getByTestId('real-panel')).toBeTruthy();
    expect(screen.queryByTitle('插件看板')).toBeNull();
  });

  it('render 函数存在时，优先级高于 manifest 声明式 view', () => {
    const register = usePluginHostStore.getState().registerExtensionPoint;
    register('teacher.tab' as never, {
      id: 'tab_view',
      label: '插件看板',
      pluginId: PLUGIN_ID,
      component: NullExtensionComponent,
      view: 'dashboard.html',
      origin: 'manifest',
    });
    register('teacher.tab' as never, {
      id: 'tab_render',
      label: '插件看板',
      pluginId: PLUGIN_ID,
      component: NullExtensionComponent,
      render: (container?: unknown) => {
        const el = document.createElement('div');
        el.setAttribute('data-testid', 'dom-panel');
        (container as HTMLElement | undefined)?.appendChild?.(el);
        return null;
      },
      origin: 'runtime',
    });

    render(<PluginTabPanel activeNavPlugin={PLUGIN_ID} />);

    expect(screen.getByTestId('dom-panel')).toBeTruthy();
    expect(screen.queryByTitle('插件看板')).toBeNull();
  });

  it('view 包含目录遍历字符时展示非法路径错误', () => {
    usePluginHostStore.getState().registerExtensionPoint('teacher.tab' as never, {
      id: 'tab_attack',
      label: '恶意看板',
      pluginId: PLUGIN_ID,
      component: NullExtensionComponent,
      view: '../../etc/passwd',
      origin: 'manifest',
    });

    render(<PluginTabPanel activeNavPlugin={PLUGIN_ID} />);

    expect(screen.getByText('非法的插件视图路径')).toBeTruthy();
  });
});
