/**
 * PluginHost 完整生命周期集成测试。
 *
 * 覆盖 15 个测试用例，包含：
 * - 生命周期流程测试（install → activate → deactivate → uninstall）
 * - 错误隔离测试（插件 A 失败不影响插件 B）
 * - 工具测试（listPlugins、getPluginState、restoreActivePlugins）
 *
 * 使用内存 SQLite（:memory:）和 mock EsmLoader，无外部依赖。
 */
import Database from 'better-sqlite3';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServiceRegistry } from '../../di/service-registry.js';
import { EsmLoader } from '../../esm-loader/esm-loader.js';
import type { PluginModule } from '../../esm-loader/esm-loader.js';
import { PluginHost, SemverMismatchError } from '../index.js';
import { PluginState } from '../types.js';
import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
} from '../../di/interfaces.js';
import type {
  ICommandBusService,
  IEventBusService,
  IActionRegistryService,
  ICapabilityService,
  IProcessService,
  IStorageService,
  IAIService,
} from '../../di/interfaces.js';

// ── Helpers ────────────────────────────────────────────────────────────────

/** 创建内存 SQLite 数据库并初始化插件相关表 */
function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      name TEXT,
      manifest TEXT,
      source_code TEXT,
      status TEXT,
      created_at INTEGER,
      loader_version TEXT,
      zip_package BLOB,
      execution_mode TEXT DEFAULT 'inline'
    );
    CREATE TABLE IF NOT EXISTS plugin_storage (
      plugin_id TEXT,
      key TEXT,
      value TEXT,
      updated_at INTEGER,
      PRIMARY KEY (plugin_id, key)
    );
  `);
  return db;
}

/** 生成简单插件的源码字符串 */
function simplePluginSource(manifestId: string, manifestName: string): string {
  return `
    export const manifest = ${JSON.stringify({
      id: manifestId,
      name: manifestName,
      version: '1.0.0',
      main: 'index.ts',
    })};
    export async function activate(ctx) {
      ctx._activated = true;
      ctx._pluginId = ctx.pluginId;
      ctx._manifestName = ctx.manifest.name;
    }
  `;
}

/** 生成带 deactivate 的插件源码 */
function pluginWithDeactivateSource(manifestId: string, manifestName: string): string {
  return `
    export const manifest = ${JSON.stringify({
      id: manifestId,
      name: manifestName,
      version: '1.0.0',
      main: 'index.ts',
    })};
    export async function activate(ctx) {
      ctx._activated = true;
    }
    export async function deactivate() {
      // 正常停用
    }
  `;
}

/** 生成 activate 失败的插件源码 */
function failingPluginSource(manifestId: string): string {
  return `
    export const manifest = ${JSON.stringify({
      id: manifestId,
      name: 'Failing Plugin',
      version: '1.0.0',
      main: 'index.ts',
    })};
    export async function activate(ctx) {
      throw new Error('activate failed intentionally');
    }
  `;
}

/** 生成 activate 无限挂起的插件源码 */
function hangingPluginSource(manifestId: string): string {
  return `
    export const manifest = ${JSON.stringify({
      id: manifestId,
      name: 'Hanging Plugin',
      version: '1.0.0',
      main: 'index.ts',
    })};
    export async function activate(ctx) {
      await new Promise(() => {}); // never resolves
    }
  `;
}

/** 生成 deactivate 无限挂起的插件源码 */
function hangingDeactivateSource(manifestId: string): string {
  return `
    export const manifest = ${JSON.stringify({
      id: manifestId,
      name: 'Hanging Deactivate Plugin',
      version: '1.0.0',
      main: 'index.ts',
    })};
    export async function activate(ctx) {
      ctx._activated = true;
    }
    export async function deactivate() {
      await new Promise(() => {}); // never resolves
    }
  `;
}

/** 创建最小化的 mock service（返回 undefined 的 vi.fn） */
function createMockServices(): Record<string, unknown> {
  return {
    commandBus: {
      execute: vi.fn().mockResolvedValue(undefined),
      registerHandler: vi.fn().mockResolvedValue(undefined),
      unregisterHandler: vi.fn().mockResolvedValue(undefined),
      createCommand: vi.fn().mockResolvedValue({}),
      setInterceptor: vi.fn().mockResolvedValue(undefined),
    } as ICommandBusService,
    eventBus: {
      publish: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    } as IEventBusService,
    actionRegistry: {
      register: vi.fn().mockResolvedValue(undefined),
      unregister: vi.fn().mockResolvedValue(undefined),
      getAllActions: vi.fn().mockResolvedValue([]),
      getAgentTools: vi.fn().mockResolvedValue([]),
      getActionByToolName: vi.fn().mockResolvedValue(undefined),
      getActionByCommandType: vi.fn().mockResolvedValue(undefined),
    } as IActionRegistryService,
    capability: {
      grant: vi.fn().mockResolvedValue(undefined),
      revokeAll: vi.fn().mockResolvedValue(undefined),
      check: vi.fn().mockResolvedValue(true),
    } as ICapabilityService,
    processManager: {
      spawn: vi.fn().mockResolvedValue('process-id'),
      kill: vi.fn().mockResolvedValue(undefined),
      registerHandler: vi.fn().mockResolvedValue(undefined),
      unregisterHandler: vi.fn().mockResolvedValue(undefined),
      registerInterval: vi.fn().mockResolvedValue('interval-id'),
      restore: vi.fn().mockResolvedValue(undefined),
    } as IProcessService,
    storage: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    } as IStorageService,
    ai: {
      generateText: vi.fn().mockResolvedValue('AI response'),
    } as IAIService,
  };
}

/** 向 ServiceRegistry 注册所有 7 个 mock services */
async function registerMockServices(
  sr: ServiceRegistry,
  services: Record<string, unknown>,
): Promise<void> {
  await sr.register(ICommandBusServiceToken, services.commandBus as ICommandBusService);
  await sr.register(IEventBusServiceToken, services.eventBus as IEventBusService);
  await sr.register(IActionRegistryServiceToken, services.actionRegistry as IActionRegistryService);
  await sr.register(ICapabilityServiceToken, services.capability as ICapabilityService);
  await sr.register(IProcessServiceToken, services.processManager as IProcessService);
  await sr.register(IStorageServiceToken, services.storage as IStorageService);
  await sr.register(IAIServiceToken, services.ai as IAIService);
}

/**
 * TestEsmLoader — 可控的 EsmLoader mock。
 *
 * loadMap 按 sourceCode 键返回预定义的 PluginModule，
 * 支持每种测试场景的不同行为。
 */
class TestEsmLoader extends EsmLoader {
  constructor(
    private loadMap: Map<string, PluginModule>,
  ) {
    super();
  }

  async load(code: string): Promise<PluginModule> {
    const result = this.loadMap.get(code);
    if (result) return result;
    // 默认：尝试解析为简单插件
    return {
      default: {
        manifest: { id: 'default', name: 'Default', version: '1.0.0', main: 'index.ts' },
        activate: async () => {},
      },
    };
  }
}

/** 创建简单的 PluginModule（用于 EsmLoader） */
function makePluginModule(manifestId: string, manifestName: string, activate?: (ctx: any) => Promise<void>, deactivate?: () => Promise<void>): PluginModule {
  const m = {
    id: manifestId,
    name: manifestName,
    version: '1.0.0',
    main: 'index.ts',
  };
  return {
    default: {
      manifest: m,
      activate: activate ?? (async (ctx: any) => { ctx._activated = true; }),
      ...(deactivate ? { deactivate } : {}),
    },
    manifest: m,
    activate: activate ?? (async (ctx: any) => { ctx._activated = true; }),
    ...(deactivate ? { deactivate } : {}),
  };
}

// ── Test Suite ─────────────────────────────────────────────────────────────

describe('PluginHost — 完整生命周期', () => {
  let db: Database.Database;
  let sr: ServiceRegistry;
  let services: Record<string, unknown>;
  let host: PluginHost;
  let loader: TestEsmLoader;
  let loadMap: Map<string, PluginModule>;

  beforeEach(async () => {
    db = createTestDb();
    sr = new ServiceRegistry();
    services = createMockServices();
    await registerMockServices(sr, services);
    loadMap = new Map();
    loader = new TestEsmLoader(loadMap);
    host = new PluginHost(sr, loader, db);
  });

  afterEach(() => {
    db.close();
  });

  // ── Test 1: installPlugin 成功 ────────────────────────────────────────

  it('installPlugin 成功 — 插件安装后 DB 和状态均正确', async () => {
    const sourceCode = 'install-test-source';
    const module = makePluginModule('test-plugin', 'Test Plugin');
    loadMap.set(sourceCode, module);

    const manifest = await host.installPlugin(sourceCode);

    expect(manifest.id).toBe('test-plugin');
    expect(manifest.name).toBe('Test Plugin');

    // 检查 DB
    const rows = db.prepare('SELECT * FROM plugins').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Test Plugin');
    expect(rows[0].status).toBe('installed');
    expect(rows[0].loader_version).toBe('esm');

    // 检查内存状态（通过 listPlugins 间接验证）
    const plugins = host.listPlugins();
    expect(plugins).toHaveLength(1);
    expect(plugins[0].state).toBe(PluginState.INSTALLED);
  });

  // ── Test 2: activatePlugin 成功 ───────────────────────────────────────

  it('activatePlugin 成功 — 插件激活后状态为 ACTIVE', async () => {
    const sourceCode = 'activate-test-source';
    const module = makePluginModule('activate-test', 'Activate Test');
    loadMap.set(sourceCode, module);

    await host.installPlugin(sourceCode);

    const [installed] = db.prepare('SELECT id FROM plugins').all() as any[];
    await host.activatePlugin(installed.id);

    expect(host.getPluginState(installed.id)).toBe(PluginState.ACTIVE);

    // 验证 DB 中 status 已更新
    const row = db.prepare('SELECT status FROM plugins WHERE id = ?').get(installed.id) as any;
    expect(row.status).toBe('active');
  });

  // ── Test 3: activatePlugin 在已激活插件上抛出 ────────────────────────

  it('activatePlugin 在已激活插件上抛出 IllegalStateTransitionError', async () => {
    const sourceCode = 'double-activate-source';
    const module = makePluginModule('double-activate', 'Double Activate');
    loadMap.set(sourceCode, module);

    await host.installPlugin(sourceCode);
    const [installed] = db.prepare('SELECT id FROM plugins').all() as any[];
    await host.activatePlugin(installed.id);

    // 再次激活应抛出
    await expect(host.activatePlugin(installed.id)).rejects.toThrow(/illegal state transition/i);
  });

  // ── Test 4: deactivatePlugin 成功 ─────────────────────────────────────

  it('deactivatePlugin 成功 — 状态为 INACTIVE，资源已清理', async () => {
    const sourceCode = 'deactivate-test-source';
    const deactivateSpy = vi.fn();
    const module = makePluginModule('deactivate-test', 'Deactivate Test', undefined, deactivateSpy);
    loadMap.set(sourceCode, module);

    await host.installPlugin(sourceCode);
    const [installed] = db.prepare('SELECT id FROM plugins').all() as any[];
    await host.activatePlugin(installed.id);

    // Spy on disposeAll
    const disposeSpy = vi.spyOn((host as any).resourceTracker, 'disposeAll');

    await host.deactivatePlugin(installed.id);

    expect(host.getPluginState(installed.id)).toBe(PluginState.INACTIVE);
    expect(deactivateSpy).toHaveBeenCalledTimes(1);
    expect(disposeSpy).toHaveBeenCalledWith(installed.id);

    // 验证 DB status
    const row = db.prepare('SELECT status FROM plugins WHERE id = ?').get(installed.id) as any;
    expect(row.status).toBe('inactive');
  });

  // ── Test 5: deactivatePlugin 在未激活插件上静默返回 ──────────────────

  it('deactivatePlugin 在未激活插件上静默返回（无错误）', async () => {
    const sourceCode = 'silent-deactivate-source';
    const module = makePluginModule('silent-deactivate', 'Silent Deactivate');
    loadMap.set(sourceCode, module);

    await host.installPlugin(sourceCode);
    const [installed] = db.prepare('SELECT id FROM plugins').all() as any[];

    // 未激活的插件 — deactivate 应静默返回
    await expect(host.deactivatePlugin(installed.id)).resolves.toBeUndefined();
    expect(host.getPluginState(installed.id)).toBe(PluginState.INSTALLED);
  });

  // ── Test 6: deactivatePlugin 超时后强制清理 ──────────────────────────

  it('deactivatePlugin 超时 5s 后强制清理 — 状态 INACTIVE 且 disposeAll 被调用', async () => {
    vi.useFakeTimers();

    const sourceCode = 'hang-deactivate-source';
    const deactivateNever = async () => {
      await new Promise(() => {}); // never resolves
    };
    const module = makePluginModule('hang-deactivate', 'Hang Deactivate', async (ctx) => {
      ctx._activated = true;
    }, deactivateNever);
    loadMap.set(sourceCode, module);

    await host.installPlugin(sourceCode);
    const [installed] = db.prepare('SELECT id FROM plugins').all() as any[];
    await host.activatePlugin(installed.id);

    const disposeSpy = vi.spyOn((host as any).resourceTracker, 'disposeAll');

    // 启动 deactivate（不会 resolve）
    const deactivatePromise = host.deactivatePlugin(installed.id);

    // 前进时间到 6s（超过 5s 超时）
    await vi.advanceTimersByTimeAsync(6000);
    // 让 microtask 执行
    await Promise.resolve();

    // 验证状态
    expect(host.getPluginState(installed.id)).toBe(PluginState.INACTIVE);
    expect(disposeSpy).toHaveBeenCalledWith(installed.id);

    vi.useRealTimers();

    // deactivatePromise 应已 resolve（finally 块执行完毕）
    await expect(deactivatePromise).resolves.toBeUndefined();
  });

  // ── Test 7: deactivatePlugin 即使 deactivate() 抛出也强制清理 ────────

  it('deactivatePlugin 即使 deactivate() 抛出错误也强制清理', async () => {
    const sourceCode = 'throw-deactivate-source';
    const deactivateThrow = async () => {
      throw new Error('deactivate error');
    };
    const module = makePluginModule('throw-deactivate', 'Throw Deactivate', async (ctx) => {
      ctx._activated = true;
    }, deactivateThrow);
    loadMap.set(sourceCode, module);

    await host.installPlugin(sourceCode);
    const [installed] = db.prepare('SELECT id FROM plugins').all() as any[];
    await host.activatePlugin(installed.id);

    const disposeSpy = vi.spyOn((host as any).resourceTracker, 'disposeAll');

    // 不应抛出 — deactivate 错误在内部 catch
    await expect(host.deactivatePlugin(installed.id)).resolves.toBeUndefined();

    expect(host.getPluginState(installed.id)).toBe(PluginState.INACTIVE);
    expect(disposeSpy).toHaveBeenCalledWith(installed.id);
  });

  // ── Test 8: uninstallPlugin 成功后返回 ────────────────────────────────

  it('uninstallPlugin 成功 — 状态 UNINSTALLED，DB 行已删除', async () => {
    const sourceCode = 'uninstall-test-source';
    const module = makePluginModule('uninstall-test', 'Uninstall Test');
    loadMap.set(sourceCode, module);

    await host.installPlugin(sourceCode);
    const [installed] = db.prepare('SELECT id FROM plugins').all() as any[];
    await host.activatePlugin(installed.id);
    await host.uninstallPlugin(installed.id);

    expect(host.getPluginState(installed.id)).toBe(PluginState.UNINSTALLED);

    // 验证 DB 行已删除
    const rows = db.prepare('SELECT * FROM plugins WHERE id = ?').all(installed.id) as any[];
    expect(rows).toHaveLength(0);
  });

  // ── Test 9: uninstallPlugin 在已安装但未激活的插件上有效 ─────────────

  it('uninstallPlugin 在已安装但未激活的插件上有效（直接卸载）', async () => {
    const sourceCode = 'direct-uninstall-source';
    const module = makePluginModule('direct-uninstall', 'Direct Uninstall');
    loadMap.set(sourceCode, module);

    await host.installPlugin(sourceCode);
    const [installed] = db.prepare('SELECT id FROM plugins').all() as any[];

    // 未激活直接卸载 — 应成功
    await expect(host.uninstallPlugin(installed.id)).resolves.toBeUndefined();

    expect(host.getPluginState(installed.id)).toBe(PluginState.UNINSTALLED);
    const rows = db.prepare('SELECT * FROM plugins WHERE id = ?').all(installed.id) as any[];
    expect(rows).toHaveLength(0);
  });

  // ── Test 10: activatePlugin 失败 → 状态 ERROR + disposeAll 回滚 ──────

  it('activatePlugin 失败 — 状态 ERROR，disposeAll 被调用', async () => {
    const sourceCode = 'fail-activate-source';
    const activateFail = async () => {
      throw new Error('activate failed intentionally');
    };
    const module = {
      default: {
        manifest: { id: 'fail-plugin', name: 'Fail Plugin', version: '1.0.0', main: 'index.ts' },
        activate: activateFail,
      },
      manifest: { id: 'fail-plugin', name: 'Fail Plugin', version: '1.0.0', main: 'index.ts' },
      activate: activateFail,
    };
    loadMap.set(sourceCode, module);

    await host.installPlugin(sourceCode);
    const [installed] = db.prepare('SELECT id FROM plugins').all() as any[];

    const disposeSpy = vi.spyOn((host as any).resourceTracker, 'disposeAll');

    await expect(host.activatePlugin(installed.id)).rejects.toThrow();

    expect(host.getPluginState(installed.id)).toBe(PluginState.ERROR);
    expect(disposeSpy).toHaveBeenCalledWith(installed.id);

    // DB status 应保持不变（未更新为 active）
    const row = db.prepare('SELECT status FROM plugins WHERE id = ?').get(installed.id) as any;
    expect(row.status).toBe('installed');
  });

  // ── Test 11: 插件 A 激活失败不影响插件 B ─────────────────────────────

  it('插件 A 激活失败不影响插件 B — 错误隔离', async () => {
    // 插件 A — 失败激活
    const sourceA = 'fail-a-source';
    const moduleA: PluginModule = {
      default: {
        manifest: { id: 'fail-a', name: 'Fail A', version: '1.0.0', main: 'index.ts' },
        activate: async () => { throw new Error('A failed'); },
      },
      manifest: { id: 'fail-a', name: 'Fail A', version: '1.0.0', main: 'index.ts' },
      activate: async () => { throw new Error('A failed'); },
    };
    loadMap.set(sourceA, moduleA);

    // 插件 B — 正常激活
    const sourceB = 'ok-b-source';
    const moduleB = makePluginModule('ok-b', 'OK B');
    loadMap.set(sourceB, moduleB);

    await host.installPlugin(sourceA);
    await host.installPlugin(sourceB);

    const rows = db.prepare('SELECT id FROM plugins ORDER BY created_at').all() as any[];
    expect(rows).toHaveLength(2);

    // 激活 A → 失败
    await expect(host.activatePlugin(rows[0].id)).rejects.toThrow();
    expect(host.getPluginState(rows[0].id)).toBe(PluginState.ERROR);

    // 激活 B → 成功
    await host.activatePlugin(rows[1].id);
    expect(host.getPluginState(rows[1].id)).toBe(PluginState.ACTIVE);
  });

  // ── Test 12: listPlugins 返回所有插件 ────────────────────────────────

  it('listPlugins 返回所有已安装的插件', async () => {
    const modA = makePluginModule('lp-a', 'List Plugin A');
    const modB = makePluginModule('lp-b', 'List Plugin B');
    const modC = makePluginModule('lp-c', 'List Plugin C');

    loadMap.set('src-a', modA);
    loadMap.set('src-b', modB);
    loadMap.set('src-c', modC);

    await host.installPlugin('src-a');
    await host.installPlugin('src-b');
    await host.installPlugin('src-c');

    const plugins = host.listPlugins();
    expect(plugins).toHaveLength(3);
    expect(plugins.map(p => p.name)).toEqual(
      expect.arrayContaining(['List Plugin A', 'List Plugin B', 'List Plugin C']),
    );
    expect(plugins.every(p => p.state === PluginState.INSTALLED)).toBe(true);
  });

  // ── Test 13: getPluginState 返回正确的状态 ───────────────────────────

  it('getPluginState 在各个生命周期阶段返回正确状态', async () => {
    const sourceCode = 'state-check-source';
    const module = makePluginModule('state-check', 'State Check');
    loadMap.set(sourceCode, module);

    await host.installPlugin(sourceCode);
    const [installed] = db.prepare('SELECT id FROM plugins').all() as any[];

    // INSTALLED
    expect(host.getPluginState(installed.id)).toBe(PluginState.INSTALLED);

    // → ACTIVE
    await host.activatePlugin(installed.id);
    expect(host.getPluginState(installed.id)).toBe(PluginState.ACTIVE);

    // → INACTIVE
    await host.deactivatePlugin(installed.id);
    expect(host.getPluginState(installed.id)).toBe(PluginState.INACTIVE);

    // 未追踪的 ID 返回 undefined
    expect(host.getPluginState('nonexistent')).toBeUndefined();
  });

  // ── Test 14: restoreActivePlugins 恢复 active 插件 ───────────────────

  it('restoreActivePlugins 从 DB 恢复 active 的 ESM 插件', async () => {
    // 直接在 DB 中插入一个 active 状态的插件（模拟重启场景）
    const pluginId = 'restored-plugin-1';
    const manifest = { id: 'restore-test', name: 'Restore Test', version: '1.0.0', main: 'index.ts' };
    db.prepare(
      'INSERT INTO plugins (id, name, manifest, source_code, status, created_at, loader_version) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(pluginId, 'Restore Test', JSON.stringify(manifest), 'restore-source', 'active', Date.now(), 'esm');

    // 为 restore 准备 EsmLoader
    const module = makePluginModule('restore-test', 'Restore Test');
    loadMap.set('restore-source', module);

    await host.restoreActivePlugins();

    expect(host.getPluginState(pluginId)).toBe(PluginState.ACTIVE);
  });

  // ── Test 15: 完整生命周期流程 ────────────────────────────────────────

  it('完整生命周期流程 — install → activate → deactivate → uninstall', async () => {
    const sourceCode = 'full-lifecycle-source';
    const module = makePluginModule('full-lifecycle', 'Full Lifecycle');
    loadMap.set(sourceCode, module);

    // install
    await host.installPlugin(sourceCode);
    const [installed] = db.prepare('SELECT id FROM plugins').all() as any[];
    expect(host.getPluginState(installed.id)).toBe(PluginState.INSTALLED);

    // activate
    await host.activatePlugin(installed.id);
    expect(host.getPluginState(installed.id)).toBe(PluginState.ACTIVE);

    // deactivate
    await host.deactivatePlugin(installed.id);
    expect(host.getPluginState(installed.id)).toBe(PluginState.INACTIVE);

    // uninstall
    await host.uninstallPlugin(installed.id);
    expect(host.getPluginState(installed.id)).toBe(PluginState.UNINSTALLED);

    // DB 中无记录
    const rows = db.prepare('SELECT * FROM plugins WHERE id = ?').all(installed.id) as any[];
    expect(rows).toHaveLength(0);

    // 无残留资源（listPlugins 返回空 — 取决于 DB 是否有其他记录，这里应无）
    const plugins = host.listPlugins();
    expect(plugins).toHaveLength(0);
  });

  // ── Phase 6: SemVer Compatibility Check ──────────────────────────────────

  /**
   * Helper: 创建带 requires/optional 的 PluginModule。
   */
  function makeModuleWithDeps(
    manifestId: string,
    manifestName: string,
    requires?: string[],
    optional?: string[],
    activate?: (ctx: any) => Promise<void>,
  ): PluginModule {
    const m: Record<string, any> = {
      id: manifestId,
      name: manifestName,
      version: '1.0.0',
      main: 'index.ts',
    };
    if (requires) m.requires = requires;
    if (optional) m.optional = optional;
    const activateFn = activate ?? (async (ctx: any) => { ctx._activated = true; });
    return {
      default: { manifest: m, activate: activateFn },
      manifest: m,
      activate: activateFn,
    };
  }

  describe('SemVer compatibility check (Phase 6)', () => {

    it('Test 1: should pass when required Token version matches range', async () => {
      const src = 'semver-pass-source';
      const module = makeModuleWithDeps(
        'semver-pass', 'SemVer Pass',
        ['@openlearn/core:ICommandBusService@^1.0.0'],
      );
      loadMap.set(src, module);

      // Install should succeed
      const manifest = await host.installPlugin(src);
      expect(manifest.id).toBe('semver-pass');

      // Activate should succeed
      const [installed] = db.prepare('SELECT id FROM plugins ORDER BY created_at DESC').all() as any[];
      await host.activatePlugin(installed.id);
      expect(host.getPluginState(installed.id)).toBe(PluginState.ACTIVE);
    });

    it('Test 2: should throw SemverMismatchError when required Token version is incompatible', async () => {
      const src = 'semver-fail-source';
      const module = makeModuleWithDeps(
        'semver-fail', 'SemVer Fail',
        ['@openlearn/core:ICommandBusService@^2.0.0'],
      );
      loadMap.set(src, module);

      // installPlugin should throw because of install-time pre-check — no DB INSERT occurs
      await expect(host.installPlugin(src)).rejects.toThrow(SemverMismatchError);

      // No plugin was installed (pre-check blocked it)
      const rows = db.prepare('SELECT * FROM plugins').all() as any[];
      expect(rows).toHaveLength(0);
    });

    it('Test 3: should throw SemverMismatchError when required Token is not registered', async () => {
      const src = 'semver-unreg-source';
      const module = makeModuleWithDeps(
        'semver-unreg', 'SemVer Unreg',
        ['@openlearn/core:INonExistentService@^1.0.0'],
      );
      loadMap.set(src, module);

      // installPlugin throws immediately — install-time pre-check blocks unregistered Token
      await expect(host.installPlugin(src)).rejects.toThrow(SemverMismatchError);

      // No plugin was installed
      const rows = db.prepare('SELECT * FROM plugins').all() as any[];
      expect(rows).toHaveLength(0);
    });

    it('Test 4: should pass when required Token has no version range', async () => {
      const src = 'semver-norange-source';
      const module = makeModuleWithDeps(
        'semver-norange', 'SemVer NoRange',
        ['@openlearn/core:ICommandBusService'],
      );
      loadMap.set(src, module);

      await host.installPlugin(src);
      const [installed] = db.prepare('SELECT id FROM plugins ORDER BY created_at DESC').all() as any[];

      // Accept any version — should pass
      await expect(host.activatePlugin(installed.id)).resolves.toBeUndefined();
      expect(host.getPluginState(installed.id)).toBe(PluginState.ACTIVE);
    });

    it('Test 5: should not throw for optional dependency with incompatible version', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const src = 'semver-opt-source';
      const module = makeModuleWithDeps(
        'semver-opt', 'SemVer Opt',
        undefined, // no requires
        ['@openlearn/core:IAIService@^2.0.0'],  // incompatible with host 1.0.0
      );
      loadMap.set(src, module);

      await host.installPlugin(src);
      const [installed] = db.prepare('SELECT id FROM plugins ORDER BY created_at DESC').all() as any[];

      // Should not throw — optional incompatibility is non-blocking
      await expect(host.activatePlugin(installed.id)).resolves.toBeUndefined();
      expect(host.getPluginState(installed.id)).toBe(PluginState.ACTIVE);

      // console.warn should have been called
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('Test 6: should set ctx.services key to null for incompatible optional dependency (D-12)', async () => {
      let capturedCtx: any = null;
      const activateWithCapture = async (ctx: any) => {
        capturedCtx = ctx;
        ctx._activated = true;
      };

      const src = 'd12-inject-source';
      const module: PluginModule = {
        default: {
          manifest: {
            id: 'd12-inject', name: 'D12 Inject', version: '1.0.0', main: 'index.ts',
            optional: ['@openlearn/core:IStorageService@^2.0.0'],
          },
          activate: activateWithCapture,
        },
        manifest: {
          id: 'd12-inject', name: 'D12 Inject', version: '1.0.0', main: 'index.ts',
          optional: ['@openlearn/core:IStorageService@^2.0.0'],
        },
        activate: activateWithCapture,
      };
      loadMap.set(src, module);

      await host.installPlugin(src);
      const [installed] = db.prepare('SELECT id FROM plugins ORDER BY created_at DESC').all() as any[];

      await host.activatePlugin(installed.id);
      expect(host.getPluginState(installed.id)).toBe(PluginState.ACTIVE);

      // The activate function should have received ctx with storage === null
      expect(capturedCtx).not.toBeNull();
      expect(capturedCtx.services.storage).toBeNull();

      // Other services should still be injected normally
      expect(capturedCtx.services.commandBus).not.toBeNull();
      expect(capturedCtx.services.eventBus).not.toBeNull();
    });

    it('Test 7: should reject installation when any required dependency fails (mixed compatibility)', async () => {
      const src = 'semver-mixed-source';
      const module = makeModuleWithDeps(
        'semver-mixed', 'SemVer Mixed',
        [
          '@openlearn/core:ICommandBusService@^1.0.0',  // matches host 1.0.0
          '@openlearn/core:IEventBusService@^2.0.0',    // incompatible with host 1.0.0
        ],
      );
      loadMap.set(src, module);

      // installPlugin throws because second required dep is incompatible
      await expect(host.installPlugin(src)).rejects.toThrow(SemverMismatchError);

      // No plugin was installed
      const rows = db.prepare('SELECT * FROM plugins').all() as any[];
      expect(rows).toHaveLength(0);
    });
  });
});
