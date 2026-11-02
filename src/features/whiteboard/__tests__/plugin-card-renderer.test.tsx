/**
 * PluginCardRenderer · 双端 widgetId 缺失的错误态（Issue #370）
 *
 * 背景：白板挂件按 teacherWidgetId / studentWidgetId 取组件，缺一个会静默变成 undefined，
 * 旧实现只渲染「正在加载」，用户永远等不到结果、日志里也查不到原因。
 * 现在缺 id 必须渲染明确错误态，不能伪装成加载中。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('../../../plugin-host/plugin-host-store', () => ({
  usePluginHostStore: (selector: (state: { extensionPoints: Map<string, unknown> }) => unknown) =>
    selector({ extensionPoints: new Map() }),
}));

vi.mock('../../../plugin-host/plugin-host', () => ({
  NullExtensionComponent: () => null,
}));

vi.mock('../../../components/PluginSandboxIframeView', () => ({
  PluginSandboxIframeView: () => <div data-testid="sandbox-iframe" />,
}));

import { PluginCardRenderer } from '../widgets/PluginCardRenderer';

const baseProps = {
  pluginId: 'ext-demo',
  slot: 'student.view',
  elementId: 'el-1',
  lessonId: 'lesson-1',
};

afterEach(cleanup);

describe('PluginCardRenderer 双端 widgetId', () => {
  it('缺少 widgetId 时渲染可见错误态，而不是永久「正在加载」', () => {
    render(<PluginCardRenderer {...baseProps} widgetId={undefined} />);

    expect(screen.getByTestId('plugin-widget-misconfigured')).toBeTruthy();
    expect(screen.getByText('挂件未正确配置')).toBeTruthy();
    // 明确指出缺的是哪一端，插件作者能照着改 payload
    expect(screen.getByText(/studentWidgetId/)).toBeTruthy();
    expect(screen.queryByText(/正在加载/)).toBeNull();
  });

  it('有 widgetId 但扩展未注册时仍保留加载提示（扩展可能是异步注册）', () => {
    render(<PluginCardRenderer {...baseProps} widgetId="missing-widget" />);

    expect(screen.queryByTestId('plugin-widget-misconfigured')).toBeNull();
    expect(screen.getByText(/正在加载或未启用/)).toBeTruthy();
  });
});
