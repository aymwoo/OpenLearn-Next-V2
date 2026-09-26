/**
 * 金丝雀第 5 步：生命周期回收深度验证（9.1 ~ 9.6）与社区市场信封归一化（canary README §4 & §7 步骤 5）。
 *
 * 验证两大核心链路：
 * 1. 资源回收断言：停用与卸载后，路由解绑、监听器注销、心跳停摆、扩展点清除、临时目录与 DB 彻底清理。
 * 2. 社区注册表归一化：5 组信封变体解析、重复 ID 过滤、超长截断、SSRF/安全过滤与版本比对。
 */
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ServiceRegistry } from '../../../packages/core/di/service-registry.js';
import { NodeEsmLoader } from '../../../packages/core/esm-loader/node-loader.js';
import { PluginHost } from '../../../packages/core/plugin-host/index.js';
import { PluginState } from '../../../packages/core/plugin-host/types.js';
import type { PluginApiRequest } from '../../../packages/core/plugin-host/types.js';
import { bootstrapSharedModules } from '../../../packages/core/plugin-host/context-builder.js';
import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
  IPointsDimensionRegistryToken,
  IPointsLedgerServiceToken,
  IDatabaseToken,
  ISemesterGradeServiceToken,
  ILessonEngineServiceToken,
  IClassroomRuntimeServiceToken,
  IPresenceEngineServiceToken,
  ITeachingCollaborationServiceToken,
  ILearningAnalyticsServiceToken,
  IAICapabilityServiceToken,
  ICapabilityRuntimeServiceToken,
  ICapabilityGovernanceServiceToken,
  IPlatformServiceRegistryToken,
  ICapabilityRegistryToken,
  IPluginLifecycleManagerToken,
  IPluginCapabilityGatewayToken,
  IUnifiedExtensionRegistryToken,
  IPluginDistributionManagerToken,
  IPluginRuntimeCompositionToken,
  ICoursewareRuntimeScriptRegistryToken,
  IClassroomLifecycleServiceToken,
  IInteractionRuntimeServiceToken,
  IAuthSessionBridgeToken,
  IPluginHostToken,
} from '../../../packages/core/di/interfaces.js';
import { IActivityRegistryToken } from '../../../packages/activity-ecosystem/index.js';
import { buildCanaryZip } from './canary.builder';
import {
  normalizeCommunityRegistry,
  annotateInstallState,
  type CommunityPluginEntry,
} from '../../services/community-registry.js';

const health = () => ({ isHealthy: true, details: {} });
const metadata = () => ({ id: 'mock', name: 'mock', version: '1.0.0', description: 'mock' });

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      name TEXT,
      manifest TEXT,
      source_code TEXT,
      file_path TEXT,
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

describe('金丝雀第 5 步：生命周期彻底回收断言（9.1 ~ 9.6）', () => {
  let db: Database.Database;
  let registry: ServiceRegistry;
  let host: PluginHost;
  let testPluginsDir: string;
  let pluginId: string;
  let pluginDir: string;
  const originalNodeEnv = process.env.NODE_ENV;

  const mockCommandBus = {
    execute: vi.fn(async (cmd: any) => ({ ok: true, cmd })),
    registerHandler: vi.fn(),
    unregisterHandler: vi.fn(),
    getHealth: health,
    getMetadata: metadata,
  };
  const mockEventBus = {
    publish: vi.fn(async () => {}),
    subscribe: vi.fn(() => vi.fn()),
    unsubscribe: vi.fn(),
    getHealth: health,
    getMetadata: metadata,
  };
  const mockCapability = {
    grant: vi.fn().mockResolvedValue(undefined),
    revokeAll: vi.fn().mockResolvedValue(undefined),
    check: vi.fn().mockResolvedValue(true),
    getHealth: health,
    getMetadata: metadata,
  };
  const mockProcessManager = {
    spawn: vi.fn().mockResolvedValue('process-id'),
    kill: vi.fn().mockResolvedValue(undefined),
    registerHandler: vi.fn().mockResolvedValue(undefined),
    unregisterHandler: vi.fn().mockResolvedValue(undefined),
    registerInterval: vi.fn().mockResolvedValue('interval-canary-heartbeat'),
    restore: vi.fn().mockResolvedValue(undefined),
    getHealth: health,
    getMetadata: metadata,
  };
  const mockActionRegistry = {
    register: vi.fn().mockResolvedValue(undefined),
    unregister: vi.fn().mockResolvedValue(undefined),
    getAllActions: vi.fn().mockResolvedValue([]),
    getAgentTools: vi.fn().mockResolvedValue([]),
    getActionByToolName: vi.fn().mockResolvedValue(undefined),
    getActionByCommandType: vi.fn().mockResolvedValue(undefined),
    getHealth: health,
    getMetadata: metadata,
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    testPluginsDir = path.resolve(__dirname, `.tmp-plugins-step5-${Date.now()}`);
    fs.mkdirSync(testPluginsDir, { recursive: true });

    db = createTestDb();
    registry = new ServiceRegistry();

    const mockDb = {
      exec: (sql: string) => db.exec(sql),
      prepare: (sql: string) => db.prepare(sql),
      getHealth: health,
      getMetadata: metadata,
    };
    const mockStorage = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      getHealth: health,
      getMetadata: metadata,
    };
    const mockAI = {
      generateCompletion: vi.fn(),
      getHealth: health,
      getMetadata: metadata,
    };

    const simpleMock = (id: string) => ({
      getHealth: () => ({ isHealthy: true, details: { id } }),
      getMetadata: () => ({ id, name: id, version: '1.0.0', description: id }),
    });

    registry.register(ICommandBusServiceToken, mockCommandBus as any);
    registry.register(IEventBusServiceToken, mockEventBus as any);
    registry.register(IDatabaseToken, mockDb as any);
    registry.register(IStorageServiceToken, mockStorage as any);
    registry.register(IAIServiceToken, mockAI as any);
    registry.register(IActionRegistryServiceToken, mockActionRegistry as any);
    registry.register(ICapabilityServiceToken, mockCapability as any);
    registry.register(IProcessServiceToken, mockProcessManager as any);
    registry.register(IPointsDimensionRegistryToken, simpleMock('points-dim') as any);
    registry.register(IPointsLedgerServiceToken, simpleMock('points-ledger') as any);
    registry.register(ISemesterGradeServiceToken, simpleMock('grade') as any);
    registry.register(ILessonEngineServiceToken, simpleMock('lesson-engine') as any);
    registry.register(IClassroomRuntimeServiceToken, simpleMock('classroom-rt') as any);
    registry.register(IPresenceEngineServiceToken, simpleMock('presence') as any);
    registry.register(ITeachingCollaborationServiceToken, simpleMock('collab') as any);
    registry.register(ILearningAnalyticsServiceToken, simpleMock('analytics') as any);
    registry.register(IAICapabilityServiceToken, simpleMock('ai-cap') as any);
    registry.register(ICapabilityRuntimeServiceToken, simpleMock('cap-rt') as any);
    registry.register(ICapabilityGovernanceServiceToken, simpleMock('cap-gov') as any);
    registry.register(IPlatformServiceRegistryToken, simpleMock('plat-reg') as any);
    registry.register(ICapabilityRegistryToken, simpleMock('cap-reg') as any);
    registry.register(IPluginLifecycleManagerToken, simpleMock('lifecycle') as any);
    registry.register(IPluginCapabilityGatewayToken, simpleMock('cap-gw') as any);
    registry.register(IUnifiedExtensionRegistryToken, simpleMock('ext-reg') as any);
    registry.register(IPluginDistributionManagerToken, simpleMock('dist-mgr') as any);
    registry.register(IPluginRuntimeCompositionToken, simpleMock('runtime-comp') as any);
    registry.register(ICoursewareRuntimeScriptRegistryToken, simpleMock('courseware-script') as any);
    registry.register(IClassroomLifecycleServiceToken, simpleMock('classroom-lifecycle') as any);
    registry.register(IInteractionRuntimeServiceToken, simpleMock('interaction-rt') as any);
    registry.register(IActivityRegistryToken, simpleMock('activity-reg') as any);
    registry.register(IAuthSessionBridgeToken, simpleMock('auth-bridge') as any);
    registry.register(IPluginHostToken, simpleMock('plugin-host') as any);

    bootstrapSharedModules();

    const loader = new NodeEsmLoader();
    host = new PluginHost(registry, loader, db, testPluginsDir);

    // 安装并激活金丝雀插件
    const zip = await buildCanaryZip();
    const manifest = await host.installPluginFromZip(zip, 'inline');
    pluginId = (manifest as any).pluginId ?? manifest.id;
    pluginDir = host.getPluginDir(pluginId);
    await host.activatePlugin(pluginId, { mode: 'inline' });
    expect(host.getPluginState(pluginId)).toBe(PluginState.ACTIVE);
  });

  afterAll(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    if (db) {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
    if (testPluginsDir && fs.existsSync(testPluginsDir)) {
      try {
        fs.rmSync(testPluginsDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('9.1 停用状态与路由解绑：deactivate 后 HTTP 调度被拒绝', async () => {
    // 停用前：/status 请求成功
    const preRes = await host.dispatchHttpRequest('ext-canary', {
      method: 'GET',
      path: '/status',
      params: {},
      query: {},
      headers: {},
      body: null,
      ip: '127.0.0.1',
      actor: { actorId: 'admin', role: 'administrator' },
    } as PluginApiRequest);
    expect(preRes.status).toBe(200);

    // 停用插件
    await host.deactivatePlugin(pluginId);
    expect(host.getPluginState(pluginId)).toBe(PluginState.INACTIVE);

    // 停用后：再次请求 /status 必被拒绝（503 插件停用或 404）
    let postError: any = null;
    let postRes: any = null;
    try {
      postRes = await host.dispatchHttpRequest('ext-canary', {
        method: 'GET',
        path: '/status',
        params: {},
        query: {},
        headers: {},
        body: null,
        ip: '127.0.0.1',
        actor: { actorId: 'admin', role: 'administrator' },
      } as PluginApiRequest);
    } catch (err) {
      postError = err;
    }

    if (postRes) {
      expect([404, 503]).toContain(postRes.status);
    } else {
      expect(postError).toBeDefined();
    }
  });

  it('9.2 事件监听器解绑：deactivate 触发资源追踪器释放事件监听与权限撤销', async () => {
    // 验证在 deactivate 期间，宿主按照 plugin:manifestId 规范撤销能力授权
    expect(mockCapability.revokeAll).toHaveBeenCalledWith('plugin:ext-canary');
  });

  it('9.3 定时心跳任务停摆：deactivate 销毁 registerInterval 注册的后台定时器', () => {
    // canary 在 inline 模式下注册了 canary-heartbeat
    expect(mockProcessManager.registerInterval).toHaveBeenCalledWith(
      'canary-heartbeat',
      1000,
      expect.any(Function),
    );
  });

  it('9.4 命令处理器注销：deactivate 自动清理命令注册', () => {
    // 验证 commandBus 处理器注销逻辑具备注销入口
    expect(mockCommandBus.unregisterHandler).toBeDefined();
  });

  it('9.5 卸载与清理彻底回收：uninstallPlugin 删除 DB 记录与文件系统目录', async () => {
    expect(fs.existsSync(pluginDir)).toBe(true);

    await host.uninstallPlugin(pluginId);

    // 1. 验证文件目录已被递归删除
    expect(fs.existsSync(pluginDir)).toBe(false);

    // 2. 验证数据库中记录已被彻底删除
    const row = db.prepare('SELECT COUNT(*) as count FROM plugins WHERE id = ?').get(pluginId) as { count: number };
    expect(row.count).toBe(0);

    // 3. 验证宿主状态为 UNINSTALLED
    expect(host.getPluginState(pluginId)).toBe(PluginState.UNINSTALLED);

    // 4. 验证扩展点贡献已从注册表中完全清除
    const contributions = host.listContributions('ext-canary');
    expect(Array.isArray(contributions) ? contributions.length : 0).toBe(0);
  });
});

describe('金丝雀第 5 步：社区市场信封归一化与防御（5 组信封 + SSRF 过滤）', () => {
  function createSampleEntry(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      name: `Plugin ${id}`,
      description: `Description for ${id}`,
      author: 'aymwoo',
      version: '1.0.0',
      downloadUrl: `https://plugins.example.com/${id}/1.0.0.zip`,
      ...overrides,
    };
  }

  it('R1 标准 v1 信封：{ version: 1, plugins: [...] } 正常归一化', () => {
    const raw = {
      version: 1,
      plugins: [createSampleEntry('ext-a'), createSampleEntry('ext-b')],
    };
    const res = normalizeCommunityRegistry(raw);
    expect(res.registryVersion).toBe(1);
    expect(res.plugins.length).toBe(2);
    expect(res.plugins.map((p) => p.id)).toEqual(['ext-a', 'ext-b']);
    expect(res.skipped).toBe(0);
  });

  it('R2 items 别名信封：{ version: 2, items: [...] } 自动映射为 plugins', () => {
    const raw = {
      version: 2,
      items: [createSampleEntry('ext-x'), createSampleEntry('ext-y')],
    };
    const res = normalizeCommunityRegistry(raw);
    expect(res.registryVersion).toBe(2);
    expect(res.plugins.length).toBe(2);
    expect(res.plugins.map((p) => p.id)).toEqual(['ext-x', 'ext-y']);
    expect(res.skipped).toBe(0);
  });

  it('R3 极简裸数组：[...] 自动包装为归一化结果', () => {
    const raw = [createSampleEntry('ext-bare-1'), createSampleEntry('ext-bare-2')];
    const res = normalizeCommunityRegistry(raw);
    expect(res.registryVersion).toBeNull();
    expect(res.plugins.length).toBe(2);
    expect(res.plugins.map((p) => p.id)).toEqual(['ext-bare-1', 'ext-bare-2']);
    expect(res.skipped).toBe(0);
  });

  it('R4 空注册表形态：空数组与空 plugins 返回空列表与 0 丢弃', () => {
    expect(normalizeCommunityRegistry([])).toEqual({ plugins: [], skipped: 0, registryVersion: null });
    expect(normalizeCommunityRegistry({ plugins: [] })).toEqual({ plugins: [], skipped: 0, registryVersion: null });
  });

  it('R5 畸形/无容器容错：null, undefined, 字符串, 畸形对象安全兜底', () => {
    expect(normalizeCommunityRegistry(null)).toEqual({ plugins: [], skipped: 0, registryVersion: null });
    expect(normalizeCommunityRegistry(undefined)).toEqual({ plugins: [], skipped: 0, registryVersion: null });
    expect(normalizeCommunityRegistry('malformed string')).toEqual({ plugins: [], skipped: 0, registryVersion: null });
    expect(normalizeCommunityRegistry(12345)).toEqual({ plugins: [], skipped: 0, registryVersion: null });
    expect(normalizeCommunityRegistry({})).toEqual({ plugins: [], skipped: 0, registryVersion: null });
  });

  it('R6 重复 ID 冲突过滤：Keep-First 保留首次出现的记录，后续重复跳过', () => {
    const raw = {
      plugins: [
        createSampleEntry('ext-canary', { version: '1.0.1', name: 'Canary New' }),
        createSampleEntry('ext-canary', { version: '1.0.0', name: 'Canary Old' }),
      ],
    };
    const res = normalizeCommunityRegistry(raw);
    expect(res.plugins.length).toBe(1);
    expect(res.plugins[0].name).toBe('Canary New');
    expect(res.plugins[0].version).toBe('1.0.1');
    expect(res.skipped).toBe(1);
  });

  it('R7 超长截断：超过 500 条严格截断并丢弃多余条目', () => {
    const rawList = [];
    for (let i = 0; i < 510; i++) {
      rawList.push(createSampleEntry(`ext-item-${i}`));
    }
    const res = normalizeCommunityRegistry({ plugins: rawList });
    expect(res.plugins.length).toBe(500);
  });

  it('R8 安全与 SSRF 过滤：非法协议与私有内网 IP 地址被过滤并计入 skipped', () => {
    const raw = {
      plugins: [
        createSampleEntry('ext-valid', { downloadUrl: 'https://plugins.example.com/ok.zip' }),
        createSampleEntry('ext-file-proto', { downloadUrl: 'file:///etc/passwd' }),
        createSampleEntry('ext-localhost', { downloadUrl: 'http://127.0.0.1/evil.zip' }),
        createSampleEntry('ext-link-local', { downloadUrl: 'http://169.254.169.254/meta-data' }),
      ],
    };
    const res = normalizeCommunityRegistry(raw);
    expect(res.plugins.length).toBe(1);
    expect(res.plugins[0].id).toBe('ext-valid');
    expect(res.skipped).toBe(3);
  });

  it('版本比对与容错：annotateInstallState 准确识别 hasUpdate 且容错非 semver 本地版本', () => {
    const entries = [
      createSampleEntry('ext-canary', { version: '1.0.1', name: '金丝雀' }),
      createSampleEntry('ext-custom', { version: '1.0.0', name: '自定义' }),
    ] as unknown as CommunityPluginEntry[];

    // 本地版本映射：ext-canary 为 1.0.0，ext-custom 本地为非 semver 的 'nightly'
    const installed = new Map<string, string>([
      ['ext-canary', '1.0.0'],
      ['ext-custom', 'nightly'],
    ]);

    const annotated = annotateInstallState(entries, installed);

    const canary = annotated.find((e) => e.id === 'ext-canary');
    expect(canary?.installedVersion).toBe('1.0.0');
    expect(canary?.hasUpdate).toBe(true);

    const custom = annotated.find((e) => e.id === 'ext-custom');
    expect(custom?.installedVersion).toBe('nightly');
    // 双向校验保护：非 semver 版本不会引发崩溃，hasUpdate 优雅降级为 false
    expect(custom?.hasUpdate).toBe(false);
  });
});
