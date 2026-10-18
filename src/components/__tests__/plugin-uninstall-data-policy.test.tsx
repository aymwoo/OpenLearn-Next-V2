/**
 * Issue #141 前端交互测试：卸载数据策略对话框 + 「插件数据」面板。
 *
 * 覆盖：
 * - 卸载对话框默认「保留数据」，直接确认即为 keep；
 * - 选择「清除数据」后必须勾选不可恢复确认，否则按钮禁用、点击不出结果；
 * - 勾选后确认 → purge；
 * - 插件数据面板：挂载时拉取、空态文案、导出 / 两步清除回调。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PluginUninstallDialog } from '../PluginUninstallDialog';
import { PluginDataPanel } from '../plugin-center/sub-views/PluginDataPanel';
import type { OrphanDataItem } from '../plugin-center/types';

afterEach(cleanup);

function makeOrphanItem(overrides: Partial<OrphanDataItem> = {}): OrphanDataItem {
  return {
    manifestId: 'ext-homework-hub',
    pluginId: '019f-uuid-0001',
    pluginName: '作业中心',
    pluginVersion: '1.2.0',
    tableNames: ['plugin_019f_uuid_0001_scores'],
    tableCount: 1,
    rowCount: 42,
    storageKeys: 3,
    migrationVersion: 2,
    lastExportPath: null,
    uninstalledAt: Date.now(),
    ...overrides,
  };
}

describe('PluginUninstallDialog（Issue #141）', () => {
  it('默认「保留数据」：直接确认即为 keep', () => {
    const onConfirm = vi.fn();
    render(
      <PluginUninstallDialog
        pluginName="作业中心"
        manifestId="ext-homework-hub"
        lang="zh"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '卸载并保留数据' }));
    expect(onConfirm).toHaveBeenCalledWith('keep');
  });

  it('选择「清除数据」后未勾选确认时按钮禁用；勾选后确认 → purge', () => {
    const onConfirm = vi.fn();
    render(
      <PluginUninstallDialog
        pluginName="作业中心"
        manifestId="ext-homework-hub"
        lang="zh"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByText('卸载并清除插件数据（不可恢复）'));

    const confirmButton = screen.getByRole('button', { name: '卸载并清除数据' }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
    fireEvent.click(confirmButton);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect((screen.getByRole('button', { name: '卸载并清除数据' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '卸载并清除数据' }));
    expect(onConfirm).toHaveBeenCalledWith('purge');
  });

  it('取消不会触发任何卸载', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <PluginUninstallDialog
        pluginName="作业中心"
        manifestId="ext-homework-hub"
        lang="zh"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('PluginDataPanel（Issue #141）', () => {
  it('空列表显示空态，并在挂载时拉取一次', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <PluginDataPanel
        lang="zh"
        items={[]}
        onRefresh={onRefresh}
        onExport={vi.fn()}
        onPurge={vi.fn()}
      />,
    );

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(screen.getByText('暂无保留的插件数据')).toBeDefined();
  });

  it('列出孤立数据摘要，导出按钮回调携带该项', () => {
    const onExport = vi.fn();
    const item = makeOrphanItem();
    render(
      <PluginDataPanel
        lang="zh"
        items={[item]}
        onRefresh={vi.fn()}
        onExport={onExport}
        onPurge={vi.fn()}
      />,
    );

    expect(screen.getByText('作业中心')).toBeDefined();
    expect(screen.getByText('ext-homework-hub')).toBeDefined();
    expect(screen.getByText('42')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /导出归档/ }));
    expect(onExport).toHaveBeenCalledWith(item);
  });

  it('清除为两步确认：先展开提示，再「确认清除」才回调', () => {
    const onPurge = vi.fn();
    const item = makeOrphanItem();
    render(
      <PluginDataPanel
        lang="zh"
        items={[item]}
        onRefresh={vi.fn()}
        onExport={vi.fn()}
        onPurge={onPurge}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /清除数据/ }));
    expect(onPurge).not.toHaveBeenCalled();
    expect(screen.getByText(/将清除 1 张表、42 行数据与 3 个配置键/)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /确认清除/ }));
    expect(onPurge).toHaveBeenCalledWith(item);
  });
});
