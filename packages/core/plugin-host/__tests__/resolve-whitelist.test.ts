/**
 * 审计修复 E-2 回归：`ctx.resolve(<string>)` 仅接受 SDK 已承诺的 Token 名。
 *
 * 修复前字符串路径直达 `ServiceRegistry.resolveByName(name)`（纯 Map.get、
 * 零门禁）—— 插件知道任意内部 token 名即可在 inline 模式拿到 20+ 个内核
 * 服务实例（worker 模式有 computeAllowedWorkerTokens 兜底，inline 没有）。
 *
 * Token 对象路径不受影响：插件必须 import SDK 导出的常量才拿得到对象。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PluginState } from '../types.js';
import { ICapabilityGovernanceServiceToken } from '../../di/interfaces.js';
import { createDb, makeHost, makeTmpDir, removeTmpDir, insertPluginRow } from './helpers/audit-host.js';

describe('E-2 · ctx.resolve(string) Token 白名单', () => {
  let db: ReturnType<typeof createDb>;
  let pluginsDir: string;
  let host: Awaited<ReturnType<typeof makeHost>>;

  beforeEach(() => {
    db = createDb();
    pluginsDir = makeTmpDir('audit-e2-');
  });

  afterEach(() => {
    removeTmpDir(pluginsDir);
    db.close();
  });

  it('非白名单 token 名（即使已注册）被拒绝；白名单名可解析', async () => {
    const pluginId = '33333333-3333-7333-8333-333333333333';
    const manifest = { id: 'ext-audit-resolve', name: 'Resolve', version: '1.0.0', main: 'index.js' };
    insertPluginRow(db, { id: pluginId, manifest });

    let governanceError: Error | null = null;
    let resolvedAi: unknown = null;

    host = await makeHost(db, pluginsDir);
    // 先构造宿主，再补注册一个「已注册但不在 SDK 公开面」的内部服务
    const registry = (host as unknown as { serviceRegistry: { register: (t: unknown, i: unknown) => Promise<void> } })
      .serviceRegistry;
    await registry.register(ICapabilityGovernanceServiceToken, { internal: true });

    host.registerPreloadedPlugin(pluginId, {
      manifest,
      activate: async (ctx: any) => {
        try {
          await ctx.resolve('@openlearn/core:ICapabilityGovernanceService');
        } catch (e) {
          governanceError = e as Error;
        }
        resolvedAi = await ctx.resolve('@openlearn/core:IAIService');
      },
      deactivate: async () => {},
    });

    await host.activatePlugin(pluginId);
    expect(host.getPluginState(pluginId)).toBe(PluginState.ACTIVE);

    expect(governanceError).not.toBeNull();
    expect(governanceError!.message).toMatch(/cannot resolve "@openlearn\/core:ICapabilityGovernanceService"/);
    // 白名单内（SDK 导出）的名字照常解析
    expect(resolvedAi).toMatchObject({ generateText: expect.any(Function) });
  });
});
