/**
 * E2E plugin lifecycle regression test（V3.1）。
 *
 * 通过 PluginHost API 覆盖完整插件生命周期，验证所有 V2.5→V3.1 特性。
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServiceRegistry } from '../../di/service-registry.js';
import { EsmLoader } from '../../esm-loader/esm-loader.js';
import type { PluginModule } from '../../esm-loader/esm-loader.js';
import { PluginHost } from '../index.js';
import { ContributionRegistry } from '../contribution-registry.js';
import { PluginState } from '../types.js';
import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
  IDatabaseToken,
} from '../../di/interfaces.js';
import { CommandBus } from '../../command-bus/index.js';
import { EventBus } from '../../event-bus/index.js';
import { ActionRegistry } from '../../registry/index.js';
import { CapabilityGuard } from '../../capability-system/index.js';

// ── TestEsmLoader: 控制注入的插件模块 ──────────────────────────────────

class TestEsmLoader extends EsmLoader {
  constructor(private modules: Map<string, PluginModule>) {
    super();
  }
  async load(code: string): Promise<PluginModule> {
    const mod = this.modules.get(code);
    if (!mod) throw new Error(`No test module registered for code: ${code.slice(0, 60)}...`);
    return mod;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, manifest TEXT NOT NULL,
      source_code TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL,
      loader_version TEXT, execution_mode TEXT, file_path TEXT
    );
    CREATE TABLE IF NOT EXISTS plugin_storage (
      plugin_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
      updated_at INTEGER NOT NULL, PRIMARY KEY (plugin_id, key)
    );
    CREATE TABLE IF NOT EXISTS plugin_migrations (
      plugin_id TEXT PRIMARY KEY, version INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vfs_nodes (
      id TEXT, parent_id TEXT, type TEXT, name TEXT,
      content TEXT, created_at INTEGER, updated_at INTEGER
    );
  `);
}

interface MakeModuleOpts {
  id: string;
  name?: string;
  version?: string;
  capabilitiesProposed?: string[];
  pluginDependencies?: string[];
  configuration?: Record<string, any>;
  commands?: Array<{ type: string; desc: string; cap: string }>;
}

function makePluginModule(opts: MakeModuleOpts): PluginModule {
  const name = opts.name ?? opts.id;
  const version = opts.version ?? '1.0.0';
  const caps = opts.capabilitiesProposed ?? [];
  const deps = opts.pluginDependencies ?? [];
  const config = opts.configuration;
  const cmds = opts.commands ?? [];

  const extra: Record<string, any> = {};
  if (deps.length > 0) extra.pluginDependencies = deps;
  if (config) extra.configuration = config;

  return {
    default: {
      manifest: {
        id: opts.id,
        name,
        version,
        main: 'index.js',
        capabilitiesProposed: caps,
        ...extra,
      },
      activate: async (_ctx: any) => {
        for (const c of cmds) {
          await _ctx.services.commandBus.registerHandler(c.type, {
            execute: async () => ({ ok: true, from: opts.id }),
          });
        }
      },
      deactivate: async () => {},
    },
  };
}

async function setupServiceRegistry(db: Database.Database): Promise<ServiceRegistry> {
  const sr = new ServiceRegistry();
  const eventBus = new EventBus();
  const capabilityGuard = new CapabilityGuard();
  const commandBus = new CommandBus(eventBus);
  const actionRegistry = new ActionRegistry();

  await sr.register(IEventBusServiceToken, eventBus);
  await sr.register(ICapabilityServiceToken, capabilityGuard);
  await sr.register(ICommandBusServiceToken, commandBus);
  await sr.register(IActionRegistryServiceToken, actionRegistry);
  await sr.register(IDatabaseToken, db);

  // IStorageService: 注册最小实现
  await sr.register(IStorageServiceToken, {
    get: async () => null,
    set: async () => {},
    delete: async () => {},
  } as any);

  // IProcessService: 注册最小实现
  await sr.register(IProcessServiceToken, {
    spawn: async () => 'proc-1',
    kill: async () => {},
    registerHandler: async () => {},
    unregisterHandler: async () => {},
    registerInterval: async () => 'int-1',
    restore: async () => {},
  } as any);

  // IAIService: 注册最小实现
  await sr.register(IAIServiceToken, {
    generateText: async () => '',
  } as any);

  return sr;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('E2E Plugin Lifecycle', () => {
  let db: Database.Database;
  let pluginHost: PluginHost;
  let serviceRegistry: ServiceRegistry;
  let loadMap: Map<string, PluginModule>;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-e2e-'));
    db = new Database(':memory:');
    createTables(db);
    serviceRegistry = await setupServiceRegistry(db);
    loadMap = new Map();
    const loader = new TestEsmLoader(loadMap);
    pluginHost = new PluginHost(serviceRegistry, loader, db, tmpDir);
  });

  afterEach(() => {
    db.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  // ══════════════════════════════════════════════════════════════════════
  // V3.0: Contribution Registry
  // ══════════════════════════════════════════════════════════════════════

  describe('V3.0 ContributionRegistry', () => {
    it('插件安装后贡献点可枚举（无需激活）', () => {
      const registry = new ContributionRegistry();
      registry.registerClassroomTools('ext-contrib-a', [
        { id: 'tool-1', name: 'Tool 1', commandType: 'cmd.1' },
        { id: 'tool-2', name: 'Tool 2', commandType: 'cmd.2' },
      ]);

      const summary = registry.summary('ext-contrib-a');
      expect(summary).toHaveLength(1);
      expect(summary[0].slot).toBe('classroom.tool');
      expect(summary[0].count).toBe(2);
    });

    it('allSummaries 跨插件聚合', () => {
      const registry = new ContributionRegistry();
      registry.register('ext-a', {
        'classroom.tool': [{ id: 'a1', name: 'A1', commandType: 'a.cmd' }],
      });
      registry.register('ext-b', {
        'teacher.tab': [{ id: 'b1', label: 'B1' }],
      });
      expect(registry.allSummaries()).toHaveLength(2);
    });

    it('stats 返回正确的聚合统计', () => {
      const registry = new ContributionRegistry();
      registry.register('ext-a', {
        'classroom.tool': [
          { id: 'a1', name: 'A1', commandType: 'a1.cmd' },
          { id: 'a2', name: 'A2', commandType: 'a2.cmd' },
        ],
      });
      registry.register('ext-b', {
        'classroom.tool': [{ id: 'b1', name: 'B1', commandType: 'b1.cmd' }],
        'teacher.tab': [{ id: 'tab1', label: 'Tab' }],
      });

      const s = registry.stats();
      expect(s.totalPlugins).toBe(2);
      expect(s.totalContributions).toBe(4);
      expect(s.bySlot['classroom.tool']).toBe(3);
      expect(s.bySlot['teacher.tab']).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // V3.0: Plugin Dependencies
  // ══════════════════════════════════════════════════════════════════════

  describe('V3.0 Plugin Dependencies', () => {
    it('依赖满足 → 激活成功', async () => {
      const a = makePluginModule({ id: 'ext-a' });
      const b = makePluginModule({ id: 'ext-b', pluginDependencies: ['ext-a'] });

      // 两个插件的源码 key
      loadMap.set('src-a', a);
      loadMap.set('src-b', b);

      await pluginHost.installPlugin('src-a');
      await pluginHost.installPlugin('src-b');

      await pluginHost.activatePlugin('ext-a');
      expect(pluginHost.getPluginState('ext-a')).toBe(PluginState.ACTIVE);

      await pluginHost.activatePlugin('ext-b');
      expect(pluginHost.getPluginState('ext-b')).toBe(PluginState.ACTIVE);
    });

    it('依赖缺失 → 激活失败', async () => {
      const orphan = makePluginModule({
        id: 'ext-orphan',
        pluginDependencies: ['ext-nonexistent'],
      });

      loadMap.set('src-orphan', orphan);
      await pluginHost.installPlugin('src-orphan');

      await expect(
        pluginHost.activatePlugin('ext-orphan'),
      ).rejects.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // V3.0: Configuration Service
  // ══════════════════════════════════════════════════════════════════════

  describe('V3.0 ConfigurationService', () => {
    it('配置默认值 + set + get + 持久化', async () => {
      const { ConfigService } = await import('../config-service.js');

      const manifest = {
        id: 'ext-cfg',
        name: 'Cfg',
        version: '1.0.0',
        main: 'index.js',
        configuration: {
          properties: {
            maxQuestions: { type: 'number', default: 50 },
            title: { type: 'string', default: 'Quiz' },
            debug: { type: 'boolean', default: false },
            mode: { type: 'string', enum: ['easy', 'hard'], default: 'easy' },
          },
        },
      };
      const svc = new ConfigService(db, manifest as any);
      svc.loadFromDB();

      // 默认值
      expect(svc.get('maxQuestions')).toBe(50);
      expect(svc.get('title')).toBe('Quiz');
      expect(svc.get('debug')).toBe(false);
      expect(svc.get('mode')).toBe('easy');

      // 写入 + 读取
      await svc.set('maxQuestions', 100);
      await svc.set('title', 'Exam');
      await svc.set('debug', true);
      await svc.set('mode', 'hard');

      expect(svc.get('maxQuestions')).toBe(100);
      expect(svc.get('title')).toBe('Exam');
      expect(svc.get('debug')).toBe(true);
      expect(svc.get('mode')).toBe('hard');
    });

    it('schema 校验拒绝非法值', async () => {
      const { ConfigService } = await import('../config-service.js');
      const manifest = {
        id: 'ext-val',
        name: 'Val',
        version: '1.0.0',
        main: 'index.js',
        configuration: {
          properties: {
            score: { type: 'number', minimum: 0, maximum: 100 },
            type: { type: 'string', enum: ['a', 'b'] },
          },
        },
      };
      const svc = new ConfigService(db, manifest as any);

      await expect(svc.set('score', 150)).rejects.toThrow();
      await expect(svc.set('score', -1)).rejects.toThrow();
      await expect(svc.set('type', 'c')).rejects.toThrow();
      await expect(svc.set('unknown', 'x')).rejects.toThrow();
    });

    it('onChange 回调', async () => {
      const { ConfigService } = await import('../config-service.js');
      const manifest = {
        id: 'ext-events',
        name: 'Events',
        version: '1.0.0',
        main: 'index.js',
        configuration: {
          properties: { theme: { type: 'string', default: 'light' } },
        },
      };
      const svc = new ConfigService(db, manifest as any);
      const calls: Array<{ key: string; newValue: unknown }> = [];
      svc.onChange((k, nv) => calls.push({ key: k, newValue: nv }));

      await svc.set('theme', 'dark');
      await svc.set('theme', 'auto');
      expect(calls).toHaveLength(2);
    });

    it('getAll 返回所有值', async () => {
      const { ConfigService } = await import('../config-service.js');
      const manifest = {
        id: 'ext-all',
        name: 'All',
        version: '1.0.0',
        main: 'index.js',
        configuration: {
          properties: {
            a: { type: 'number', default: 1 },
            b: { type: 'string', default: 'x' },
          },
        },
      };
      const svc = new ConfigService(db, manifest as any);
      svc.loadFromDB();

      const all = svc.getAll();
      expect(all.a).toBe(1);
      expect(all.b).toBe('x');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 完整生命周期
  // ══════════════════════════════════════════════════════════════════════

  describe('完整生命周期', () => {
    it('install → activate → deactivate → reactivate → uninstall', async () => {
      const mod = makePluginModule({ id: 'ext-lifecycle' });
      loadMap.set('src-lifecycle', mod);

      // Install
      const manifest = await pluginHost.installPlugin('src-lifecycle');
      const uuid = pluginHost.resolvePluginUuid('ext-lifecycle');
      expect(pluginHost.getPluginState('ext-lifecycle')).toBe(PluginState.INSTALLED);

      // Activate
      await pluginHost.activatePlugin('ext-lifecycle');
      expect(pluginHost.getPluginState('ext-lifecycle')).toBe(PluginState.ACTIVE);

      // Deactivate
      await pluginHost.deactivatePlugin('ext-lifecycle');
      expect(pluginHost.getPluginState('ext-lifecycle')).toBe(PluginState.INACTIVE);

      // Reactivate
      await pluginHost.activatePlugin('ext-lifecycle');
      expect(pluginHost.getPluginState('ext-lifecycle')).toBe(PluginState.ACTIVE);

      // Uninstall — state is kept in memory as UNINSTALLED
      await pluginHost.uninstallPlugin('ext-lifecycle');
      expect(pluginHost.getPluginState(uuid)).toBe(PluginState.UNINSTALLED);
    });

    it('listPlugins 状态一致', async () => {
      const mod = makePluginModule({ id: 'ext-list-test' });
      loadMap.set('src-list', mod);

      await pluginHost.installPlugin('src-list');
      await pluginHost.activatePlugin('ext-list-test');

      const plugins = pluginHost.listPlugins();
      const p = plugins.find((x: any) => x.name === 'ext-list-test');
      expect(p).toBeDefined();
      expect(p!.state).toBe(PluginState.ACTIVE);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 并发：多插件独立清理
  // ══════════════════════════════════════════════════════════════════════

  describe('并发清理', () => {
    it('多插件各自卸载互不影响', async () => {
      loadMap.set('src-1', makePluginModule({ id: 'ext-concurrent-1' }));
      loadMap.set('src-2', makePluginModule({ id: 'ext-concurrent-2' }));
      loadMap.set('src-3', makePluginModule({ id: 'ext-concurrent-3' }));

      await pluginHost.installPlugin('src-1');
      await pluginHost.installPlugin('src-2');
      await pluginHost.installPlugin('src-3');

      const uuid1 = pluginHost.resolvePluginUuid('ext-concurrent-1');
      const uuid2 = pluginHost.resolvePluginUuid('ext-concurrent-2');
      const uuid3 = pluginHost.resolvePluginUuid('ext-concurrent-3');

      await pluginHost.activatePlugin('ext-concurrent-1');
      await pluginHost.activatePlugin('ext-concurrent-2');
      await pluginHost.activatePlugin('ext-concurrent-3');

      // 卸载插件 1 → 2 和 3 不受影响
      await pluginHost.uninstallPlugin('ext-concurrent-1');
      expect(pluginHost.getPluginState(uuid1)).toBe(PluginState.UNINSTALLED);
      expect(pluginHost.getPluginState(uuid2)).toBe(PluginState.ACTIVE);
      expect(pluginHost.getPluginState(uuid3)).toBe(PluginState.ACTIVE);

      // 卸载插件 2
      await pluginHost.uninstallPlugin('ext-concurrent-2');
      expect(pluginHost.getPluginState(uuid2)).toBe(PluginState.UNINSTALLED);
      expect(pluginHost.getPluginState(uuid3)).toBe(PluginState.ACTIVE);

      // 卸载插件 3
      await pluginHost.uninstallPlugin('ext-concurrent-3');
      expect(pluginHost.getPluginState(uuid3)).toBe(PluginState.UNINSTALLED);
    });
  });
});
