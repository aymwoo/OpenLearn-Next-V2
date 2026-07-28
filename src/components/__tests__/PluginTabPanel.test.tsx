import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PluginTabPanel } from '../PluginTabPanel';
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
