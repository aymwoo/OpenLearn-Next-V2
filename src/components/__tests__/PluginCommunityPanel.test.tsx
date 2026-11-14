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
  canConfigure?: boolean;
  configSource?: 'database' | 'env' | 'none';
  databaseUrl?: string | null;
  hasEnvFallback?: boolean;
  installEnabled?: boolean;
  installConfigSource?: 'database' | 'env' | 'default' | null;
  storedInstallEnabled?: boolean | null;
  hasInstallEnvFallback?: boolean | null;
  publicKeysConfigured?: boolean | null;
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

    // Issue #228：registry 里的 repository / homepage 是外部数据 —— 协议不受限的话，
    // `javascript:` 之类会直接进 href。
    it('drops links whose scheme is not http(s)', async () => {
      const { fetcher } = makeFetcher([
        (url) =>
          url.startsWith('/api/plugins/community')
            ? json(
                registryBody({
                  plugins: [
                    makePlugin({
                      repository: 'javascript:alert(1)',
                      homepage: 'data:text/html,<script>alert(1)</script>',
                    }),
                  ],
                }),
              )
            : undefined,
      ]);

      renderPanel({ fetcher });

      expect(await screen.findByText('作业中心')).toBeTruthy();
      const card = within(screen.getByTestId(HOMEWORK_CARD));
      // 非法协议的链接整条不渲染
      expect(card.queryByRole('link', { name: /源码/ })).toBeNull();
      expect(card.queryByRole('link')).toBeNull();
      expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
      expect(document.querySelector('a[href^="data:"]')).toBeNull();
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
      expect(await screen.findByTestId('community-install-risk-dialog')).toBeTruthy();
      expect(calls.find((c) => c.url === '/api/plugins/install-from-url')).toBeUndefined();

      fireEvent.click(screen.getByRole('button', { name: '确认风险并安装' }));

      expect(await screen.findByText('安装完成，请在「发现」页启用')).toBeTruthy();

      const installCall = calls.find((c) => c.url === '/api/plugins/install-from-url');
      expect(installCall?.init?.method).toBe('POST');
      expect(JSON.parse(String(installCall?.init?.body))).toEqual({
        downloadUrl: 'https://plugins.example.com/ext-homework-hub-1.2.0.zip',
        expectedId: 'ext-homework-hub',
        acknowledgeRisk: true,
        approvePublicRoutes: false,
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
      fireEvent.click(await screen.findByLabelText('同时批准清单中声明为公开的路由（auth: false）'));
      fireEvent.click(screen.getByRole('button', { name: '确认风险并安装' }));

      expect(await screen.findByText('安装完成，请在「发现」页启用')).toBeTruthy();

      const installCall = calls.find((c) => c.url === '/api/plugins/install-from-url');
      expect(JSON.parse(String(installCall?.init?.body)).approvePublicRoutes).toBe(true);

      const uploadCall = calls.find((c) => c.url === '/api/plugins/upload-zip-raw');
      expect(uploadCall).toBeTruthy();
      const headers = uploadCall?.init?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/octet-stream');
      expect(headers['x-filename']).toBe('ext-homework-hub-1.2.0.zip');
      expect(headers['x-approve-public-routes']).toBe('true');
      expect(uploadCall?.init?.body).toBeInstanceOf(Blob);
    });

    it('explains that installation is administrator-only on a 403 without error code', async () => {
      const { fetcher } = makeFetcher([
        (url) => (url.startsWith('/api/plugins/community') ? json(registryBody()) : undefined),
        (url) => (url === '/api/plugins/install-from-url' ? json({ success: false }, 403) : undefined),
      ]);

      renderPanel({ fetcher });
      await screen.findByTestId(HOMEWORK_CARD);

      fireEvent.click(screen.getByRole('button', { name: '安装' }));
      fireEvent.click(screen.getByRole('button', { name: '确认风险并安装' }));

      expect(await screen.findByText('仅管理员可安装社区插件，请联系管理员。')).toBeTruthy();
    });

    it('surfaces the server error when 403 carries a specific error code such as COMMUNITY_INSTALL_DISABLED', async () => {
      const disabledMsg = '社区安装默认关闭。设置 OPENLEARN_COMMUNITY_INSTALL=1 后才允许从注册表安装。';
      const { fetcher } = makeFetcher([
        (url) => (url.startsWith('/api/plugins/community') ? json(registryBody()) : undefined),
        (url) =>
          url === '/api/plugins/install-from-url'
            ? json({ success: false, code: 'COMMUNITY_INSTALL_DISABLED', error: disabledMsg }, 403)
            : undefined,
      ]);

      renderPanel({ fetcher });
      await screen.findByTestId(HOMEWORK_CARD);

      fireEvent.click(screen.getByRole('button', { name: '安装' }));
      fireEvent.click(screen.getByRole('button', { name: '确认风险并安装' }));

      expect(await screen.findByText(disabledMsg)).toBeTruthy();
      expect(screen.queryByText('仅管理员可安装社区插件，请联系管理员。')).toBeNull();
    });

    it('handles 403 code distinction properly during browser upload fallback', async () => {
      const disabledMsg = '社区安装默认关闭。设置 OPENLEARN_COMMUNITY_INSTALL=1 后才允许从注册表安装。';
      const { fetcher } = makeFetcher([
        (url) => (url.startsWith('/api/plugins/community') ? json(registryBody()) : undefined),
        (url) =>
          url === '/api/plugins/install-from-url' ? json({ success: false, fallbackToClient: true }, 502) : undefined,
        (url) =>
          url.endsWith('.zip') ? new Response(new Blob([new Uint8Array([1, 2, 3])]), { status: 200 }) : undefined,
        (url) =>
          url === '/api/plugins/upload-zip-raw'
            ? json({ success: false, code: 'COMMUNITY_INSTALL_DISABLED', error: disabledMsg }, 403)
            : undefined,
      ]);

      renderPanel({ fetcher });
      await screen.findByTestId(HOMEWORK_CARD);

      fireEvent.click(screen.getByRole('button', { name: '安装' }));
      fireEvent.click(screen.getByRole('button', { name: '确认风险并安装' }));

      expect(await screen.findByText(disabledMsg)).toBeTruthy();
      expect(screen.queryByText('仅管理员可安装社区插件，请联系管理员。')).toBeNull();
    });

    it('falls back to administrator-only message during browser upload fallback on role-only 403', async () => {
      const { fetcher } = makeFetcher([
        (url) => (url.startsWith('/api/plugins/community') ? json(registryBody()) : undefined),
        (url) =>
          url === '/api/plugins/install-from-url' ? json({ success: false, fallbackToClient: true }, 502) : undefined,
        (url) =>
          url.endsWith('.zip') ? new Response(new Blob([new Uint8Array([1, 2, 3])]), { status: 200 }) : undefined,
        (url) => (url === '/api/plugins/upload-zip-raw' ? json({ success: false }, 403) : undefined),
      ]);

      renderPanel({ fetcher });
      await screen.findByTestId(HOMEWORK_CARD);

      fireEvent.click(screen.getByRole('button', { name: '安装' }));
      fireEvent.click(screen.getByRole('button', { name: '确认风险并安装' }));

      expect(await screen.findByText('仅管理员可安装社区插件，请联系管理员。')).toBeTruthy();
    });

    it('reports the server error message when installation fails', async () => {
      const { fetcher, calls } = makeFetcher([
        (url) => (url.startsWith('/api/plugins/community') ? json(registryBody()) : undefined),
        (url) =>
          url === '/api/plugins/install-from-url'
            ? json({ success: false, error: '插件包超过 200MB 上限' }, 400)
            : undefined,
      ]);

      renderPanel({ fetcher });
      await screen.findByTestId(HOMEWORK_CARD);

      fireEvent.click(screen.getByRole('button', { name: '安装' }));
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
      expect(calls.find((c) => c.url === '/api/plugins/install-from-url')).toBeUndefined();

      fireEvent.click(screen.getByRole('button', { name: '安装' }));
      fireEvent.click(screen.getByRole('button', { name: '确认风险并安装' }));

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

  describe('registry URL configuration in Community tab', () => {
    it('lets an administrator configure the registry URL directly from the unconfigured view', async () => {
      let configuredUrl: string | null = null;
      const { fetcher, calls } = makeFetcher([
        (url, init) => {
          if (url === '/api/plugins/community/config' && init?.method === 'PUT') {
            const parsed = JSON.parse(String(init.body)) as { registryUrl: string | null };
            configuredUrl = parsed.registryUrl;
            return json({
              success: true,
              configSource: 'database',
              databaseUrl: configuredUrl,
              activeUrl: configuredUrl,
              hasEnvFallback: false,
            });
          }
          if (url.startsWith('/api/plugins/community')) {
            return configuredUrl
              ? json(
                  registryBody({
                    configured: true,
                    source: configuredUrl,
                    configSource: 'database',
                    databaseUrl: configuredUrl,
                    canConfigure: true,
                  }),
                )
              : json(
                  registryBody({
                    configured: false,
                    source: null,
                    plugins: [],
                    envVar: 'PLUGIN_COMMUNITY_REGISTRY_URL',
                    canConfigure: true,
                    configSource: 'none',
                  }),
                );
          }
          return undefined;
        },
      ]);

      renderPanel({ fetcher });

      const input = await screen.findByLabelText('社区插件注册表 JSON 地址');
      fireEvent.change(input, { target: { value: 'https://community.example.com/plugins.json' } });
      fireEvent.click(screen.getByRole('button', { name: '保存并加载' }));

      expect(await screen.findByText('作业中心')).toBeTruthy();
      const putCall = calls.find((c) => c.url === '/api/plugins/community/config');
      expect(putCall?.init?.method).toBe('PUT');
      expect(JSON.parse(String(putCall?.init?.body))).toEqual({
        registryUrl: 'https://community.example.com/plugins.json',
      });
      expect(calls.some((c) => c.url === '/api/plugins/community?refresh=1')).toBe(true);
    });

    it('validates invalid URLs client-side and surfaces server SSRF rejection errors', async () => {
      const { fetcher, calls } = makeFetcher([
        (url, init) => {
          if (url === '/api/plugins/community/config' && init?.method === 'PUT') {
            return json({ success: false, error: '安全拦截: 非法注册表地址 (IPv4 loopback)' }, 400);
          }
          if (url.startsWith('/api/plugins/community')) {
            return json(
              registryBody({
                configured: false,
                source: null,
                plugins: [],
                canConfigure: true,
                configSource: 'none',
              }),
            );
          }
          return undefined;
        },
      ]);

      renderPanel({ fetcher });

      const input = await screen.findByLabelText('社区插件注册表 JSON 地址');
      fireEvent.change(input, { target: { value: 'ftp://bad.example.com/plugins.json' } });
      fireEvent.click(screen.getByRole('button', { name: '保存并加载' }));

      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(screen.getByText(/仅支持 http:\/\/ 或 https:\/\//)).toBeTruthy();
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(calls.find((c) => c.url === '/api/plugins/community/config')).toBeUndefined();

      fireEvent.change(input, { target: { value: 'http://127.0.0.1/plugins.json' } });
      expect(screen.queryByRole('alert')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '保存并加载' }));

      expect(await screen.findByText(/安全拦截: 非法注册表地址/)).toBeTruthy();
    });

    it('allows editing and clearing the registry URL from the toolbar settings panel', async () => {
      let dbUrl: string | null = 'https://custom.example.com/plugins.json';
      const envUrl = 'https://env.example.com/plugins.json';

      const { fetcher, calls } = makeFetcher([
        (url, init) => {
          if (url === '/api/plugins/community/config' && init?.method === 'PUT') {
            const parsed = JSON.parse(String(init.body)) as { registryUrl: string | null };
            dbUrl = parsed.registryUrl;
            return json({
              success: true,
              configSource: dbUrl ? 'database' : 'env',
              databaseUrl: dbUrl,
              activeUrl: dbUrl ?? envUrl,
              hasEnvFallback: true,
            });
          }
          if (url.startsWith('/api/plugins/community')) {
            return json(
              registryBody({
                configured: true,
                source: dbUrl ?? envUrl,
                configSource: dbUrl ? 'database' : 'env',
                databaseUrl: dbUrl,
                hasEnvFallback: true,
                canConfigure: true,
              }),
            );
          }
          return undefined;
        },
      ]);

      renderPanel({ fetcher });
      await screen.findByText('作业中心');

      fireEvent.click(screen.getByRole('button', { name: '插件源设置' }));
      const panel = screen.getByTestId('community-registry-config-panel');
      expect(within(panel).getByText('当前来源：界面配置（覆盖环境变量）')).toBeTruthy();
      const input = within(panel).getByLabelText('社区插件注册表 JSON 地址') as HTMLInputElement;
      expect(input.value).toBe('https://custom.example.com/plugins.json');

      fireEvent.change(input, { target: { value: 'https://mirror.example.com/plugins.json' } });
      fireEvent.click(within(panel).getByRole('button', { name: '保存并刷新' }));

      await waitFor(() => expect(screen.queryByTestId('community-registry-config-panel')).toBeNull());
      expect(screen.getByText('mirror.example.com')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: '插件源设置' }));
      fireEvent.click(screen.getByRole('button', { name: '恢复环境变量默认' }));

      await waitFor(() => expect(screen.getByText('env.example.com')).toBeTruthy());
      const clearCall = calls.filter((c) => c.url === '/api/plugins/community/config').pop();
      expect(JSON.parse(String(clearCall?.init?.body))).toEqual({ registryUrl: null });
    });

    it('hides registry configuration controls when user is not an administrator', async () => {
      const { fetcher } = makeFetcher([
        (url) =>
          url.startsWith('/api/plugins/community')
            ? json(registryBody({ canConfigure: false, configSource: 'env' }))
            : undefined,
      ]);

      renderPanel({ fetcher });
      await screen.findByText('作业中心');

      expect(screen.queryByRole('button', { name: '插件源设置' })).toBeNull();
    });

    it('hides the setup form on the unconfigured view for non-administrators', async () => {
      const { fetcher } = makeFetcher([
        (url) =>
          url.startsWith('/api/plugins/community')
            ? json(registryBody({ configured: false, source: null, plugins: [], canConfigure: false }))
            : undefined,
      ]);

      renderPanel({ fetcher });
      expect(await screen.findByText('尚未配置社区插件源')).toBeTruthy();
      expect(screen.queryByLabelText('社区插件注册表 JSON 地址')).toBeNull();
    });

    it('offers an edit-source shortcut in the error state for administrators', async () => {
      const { fetcher } = makeFetcher([
        (url) =>
          url.startsWith('/api/plugins/community')
            ? json(registryBody({ error: '拉取社区注册表超时', plugins: [], canConfigure: true }))
            : undefined,
      ]);

      renderPanel({ fetcher });
      expect(await screen.findByRole('alert')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: '修改插件源' }));
      expect(screen.getByTestId('community-registry-config-panel')).toBeTruthy();
    });
  });

  describe('community install toggle', () => {
    it('lets an administrator turn the switch on and persist installEnabled', async () => {
      const { fetcher, calls } = makeFetcher([
        (url, init) => {
          if (url === '/api/plugins/community/config' && init?.method === 'PUT') {
            return json({
              success: true,
              installEnabled: true,
              storedInstallEnabled: true,
              installConfigSource: 'database',
            });
          }
          if (url.startsWith('/api/plugins/community')) {
            const alreadySaved = calls.some((c) => c.url === '/api/plugins/community/config');
            return json(
              registryBody({
                canConfigure: true,
                installEnabled: alreadySaved,
                installConfigSource: alreadySaved ? 'database' : 'default',
                storedInstallEnabled: alreadySaved ? true : null,
                hasInstallEnvFallback: false,
                publicKeysConfigured: true,
              }),
            );
          }
          return undefined;
        },
      ]);

      renderPanel({ fetcher });
      await screen.findByText('作业中心');

      const toggle = screen.getByTestId('community-install-toggle');
      expect(toggle.textContent || '').toMatch(/允许从社区注册表安装/);
      expect(toggle.textContent || '').toMatch(/有效状态：已关闭/);
      const switchBtn = screen.getByRole('switch', { name: '允许从社区注册表安装' }) as HTMLButtonElement;
      expect(switchBtn.disabled).toBe(false);
      expect(switchBtn.getAttribute('aria-checked')).toBe('false');

      fireEvent.click(switchBtn);
      await waitFor(() => {
        const body = calls.find((c) => c.url === '/api/plugins/community/config');
        expect(body).toBeTruthy();
        expect(JSON.parse(String(body?.init?.body))).toEqual({ installEnabled: true });
      });
      await waitFor(() => {
        expect(screen.getByTestId('community-install-toggle').textContent || '').toMatch(/有效状态：已开启/);
      });
    });

    it('warns in Chinese when the switch is on but no public key is configured', async () => {
      const { fetcher } = makeFetcher([
        (url) =>
          url.startsWith('/api/plugins/community')
            ? json(
                registryBody({
                  canConfigure: true,
                  installEnabled: true,
                  installConfigSource: 'database',
                  storedInstallEnabled: true,
                  publicKeysConfigured: false,
                }),
              )
            : undefined,
      ]);

      renderPanel({ fetcher });
      await screen.findByText('作业中心');
      const toggle = screen.getByTestId('community-install-toggle');
      expect(toggle.textContent || '').toMatch(/尚未配置社区验签公钥/);
      expect(toggle.textContent || '').toMatch(/即便已开启此开关，也无法从社区注册表安装/);
    });

    it('disables the switch for non-administrators and does not submit', async () => {
      const { fetcher, calls } = makeFetcher([
        (url) =>
          url.startsWith('/api/plugins/community')
            ? json(
                registryBody({
                  canConfigure: false,
                  installEnabled: false,
                  installConfigSource: null,
                  storedInstallEnabled: null,
                  hasInstallEnvFallback: null,
                  publicKeysConfigured: null,
                }),
              )
            : undefined,
      ]);

      renderPanel({ fetcher });
      await screen.findByText('作业中心');

      const switchBtn = screen.getByRole('switch', { name: '允许从社区注册表安装' }) as HTMLButtonElement;
      expect(switchBtn.disabled).toBe(true);
      fireEvent.click(switchBtn);
      expect(calls.some((c) => c.url === '/api/plugins/community/config')).toBe(false);
      expect(screen.getByTestId('community-install-toggle').textContent || '').not.toMatch(
        /OPENLEARN_COMMUNITY_INSTALL/,
      );
    });
  });
});
