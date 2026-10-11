import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ExtensionPointRenderer } from '../extension-point-renderer';
import { PluginHostProvider } from '../plugin-host-context';
import { FrontendPluginHost } from '../plugin-host';
import { usePluginHostStore } from '../plugin-host-store';

/**
 * ai_sidebar.tab 双形态渲染分支回归测试（v0.6.0 遗留债务 ④）。
 *
 * 此前渲染器对该槽无 renderType 分支：button 态把插件完整组件内联进
 * tab 条、panel 态不按 activeTab 过滤（多插件时全部堆叠）。
 */

function createLazyComponent(Component: React.ComponentType<any>) {
  const factory = () => Promise.resolve({ default: Component });
  (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
  return factory;
}

const PROBE_A = 'panel-A-content';
const PROBE_B = 'panel-B-content';

describe('ai_sidebar.tab 双形态渲染（遗留债务 ④ 回归）', () => {
  let host: FrontendPluginHost;

  beforeEach(() => {
    host = new FrontendPluginHost();
    usePluginHostStore.setState({ activePlugins: [], extensionPoints: new Map() });

    usePluginHostStore.getState().registerExtensionPoint('ai_sidebar.tab', {
      id: 'ext-tab-a',
      pluginId: 'prov-a',
      label: '教研助手',
      component: createLazyComponent(() => <div data-testid="panel-a">{PROBE_A}</div>),
    });
    usePluginHostStore.getState().registerExtensionPoint('ai_sidebar.tab', {
      id: 'ext-tab-b',
      pluginId: 'prov-b',
      label: '学情问答',
      component: createLazyComponent(() => <div data-testid="panel-b">{PROBE_B}</div>),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('button 态渲染紧凑 tab 按钮（而非内联完整组件）', async () => {
    const setActiveTab = vi.fn();
    render(
      <PluginHostProvider host={host}>
        <ExtensionPointRenderer
          slot="ai_sidebar.tab"
          slotProps={{ renderType: 'button', activeTab: 'agent', setActiveTab, lang: 'zh' }}
        />
      </PluginHostProvider>,
    );

    const btnA = await screen.findByTitle('教研助手');
    const btnB = await screen.findByTitle('学情问答');
    expect(btnA.textContent).toContain('教研助手');
    expect(btnB.textContent).toContain('学情问答');
    // button 态不得把插件面板内容直接渲染进 tab 条
    expect(screen.queryByTestId('panel-a')).toBeNull();
    expect(screen.queryByTestId('panel-b')).toBeNull();

    fireEvent.click(btnA);
    expect(setActiveTab).toHaveBeenCalledWith('plugin:prov-a/ext-tab-a');
  });

  it('panel 态只渲染 activeTab 命中的单个面板', async () => {
    render(
      <PluginHostProvider host={host}>
        <ExtensionPointRenderer
          slot="ai_sidebar.tab"
          slotProps={{ renderType: 'panel', activeTab: 'plugin:prov-b/ext-tab-b', lang: 'zh' }}
        />
      </PluginHostProvider>,
    );

    expect(await screen.findByTestId('panel-b')).toBeTruthy();
    expect(screen.queryByTestId('panel-a')).toBeNull();
  });

  it('panel 态 activeTab 未命中任何插件面板时不渲染', async () => {
    render(
      <PluginHostProvider host={host}>
        <ExtensionPointRenderer
          slot="ai_sidebar.tab"
          slotProps={{ renderType: 'panel', activeTab: 'agent', lang: 'zh' }}
        />
      </PluginHostProvider>,
    );

    // 等一拍确认无面板渲染
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('panel-a')).toBeNull();
    expect(screen.queryByTestId('panel-b')).toBeNull();
  });
});
