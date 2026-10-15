import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ExtensionPointRenderer } from '../extension-point-renderer';
import { PluginHostProvider } from '../plugin-host-context';
import { FrontendPluginHost } from '../plugin-host';
import { usePluginHostStore } from '../plugin-host-store';
import { PluginState } from '../types';

function dummyComponent() {
  const factory = () => Promise.resolve({ default: () => <div>Dummy Panel</div> });
  (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
  return factory;
}

function renderWithHost(ui: ReactElement) {
  const host = new FrontendPluginHost();
  return render(<PluginHostProvider host={host}>{ui}</PluginHostProvider>);
}

beforeEach(() => {
  usePluginHostStore.setState({
    extensionPoints: new Map(),
    activePlugins: [],
  });
});

afterEach(() => {
  cleanup();
});

describe('ExtensionPointRenderer — Custom Plugin Icons for NavigationSidebar', () => {
  it('renders custom Lucide icon from ext.icon in teacher.tab button', () => {
    usePluginHostStore.getState().registerExtensionPoint('teacher.tab', {
      id: 'exam-bank',
      label: '题库与测验',
      icon: 'BookOpen',
      pluginId: 'ext-exam-bank',
      position: 10,
      component: dummyComponent(),
    });

    const setTeacherTab = vi.fn();
    const { container } = renderWithHost(
      <ExtensionPointRenderer
        slot="teacher.tab"
        slotProps={{
          renderType: 'button',
          mainNavCollapsed: false,
          teacherTab: 'dashboard',
          setTeacherTab,
        }}
      />,
    );

    const btn = container.querySelector<HTMLButtonElement>('#nav_btn_ext-exam-bank_exam-bank');
    expect(btn).toBeTruthy();
    expect(btn!.textContent).toContain('题库与测验');

    const svg = container.querySelector('svg.lucide-book-open');
    expect(svg).toBeTruthy();

    fireEvent.click(btn!);
    expect(setTeacherTab).toHaveBeenCalledWith('ext-exam-bank/exam-bank');
  });

  it('inherits plugin-level icon from activePlugins when ext.icon is omitted', () => {
    usePluginHostStore.getState().addPlugin({
      id: 'ext-calculator',
      name: '计算器',
      version: '1.0.0',
      state: PluginState.ACTIVE,
      executionMode: 'inline',
      icon: 'Calculator',
    });

    usePluginHostStore.getState().registerExtensionPoint('teacher.tab', {
      id: 'calc-tool',
      label: '科学计算器',
      pluginId: 'ext-calculator',
      component: dummyComponent(),
    });

    const { container } = renderWithHost(
      <ExtensionPointRenderer
        slot="teacher.tab"
        slotProps={{
          renderType: 'button',
          mainNavCollapsed: false,
          teacherTab: 'dashboard',
        }}
      />,
    );

    expect(screen.getByText('科学计算器')).toBeTruthy();
    const svg = container.querySelector('svg.lucide-calculator');
    expect(svg).toBeTruthy();
  });

  it('renders emoji icon correctly in sidebar button', () => {
    usePluginHostStore.getState().registerExtensionPoint('teacher.tab', {
      id: 'emoji-plugin',
      label: '实验报告',
      icon: '🧪',
      pluginId: 'ext-experiment',
      component: dummyComponent(),
    });

    renderWithHost(
      <ExtensionPointRenderer
        slot="teacher.tab"
        slotProps={{
          renderType: 'button',
          mainNavCollapsed: false,
          teacherTab: 'dashboard',
        }}
      />,
    );

    const emojiSpan = screen.getByText('🧪');
    expect(emojiSpan).toBeTruthy();
    expect(screen.getByText('实验报告')).toBeTruthy();
  });

  it('sorts multiple plugin tabs by position ascending', () => {
    usePluginHostStore.getState().registerExtensionPoint('teacher.tab', {
      id: 'tab-second',
      label: '第二标签',
      pluginId: 'ext-two',
      position: 50,
      component: dummyComponent(),
    });
    usePluginHostStore.getState().registerExtensionPoint('teacher.tab', {
      id: 'tab-first',
      label: '第一标签',
      pluginId: 'ext-one',
      position: 10,
      component: dummyComponent(),
    });

    const { container } = renderWithHost(
      <ExtensionPointRenderer
        slot="teacher.tab"
        slotProps={{
          renderType: 'button',
          mainNavCollapsed: false,
          teacherTab: 'dashboard',
        }}
      />,
    );

    const tabFirst = container.querySelector<HTMLElement>('#nav_btn_ext-one_tab-first');
    const tabSecond = container.querySelector<HTMLElement>('#nav_btn_ext-two_tab-second');
    expect(tabFirst?.textContent).toContain('第一标签');
    expect(tabSecond?.textContent).toContain('第二标签');

    // Each tab now also has a hover-only "open in new tab" affordance.
    const newTabFirst = container.querySelector<HTMLElement>('#nav_btn_ext-one_tab-first_newtab');
    const newTabSecond = container.querySelector<HTMLElement>('#nav_btn_ext-two_tab-second_newtab');
    expect(newTabFirst).toBeTruthy();
    expect(newTabSecond).toBeTruthy();
    expect(newTabFirst!.getAttribute('aria-label')).toContain('第一标签');
    expect(newTabSecond!.getAttribute('aria-label')).toContain('第二标签');
  });

  it('renders "open in new tab" affordance on each plugin teacher.tab button', () => {
    usePluginHostStore.getState().registerExtensionPoint('teacher.tab', {
      id: 'open-in-newtab',
      label: '新标签页打开测试',
      icon: 'ExternalLink',
      pluginId: 'ext-newtab',
      component: dummyComponent(),
    });

    const openSpy = vi.fn();
    vi.stubGlobal('open', openSpy);
    // jsdom's window.location.hash is read-only; provide a minimal stub.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { pathname: '/teacher', search: '', hash: '' },
    });

    const { container } = renderWithHost(
      <ExtensionPointRenderer
        slot="teacher.tab"
        slotProps={{
          renderType: 'button',
          mainNavCollapsed: false,
          teacherTab: 'dashboard',
        }}
      />,
    );

    const newTabBtn = container.querySelector<HTMLButtonElement>('#nav_btn_ext-newtab_open-in-newtab_newtab');
    expect(newTabBtn).toBeTruthy();
    expect(newTabBtn!.getAttribute('aria-label')).toBe('在新标签页打开"新标签页打开测试"');
    expect(newTabBtn!.getAttribute('title')).toBe('在新标签页打开');

    fireEvent.click(newTabBtn!);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(
      '/teacher#/ext-newtab/open-in-newtab',
      '_blank',
      'noopener,noreferrer',
    );

    vi.unstubAllGlobals();
  });

  it('hides "open in new tab" affordance when the sidebar is collapsed', () => {
    usePluginHostStore.getState().registerExtensionPoint('teacher.tab', {
      id: 'collapse-me',
      label: '收起时不显示',
      icon: 'Puzzle',
      pluginId: 'ext-collapse',
      component: dummyComponent(),
    });

    const { container } = renderWithHost(
      <ExtensionPointRenderer
        slot="teacher.tab"
        slotProps={{
          renderType: 'button',
          mainNavCollapsed: true,
          teacherTab: 'dashboard',
        }}
      />,
    );

    const newTabBtn = container.querySelector<HTMLElement>('#nav_btn_ext-collapse_collapse-me_newtab');
    expect(newTabBtn).toBeNull();
  });

  it('renders custom icon in class.tab button slot', () => {
    usePluginHostStore.getState().registerExtensionPoint('class.tab', {
      id: 'class-growth',
      label: '成长档案',
      icon: 'GraduationCap',
      pluginId: 'ext-growth',
      component: dummyComponent(),
    });

    const { container } = renderWithHost(
      <ExtensionPointRenderer
        slot="class.tab"
        slotProps={{
          renderType: 'button',
          classActiveTab: 'overview',
        }}
      />,
    );

    expect(screen.getByText('成长档案')).toBeTruthy();
    const svg = container.querySelector('svg.lucide-graduation-cap');
    expect(svg).toBeTruthy();
  });
});
