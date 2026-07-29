import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { PluginStorePanel } from '../plugin-center/sub-views/PluginStorePanel';
import { PluginLogsPanel } from '../plugin-center/sub-views/PluginLogsPanel';

describe('PluginCenter Sub-components', () => {
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
                description: '这是一个测试插件'
              })
            }
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
        />
      );

      expect(screen.getByText('测试测试插件')).toBeDefined();
      expect(screen.getByText('已启用')).toBeDefined();
      expect(screen.getByText('这是一个测试插件')).toBeDefined();
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
