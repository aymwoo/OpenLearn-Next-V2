/**
 * 全局壳层扩展槽（底座解耦）—— `header.action` / `statusbar.item` 宿主挂载测试。
 *
 * 验证：
 * - 无插件贡献时：顶栏扩展容器与底部状态栏均为空（`empty:hidden` 生效前提），不渲染加载骨架
 * - 有插件贡献时：组件被渲染，且收到宿主注入的 session / currentRole / lang（/ isOnline）
 * - 状态栏的 isOnline 随浏览器 online/offline 事件更新
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import type { ReactElement } from 'react';
import { AppHeader } from '../AppHeader';
import { AppStatusBar } from '../AppStatusBar';
import { PluginHostProvider } from '../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../plugin-host/plugin-host';
import { usePluginHostStore } from '../../plugin-host/plugin-host-store';

if (typeof (globalThis as Record<string, unknown>).__APP_VERSION__ === 'undefined') {
  (globalThis as Record<string, unknown>).__APP_VERSION__ = '0.0.0';
}

function renderWithHost(ui: ReactElement) {
  return render(<PluginHostProvider host={new FrontendPluginHost()}>{ui}</PluginHostProvider>);
}

function register(slot: 'header.action' | 'statusbar.item', Comp: (props: any) => ReactElement) {
  const factory = () => Promise.resolve({ default: Comp });
  (factory as any).__isLazyFactory = true;
  usePluginHostStore.getState().registerExtensionPoint(slot, {
    id: `${slot}-ext`,
    label: slot,
    pluginId: `p-${slot}`,
    component: factory,
  });
}

const headerProps = {
  activeRole: 'teacher' as const,
  lang: 'zh' as const,
  session: { name: 'T', role: 'teacher' },
  siteInfo: { siteName: 'OpenLearn Next' },
};

beforeEach(() => {
  usePluginHostStore.setState({ extensionPoints: new Map() });
});

afterEach(() => {
  cleanup();
  usePluginHostStore.setState({ extensionPoints: new Map() });
});

describe('header.action 全局顶栏扩展槽', () => {
  it('无插件贡献时扩展容器为空', () => {
    renderWithHost(<AppHeader {...headerProps} />);
    const container = document.getElementById('app-header-plugin-actions');
    expect(container).toBeTruthy();
    expect(container!.childNodes.length).toBe(0);
  });

  it('渲染插件按钮并注入 session / currentRole / lang', async () => {
    register('header.action', (props: any) => (
      <button data-testid="hdr-action" data-role={props.currentRole} data-lang={props.lang}>
        {props.session?.name}
      </button>
    ));

    renderWithHost(<AppHeader {...headerProps} />);

    const btn = await screen.findByTestId('hdr-action');
    expect(btn.getAttribute('data-role')).toBe('teacher');
    expect(btn.getAttribute('data-lang')).toBe('zh');
    expect(btn.textContent).toBe('T');
    expect(document.getElementById('app-header-plugin-actions')!.contains(btn)).toBe(true);
  });
});

describe('statusbar.item 全局底部状态栏扩展槽', () => {
  it('无插件贡献时状态栏为空（隐藏）', () => {
    renderWithHost(<AppStatusBar />);
    const bar = document.getElementById('app-statusbar');
    expect(bar).toBeTruthy();
    expect(bar!.childNodes.length).toBe(0);
    expect(bar!.className).toContain('empty:hidden');
  });

  it('渲染状态栏条目并随 online/offline 事件更新 isOnline', async () => {
    register('statusbar.item', (props: any) => (
      <span data-testid="sb-item" data-online={String(props.isOnline)} data-role={props.currentRole}>
        net
      </span>
    ));

    renderWithHost(<AppStatusBar />);

    const item = await screen.findByTestId('sb-item');
    expect(item.getAttribute('data-online')).toBe('true');
    expect(item.getAttribute('data-role')).toBe('teacher');

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByTestId('sb-item').getAttribute('data-online')).toBe('false');

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.getByTestId('sb-item').getAttribute('data-online')).toBe('true');
  });
});
