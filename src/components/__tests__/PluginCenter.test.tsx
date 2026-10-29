import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PluginStorePanel } from '../plugin-center/sub-views/PluginStorePanel';
import { PluginLogsPanel } from '../plugin-center/sub-views/PluginLogsPanel';

describe('PluginCenter Sub-components', () => {
  afterEach(() => {
    cleanup();
  });
  describe('PluginStorePanel', () => {
    it('should render plugin store cards with status badges', () => {
      render(
        <PluginStorePanel
          plugins={[
            {
              id: 'ext-test',
              name: '测试测试插件',
              status: 'active',
              created_at: Date.now(),
              manifest: JSON.stringify({
                id: 'ext-test',
                name: '测试测试插件',
                version: '1.0.0',
                description: '这是一个测试插件',
              }),
            },
          ]}
          lang="zh"
          showSystemPlugins={false}
          marketMap={new Map()}
          checkingUpdateId={null}
          oneClickUpdatingId={null}
          handleCheckUpdate={vi.fn()}
          handleOneClickUpdate={vi.fn()}
          setChangelogModalPlugin={vi.fn()}
          setSettingsPlugin={vi.fn()}
          setUpdateTargetPluginId={vi.fn()}
          updateFileInputRef={{ current: null }}
          onToggle={vi.fn()}
          onDelete={vi.fn()}
        />,
      );

      expect(screen.getByText('测试测试插件')).toBeDefined();
      expect(screen.getByText('已启用')).toBeDefined();
      expect(screen.getByText('这是一个测试插件')).toBeDefined();
    });

    it('should display decoupled badges, compact date, and more actions dropdown', () => {
      const mockDelete = vi.fn();
      const mockSetSettings = vi.fn();
      const testTimestamp = new Date('2026-10-29T12:00:00Z').getTime();

      render(
        <PluginStorePanel
          plugins={[
            {
              id: 'ext-classroom-notes',
              name: '课堂便签',
              status: 'active',
              execution_mode: 'esm',
              isolation_mode: 'process',
              created_at: testTimestamp,
              manifest: JSON.stringify({
                id: 'ext-classroom-notes',
                name: '课堂便签',
                version: '0.1.4',
                author: 'OpenLearn Developer',
                description: '基于 OpenLearn 的师生双轨制互动便签贴',
                configuration: {
                  properties: {
                    maxNotes: { type: 'number', default: 50 },
                  },
                },
              }),
            },
          ]}
          lang="zh"
          showSystemPlugins={false}
          marketMap={new Map()}
          checkingUpdateId={null}
          oneClickUpdatingId={null}
          handleCheckUpdate={vi.fn()}
          handleOneClickUpdate={vi.fn()}
          setChangelogModalPlugin={vi.fn()}
          setSettingsPlugin={mockSetSettings}
          setUpdateTargetPluginId={vi.fn()}
          updateFileInputRef={{ current: null }}
          onToggle={vi.fn()}
          onDelete={mockDelete}
        />,
      );

      // 1. 验证标题和模式徽章正常显示
      expect(screen.getByText('课堂便签')).toBeDefined();
      expect(screen.getByText('ESM')).toBeDefined();
      expect(screen.getByText('子进程')).toBeDefined();
      expect(screen.getByText('已启用')).toBeDefined();

      // 2. 验证作者与紧凑日期正常显示
      expect(screen.getByText('OpenLearn Developer')).toBeDefined();
      expect(screen.getByText(/2026-10-29/)).toBeDefined();

      // 3. 验证主操作栏
      expect(screen.getByText('禁用')).toBeDefined();
      expect(screen.getByText('总览')).toBeDefined();

      // 4. 验证更多操作菜单
      const moreBtn = screen.getByLabelText('更多操作');
      expect(moreBtn).toBeDefined();

      // 默认下拉菜单未展开
      expect(screen.queryByText('插件设置')).toBeNull();

      // 点击展开菜单
      fireEvent.click(moreBtn);
      expect(screen.getByText('插件设置')).toBeDefined();
      expect(screen.getByText('上传更新包')).toBeDefined();
      expect(screen.getByText('卸载插件')).toBeDefined();

      // 点击设置
      fireEvent.click(screen.getByText('插件设置'));
      expect(mockSetSettings).toHaveBeenCalledTimes(1);

      // 再次点击更多展开并测试卸载
      fireEvent.click(moreBtn);
      fireEvent.click(screen.getByText('卸载插件'));
      expect(mockDelete).toHaveBeenCalledWith('ext-classroom-notes');
    });
  });

  describe('PluginLogsPanel', () => {
    it('should render plugin logs panel layout', () => {
      render(<PluginLogsPanel lang="zh" />);

      expect(screen.getByPlaceholderText('搜索日志内容...')).toBeDefined();
      expect(screen.getByText('自动刷新 (3s)')).toBeDefined();
    });
  });
});
