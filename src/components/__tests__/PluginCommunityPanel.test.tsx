// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { PluginCommunityPanel, type CommunityPlugin } from '../plugin-center/sub-views/PluginCommunityPanel';

// 与缺失的 vitest.config.ts（jsdom + globals + setup 文件）无关：本用例以文件级
// `@vitest-environment jsdom` 固定 DOM 环境，并显式清理 DOM —— globals 关闭时
// @testing-library 无法自动注册 afterEach，否则用例之间的 DOM 会互相污染。
afterEach(cleanup);

const HOMEWORK_CARD = 'community-card-ext-homework-hub';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makePlugin(overrides: Partial<CommunityPlugin> = {}): CommunityPlugin {
  return {
    id: 'ext-homework-hub',
    name: '作业中心',
    description: '面向课堂的作业收发与批改面板',
    author: 'aymwoo',
    version: '1.2.0',
    downloadUrl: 'https://plugins.example.com/ext-homework-hub-1.2.0.zip',
    icon: '📚',
    homepage: 'https://example.com/homework-hub',
    repository: 'https://github.com/aymwoo/ext-homework-hub',
    license: 'MIT',
    tags: ['作业', '评价'],
    capabilities: ['student:read'],
    minPlatformVersion: null,
    publishedAt: '2026-01-02T03:04:05Z',
    downloads: 1200,
    stars: 45,
    verified: true,
    featured: false,
    installedVersion: null,
    hasUpdate: false,
    ...overrides,
  };
}

interface RegistryBody {
  success: boolean;
  configured: boolean;
  source: string | null;
  registryVersion: number | null;
  fetchedAt: number | null;
  cached: boolean;
  plugins: CommunityPlugin[];
  skipped: number;
  error?: string;
  envVar?: string;
}

function registryBody(overrides: Partial<RegistryBody> = {}): RegistryBody {
  return {
    success: true,
    configured: true,
    source: 'https://registry.example.com/community-plugins.json',
    registryVersion: 1,
    fetchedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
    cached: false,
    plugins: [makePlugin()],
    skipped: 0,
    ...overrides,
  };
}

const json = (body: unknown, status = 200): Response =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

const zip = (bytes = 'PK\u0003\u0004zip-bytes'): Response =>
  ({ ok: true, status: 200, blob: async () => new Blob([bytes], { type: 'application/zip' }) }) as unknown as Response;

interface Call {
  url: string;
  init?: RequestInit;
}

/** 记录全部请求的路由式 fetch 替身。 */
function makeFetcher(routes: Array<(url: string, init?: RequestInit) => Response | undefined>) {
  const calls: Call[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    for (const route of routes) {
      const response = route(url, init);
      if (response) return response;
    }
    throw new Error(`unexpected request: ${init?.method ?? 'GET'} ${url}`);
  };
  return { fetcher, calls };
}

const renderPanel = (props: Partial<React.ComponentProps<typeof PluginCommunityPanel>> = {}) =>
  render(<PluginCommunityPanel installedPlugins={[]} lang="zh" fetcher={vi.fn()} {...props} />);

// ── Tests ───────────────────────────────────────────────────────────────────

describe('PluginCommunityPanel', () => {
  describe('registry loading', () => {
    it('renders a preview card for each registry entry', async () => {
      const { fetcher, calls } = makeFetcher([
        (url) => (url.startsWith('/api/plugins/community') ? json(registryBody()) : undefined),
      ]);

      renderPanel({ fetcher });

      expect(await screen.findByText('作业中心')).toBeTruthy();

      const card = within(screen.getByTestId(HOMEWORK_CARD));
      expect(card.getByText('aymwoo')).toBeTruthy();
      expect(card.getByText('v1.2.0')).toBeTruthy();
      expect(card.getByText('面向课堂的作业收发与批改面板')).toBeTruthy();
      expect(card.getByText('作业')).toBeTruthy();
      expect(card.getByText('评价')).toBeTruthy();
      expect(card.getByText('已认证')).toBeTruthy();
      expect(card.getByText('1 项权限')).toBeTruthy();
      expect(card.getByText('1200')).toBeTruthy();
      expect(card.getByText('45')).toBeTruthy();
      expect(card.getByText('MIT')).toBeTruthy();
      expect(card.getByRole('link', { name: /源码/ })).toHaveProperty(
        'href',
        'https://github.com/aymwoo/ext-homework-hub',
      );
      expect(calls[0].url).toBe('/api/plugins/community');
    });

    it('explains how to configure the registry when none is set', async () => {
      const { fetcher } = makeFetcher([
        (url) =>
          url.startsWith('/api/plugins/community')
            ? json(
                registryBody({ configured: false, source: null, plugins: [], envVar: 'PLUGIN_COMMUNITY_REGISTRY_URL' }),
              )
            : undefined,
      ]);

      renderPanel({ fetcher });

      expect(await screen.findByText('尚未配置社区插件源')).toBeTruthy();
      expect(screen.getByText(/PLUGIN_COMMUNITY_REGISTRY_URL/)).toBeTruthy();
    });

    it('renders an empty state when the registry has no plugins', async () => {
      const { fetcher } = makeFetcher([
        (url) => (url.startsWith('/api/plugins/community') ? json(registryBody({ plugins: [] })) : undefined),
      ]);

      renderPanel({ fetcher });

      expect(await screen.findByText('社区注册表暂时没有可用插件')).toBeTruthy();
    });

    it('surfaces a registry error and recovers on retry with a cache-busting refresh', async () => {
      let attempt = 0;
      const { fetcher, calls } = makeFetcher([
        (url) => {
          if (!url.startsWith('/api/plugins/community')) return undefined;
          attempt += 1;
          return attempt === 1
            ? json(registryBody({ error: '拉取社区注册表超时', plugins: [] }))
            : json(registryBody());
        },
      ]);

      renderPanel({ fetcher });

      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(screen.getByText('拉取社区注册表超时')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: '重试' }));

      expect(await screen.findByText('作业中心')).toBeTruthy();
      expect(calls[1].url).toBe('/api/plugins/community?refresh=1');
    });

    it('reports entries the server had to discard', async () => {
      const { fetcher } = makeFetcher([
        (url) => (url.startsWith('/api/plugins/community') ? json(registryBody({ skipped: 3 })) : undefined),
      ]);

      renderPanel({ fetcher });

      expect(await screen.findByText(/3 条记录被忽略/)).toBeTruthy();
    });
  });

  describe('filtering', () => {
    const twoPluginBody = () =>
      registryBody({
        plugins: [
          makePlugin(),
          makePlugin({
            id: 'ext-whiteboard',
            name: '白板画笔',
            description: '手写几何图形识别',
            author: 'someone',
            tags: ['白板'],
          }),
        ],
      });

    it('filters cards by search query across name, author and tags', async () => {
      const { fetcher } = makeFetcher([
        (url) => (url.startsWith('/api/plugins/community') ? json(twoPluginBody()) : undefined),
      ]);

      renderPanel({ fetcher });
      expect(await screen.findByTestId(HOMEWORK_CARD)).toBeTruthy();
      expect(screen.getByTestId('community-card-ext-whiteboard')).toBeTruthy();

      fireEvent.change(screen.getByLabelText('搜索社区插件'), { target: { value: '白板' } });

      await waitFor(() => expect(screen.queryByTestId(HOMEWORK_CARD)).toBeNull());
      expect(screen.getByTestId('community-card-ext-whiteboard')).toBeTruthy();
    });

    it('filters cards by tag chip and clears the filter on a second click', async () => {
      const { fetcher } = makeFetcher([
        (url) => (url.startsWith('/api/plugins/community') ? json(twoPluginBody()) : undefined),
      ]);

      renderPanel({ fetcher });
      await screen.findByTestId(HOMEWORK_CARD);

      const chips = within(screen.getByTestId('community-tag-filters'));
      fireEvent.click(chips.getByRole('button', { name: '白板' }));

      await waitFor(() => expect(screen.queryByTestId(HOMEWORK_CARD)).toBeNull());
      expect(screen.getByTestId('community-card-ext-whiteboard')).toBeTruthy();

      fireEvent.click(chips.getByRole('button', { name: '白板' }));
      expect(await screen.findByTestId(HOMEWORK_CARD)).toBeTruthy();
    });

    it('offers a clear-filters action when a search matches nothing', async () => {
      const { fetcher } = makeFetcher([
        (url) => (url.startsWith('/api/plugins/community') ? json(twoPluginBody()) : undefined),
      ]);

      renderPanel({ fetcher });
      await screen.findByTestId(HOMEWORK_CARD);

      fireEvent.change(screen.getByLabelText('搜索社区插件'), { target: { value: 'zzzz-no-match' } });
      expect(await screen.findByText('没有符合当前筛选条件的插件')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: '清除筛选条件' }));
      expect(await screen.findByTestId(HOMEWORK_CARD)).toBeTruthy();
    });
  });

  describe('install', () => {
    it('installs through the server endpoint and reports success', async () => {
      const onInstalled = vi.fn();
      const { fetcher, calls } = makeFetcher([
        (url) => (url.startsWith('/api/plugins/community') ? json(registryBody()) : undefined),
        (url) => (url === '/api/plugins/install-from-url' ? json({ success: true, updated: false }) : undefined),
      ]);

      renderPanel({ fetcher, onInstalled });
      await screen.findByTestId(HOMEWORK_CARD);

      fireEvent.click(screen.getByRole('button', { name: '安装' }));

      expect(await screen.findByText('安装完成，请在「发现」页启用')).toBeTruthy();

      const installCall = calls.find((c) => c.url === '/api/plugins/install-from-url');
      expect(installCall?.init?.method).toBe('POST');
      expect(JSON.parse(String(installCall?.init?.body))).toEqual({
        downloadUrl: 'https://plugins.example.com/ext-homework-hub-1.2.0.zip',
        expectedId: 'ext-homework-hub',
      });
      expect(onInstalled).toHaveBeenCalledTimes(1);

      // 安装成功后按钮进入已安装态，避免重复安装
      expect(await screen.findByRole('button', { name: '已安装' })).toHaveProperty('disabled', true);
    });

    it('falls back to a browser transfer when the server cannot download the package', async () => {
      const downloadUrl = 'https://plugins.example.com/ext-homework-hub-1.2.0.zip';
      const { fetcher, calls } = makeFetcher([
        (url) => (url.startsWith('/api/plugins/community') ? json(registryBody()) : undefined),
        (url) =>
          url === '/api/plugins/install-from-url'
            ? json({ success: false, error: '服务端下载超时', fallbackToClient: true }, 400)
            : undefined,
        (url) => (url === downloadUrl ? zip() : undefined),
        (url) => (url === '/api/plugins/upload-zip-raw' ? json({ success: true, updated: false }) : undefined),
      ]);

      renderPanel({ fetcher });
      await screen.findByTestId(HOMEWORK_CARD);

      fireEvent.click(screen.getByRole('button', { name: '安装' }));

      expect(await screen.findByText('安装完成，请在「发现」页启用')).toBeTruthy();

      const uploadCall = calls.find((c) => c.url === '/api/plugins/upload-zip-raw');
      expect(uploadCall).toBeTruthy();
      const headers = uploadCall?.init?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/octet-stream');
      expect(headers['x-filename']).toBe('ext-homework-hub-1.2.0.zip');
      expect(uploadCall?.init?.body).toBeInstanceOf(Blob);
    });

    it('explains that installation is administrator-only on a 403', async () => {
      const { fetcher } = makeFetcher([
        (url) => (url.startsWith('/api/plugins/community') ? json(registryBody()) : undefined),
        (url) => (url === '/api/plugins/install-from-url' ? json({ success: false }, 403) : undefined),
      ]);

      renderPanel({ fetcher });
      await screen.findByTestId(HOMEWORK_CARD);

      fireEvent.click(screen.getByRole('button', { name: '安装' }));

      expect(await screen.findByText('仅管理员可安装社区插件，请联系管理员。')).toBeTruthy();
    });

    it('reports the server error message when installation fails', async () => {
      const { fetcher } = makeFetcher([
        (url) => (url.startsWith('/api/plugins/community') ? json(registryBody()) : undefined),
        (url) =>
          url === '/api/plugins/install-from-url'
            ? json({ success: false, error: '插件包超过 200MB 上限' }, 400)
            : undefined,
      ]);

      renderPanel({ fetcher });
      await screen.findByTestId(HOMEWORK_CARD);

      fireEvent.click(screen.getByRole('button', { name: '安装' }));

      expect(await screen.findByText('插件包超过 200MB 上限')).toBeTruthy();
    });
  });

  describe('installed state', () => {
    const installedWith = (manifest: string) => [{ id: 'uuid-homework', manifest }];

    it('offers an update when the registry version is newer than the installed one', async () => {
      const { fetcher } = makeFetcher([
        (url) =>
          url.startsWith('/api/plugins/community')
            ? json(registryBody({ plugins: [makePlugin({ installedVersion: '1.0.0', hasUpdate: true })] }))
            : undefined,
      ]);

      renderPanel({
        fetcher,
        installedPlugins: installedWith(JSON.stringify({ id: 'ext-homework-hub', version: '1.0.0' })),
      });

      expect(await screen.findByRole('button', { name: '更新至 v1.2.0' })).toBeTruthy();
      expect(screen.getByText('已装 v1.0.0')).toBeTruthy();
    });

    it('disables the button when the installed version is current', async () => {
      const { fetcher } = makeFetcher([
        (url) =>
          url.startsWith('/api/plugins/community')
            ? json(registryBody({ plugins: [makePlugin({ installedVersion: '1.2.0', hasUpdate: false })] }))
            : undefined,
      ]);

      renderPanel({
        fetcher,
        installedPlugins: installedWith(JSON.stringify({ id: 'ext-homework-hub', version: '1.2.0' })),
      });

      const button = await screen.findByRole('button', { name: '已安装' });
      expect(button).toHaveProperty('disabled', true);
    });

    it('detects an installed plugin from the local manifest even if the server has not annotated it', async () => {
      const { fetcher } = makeFetcher([
        (url) => (url.startsWith('/api/plugins/community') ? json(registryBody()) : undefined),
      ]);

      renderPanel({
        fetcher,
        installedPlugins: installedWith(JSON.stringify({ id: 'ext-homework-hub', version: '1.2.0' })),
      });

      expect(await screen.findByRole('button', { name: '已安装' })).toBeTruthy();
    });

    it('hides installed plugins when the filter is enabled', async () => {
      const { fetcher } = makeFetcher([
        (url) => (url.startsWith('/api/plugins/community') ? json(registryBody()) : undefined),
      ]);

      renderPanel({
        fetcher,
        installedPlugins: installedWith(JSON.stringify({ id: 'ext-homework-hub', version: '1.2.0' })),
      });
      await screen.findByTestId(HOMEWORK_CARD);

      fireEvent.click(screen.getByLabelText('隐藏已安装'));

      await waitFor(() => expect(screen.queryByTestId(HOMEWORK_CARD)).toBeNull());
      expect(screen.getByText('没有符合当前筛选条件的插件')).toBeTruthy();
    });

    it('falls back to the database id when a local manifest cannot be parsed', async () => {
      const { fetcher } = makeFetcher([
        (url) => (url.startsWith('/api/plugins/community') ? json(registryBody()) : undefined),
      ]);

      renderPanel({
        fetcher,
        installedPlugins: [{ id: 'ext-homework-hub', manifest: '{ not json' }],
      });

      expect(await screen.findByRole('button', { name: '已安装' })).toBeTruthy();
    });
  });

  it('renders English copy when lang is not zh', async () => {
    const { fetcher } = makeFetcher([
      (url) => (url.startsWith('/api/plugins/community') ? json(registryBody()) : undefined),
    ]);

    renderPanel({ fetcher, lang: 'en' });

    expect(await screen.findByRole('button', { name: 'Install' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Refresh/ })).toBeTruthy();
    expect(screen.getByLabelText('Hide installed')).toBeTruthy();
  });
});
