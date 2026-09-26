/**
 * 金丝雀第 4 步：毒丸测试矩阵（Poison Pill Matrix，canary README §5 & §7 步骤 4）。
 *
 * 验证宿主对各类非法、畸形、恶意 ZIP 包与越权声明的精准防御与拒绝：
 * 1. nested-zip：目录嵌套（缺根目录 manifest.json）
 * 2. engine99：平台引擎版本不兼容（>=99.0.0）
 * 3. engine02：零主版本向下不兼容（^0.2.9 vs 0.3.x）
 * 4. missing-entry：声明入口文件在 ZIP 中不存在
 * 5. bomb：解压未压缩容量超过 300MB 阈值（ZIP bomb 防护）
 * 6. all-method：API 路由包含非法 HTTP 方法（ALL）
 * 7. traversal：包含路径穿越条目（../）
 * 8. noprovides：激活时尝试 provide 未在 manifest.provides 声明的 Token
 */
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ServiceRegistry } from '../../../packages/core/di/service-registry.js';
import { NodeEsmLoader } from '../../../packages/core/esm-loader/node-loader.js';
import { PluginHost } from '../../../packages/core/plugin-host/index.js';
import { PluginState } from '../../../packages/core/plugin-host/types.js';
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
import { buildPoisonZip } from './canary.builder';
import { POISON_MATRIX } from './expectations';

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

function createServices(registry: ServiceRegistry, db: Database.Database): void {
  const mockCommandBus = {
    execute: vi.fn(async (cmd: any) => ({ ok: true, cmd })),
    registerHandler: vi.fn(),
    unregisterHandler: vi.fn(),
    getHealth: health,
    getMetadata: metadata,
  };
  const mockEventBus = {
    publish: vi.fn(async () => {}),
    subscribe: vi.fn(() => () => {}),
    unsubscribe: vi.fn(),
    getHealth: health,
    getMetadata: metadata,
  };
  const mockDb = {
    exec: (sql: string) => db.exec(sql),
    prepare: (sql: string) => db.prepare(sql),
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
  const mockProcessManager = {
    spawn: vi.fn().mockResolvedValue('process-id'),
    kill: vi.fn().mockResolvedValue(undefined),
    registerHandler: vi.fn().mockResolvedValue(undefined),
    unregisterHandler: vi.fn().mockResolvedValue(undefined),
    registerInterval: vi.fn().mockResolvedValue('interval-id'),
    restore: vi.fn().mockResolvedValue(undefined),
    getHealth: health,
    getMetadata: metadata,
  };
  const mockStorage = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
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
}

describe('金丝雀第 4 步：毒丸变体拒绝矩阵（POISON_MATRIX）', () => {
  let db: Database.Database;
  let registry: ServiceRegistry;
  let host: PluginHost;
  let testPluginsDir: string;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    testPluginsDir = path.resolve(__dirname, `.tmp-plugins-${Date.now()}`);
    fs.mkdirSync(testPluginsDir, { recursive: true });

    db = createTestDb();
    registry = new ServiceRegistry();
    createServices(registry, db);
    bootstrapSharedModules();

    const loader = new NodeEsmLoader();
    host = new PluginHost(registry, loader, db, testPluginsDir);
  });

  afterAll(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    if (host) {
      for (const p of host.listPlugins()) {
        if (p.state === PluginState.ACTIVE) {
          try {
            await host.deactivatePlugin(p.id);
          } catch {
            // ignore
          }
        }
      }
    }
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

  // 逐条对齐 POISON_MATRIX
  it.each(POISON_MATRIX)(
    '毒丸变体 [%s] 必须被精准防御拒绝且匹配错误签名',
    async ({ variant, errorPattern }) => {
      const poisonZip = await buildPoisonZip(variant);
      expect(poisonZip).toBeInstanceOf(Buffer);
      expect(poisonZip.length).toBeGreaterThan(0);

      if (variant === 'noprovides') {
        // noprovides 变体在安装时 manifest 合法，但在激活时尝试 provide 未声明的 token
        const installed = await host.installPluginFromZip(poisonZip, 'inline');
        expect(installed).toBeDefined();
        const pId = (installed as any).pluginId ?? installed.id;
        expect(host.getPluginState(pId)).toBe(PluginState.INSTALLED);

        await expect(host.activatePlugin(pId, { mode: 'inline' })).rejects.toThrow(errorPattern);

        // 清理该插件
        await host.uninstallPlugin(pId);
      } else {
        // 安装期毒丸：必须在 validateAndBundleZip 或 installPluginFromZip 阶段被直接拒绝
        let caughtError: Error | null = null;
        try {
          await host.installPluginFromZip(poisonZip, 'inline');
        } catch (err: any) {
          caughtError = err;
        }

        expect(caughtError, `毒丸变体 ${variant} 应该被宿主拒绝，但实际安装成功了！`).not.toBeNull();
        expect(caughtError!.message).toMatch(errorPattern);

        // 验证数据库中没有该插件的残留记录
        const row = db.prepare('SELECT COUNT(*) as count FROM plugins WHERE manifest LIKE ?').get(`%ext-canary%`) as { count: number };
        expect(row.count).toBe(0);
      }
    },
    20000, // 为 bomb 变体预留充足时间
  );
});
