/**
 * activateRemotePlugin — inline 执行模式分支回归测试。
 *
 * 钉住两条行为：
 *
 * 1. **安全**：`manifest.executionMode` 不构成信任依据。第三方插件即使在自己的
 *    manifest.json 里写 `"executionMode": "inline"`，只要服务端求值后的 store 模式
 *    是 `process`，就必须进 iframe 沙箱 —— 否则任何插件都能靠一行 manifest 把
 *    frontend.js 放进父页面同源执行，绕过 `sandbox="allow-scripts"`、无
 *    `allow-same-origin` 的不透明源与 CSP frame 规则。
 *    （回归：此前的判断是 `manifest.executionMode === 'inline' || store === 'inline'`。）
 *
 * 2. **可用**：store 模式为 `inline` 时走父页面 Blob import 分支，插件 `activate`
 *    被调用、状态落到 ACTIVE，且**不**创建沙箱 iframe。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FrontendPluginHost } from '../plugin-host';
import { usePluginHostStore } from '../plugin-host-store';
import { PluginState } from '../types';
import { PLUGIN_FRAME_CHANNEL, PLUGIN_FRAME_PATH } from '../sandbox-frame';
import type { IFrontendAPI, ISocketService, IStorageService, IUIService } from '../types';

function createMockServices() {
  return {
    frontendApi: { get: vi.fn(), post: vi.fn(), del: vi.fn() } as unknown as IFrontendAPI,
    socketService: { emit: vi.fn(), on: vi.fn(), off: vi.fn(), disconnect: vi.fn() } as unknown as ISocketService,
    uiService: { showToast: vi.fn(), showModal: vi.fn(), closeModal: vi.fn() } as unknown as IUIService,
    storageService: { get: vi.fn(), set: vi.fn(), delete: vi.fn(), clear: vi.fn() } as unknown as IStorageService,
  };
}

const REMOTE_ID = '019f6029-884d-71dd-a4f1-31f815fa9698';

/** 假 frontend.js：内含 hooks 用法无关紧要，这里只需要能被 import 的 ES 模块。 */
const MODULE_SOURCE = `
export async function activate(ctx) { globalThis.__inlineActivated = ctx.pluginId; }
export async function deactivate() { globalThis.__inlineDeactivated = true; }
`;

function toDataUrl(source: string): string {
  return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
}

async function setupHost() {
  const services = createMockServices();
  const host = new FrontendPluginHost({ moduleLoader: async () => ({ default: {} as never }) });
  await host.initialize(services.frontendApi, services.socketService, services.uiService, services.storageService);
  return host;
}

/** 让 store 里存在一条指定执行模式的插件记录（activateRemotePlugin 依赖它判定沙箱档位）。 */
function seedStore(executionMode: 'inline' | 'worker' | 'process') {
  usePluginHostStore.getState().addPlugin({
    id: REMOTE_ID,
    name: 'Remote Plugin',
    version: '1.0.0',
    state: PluginState.INSTALLED,
    executionMode,
  });
}

beforeEach(() => {
  usePluginHostStore.setState({ activePlugins: [], extensionPoints: new Map(), pluginErrors: new Map() });
  delete (globalThis as any).__inlineActivated;
  delete (globalThis as any).__inlineDeactivated;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('activateRemotePlugin — inline / 沙箱判定', () => {
  it('manifest 自述 inline 但服务端求值为 process 时，必须进 iframe 沙箱（不信任 manifest）', async () => {
    seedStore('process');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => MODULE_SOURCE }));
    const createObjectURL = vi.fn(() => toDataUrl(MODULE_SOURCE));
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));

    const host = await setupHost();
    const activation = host.activateRemotePlugin(REMOTE_ID, {
      id: REMOTE_ID,
      name: 'Remote Plugin',
      version: '1.0.0',
      // 插件自己的声明 —— 单独它不足以放行父页面执行
      executionMode: 'inline',
    });

    // 沙箱 iframe 挂上即为「走了沙箱路径」的证据
    await vi.waitFor(() => {
      expect(document.querySelector(`iframe[src="${PLUGIN_FRAME_PATH}"]`)).not.toBeNull();
    });

    // 完成握手，避免用例等满 5s 激活超时
    const frame = document.querySelector(`iframe[src="${PLUGIN_FRAME_PATH}"]`) as HTMLIFrameElement;
    const emit = (data: Record<string, unknown>) =>
      window.dispatchEvent(new MessageEvent('message', { data, source: frame.contentWindow }));
    emit({ channel: PLUGIN_FRAME_CHANNEL, type: 'ready' });
    emit({ channel: PLUGIN_FRAME_CHANNEL, type: 'activated', id: REMOTE_ID });
    await activation;

    // 关键断言：父页面从未把插件代码当模块 import
    expect(createObjectURL).not.toHaveBeenCalled();
    expect((globalThis as any).__inlineActivated).toBeUndefined();
    expect(usePluginHostStore.getState().activePlugins.find((p) => p.id === REMOTE_ID)?.state).toBe(PluginState.ACTIVE);
  });

  it('store 模式为 inline 时走父页面 Blob import，activate 被调用且不建沙箱 iframe', async () => {
    seedStore('inline');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => MODULE_SOURCE }));
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        // jsdom 未实现 createObjectURL；用 data: URL 让 Node 的原生 import 接管
        createObjectURL: vi.fn(() => toDataUrl(MODULE_SOURCE)),
        revokeObjectURL: vi.fn(),
      }),
    );

    const host = await setupHost();
    await host.activateRemotePlugin(REMOTE_ID, {
      id: REMOTE_ID,
      name: 'Remote Plugin',
      version: '1.0.0',
      executionMode: 'inline',
    });

    expect((globalThis as any).__inlineActivated).toBe(REMOTE_ID);
    expect(document.querySelector(`iframe[src="${PLUGIN_FRAME_PATH}"]`)).toBeNull();
    expect(usePluginHostStore.getState().activePlugins.find((p) => p.id === REMOTE_ID)?.state).toBe(PluginState.ACTIVE);

    // 反注册走插件自己的 deactivate（内联分支必须把模块入口记进 pluginModules）
    await host.deactivatePlugin(REMOTE_ID);
    expect((globalThis as any).__inlineDeactivated).toBe(true);
  });
});
