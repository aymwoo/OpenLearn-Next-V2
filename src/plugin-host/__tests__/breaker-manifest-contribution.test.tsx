/**
 * v0.7.0 熔断越权修复回归测试。
 *
 * 缺陷：插件前端加载失败或被熔断时，扩展点清理路径把 **manifest 声明式贡献**
 * 一并摘除 —— 熔断器 `handleBreakerTrip` → `unregisterPluginExtensionPoints`
 * （整包摘除），激活失败路径 `unregisterPluginResources` → 同样整包摘除。
 *
 * 后果：声明式贡献（Tab / 命令面板项 / 画布调色板项）由**服务端**插件宿主执行，
 * 与前端 bundle 无关，前端崩溃不该让它们凭空消失。实测表现为失败插件的 Tab
 * 「闪现后消失」（单跑出现、全跑消失，取决于渲染时序），用户既看不到提示，
 * 也无从判断是「插件没装」还是「插件挂了」。
 *
 * 本测试钉住修复后的三条契约：
 * 1. 扩展点按来源分流（origin: manifest | runtime），两类清理路径互不越权；
 * 2. 激活失败 / 熔断降级保留声明式贡献，并记录显式错误；
 * 3. 渲染层给出「错误 + 重试」的显式错误态，而不是静默留白。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { FrontendPluginHost, describeActivationError } from '../plugin-host';
import { usePluginHostStore } from '../plugin-host-store';
import { PluginState } from '../types';
import type {
  IFrontendAPI,
  ISocketService,
  IUIService,
  IStorageService,
  FrontendPluginManifest,
  FrontendPluginContext,
} from '../types';
import { ExtensionPointRenderer } from '../extension-point-renderer';
import { PluginHostProvider } from '../plugin-host-context';

// ── helpers ────────────────────────────────────────────────────────────────

function createMockServices() {
  return {
    frontendApi: { get: vi.fn(), post: vi.fn(), del: vi.fn() } as unknown as IFrontendAPI,
    socketService: { emit: vi.fn(), on: vi.fn(), off: vi.fn(), disconnect: vi.fn() } as unknown as ISocketService,
    uiService: { showToast: vi.fn(), showModal: vi.fn(), closeModal: vi.fn() } as unknown as IUIService,
    storageService: { get: vi.fn(), set: vi.fn(), delete: vi.fn(), clear: vi.fn() } as unknown as IStorageService,
  };
}

const mockServices = createMockServices();

const MANIFEST = {
  id: 'test-plugin',
  name: 'Test Plugin',
  version: '1.0.0',
  contributes: {
    'teacher.tab': [{ id: 'tab-1', label: '我的 Tab' }],
    'command_palette.item': [{ id: 'cmd-1', title: '计算器', commandType: 'calc.run' }],
  },
} as unknown as FrontendPluginManifest;

async function createHost(): Promise<FrontendPluginHost> {
  const host = new FrontendPluginHost();
  await host.initialize(
    mockServices.frontendApi,
    mockServices.socketService,
    mockServices.uiService,
    mockServices.storageService,
  );
  return host;
}

/** 安装一个 activate 抛错的内联插件（模拟前端 bundle 起不来）。 */
async function installFailingPlugin(host: FrontendPluginHost, manifest: FrontendPluginManifest = MANIFEST) {
  await host.installPlugin(manifest, JSON.stringify(manifest));
  const failing = {
    manifest,
    activate: vi.fn().mockRejectedValue(new Error('boom: frontend bundle crashed')),
  };
  (host as unknown as { moduleLoader: unknown }).moduleLoader = async () => ({ default: failing });
  return failing;
}

beforeEach(() => {
  usePluginHostStore.setState({
    activePlugins: [],
    extensionPoints: new Map(),
    pluginErrors: new Map(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ── 契约 1：扩展点按来源分流 ────────────────────────────────────────────────

describe('扩展点来源分流（origin）', () => {
  it('manifest 声明式贡献标记为 origin=manifest', async () => {
    const host = await createHost();
    const plugin = {
      manifest: MANIFEST,
      activate: vi.fn().mockResolvedValue(undefined),
    };
    (host as unknown as { moduleLoader: unknown }).moduleLoader = async () => ({ default: plugin });
    await host.installPlugin(MANIFEST, JSON.stringify(MANIFEST));
    await host.activatePlugin('test-plugin');

    const tabs = usePluginHostStore.getState().getExtensions('teacher.tab');
    expect(tabs).toHaveLength(1);
    expect(tabs[0].origin).toBe('manifest');

    const cmds = usePluginHostStore.getState().getExtensions('command_palette.item');
    expect(cmds[0].origin).toBe('manifest');
  });

  it('legacy manifest.classroomTools 同样标记为 origin=manifest', async () => {
    const host = await createHost();
    const manifest = {
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      classroomTools: [{ id: 'legacy-tool', name: 'Legacy Tool' }],
    } as unknown as FrontendPluginManifest;
    const plugin = { manifest, activate: vi.fn().mockResolvedValue(undefined) };
    (host as unknown as { moduleLoader: unknown }).moduleLoader = async () => ({ default: plugin });
    await host.installPlugin(manifest, JSON.stringify(manifest));
    await host.activatePlugin('test-plugin');

    const tools = usePluginHostStore.getState().getExtensions('classroom.tool');
    expect(tools).toHaveLength(1);
    expect(tools[0].origin).toBe('manifest');
  });

  it('插件运行时通过 ctx.ui.registerExtensionPoint 注册的标记为 origin=runtime', async () => {
    const host = await createHost();
    const plugin = {
      manifest: MANIFEST,
      activate: vi.fn().mockImplementation(async (ctx: FrontendPluginContext) => {
        ctx.ui.registerExtensionPoint('teacher.panel', {
          id: 'runtime-panel',
          label: '运行时面板',
          pluginId: 'test-plugin',
          component: () => null,
        });
      }),
    };
    (host as unknown as { moduleLoader: unknown }).moduleLoader = async () => ({ default: plugin });
    await host.installPlugin(MANIFEST, JSON.stringify(MANIFEST));
    await host.activatePlugin('test-plugin');

    const runtime = usePluginHostStore.getState().getExtensions('teacher.panel');
    expect(runtime).toHaveLength(1);
    expect(runtime[0].origin).toBe('runtime');
  });
});

// ── 契约 1b：两类清理路径互不越权 ───────────────────────────────────────────

describe('unregisterPluginRuntimeExtensionPoints 只摘运行时扩展点', () => {
  beforeEach(() => {
    usePluginHostStore.getState().registerExtensionPoint('teacher.tab', {
      id: 'tab-1',
      label: '声明式 Tab',
      pluginId: 'p1',
      origin: 'manifest',
      component: () => null,
    });
    usePluginHostStore.getState().registerExtensionPoint('teacher.panel', {
      id: 'runtime-panel',
      label: '运行时面板',
      pluginId: 'p1',
      origin: 'runtime',
      component: () => null,
    });
  });

  it('保留 manifest 贡献、摘除 runtime 贡献', () => {
    usePluginHostStore.getState().unregisterPluginRuntimeExtensionPoints('p1');

    expect(usePluginHostStore.getState().getExtensions('teacher.tab')).toHaveLength(1);
    expect(usePluginHostStore.getState().getExtensions('teacher.panel')).toHaveLength(0);
  });

  it('origin 缺省的历史注册按 runtime 处理（会被摘除）', () => {
    usePluginHostStore.getState().registerExtensionPoint('legacy.slot', {
      id: 'legacy',
      label: '历史注册',
      pluginId: 'p1',
      component: () => null,
    });

    usePluginHostStore.getState().unregisterPluginRuntimeExtensionPoints('p1');

    expect(usePluginHostStore.getState().getExtensions('legacy.slot')).toHaveLength(0);
    expect(usePluginHostStore.getState().getExtensions('teacher.tab')).toHaveLength(1);
  });

  it('unregisterPluginExtensionPoints 仍然整包摘除（卸载/停用语义不变）', () => {
    usePluginHostStore.getState().unregisterPluginExtensionPoints('p1');

    expect(usePluginHostStore.getState().getExtensions('teacher.tab')).toHaveLength(0);
    expect(usePluginHostStore.getState().getExtensions('teacher.panel')).toHaveLength(0);
  });
});

// ── 契约 2：激活失败保留声明式贡献 + 记录显式错误 ───────────────────────────

describe('激活失败保留 manifest 声明式贡献', () => {
  it('inline 插件 activate 抛错 → Tab 仍在，且记录显式错误', async () => {
    const host = await createHost();
    await installFailingPlugin(host);

    await expect(host.activatePlugin('test-plugin')).rejects.toThrow(/boom/);

    const tabs = usePluginHostStore.getState().getExtensions('teacher.tab');
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).toBe('tab-1');

    const pluginInfo = usePluginHostStore.getState().activePlugins.find((p) => p.id === 'test-plugin');
    expect(pluginInfo?.state).toBe(PluginState.ERROR);

    const err = usePluginHostStore.getState().pluginErrors.get('test-plugin');
    expect(err).toBeTruthy();
    expect(err).toContain('boom');
  });

  it('激活失败不清除其它插件的贡献', async () => {
    const host = await createHost();
    usePluginHostStore.getState().registerExtensionPoint('teacher.tab', {
      id: 'other-tab',
      label: '别的插件的 Tab',
      pluginId: 'other-plugin',
      origin: 'manifest',
      component: () => null,
    });

    await installFailingPlugin(host);
    await expect(host.activatePlugin('test-plugin')).rejects.toThrow(/boom/);

    expect(usePluginHostStore.getState().getExtensions('teacher.tab')).toHaveLength(2);
  });

  it('重新激活成功后清除错误态', async () => {
    const host = await createHost();
    await installFailingPlugin(host);
    await expect(host.activatePlugin('test-plugin')).rejects.toThrow(/boom/);
    expect(usePluginHostStore.getState().pluginErrors.has('test-plugin')).toBe(true);

    // 换成正常插件再激活
    const ok = { manifest: MANIFEST, activate: vi.fn().mockResolvedValue(undefined) };
    (host as unknown as { moduleLoader: unknown }).moduleLoader = async () => ({ default: ok });
    await host.activatePlugin('test-plugin');

    expect(usePluginHostStore.getState().pluginErrors.has('test-plugin')).toBe(false);
  });
});

// ── 契约 2b：熔断降级（suspendPlugin）不越权 ────────────────────────────────

describe('suspendPlugin（熔断降级）保留声明式贡献', () => {
  it('停掉运行时代码但保留 manifest 贡献，状态置 ERROR', async () => {
    const host = await createHost();
    const plugin = {
      manifest: MANIFEST,
      activate: vi.fn().mockImplementation(async (ctx: FrontendPluginContext) => {
        ctx.ui.registerExtensionPoint('teacher.panel', {
          id: 'runtime-panel',
          label: '运行时面板',
          pluginId: 'test-plugin',
          component: () => null,
        });
      }),
      deactivate: vi.fn().mockResolvedValue(undefined),
    };
    (host as unknown as { moduleLoader: unknown }).moduleLoader = async () => ({ default: plugin });
    await host.installPlugin(MANIFEST, JSON.stringify(MANIFEST));
    await host.activatePlugin('test-plugin');

    expect(usePluginHostStore.getState().getExtensions('teacher.panel')).toHaveLength(1);

    await host.suspendPlugin('test-plugin');

    // 声明式贡献保留 —— Tab 不再「闪现后消失」
    expect(usePluginHostStore.getState().getExtensions('teacher.tab')).toHaveLength(1);
    // 运行时贡献被摘除 —— 崩溃的前端不该继续渲染
    expect(usePluginHostStore.getState().getExtensions('teacher.panel')).toHaveLength(0);

    const pluginInfo = usePluginHostStore.getState().activePlugins.find((p) => p.id === 'test-plugin');
    expect(pluginInfo?.state).toBe(PluginState.ERROR);
    expect(usePluginHostStore.getState().pluginErrors.get('test-plugin')).toBeTruthy();
  });

  it('用户主动停用仍整包摘除（deactivate 语义不变）', async () => {
    const host = await createHost();
    const plugin = {
      manifest: MANIFEST,
      activate: vi.fn().mockResolvedValue(undefined),
      deactivate: vi.fn().mockResolvedValue(undefined),
    };
    (host as unknown as { moduleLoader: unknown }).moduleLoader = async () => ({ default: plugin });
    await host.installPlugin(MANIFEST, JSON.stringify(MANIFEST));
    await host.activatePlugin('test-plugin');

    await host.deactivatePlugin('test-plugin');

    expect(usePluginHostStore.getState().getExtensions('teacher.tab')).toHaveLength(0);
  });
});

// ── 契约 3：渲染层显式错误态 ───────────────────────────────────────────────

describe('渲染层显式错误态', () => {
  it('插件出错时渲染错误面板与重试按钮，而不是留白', () => {
    const host = new FrontendPluginHost();
    usePluginHostStore.setState({
      pluginErrors: new Map([['p1', '前端资源加载失败（HTTP 错误）']]),
    });
    usePluginHostStore.getState().registerExtensionPoint('teacher.tab', {
      id: 'tab-1',
      label: '我的 Tab',
      pluginId: 'p1',
      origin: 'manifest',
      component: () => null,
    });

    render(
      <PluginHostProvider host={host}>
        <ExtensionPointRenderer slot="teacher.tab" slotProps={{ renderType: 'panel' }} />
      </PluginHostProvider>,
    );

    expect(screen.getByText('插件加载失败')).toBeTruthy();
    expect(screen.getByText('前端资源加载失败（HTTP 错误）')).toBeTruthy();
    expect(screen.getByTestId('plugin-retry-btn-p1')).toBeTruthy();
  });

  it('正常插件不受影响', () => {
    const host = new FrontendPluginHost();
    usePluginHostStore.getState().registerExtensionPoint('teacher.tab', {
      id: 'tab-1',
      label: '我的 Tab',
      pluginId: 'p1',
      origin: 'manifest',
      component: () => React.createElement('div', null, '插件面板内容'),
    });

    render(
      <PluginHostProvider host={host}>
        <ExtensionPointRenderer slot="teacher.tab" slotProps={{ renderType: 'panel' }} />
      </PluginHostProvider>,
    );

    expect(screen.getByText('插件面板内容')).toBeTruthy();
    expect(screen.queryByText('插件加载失败')).toBeNull();
  });
});

// ── 错误描述归一化 ──────────────────────────────────────────────────────────

describe('describeActivationError 归一化', () => {
  it('前端资源 HTTP 错误 → 用户可读短句', () => {
    expect(describeActivationError(new Error('Failed to fetch frontend.js for plugin "x": HTTP 404'))).toBe(
      '前端资源加载失败（HTTP 错误）',
    );
  });

  it('共享依赖缺失 → 点出真实原因', () => {
    expect(describeActivationError(new Error("Cannot read properties of undefined (reading 'React')"))).toContain(
      '宿主未提供共享运行时',
    );
  });

  it('激活超时 → 明确文案', () => {
    expect(describeActivationError(new Error('Activation timeout (5000ms)'))).toBe('插件激活超时（5 秒）');
  });

  it('超长错误信息截断', () => {
    const long = 'x'.repeat(400);
    expect(describeActivationError(new Error(long)).length).toBeLessThanOrEqual(161);
  });

  it('非 Error 值兜底', () => {
    expect(describeActivationError('boom')).toBe('未知错误');
  });
});
