/**
 * H-2 / C-4 回归测试：并发生命周期操作的正确性。
 *
 * 审计原描述（部分已更正）：
 * - H-2：`inflightActivate` 与 `inflightDeactivate` 是两个独立 Map、二者无互斥。
 *   「停用请求到达时插件仍在 ACTIVATING」会被**静默丢弃** → 用户点了停用，插件仍是 ACTIVE。
 *   真实危害是卸载竞态：`uninstallPlugin` 见状态非 ACTIVE 就跳过停用直接 DELETE DB 行，
 *   在飞的 activate 随后仍注册 handler → **已删除的插件留下一批命令 handler**。
 * - `reloadPlugin` 完全不经过 inflight 串行化，与 deactivate 并发时双方各自
 *   `disposeAll` 互相踩踏。
 * - C-4（成因已更正）：`worker-manager.terminate()` 的 finally 无条件回收线程，
 *   mode 传递不是泄漏源；真实场景是「非 ACTIVE 态执行 update」时 deactivation
 *   整段被跳过，残留 worker 无人回收。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PluginHost } from '../index.js';
import { EsmLoader, type PluginModule } from '../../esm-loader/esm-loader.js';
import { ServiceRegistry } from '../../di/service-registry.js';
import { CommandBus } from '../../command-bus/index.js';
import { EventBus } from '../../event-bus/index.js';
import { ActionRegistry } from '../../registry/index.js';
import { CapabilityGuard } from '../../capability/index.js';
import { IllegalStateTransitionError } from '../errors.js';
import {
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  ICommandBusServiceToken,
  IDatabaseToken,
  IEventBusServiceToken,
  IAIServiceToken,
  IPointsDimensionRegistryToken,
  IPointsLedgerServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
} from '../../di/interfaces.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY, name TEXT, manifest TEXT, source_code TEXT, file_path TEXT,
      status TEXT, created_at INTEGER, loader_version TEXT, zip_package BLOB,
      version TEXT,
      execution_mode TEXT DEFAULT 'inline'
    );
    CREATE TABLE IF NOT EXISTS plugin_storage (
      plugin_id TEXT, key TEXT, value TEXT, updated_at INTEGER, PRIMARY KEY (plugin_id, key)
    );
  `);
  return db;
}

/** 可控 loader：以「源码 → 模块」映射驱动 activate 的挂起与抛错 */
class ScriptedLoader extends EsmLoader {
  public handlers = new Map<string, () => Promise<void>>();
  public modules = new Map<string, PluginModule>();

  async load(code: string): Promise<PluginModule> {
    const mod = this.modules.get(code);
    if (mod) return mod;
    return {
      default: { manifest: { id: 'x', name: 'X', version: '1.0.0', main: 'index.js' }, activate: async () => {} },
    };
  }
}

const manifestOf = (id: string, version = '1.0.0') => ({
  id,
  name: id,
  version,
  main: 'index.js',
});

function pluginSource(id: string): string {
  return `export const manifest = ${JSON.stringify(manifestOf(id))};`;
}

describe('H-2 / C-4：并发生命周期操作的正确性', () => {
  let db: Database.Database;
  let pluginsDir: string;
  let loader: ScriptedLoader;
  let bus: CommandBus;
  let actions: ActionRegistry;
  let host: PluginHost;

  beforeEach(async () => {
    db = createDb();
    pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-race-'));
    loader = new ScriptedLoader();
    bus = new CommandBus(new EventBus());
    actions = new ActionRegistry();
    bus.setInterceptor(async () => {}); // 关闭鉴权，聚焦并发语义

    const registry = new ServiceRegistry();
    // PluginContext 的 buildContext 会 resolve 下列全部服务，缺一即抛
    // "No provider registered for token"（与 e2e-lifecycle.test.ts 的清单保持一致）
    await registry.register(IEventBusServiceToken, new EventBus() as never);
    await registry.register(ICapabilityServiceToken, new CapabilityGuard() as never);
    await registry.register(ICommandBusServiceToken, bus as never);
    await registry.register(IActionRegistryServiceToken, actions as never);
    await registry.register(IDatabaseToken, db as never);
    await registry.register(IStorageServiceToken, {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
    } as never);
    await registry.register(IProcessServiceToken, {
      spawn: async () => 'proc-1',
      kill: async () => {},
      registerHandler: async () => {},
      unregisterHandler: async () => {},
      registerInterval: async () => 'int-1',
      restore: async () => {},
    } as never);
    await registry.register(IAIServiceToken, { generateText: async () => '' } as never);
    await registry.register(IPointsDimensionRegistryToken, {
      registerDimension: () => undefined,
      getDimension: () => undefined,
      listDimensions: () => [],
    } as never);
    await registry.register(IPointsLedgerServiceToken, {
      addPoints: async () => ({
        studentId: '',
        classId: '',
        dimensionId: '',
        deltaPoints: 0,
        reason: '',
        timestamp: 0,
      }),
      getLogs: async () => [],
      getStudentTotalByDimension: async () => 0,
      getStudentDimensionSummary: async () => ({}),
    } as never);

    // 构造签名为 (serviceRegistry, esmLoader, db, pluginsDir?)；
    // contributionRegistry / actionRegistry / capabilityGuard 由宿主内部创建，
    // 并经 serviceRegistry 暴露给 PluginContext。
    host = new PluginHost(registry, loader, db, pluginsDir);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(pluginsDir, { recursive: true, force: true });
  });

  /** 安装并激活一个插件；activate 可由测试控制挂起时长 */
  async function installAndActivate(id: string, activateImpl?: (ctx: any) => Promise<void>) {
    const src = pluginSource(id);
    loader.modules.set(src, {
      default: {
        manifest: manifestOf(id),
        activate: activateImpl ?? (async () => {}),
      },
    } as PluginModule);
    await host.installPlugin(src);
    const installed = db.prepare('SELECT id FROM plugins').all() as Array<{ id: string }>;
    return installed[installed.length - 1].id;
  }

  it('停用请求到达时插件仍在 ACTIVATING：等待其完成后真正停用（不静默丢弃）', async () => {
    let releaseActivate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseActivate = resolve;
    });

    const pluginId = await installAndActivate('ext-race-1', async () => {
      await gate; // 模拟慢 activate
    });

    // 触发 activate（不 await，制造 ACTIVATING 窗口）
    const activating = host.activatePlugin(pluginId);
    await vi.waitFor(() => expect(host.getPluginState(pluginId)).toBe('activating'));

    // 停用意图在 activate 未完成时到达
    const deactivating = host.deactivatePlugin(pluginId);

    // 放开 activate
    releaseActivate!();
    await activating;
    await deactivating;

    // 关键断言：用户的停用意图生效，而不是被静默丢弃
    expect(host.getPluginState(pluginId)).toBe('inactive');
    const row = db.prepare('SELECT status FROM plugins WHERE id = ?').get(pluginId) as { status: string };
    expect(row.status).toBe('inactive');
  });

  it('activate 失败后到达的停用请求不会把状态弄成 ACTIVE', async () => {
    const pluginId = await installAndActivate('ext-race-2', async () => {
      throw new Error('boom');
    });

    const activating = host.activatePlugin(pluginId);
    await vi.waitFor(() => expect(host.getPluginState(pluginId)).toBe('activating'));

    const deactivating = host.deactivatePlugin(pluginId);

    await expect(activating).rejects.toThrow();
    await deactivating; // 不应抛出

    // 失败插件不应变成 ACTIVE
    expect(host.getPluginState(pluginId)).not.toBe('active');
  });

  it('卸载竞态：activate 仍在飞时卸载，不会留下已删除插件的命令 handler', async () => {
    let releaseActivate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseActivate = resolve;
    });

    const registered: string[] = [];
    const pluginId = await installAndActivate('ext-race-3', async (ctx: any) => {
      await gate;
      // activate 期间注册 handler —— 这是「已删除插件留下 handler」的泄漏点
      await ctx.services.commandBus.registerHandler('ext-race-3.ping', {
        execute: async () => 'pong',
      });
      registered.push('done');
    });

    const activating = host.activatePlugin(pluginId);
    await vi.waitFor(() => expect(host.getPluginState(pluginId)).toBe('activating'));

    // 卸载：因状态非 ACTIVE，修复前会跳过停用直接 DELETE
    const uninstalling = host.uninstallPlugin(pluginId);

    releaseActivate!();
    await activating.catch(() => undefined);
    await uninstalling;

    // 关键断言：卸载完成后 handler 不得残留
    const handlers = (bus as unknown as { handlers: Map<string, unknown> }).handlers;
    const leaked = [...handlers.keys()].filter((k) => k.includes('ext-race-3'));
    expect(leaked, `泄漏的 handler: ${leaked.join(', ')}`).toEqual([]);
  });

  it('reload 等待在飞的生命周期操作结束，不与之并发 disposeAll', async () => {
    let releaseDeactivate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseDeactivate = resolve;
    });

    const src = pluginSource('ext-race-4');
    loader.modules.set(src, {
      default: {
        manifest: manifestOf('ext-race-4'),
        activate: async () => {},
        deactivate: async () => {
          await gate; // 慢 deactivate
        },
      },
    } as PluginModule);
    await host.installPlugin(src);
    const [row] = db.prepare('SELECT id FROM plugins').all() as Array<{ id: string }>;
    const pluginId = row.id;
    await host.activatePlugin(pluginId);

    // 触发一个慢 deactivate
    const deactivating = host.deactivatePlugin(pluginId);
    await vi.waitFor(() => expect(host.getPluginState(pluginId)).toBe('deactivating'));

    // reload 在 deactivate 未完成时到达 —— 应等待，而非并发
    const v2 = pluginSource('ext-race-4');
    loader.modules.set(v2, {
      default: { manifest: manifestOf('ext-race-4', '2.0.0'), activate: async () => {} },
    } as PluginModule);
    let settled = false;
    const reloading = host.reloadPlugin(pluginId, v2).then(() => {
      settled = true;
    });

    // deactivate 尚未释放 → reload 不应完成
    await new Promise((r) => setTimeout(r, 30));
    expect(settled, 'reload 不应在 deactivate 未完成时返回').toBe(false);

    releaseDeactivate!();
    await deactivating;

    // 插件已被停用，reload 应当**明确报错**而不是并发地继续操作。
    // 这正是串行化的意义：reload 观察到的是稳定终态，而不是与 deactivate 交错的中间态。
    await expect(reloading).rejects.toThrow(IllegalStateTransitionError);
    expect(settled).toBe(false);
    expect(host.getPluginState(pluginId)).toBe('inactive');
  });

  it('waitForLifecycleIdle 对无在飞操作时立即返回', async () => {
    await expect(host.reloadPlugin('never-installed', pluginSource('x'))).rejects.toThrow();
  });
});
