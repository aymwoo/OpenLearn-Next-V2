// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FrontendPluginHost } from '../plugin-host';
import { usePluginHostStore } from '../plugin-host-store';
import { ServiceHost } from '../service-host';
import { FrontendServiceRegistry } from '../service-registry';
import { resolveDeclaredCapabilities } from '../capabilities';
import { computeAllowedWorkerTokens } from '../allowed-tokens';
import { PluginState, STORAGE_SERVICE_TOKEN } from '../types';
import type { FrontendPluginInfo, FrontendPluginManifest } from '../types';
import type { IWorkerTransport } from '../../../packages/core/worker-runtime/types';

/**
 * 本文件覆盖 worker 模式能力数据链的端到端行为：
 *
 *   GET /api/plugins 响应 → useAppComposer → plugin-host store
 *     → activateWorkerPlugin 合成的 manifest
 *       → ServiceHost Security Barrier 2（非空 capability 才放行非 get* 方法）
 *
 * 修复前：activateWorkerPlugin 只填 id/name/version，manifestCapabilities 恒为空，
 * 所有 worker 插件都被降级为只读。
 */

// ── Test doubles ─────────────────────────────────────────────────────────

function createMockTransport(): IWorkerTransport {
  return {
    id: 'test-transport',
    postMessage: vi.fn(),
    onMessage: vi.fn(),
    terminate: vi.fn().mockResolvedValue(undefined),
  };
}

/** BrowserWorkerManager 的最小替身：只捕获传入的 manifest。 */
function createManagerStub(captured: FrontendPluginManifest[]) {
  return {
    createWorker: vi.fn(async (_pluginId: string, manifest: FrontendPluginManifest) => {
      captured.push(manifest);
      return {
        transport: createMockTransport(),
        serviceHost: new ServiceHost(new FrontendServiceRegistry(), 'plugin:stub', [], undefined, []),
      };
    }),
    terminateWorker: vi.fn(),
  } as unknown as Parameters<FrontendPluginHost['setWorkerManager']>[0];
}

const MANIFEST_WITH_CAPS: FrontendPluginManifest = {
  id: 'capable-plugin',
  name: 'Capable Plugin',
  version: '1.0.0',
  capabilitiesProposed: ['storage:write'],
};

const MANIFEST_WITHOUT_CAPS: FrontendPluginManifest = {
  id: 'silent-plugin',
  name: 'Silent Plugin',
  version: '1.0.0',
};

const OFF_LIST_TOKEN = '@openlearn/core:IPointsLedgerService';

function createStorageService() {
  return { get: vi.fn(), set: vi.fn(), delete: vi.fn(), clear: vi.fn() };
}

describe('worker 模式 capabilities 数据链', () => {
  beforeEach(() => {
    usePluginHostStore.setState({
      activePlugins: [],
      extensionPoints: new Map(),
      services: null,
      initialized: false,
    });
  });

  // ── 1. 合成 manifest 时必须带上真实 capabilitiesProposed ──────────────

  describe('activateWorkerPlugin 合成的 manifest', () => {
    /**
     * 走完整的 worker 激活路径：installPlugin 写入 sourceCodes，
     * 再把 store 条目切成 worker 模式（生产中由 useAppComposer 的列表同步完成）。
     */
    async function activateAsWorker(
      manifest: FrontendPluginManifest,
      infoOverrides?: Partial<FrontendPluginInfo>,
    ): Promise<FrontendPluginManifest> {
      const captured: FrontendPluginManifest[] = [];
      const host = new FrontendPluginHost();
      host.setWorkerManager(createManagerStub(captured));

      await host.installPlugin(manifest, 'export default {}');

      const base: FrontendPluginInfo = {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        state: PluginState.INSTALLED,
        executionMode: 'worker',
      };
      usePluginHostStore.setState({ activePlugins: [{ ...base, ...infoOverrides }] });

      await host.activatePlugin(manifest.id);

      expect(captured).toHaveLength(1);
      return captured[0];
    }

    it('store 中声明了 capability 时，传入 worker 的 manifest 携带该声明', async () => {
      const passed = await activateAsWorker(MANIFEST_WITH_CAPS, { capabilitiesProposed: ['storage:write'] });

      expect(passed).toEqual({
        id: MANIFEST_WITH_CAPS.id,
        name: MANIFEST_WITH_CAPS.name,
        version: MANIFEST_WITH_CAPS.version,
        capabilitiesProposed: ['storage:write'],
      });
    });

    it('store 中没有 capabilitiesProposed 字段时安全回退为空数组', async () => {
      const passed = await activateAsWorker(MANIFEST_WITHOUT_CAPS);

      expect(passed.capabilitiesProposed).toEqual([]);
    });

    it('capabilitiesProposed 为非数组时安全回退为空数组', async () => {
      const passed = await activateAsWorker(MANIFEST_WITH_CAPS, {
        capabilitiesProposed: 'storage:write' as unknown as string[],
      });

      expect(passed.capabilitiesProposed).toEqual([]);
    });

    it('installPlugin 把 manifest 的能力声明一并写入 store', async () => {
      const host = new FrontendPluginHost();
      await host.installPlugin(MANIFEST_WITH_CAPS, 'export default {}');

      const stored = usePluginHostStore.getState().activePlugins.find((p) => p.id === MANIFEST_WITH_CAPS.id);
      expect(stored?.capabilitiesProposed).toEqual(['storage:write']);
    });
  });

  // ── 2. Barrier 2 正向：声明了 capability → 放行非 get* 方法 ──────────

  describe('Security Barrier 2 —— 正向（声明了 capability）', () => {
    it('manifest 携带的 capability 允许调用非 get* 方法（修复前会被拒绝）', async () => {
      const registry = new FrontendServiceRegistry();
      const storageService = createStorageService();
      await registry.register(STORAGE_SERVICE_TOKEN, storageService);

      const caps = resolveDeclaredCapabilities({
        capabilitiesProposed: (MANIFEST_WITH_CAPS as { capabilitiesProposed: string[] }).capabilitiesProposed,
        manifest: JSON.stringify(MANIFEST_WITH_CAPS),
      });
      expect(caps).toEqual(['storage:write']);

      // 与 BrowserWorkerManager.createWorker 相同的注入方式
      const allowedTokens = computeAllowedWorkerTokens({ capabilitiesProposed: caps }, [STORAGE_SERVICE_TOKEN]);
      const host = new ServiceHost(registry, 'plugin:capable-plugin', caps, undefined, allowedTokens);
      const transport = createMockTransport();

      await host.handleInvoke(
        { type: 'invoke', invokeId: 'i1', token: STORAGE_SERVICE_TOKEN, method: 'set', args: ['k', 'v'] },
        transport,
      );

      expect(transport.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'result', invokeId: 'i1' }),
      );
      expect(storageService.set).toHaveBeenCalledWith('k', 'v');
    });
  });

  // ── 3. Barrier 2 反向：未声明 capability → 仍然拒绝 ──────────────────

  describe('Security Barrier 2 —— 反向（未声明 capability，必须保持）', () => {
    it('manifest 未声明 capability 时，非 get* 方法仍被拒绝', async () => {
      const registry = new FrontendServiceRegistry();
      const storageService = createStorageService();
      await registry.register(STORAGE_SERVICE_TOKEN, storageService);

      const caps = resolveDeclaredCapabilities({ manifest: JSON.stringify(MANIFEST_WITHOUT_CAPS) });
      expect(caps).toEqual([]);

      const host = new ServiceHost(registry, 'plugin:silent-plugin', caps);
      const transport = createMockTransport();

      await host.handleInvoke(
        { type: 'invoke', invokeId: 'i2', token: STORAGE_SERVICE_TOKEN, method: 'set', args: ['k', 'v'] },
        transport,
      );

      expect(transport.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          invokeId: 'i2',
          message: expect.stringContaining('Capability denied'),
        }),
      );
      expect(storageService.set).not.toHaveBeenCalled();
    });

    it('manifest 未声明 capability 时，get* 只读方法仍放行', async () => {
      const registry = new FrontendServiceRegistry();
      const storageService = createStorageService();
      storageService.get.mockReturnValue('v');
      await registry.register(STORAGE_SERVICE_TOKEN, storageService);

      const host = new ServiceHost(registry, 'plugin:silent-plugin', []);
      const transport = createMockTransport();

      await host.handleInvoke(
        { type: 'invoke', invokeId: 'i3', token: STORAGE_SERVICE_TOKEN, method: 'get', args: ['k'] },
        transport,
      );

      expect(transport.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'result', invokeId: 'i3', value: 'v' }),
      );
    });

    it('Barrier 1 仍然先行：未进白名单的 Token 即使 capability 为 * 也被拒绝', async () => {
      const registry = new FrontendServiceRegistry();
      const offListService = { doDangerousThing: vi.fn() };
      await registry.register(OFF_LIST_TOKEN, offListService);

      // 白名单只含存储服务 —— 后端领域服务 Token 不在其中
      const host = new ServiceHost(registry, 'plugin:capable-plugin', ['*'], undefined, [STORAGE_SERVICE_TOKEN]);
      const transport = createMockTransport();

      await host.handleInvoke(
        { type: 'invoke', invokeId: 'i4', token: OFF_LIST_TOKEN, method: 'doDangerousThing', args: [] },
        transport,
      );

      const msg = (transport.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(msg.type).toBe('error');
      expect(msg.message).toContain('not in worker allowedTokens');
      expect(offListService.doDangerousThing).not.toHaveBeenCalled();
    });
  });

  // ── 4. 列表字段缺失 / 异常时的安全回退 ───────────────────────────────

  describe('resolveDeclaredCapabilities 安全回退', () => {
    it('服务端扁平字段存在时优先采用', () => {
      expect(
        resolveDeclaredCapabilities({
          capabilitiesProposed: ['a:read'],
          manifest: JSON.stringify({ capabilitiesProposed: ['b:read'] }),
        }),
      ).toEqual(['a:read']);
    });

    it('扁平字段缺失时回退解析 manifest 原文（旧服务端响应）', () => {
      expect(
        resolveDeclaredCapabilities({ manifest: JSON.stringify({ id: 'x', capabilitiesProposed: ['c:write'] }) }),
      ).toEqual(['c:write']);
    });

    it('记录缺失 / 字段缺失 / manifest 非法 JSON / 非字符串元素 → 一律 []', () => {
      expect(resolveDeclaredCapabilities(null)).toEqual([]);
      expect(resolveDeclaredCapabilities(undefined)).toEqual([]);
      expect(resolveDeclaredCapabilities({})).toEqual([]);
      expect(resolveDeclaredCapabilities({ manifest: '{ not json' })).toEqual([]);
      expect(resolveDeclaredCapabilities({ manifest: JSON.stringify({ id: 'x' }) })).toEqual([]);
      expect(resolveDeclaredCapabilities({ capabilitiesProposed: 'not-an-array' })).toEqual([]);
      expect(resolveDeclaredCapabilities({ capabilitiesProposed: [1, null, 'ok', ''] })).toEqual(['ok']);
    });

    it('扁平字段为空数组时仍回退到 manifest 原文（避免服务端漏填导致误降级）', () => {
      expect(
        resolveDeclaredCapabilities({
          capabilitiesProposed: [],
          manifest: JSON.stringify({ capabilitiesProposed: ['d:read'] }),
        }),
      ).toEqual(['d:read']);
    });
  });
});
