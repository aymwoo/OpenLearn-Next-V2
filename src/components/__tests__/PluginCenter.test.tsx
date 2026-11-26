import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PluginStorePanel } from '../plugin-center/sub-views/PluginStorePanel';
import { PluginLogsPanel } from '../plugin-center/sub-views/PluginLogsPanel';
import { PluginSnapshotRollbackModal } from '../PluginSnapshotRollbackModal';
import { PluginCenter } from '../PluginCenter';

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

  describe('PluginSnapshotRollbackModal', () => {
    it('loads snapshots and requires two-step confirmation before rolling back', async () => {
      const calls: Array<{ url: string; method?: string }> = [];
      const onRolledBack = vi.fn();
      const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method });
        if (url.endsWith('/snapshots')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              snapshots: [
                {
                  snapshotId: 'snap-100',
                  pluginId: 'uuid-1',
                  manifestId: 'ext-demo',
                  pluginName: 'Demo',
                  fromVersion: '1.0.0',
                  toVersion: '2.0.0',
                  status: 'ready',
                  createdAt: Date.UTC(2026, 10, 15),
                  wasActive: true,
                  executionMode: 'inline',
                  tableCount: 2,
                  rowCount: 15,
                  storageRows: 4,
                  configRows: 3,
                  migrationVersion: 2,
                  sizeBytes: 4096,
                },
              ],
            }),
          } as unknown as Response;
        }
        if (url.endsWith('/rollback')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              restoredVersion: '1.0.0',
              fromVersion: '2.0.0',
            }),
          } as unknown as Response;
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });

      render(
        <PluginSnapshotRollbackModal
          plugin={{ id: 'uuid-1', name: 'Demo', version: '2.0.0', manifestId: 'ext-demo' }}
          lang="zh"
          onClose={vi.fn()}
          onRolledBack={onRolledBack}
          fetcher={fetcher}
        />,
      );

      await screen.findByText(/2 张私有表 \/ 15 行/);
      const firstRollbackBtn = screen.getByRole('button', { name: /回滚至 v1\.0\.0/ });
      fireEvent.click(firstRollbackBtn);

      // Step 2 confirm button appears; no rollback POST fired until confirmed
      expect(calls.some((c) => c.url.endsWith('/rollback'))).toBe(false);
      const confirmBtn = screen.getByRole('button', { name: /确认回滚/ });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(onRolledBack).toHaveBeenCalledWith({ restoredVersion: '1.0.0', fromVersion: '2.0.0' });
      });
    });
  });

  describe('PluginCenter cross-tab community update discovery', () => {
    it('surfaces community plugin updates on both Community tab badge and Discover tab cards', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/plugins/market') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, market: [] }),
          } as unknown as Response;
        }
        if (url === '/api/plugins/community') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              plugins: [
                {
                  id: 'ext-community-demo',
                  name: '社区示例插件',
                  description: '新版本修复重要问题',
                  author: 'aymwoo',
                  version: '1.5.0',
                  downloadUrl: 'https://plugins.example.com/ext-community-demo-1.5.0.zip',
                  icon: '📦',
                  homepage: null,
                  repository: 'https://gitee.com/aymwoo/ext-community-demo',
                  license: 'MIT',
                  tags: ['教学'],
                  capabilities: [],
                  minPlatformVersion: null,
                  publishedAt: null,
                  downloads: 10,
                  stars: 5,
                  verified: true,
                  featured: false,
                  installedVersion: '1.0.0',
                  hasUpdate: true,
                },
              ],
            }),
          } as unknown as Response;
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });

      try {
        render(
          <PluginCenter
            plugins={[
              {
                id: 'uuid-community-demo',
                name: '社区示例插件',
                status: 'active',
                created_at: Date.now(),
                manifest: JSON.stringify({
                  id: 'ext-community-demo',
                  name: '社区示例插件',
                  version: '1.0.0',
                  description: '旧版',
                }),
              },
            ]}
            lang="zh"
            isAdmin={true}
            storeTab="store"
            setStoreTab={vi.fn()}
            pluginCode=""
            setPluginCode={vi.fn()}
            installingPlugin={false}
            onInstall={vi.fn()}
            onZipUpload={vi.fn()}
            onToggle={vi.fn()}
            onDelete={vi.fn()}
          />,
        );

        expect(await screen.findByText(/新版本 v1\.5\.0/)).toBeDefined();
        expect(screen.getByRole('button', { name: /⚡ 更新/ })).toBeDefined();
        expect(screen.getByTestId('community-update-badge').textContent).toBe('1');
      } finally {
        vi.restoreAllMocks();
      }
    });
  });
});
