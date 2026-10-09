/**
 * 审计修复 F-4 回归：inline 插件**正常停用**也必须注销声明式贡献点。
 *
 * 修复前只有 worker 停用路径、uninstall、pipeline 崩溃兜底三处会调
 * `revokePluginContributions()` —— inline 正常停用这条路漏了，
 * contributionRegistry 长期滞留已停用插件的条目，
 * `listContributions()` 的 allSummaries / stats() 继续把它们算进去。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PluginState } from '../types.js';
import { createDb, makeHost, makeTmpDir, removeTmpDir, insertPluginRow } from './helpers/audit-host.js';

describe('F-4 · inline 停用注销声明式贡献点', () => {
  let db: ReturnType<typeof createDb>;
  let pluginsDir: string;
  let host: Awaited<ReturnType<typeof makeHost>>;

  beforeEach(() => {
    db = createDb();
    pluginsDir = makeTmpDir('audit-f4-');
  });

  afterEach(() => {
    removeTmpDir(pluginsDir);
    db.close();
  });

  it('deactivate 后 listContributions 与 registry 均不再包含该插件', async () => {
    const pluginId = '11111111-1111-7111-8111-111111111111';
    const manifest = {
      id: 'ext-audit-contrib',
      name: 'Audit Contrib',
      version: '1.0.0',
      main: 'index.js',
      contributes: {
        'classroom.tool': [{ id: 'rollcall', name: 'Roll Call', commandType: 'rollcall.start' }],
      },
    };
    insertPluginRow(db, { id: pluginId, manifest });

    host = await makeHost(db, pluginsDir);
    // install 路径对贡献点的注册由三条 install 方法完成；此处直接模拟 install 时的注册
    host.registerPreloadedPlugin(pluginId, { manifest, activate: async () => {}, deactivate: async () => {} });
    host.contributions.register(manifest.id, manifest.contributes);

    // 前置条件：注册生效
    expect(host.listContributions(manifest.id)).toHaveLength(1);

    await host.activatePlugin(pluginId);
    expect(host.getPluginState(pluginId)).toBe(PluginState.ACTIVE);

    await host.deactivatePlugin(pluginId);
    expect(host.getPluginState(pluginId)).toBe(PluginState.INACTIVE);

    // 修复前：listContributions 返回 1 条、summary 非空（已停用插件的幽灵贡献）
    expect(host.listContributions(manifest.id)).toEqual([]);
    expect(host.contributions.summary(manifest.id)).toEqual([]);
  });
});

describe('P1 · api.baseRoute 安装告警（无路由作用字段）', () => {
  let db: ReturnType<typeof createDb>;
  let pluginsDir: string;
  let host: Awaited<ReturnType<typeof makeHost>>;

  beforeEach(async () => {
    db = createDb();
    pluginsDir = makeTmpDir('audit-baseroute-');
    host = await makeHost(db, pluginsDir);
  });

  afterEach(() => {
    removeTmpDir(pluginsDir);
    db.close();
    vi.restoreAllMocks();
  });

  it('声明了 baseRoute 的 manifest 触发一次告警', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (host as unknown as { warnIfBaseRouteDeclared: (m: unknown) => void }).warnIfBaseRouteDeclared({
      api: { baseRoute: '/api/plugins/exam-bank' },
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/baseRoute[\s\S]*无路由作用/);
  });

  it('未声明（或空串）时不告警', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = host as unknown as { warnIfBaseRouteDeclared: (m: unknown) => void };
    h.warnIfBaseRouteDeclared({});
    h.warnIfBaseRouteDeclared({ api: {} });
    h.warnIfBaseRouteDeclared({ api: { baseRoute: '' } });
    expect(warn).not.toHaveBeenCalled();
  });
});
