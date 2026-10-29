/**
 * 声明式与纯 view 插件激活 / 404 回退回归测试（Issue #350）。
 *
 * 验证目标：
 * 1. hasFrontend === false（无 frontend.js）的声明式/view-only 插件：
 *    - activateRemotePlugin 不会 fetch('/plugins/:id/frontend.js')
 *    - 插件状态正常进入 ACTIVE
 *    - manifest 中的 contributes（teacher.tab、student.classroom.overlay 等）全部成功注册到 store
 *    - deactivatePlugin 能够正确注销清理声明式贡献
 * 2. hasFrontend === true 但 frontend.js fetch 返回 404 / 失败：
 *    - 声明式贡献提前注册，在 catch 块中被 preserveManifestContributions 成功保留
 *    - 插件状态标记为 ERROR 并记录 HTTP 错误描述
 *    - store 中的声明式贡献依然存在（呈现显式错误重试态，符合 #292 契约，不再静默消失）
 * 3. retryActivation 对 view-only 插件的重试能够继承 hasFrontend 标志，无需二次 fetch
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FrontendPluginHost } from '../plugin-host';
import { usePluginHostStore } from '../plugin-host-store';
import {
  PluginState,
  type FrontendPluginManifest,
  type IFrontendAPI,
  type ISocketService,
  type IUIService,
  type IStorageService,
} from '../types';

function createMockServices() {
  return {
    frontendApi: { get: vi.fn(), post: vi.fn(), del: vi.fn() } as unknown as IFrontendAPI,
    socketService: { emit: vi.fn(), on: vi.fn(), off: vi.fn(), disconnect: vi.fn() } as unknown as ISocketService,
    uiService: { showToast: vi.fn(), showModal: vi.fn(), closeModal: vi.fn() } as unknown as IUIService,
    storageService: { get: vi.fn(), set: vi.fn(), delete: vi.fn(), clear: vi.fn() } as unknown as IStorageService,
  };
}

async function setupHost(): Promise<FrontendPluginHost> {
  const host = new FrontendPluginHost();
  const mockServices = createMockServices();
  await host.initialize(
    mockServices.frontendApi,
    mockServices.socketService,
    mockServices.uiService,
    mockServices.storageService,
  );
  return host;
}

describe('声明式与纯 view 插件远程激活（Issue #350）', () => {
  beforeEach(() => {
    usePluginHostStore.setState({
      activePlugins: [],
      extensionPoints: new Map(),
      pluginErrors: new Map(),
    });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hasFrontend 为 false 的纯 view 插件成功注册声明式贡献并置为 ACTIVE，且不请求 frontend.js', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const host = await setupHost();
    const pluginId = 'sticky-notes-uuid';
    const manifest = {
      id: 'ext-sticky-notes',
      name: '课堂便签',
      version: '1.0.0',
      contributes: {
        'teacher.tab': [{ id: 'sticky-tab', label: '便签看板', view: 'storage/teacher.html' }],
        'student.classroom.overlay': [{ id: 'sticky-overlay', label: '快捷便签', view: 'storage/student.html' }],
      },
    } as unknown as FrontendPluginManifest;

    usePluginHostStore.getState().addPlugin({
      id: pluginId,
      name: '课堂便签',
      version: '1.0.0',
      state: PluginState.INSTALLED,
      executionMode: 'process',
      hasFrontend: false,
    });

    await host.activateRemotePlugin(pluginId, manifest, { hasFrontend: false });

    // 不发起 frontend.js fetch
    expect(fetchMock).not.toHaveBeenCalled();

    // 状态置为 ACTIVE
    const pluginRecord = usePluginHostStore.getState().activePlugins.find((p) => p.id === pluginId);
    expect(pluginRecord?.state).toBe(PluginState.ACTIVE);
    expect(usePluginHostStore.getState().pluginErrors.has(pluginId)).toBe(false);

    // 声明式贡献成功注册到 store 对应槽位
    const store = usePluginHostStore.getState();
    const teacherTabs = store.extensionPoints.get('teacher.tab') || [];
    expect(teacherTabs.some((t) => t.id === 'sticky-tab' && t.pluginId === pluginId)).toBe(true);

    const overlays = store.extensionPoints.get('student.classroom.overlay') || [];
    expect(overlays.some((o) => o.id === 'sticky-overlay' && o.pluginId === pluginId)).toBe(true);

    // 反激活后声明式贡献被清理
    await host.deactivatePlugin(pluginId);
    const updatedStore = usePluginHostStore.getState();
    expect(updatedStore.activePlugins.find((p) => p.id === pluginId)?.state).toBe(PluginState.INACTIVE);
    expect((updatedStore.extensionPoints.get('teacher.tab') || []).some((t) => t.pluginId === pluginId)).toBe(false);
  });

  it('frontend.js 404 加载失败时，声明式贡献保留在 store 且状态为 ERROR（#292 与 #350 时序修复）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = await setupHost();
    const pluginId = 'failed-bundle-plugin';
    const manifest = {
      id: 'ext-broken-bundle',
      name: 'Broken Bundle Plugin',
      version: '1.0.0',
      contributes: {
        'teacher.tab': [{ id: 'broken-tab', label: '损坏页签', view: 'storage/tab.html' }],
      },
    } as unknown as FrontendPluginManifest;

    usePluginHostStore.getState().addPlugin({
      id: pluginId,
      name: 'Broken Bundle Plugin',
      version: '1.0.0',
      state: PluginState.INSTALLED,
      executionMode: 'process',
      hasFrontend: true,
    });

    await expect(host.activateRemotePlugin(pluginId, manifest, { hasFrontend: true })).rejects.toThrow(/HTTP 404/);

    const store = usePluginHostStore.getState();
    const pluginRecord = store.activePlugins.find((p) => p.id === pluginId);
    expect(pluginRecord?.state).toBe(PluginState.ERROR);
    expect(store.pluginErrors.get(pluginId)).toContain('HTTP');

    // 核心断言：因 registerManifestContributions 提前执行且 catch 块 preserveManifestContributions: true，
    // 声明式贡献依然保留在 store 中，供 UI 显示错误重试态，而非空态
    const teacherTabs = store.extensionPoints.get('teacher.tab') || [];
    expect(teacherTabs.some((t) => t.id === 'broken-tab' && t.pluginId === pluginId)).toBe(true);
  });

  it('retryPlugin 对 hasFrontend 为 false 的插件能够成功恢复且不请求 frontend.js', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const host = await setupHost();
    const pluginId = 'retry-view-only-plugin';
    const manifest = {
      id: 'ext-view-retry',
      name: 'Retry View Plugin',
      version: '1.0.0',
      contributes: {
        'teacher.tab': [{ id: 'retry-tab', label: '重试页签' }],
      },
    } as unknown as FrontendPluginManifest;

    usePluginHostStore.getState().addPlugin({
      id: pluginId,
      name: 'Retry View Plugin',
      version: '1.0.0',
      state: PluginState.ERROR,
      executionMode: 'process',
      hasFrontend: false,
    });
    usePluginHostStore.getState().setPluginError(pluginId, 'Simulated initial error');

    // 首次激活缓存 manifest
    await host.activateRemotePlugin(pluginId, manifest, { hasFrontend: false });

    // 人为模拟错误态
    usePluginHostStore.getState().updatePluginState(pluginId, PluginState.ERROR);
    usePluginHostStore.getState().setPluginError(pluginId, 'Intermittent failure');

    const retrySuccess = await host.retryPlugin(pluginId);
    expect(retrySuccess).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    const store = usePluginHostStore.getState();
    expect(store.activePlugins.find((p) => p.id === pluginId)?.state).toBe(PluginState.ACTIVE);
    expect(store.pluginErrors.has(pluginId)).toBe(false);
  });
});
