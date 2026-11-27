// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import {
  DEFAULT_COMMUNITY_REGISTRY_URL,
  PluginCommunityPanel,
  type CommunityPlugin,
} from '../plugin-center/sub-views/PluginCommunityPanel';

// 与缺失的 vitest.config.ts（jsdom + globals + setup 文件）无关：本用例以文件级
// `@vitest-environment jsdom` 固定 DOM 环境，并显式清理 DOM —— globals 关闭时
// @testing-library 无法自动注册 afterEach，否则用例之间的 DOM 会互相污染。
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

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
  configSource?: 'database' | 'env' | 'default' | 'none';
  databaseUrl?: string | null;
  defaultUrl?: string | null;
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

    it('displays loading spinner and indeterminate progress animation during initial load and manual refresh', async () => {
      const pendingResolvers: Array<(res: Response) => void> = [];
      let requestCount = 0;
      const fetcher: typeof fetch = vi.fn((input) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (!url.startsWith('/api/plugins/community')) {
          return Promise.resolve(json({ success: false }, 404));
        }
        requestCount += 1;
        return new Promise<Response>((resolve) => {
          pendingResolvers.push(resolve);
        });
      }) as unknown as typeof fetch;

      renderPanel({ fetcher });

      // 初始载入中动画
      const initialBanner = await screen.findByTestId('community-loading-indicator');
      expect(within(initialBanner).getByText('正在载入插件社区…')).toBeTruthy();
      expect(initialBanner.querySelector('.animate-spin')).toBeTruthy();
      const initialProgress = initialBanner.querySelector('progress');
      expect(initialProgress).toBeTruthy();
      expect(initialProgress?.hasAttribute('value')).toBe(false);

      const initialBtn = screen.getByTestId('community-refresh-btn') as HTMLButtonElement;
      expect(initialBtn.disabled).toBe(true);
      expect(initialBtn.getAttribute('aria-busy')).toBe('true');
      expect(initialBtn.textContent).toContain('载入中…');
      expect(initialBtn.querySelector('.animate-spin')).toBeTruthy();

      // 完成首次加载
      pendingResolvers.shift()?.(json(registryBody()));
      expect(await screen.findByText('作业中心')).toBeTruthy();
      expect(screen.queryByTestId('community-loading-indicator')).toBeNull();

      const readyBtn = screen.getByTestId('community-refresh-btn') as HTMLButtonElement;
      expect(readyBtn.disabled).toBe(false);
      expect(readyBtn.textContent).toContain('刷新');

      // 手动点击刷新，应立即进入刷新载入动画并禁用重复点击
      fireEvent.click(readyBtn);
      const refreshBanner = await screen.findByTestId('community-loading-indicator');
      expect(within(refreshBanner).getByText('正在刷新插件社区…')).toBeTruthy();
      expect(refreshBanner.querySelector('.animate-spin')).toBeTruthy();
      const refreshProgress = refreshBanner.querySelector('progress');
      expect(refreshProgress).toBeTruthy();
      expect(refreshProgress?.getAttribute('aria-label')).toBe('插件社区刷新进度');
      expect(refreshProgress?.hasAttribute('value')).toBe(false);

      const refreshingBtn = screen.getByTestId('community-refresh-btn') as HTMLButtonElement;
      expect(refreshingBtn.disabled).toBe(true);
      expect(refreshingBtn.getAttribute('aria-busy')).toBe('true');
      expect(refreshingBtn.textContent).toContain('刷新中…');
      fireEvent.click(refreshingBtn);
      expect(requestCount).toBe(2);

      // 完成刷新后恢复展示最新插件卡片
      pendingResolvers.shift()?.(json(registryBody({ plugins: [makePlugin({ name: '作业中心（已刷新）' })] })));
      expect(await screen.findByText('作业中心（已刷新）')).toBeTruthy();
      expect(screen.queryByTestId('community-loading-indicator')).toBeNull();
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
      expect(screen.queryByTestId('community-install-risk-dialog')).toBeNull();

      expect(await screen.findByText('安装完成，刷新页面后前端扩展点生效')).toBeTruthy();

      const installCall = calls.find((c) => c.url === '/api/plugins/install-from-url');
      expect(installCall?.init?.method).toBe('POST');
      expect((installCall?.init?.headers as Record<string, string>)?.Accept).toBe('text/event-stream');
      expect(JSON.parse(String(installCall?.init?.body))).toEqual({
        downloadUrl: 'https://plugins.example.com/ext-homework-hub-1.2.0.zip',
        expectedId: 'ext-homework-hub',
        approvePublicRoutes: true,
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

      expect(await screen.findByText('安装完成，刷新页面后前端扩展点生效')).toBeTruthy();

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

      expect(await screen.findByText('仅管理员可安装社区插件，请联系管理员。')).toBeTruthy();
    });

    it('surfaces the server error when 403 carries a specific error code such as COMMUNITY_INSTALL_DISABLED', async () => {
      const disabledMsg =
        '社区安装已被关闭。请由管理员在「站点设置 → 运行时策略」或插件中心「社区」页开启「允许从社区注册表安装」。';
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

      expect(await screen.findByText(disabledMsg)).toBeTruthy();
      expect(screen.queryByText('仅管理员可安装社区插件，请联系管理员。')).toBeNull();
    });

    it('handles 403 code distinction properly during browser upload fallback', async () => {
      const disabledMsg =
        '社区安装已被关闭。请由管理员在「站点设置 → 运行时策略」或插件中心「社区」页开启「允许从社区注册表安装」。';
      const { fetcher } = makeFetcher([
        (url) => (url.startsWith('/api/plugins/community') ? json(registryBody()) : undefined),
        (url) =>
          url === '/api/plugins/install-from-url' ? json({ success: false, fallbackToClient: true }, 502) : undefined,
        (url) => (url.endsWith('.zip') ? new Response(new Uint8Array([1, 2, 3]), { status: 200 }) : undefined),
        (url) =>
          url === '/api/plugins/upload-zip-raw'
            ? json({ success: false, code: 'COMMUNITY_INSTALL_DISABLED', error: disabledMsg }, 403)
            : undefined,
      ]);

      renderPanel({ fetcher });
      await screen.findByTestId(HOMEWORK_CARD);

      fireEvent.click(screen.getByRole('button', { name: '安装' }));

      expect(await screen.findByText(disabledMsg)).toBeTruthy();
      expect(screen.queryByText('仅管理员可安装社区插件，请联系管理员。')).toBeNull();
    });

    it('falls back to administrator-only message during browser upload fallback on role-only 403', async () => {
      const { fetcher } = makeFetcher([
        (url) => (url.startsWith('/api/plugins/community') ? json(registryBody()) : undefined),
        (url) =>
          url === '/api/plugins/install-from-url' ? json({ success: false, fallbackToClient: true }, 502) : undefined,
        (url) => (url.endsWith('.zip') ? new Response(new Uint8Array([1, 2, 3]), { status: 200 }) : undefined),
        (url) => (url === '/api/plugins/upload-zip-raw' ? json({ success: false }, 403) : undefined),
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

    it('shows loading spinner, disables duplicate clicks, and streams stage + percentage progress via SSE', async () => {
      let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
      const encoder = new TextEncoder();
      let installPostCount = 0;

      const fetcher = async (url: string) => {
        if (url.startsWith('/api/plugins/community')) return json(registryBody());
        if (url === '/api/plugins/install-from-url') {
          installPostCount += 1;
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controllerRef = controller;
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { 'content-type': 'text/event-stream; charset=utf-8' },
          });
        }
        throw new Error(`unexpected: ${url}`);
      };

      renderPanel({ fetcher });
      await screen.findByTestId(HOMEWORK_CARD);

      const installBtn = screen.getByRole('button', { name: '安装' }) as HTMLButtonElement;
      fireEvent.click(installBtn);

      // 立即进入 loading 状态并禁用重复点击
      const loadingBtn = await screen.findByRole('button', { name: '安装中…' });
      expect((loadingBtn as HTMLButtonElement).disabled).toBe(true);
      expect(loadingBtn.getAttribute('aria-busy')).toBe('true');
      expect(loadingBtn.querySelector('.animate-spin')).toBeTruthy();

      fireEvent.click(loadingBtn);
      expect(installPostCount).toBe(1);

      const pushSse = (event: string, data: unknown) => {
        controllerRef!.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // 阶段 1：下载中 + 百分比
      pushSse('progress', { stage: 'downloading', percent: 33, loaded: 500, total: 1000, downloadPercent: 50 });
      await waitFor(() => {
        expect(screen.getByTestId('community-install-stage-ext-homework-hub').textContent).toBe('下载中');
        expect(screen.getByTestId('community-install-percent-ext-homework-hub').textContent).toBe('33%');
        const bar = screen.getByRole('progressbar');
        expect(bar.getAttribute('data-indeterminate')).toBe('false');
        expect(bar.getAttribute('aria-valuenow')).toBe('33');
      });

      // 阶段 2：校验签名
      pushSse('progress', { stage: 'verifying', percent: 72 });
      await waitFor(() => {
        expect(screen.getByTestId('community-install-stage-ext-homework-hub').textContent).toBe('校验签名');
        expect(screen.getByTestId('community-install-percent-ext-homework-hub').textContent).toBe('72%');
      });

      // 阶段 3：安装中
      pushSse('progress', { stage: 'installing', percent: 85 });
      await waitFor(() => {
        expect(screen.getByTestId('community-install-stage-ext-homework-hub').textContent).toBe('安装中');
        expect(screen.getByTestId('community-install-percent-ext-homework-hub').textContent).toBe('85%');
      });

      // 阶段 4：激活中
      pushSse('progress', { stage: 'activating', percent: 95 });
      await waitFor(() => {
        expect(screen.getByTestId('community-install-stage-ext-homework-hub').textContent).toBe('激活中');
        expect(screen.getByTestId('community-install-percent-ext-homework-hub').textContent).toBe('95%');
      });

      // 完成提示
      pushSse('progress', { stage: 'complete', percent: 100 });
      pushSse('result', { success: true, updated: false, activated: true, pluginId: 'uuid-1' });
      controllerRef!.close();

      expect(await screen.findByText('安装完成，刷新页面后前端扩展点生效')).toBeTruthy();
      expect(screen.queryByTestId('community-install-progress-ext-homework-hub')).toBeNull();
    });

    it('degrades to an indeterminate progress bar while keeping stage label when Content-Length is missing', async () => {
      let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
      const encoder = new TextEncoder();

      const fetcher = async (url: string) => {
        if (url.startsWith('/api/plugins/community')) return json(registryBody());
        if (url === '/api/plugins/install-from-url') {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controllerRef = controller;
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { 'content-type': 'text/event-stream; charset=utf-8' },
          });
        }
        throw new Error(`unexpected: ${url}`);
      };

      renderPanel({ fetcher });
      await screen.findByTestId(HOMEWORK_CARD);

      fireEvent.click(screen.getByRole('button', { name: '安装' }));
      await screen.findByTestId('community-install-progress-ext-homework-hub');

      controllerRef!.enqueue(
        encoder.encode(
          `event: progress\ndata: ${JSON.stringify({ stage: 'downloading', percent: null, loaded: 2048, total: null })}\n\n`,
        ),
      );

      await waitFor(() => {
        expect(screen.getByTestId('community-install-stage-ext-homework-hub').textContent).toBe('下载中');
        expect(screen.getByTestId('community-install-percent-ext-homework-hub').textContent).toBe('大小未知');
        const bar = screen.getByRole('progressbar');
        expect(bar.getAttribute('data-indeterminate')).toBe('true');
        expect(bar.getAttribute('aria-valuenow')).toBeNull();
      });

      controllerRef!.enqueue(
        encoder.encode(
          `event: result\ndata: ${JSON.stringify({ success: true, updated: false, activated: true })}\n\n`,
        ),
      );
      controllerRef!.close();

      expect(await screen.findByText('安装完成，刷新页面后前端扩展点生效')).toBeTruthy();
    });

    it('streams browser download progress and activates plugin during fallback when Content-Length is provided or omitted', async () => {
      const downloadUrl = 'https://plugins.example.com/ext-homework-hub-1.2.0.zip';
      let zipController: ReadableStreamDefaultController<Uint8Array> | null = null;
      const { fetcher, calls } = makeFetcher([
        (url) => (url.startsWith('/api/plugins/community') ? json(registryBody()) : undefined),
        (url) =>
          url === '/api/plugins/install-from-url'
            ? json({ success: false, error: '服务端下载失败', fallbackToClient: true }, 400)
            : undefined,
        (url) => {
          if (url !== downloadUrl) return undefined;
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              zipController = controller;
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { 'content-length': '10' },
          });
        },
        (url) =>
          url === '/api/plugins/upload-zip-raw'
            ? json({ success: true, updated: false, pluginId: 'uuid-browser-1' })
            : undefined,
        (url) => (url === '/api/plugins/uuid-browser-1/toggle' ? json({ success: true, status: 'active' }) : undefined),
      ]);

      renderPanel({ fetcher });
      await screen.findByTestId(HOMEWORK_CARD);

      fireEvent.click(screen.getByRole('button', { name: '安装' }));

      await waitFor(() => expect(zipController).not.toBeNull());
      zipController!.enqueue(new Uint8Array([1, 2, 3, 4, 5]));
      await waitFor(() => {
        expect(screen.getByTestId('community-install-stage-ext-homework-hub').textContent).toBe('下载中');
        expect(screen.getByTestId('community-install-percent-ext-homework-hub').textContent).toBe('33%');
      });

      zipController!.enqueue(new Uint8Array([6, 7, 8, 9, 10]));
      zipController!.close();

      expect(await screen.findByText('安装完成，刷新页面后前端扩展点生效')).toBeTruthy();
      expect(calls.some((c) => c.url === '/api/plugins/uuid-browser-1/toggle')).toBe(true);
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

    it('displays the official Gitee registry JSON URL in the edit input when the user has not customized it', async () => {
      const { fetcher } = makeFetcher([
        (url) =>
          url.startsWith('/api/plugins/community')
            ? json(
                registryBody({
                  configured: true,
                  source: DEFAULT_COMMUNITY_REGISTRY_URL,
                  configSource: 'default',
                  databaseUrl: null,
                  defaultUrl: DEFAULT_COMMUNITY_REGISTRY_URL,
                  hasEnvFallback: false,
                  canConfigure: true,
                }),
              )
            : undefined,
      ]);

      renderPanel({ fetcher });
      await screen.findByText('作业中心');

      fireEvent.click(screen.getByRole('button', { name: '插件源设置' }));
      const panel = screen.getByTestId('community-registry-config-panel');
      expect(within(panel).getByText('当前来源：官方默认（Gitee）')).toBeTruthy();
      const input = within(panel).getByLabelText('社区插件注册表 JSON 地址') as HTMLInputElement;
      expect(input.value).toBe(DEFAULT_COMMUNITY_REGISTRY_URL);
    });

    it('resets a database override back to the official Gitee default when no env fallback exists', async () => {
      let dbUrl: string | null = 'https://custom.example.com/plugins.json';

      const { fetcher, calls } = makeFetcher([
        (url, init) => {
          if (url === '/api/plugins/community/config' && init?.method === 'PUT') {
            const parsed = JSON.parse(String(init.body)) as { registryUrl: string | null };
            dbUrl = parsed.registryUrl;
            return json({
              success: true,
              configSource: dbUrl ? 'database' : 'default',
              databaseUrl: dbUrl,
              activeUrl: dbUrl ?? DEFAULT_COMMUNITY_REGISTRY_URL,
              defaultUrl: DEFAULT_COMMUNITY_REGISTRY_URL,
              hasEnvFallback: false,
            });
          }
          if (url.startsWith('/api/plugins/community')) {
            return json(
              registryBody({
                configured: true,
                source: dbUrl ?? DEFAULT_COMMUNITY_REGISTRY_URL,
                configSource: dbUrl ? 'database' : 'default',
                databaseUrl: dbUrl,
                defaultUrl: DEFAULT_COMMUNITY_REGISTRY_URL,
                hasEnvFallback: false,
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
      expect(within(panel).getByText('当前来源：界面配置（覆盖官方默认）')).toBeTruthy();
      fireEvent.click(within(panel).getByRole('button', { name: '恢复官方默认' }));

      await waitFor(() => expect(screen.getByText('gitee.com')).toBeTruthy());
      const clearCall = calls.filter((c) => c.url === '/api/plugins/community/config').pop();
      expect(JSON.parse(String(clearCall?.init?.body))).toEqual({ registryUrl: null });

      fireEvent.click(screen.getByRole('button', { name: '插件源设置' }));
      const reopenedInput = within(screen.getByTestId('community-registry-config-panel')).getByLabelText(
        '社区插件注册表 JSON 地址',
      ) as HTMLInputElement;
      expect(reopenedInput.value).toBe(DEFAULT_COMMUNITY_REGISTRY_URL);
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

    it('does not warn about missing community public keys even when publicKeysConfigured is false', async () => {
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
      expect(toggle.textContent || '').not.toMatch(/尚未配置社区验签公钥/);
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

  describe('release metadata and Gitee +⭐ starring', () => {
    it('displays release date and formatted ZIP package size on the card', async () => {
      const { fetcher } = makeFetcher([
        (url) =>
          url.startsWith('/api/plugins/community')
            ? json(
                registryBody({
                  plugins: [
                    makePlugin({
                      publishedAt: '2026-11-14T17:41:25+08:00',
                      packageSize: 25680,
                    }),
                    makePlugin({
                      id: 'ext-large',
                      name: '大型插件',
                      publishedAt: '2026-11-10T08:00:00Z',
                      packageSize: 1759186,
                    }),
                  ],
                }),
              )
            : undefined,
      ]);

      renderPanel({ fetcher });
      const card1 = within(await screen.findByTestId(HOMEWORK_CARD));
      expect(card1.getByText('发布于 2026-11-14')).toBeTruthy();
      expect(card1.getByText('25.1 KB')).toBeTruthy();

      const card2 = within(screen.getByTestId('community-card-ext-large'));
      expect(card2.getByText('发布于 2026-11-10')).toBeTruthy();
      expect(card2.getByText('1.68 MB')).toBeTruthy();
    });

    it('prompts Gitee login, opens Gitee repo in a new tab on 401 requiresGiteeAuth, and auto-refreshes stars on tab focus', async () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      const { fetcher } = makeFetcher([
        (url) =>
          url === '/api/plugins/community'
            ? json(
                registryBody({
                  plugins: [
                    makePlugin({
                      repository: 'https://gitee.com/aymwoo/ext-homework-hub',
                      stars: 12,
                      starred: false,
                    }),
                  ],
                }),
              )
            : undefined,
        (url, init) => {
          if (url === '/api/plugins/community/gitee-star' && init?.method === 'POST') {
            return new Response(
              JSON.stringify({
                success: false,
                requiresGiteeAuth: true,
                reason: 'missing_token',
                pluginId: 'ext-homework-hub',
                starUrl: 'https://gitee.com/aymwoo/ext-homework-hub',
                error: '需要登录并授权 Gitee 账号后才能在页面内直接加星',
              }),
              { status: 401, headers: { 'content-type': 'application/json' } },
            );
          }
          if (url.startsWith('/api/plugins/community/gitee-stars')) {
            return json({
              success: true,
              pluginId: 'ext-homework-hub',
              stars: 13,
              starred: false,
              starUrl: 'https://gitee.com/aymwoo/ext-homework-hub',
            });
          }
          return undefined;
        },
      ]);

      renderPanel({ fetcher });
      await screen.findByTestId(HOMEWORK_CARD);

      const starBtn = screen.getByTestId('community-star-ext-homework-hub');
      expect(starBtn.textContent).toContain('12');
      fireEvent.click(starBtn);

      const authPanel = await screen.findByTestId('community-gitee-auth-panel');
      expect(authPanel.textContent).toContain('需要登录并授权 Gitee 账号');
      expect(authPanel.textContent).toContain('https://gitee.com/aymwoo/ext-homework-hub');
      expect(openSpy).toHaveBeenCalledWith(
        'https://gitee.com/aymwoo/ext-homework-hub',
        '_blank',
        'noopener,noreferrer',
      );

      // 模拟用户在 Gitee 新标签页点星后切回 OpenLearn 标签页，自动刷新该插件 Star 数
      fireEvent.focus(window);
      await waitFor(() => {
        expect(starBtn.textContent).toContain('13');
      });
    });

    it('binds a Gitee token and toggles Gitee +⭐ asynchronously without leaving the page', async () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      let starred = false;
      let starCount = 45;

      const { fetcher, calls } = makeFetcher([
        (url, init) => {
          if (url === '/api/plugins/community') {
            const headers = (init?.headers ?? {}) as Record<string, string>;
            const hasToken = headers['x-gitee-token'] === 'gitee_pat_token_123';
            return json(
              registryBody({
                plugins: [
                  makePlugin({
                    repository: 'https://gitee.com/aymwoo/ext-homework-hub',
                    stars: starCount,
                    starred: hasToken ? starred : false,
                  }),
                ],
              }),
            );
          }
          return undefined;
        },
        (url, init) => {
          if (url === '/api/plugins/community/gitee-star' && init?.method === 'POST') {
            const headers = (init?.headers ?? {}) as Record<string, string>;
            expect(headers['x-gitee-token']).toBe('gitee_pat_token_123');
            starred = !starred;
            starCount += starred ? 1 : -1;
            return json({
              success: true,
              pluginId: 'ext-homework-hub',
              starred,
              stars: starCount,
              starUrl: 'https://gitee.com/aymwoo/ext-homework-hub',
            });
          }
          return undefined;
        },
      ]);

      renderPanel({ fetcher });
      await screen.findByTestId(HOMEWORK_CARD);

      fireEvent.click(screen.getByTestId('community-gitee-auth-btn'));
      const tokenInput = await screen.findByPlaceholderText('粘贴 Gitee 私人令牌…');
      fireEvent.change(tokenInput, { target: { value: 'gitee_pat_token_123' } });
      fireEvent.click(screen.getByRole('button', { name: '保存令牌' }));

      await waitFor(() => {
        expect(screen.getByTestId('community-gitee-auth-btn').textContent).toContain('已绑定 Gitee');
      });

      const starBtn = screen.getByTestId('community-star-ext-homework-hub');
      fireEvent.click(starBtn);

      await waitFor(() => {
        expect(starBtn.getAttribute('aria-pressed')).toBe('true');
        expect(starBtn.textContent).toContain('已⭐');
        expect(starBtn.textContent).toContain('46');
      });
      expect(openSpy).not.toHaveBeenCalled();

      const starCall = calls.find((c) => c.url === '/api/plugins/community/gitee-star');
      expect(JSON.parse(String(starCall?.init?.body))).toEqual({ pluginId: 'ext-homework-hub' });

      fireEvent.click(starBtn);
      await waitFor(() => {
        expect(starBtn.getAttribute('aria-pressed')).toBe('false');
        expect(starBtn.textContent).toContain('45');
      });
    });

    it('sorts plugins by latest release and most starred', async () => {
      const { fetcher } = makeFetcher([
        (url) =>
          url.startsWith('/api/plugins/community')
            ? json(
                registryBody({
                  plugins: [
                    makePlugin({ id: 'old-popular', name: '旧但高星', publishedAt: '2026-01-01T00:00:00Z', stars: 99 }),
                    makePlugin({ id: 'new-quiet', name: '最新插件', publishedAt: '2026-11-14T12:00:00Z', stars: 2 }),
                  ],
                }),
              )
            : undefined,
      ]);

      renderPanel({ fetcher });
      await screen.findByText('旧但高星');

      const sortSelect = screen.getByLabelText('排序方式');
      fireEvent.change(sortSelect, { target: { value: 'latest' } });
      await waitFor(() => {
        const cards = screen.getAllByRole('article');
        expect(cards[0].getAttribute('data-testid')).toBe('community-card-new-quiet');
      });

      fireEvent.change(sortSelect, { target: { value: 'stars' } });
      await waitFor(() => {
        const cards = screen.getAllByRole('article');
        expect(cards[0].getAttribute('data-testid')).toBe('community-card-old-popular');
      });
    });

    it('sends x-install-mode=update and x-target-plugin-id during browser upload fallback when updating', async () => {
      const { calls, fetcher } = makeFetcher([
        (url) =>
          url.startsWith('/api/plugins/community')
            ? json(
                registryBody({
                  plugins: [
                    makePlugin({
                      id: 'ext-homework-hub',
                      version: '1.2.0',
                      installedVersion: '1.0.0',
                      hasUpdate: true,
                    }),
                  ],
                }),
              )
            : undefined,
        (url) =>
          url === '/api/plugins/install-from-url'
            ? json({ success: false, fallbackToClient: true, error: 'timeout' }, 400)
            : undefined,
        (url) => (url === 'https://plugins.example.com/ext-homework-hub-1.2.0.zip' ? zip() : undefined),
        (url) =>
          url === '/api/plugins/upload-zip-raw'
            ? json({ success: true, updated: true, newVersion: '1.2.0' })
            : undefined,
      ]);

      render(
        <PluginCommunityPanel
          installedPlugins={[
            {
              id: 'uuid-homework-1',
              manifest: JSON.stringify({ id: 'ext-homework-hub', version: '1.0.0' }),
            },
          ]}
          lang="zh"
          fetcher={fetcher}
        />,
      );

      const updateBtn = await screen.findByRole('button', { name: /更新至 v1\.2\.0/ });
      fireEvent.click(updateBtn);

      await waitFor(() => {
        const uploadCall = calls.find((c) => c.url === '/api/plugins/upload-zip-raw');
        expect(uploadCall).toBeDefined();
        const headers = uploadCall?.init?.headers as Record<string, string>;
        expect(headers['x-install-mode']).toBe('update');
        expect(headers['x-target-plugin-id']).toBe('uuid-homework-1');
      });

      expect(await screen.findByText(/已更新至 v1\.2\.0/)).toBeDefined();
    });

    it('keeps installed plugins with hasUpdate=true visible even when hideInstalled is checked', async () => {
      const { fetcher } = makeFetcher([
        (url) =>
          url.startsWith('/api/plugins/community')
            ? json(
                registryBody({
                  plugins: [
                    makePlugin({
                      id: 'ext-up-to-date',
                      name: '已是最新版',
                      version: '1.0.0',
                      installedVersion: '1.0.0',
                      hasUpdate: false,
                    }),
                    makePlugin({
                      id: 'ext-has-update',
                      name: '有新版本可升级',
                      version: '2.0.0',
                      installedVersion: '1.0.0',
                      hasUpdate: true,
                    }),
                  ],
                }),
              )
            : undefined,
      ]);

      render(
        <PluginCommunityPanel
          installedPlugins={[
            { id: 'ext-up-to-date', manifest: JSON.stringify({ id: 'ext-up-to-date', version: '1.0.0' }) },
            { id: 'ext-has-update', manifest: JSON.stringify({ id: 'ext-has-update', version: '1.0.0' }) },
          ]}
          lang="zh"
          fetcher={fetcher}
        />,
      );

      await screen.findByText('已是最新版');
      const hideCheckbox = screen.getByRole('checkbox', { name: /隐藏已安装/ });
      fireEvent.click(hideCheckbox);

      expect(screen.queryByText('已是最新版')).toBeNull();
      expect(screen.getByText('有新版本可升级')).toBeDefined();
    });
  });
});
