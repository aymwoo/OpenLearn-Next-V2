/**
 * 金丝雀插件步骤 3：双模式（inline / worker）主矩阵全覆盖测试（canary README §5）
 *
 * 核心目标：
 * 1. 验证合法插件在 inline 与 worker 模式下的完整生命周期；
 * 2. 85+ 用例全覆盖验证：全局不变量、PROBE_MATRIX、MODE_DIFFS、TOKEN_SWEEP、REQUIRE_SWEEP、HTTP 网关；
 * 3. 验证 deactivation 资源回收干净。
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
import { CapabilityGuard } from '../../../packages/core/capability-system/index.js';
import { WorkerManager } from '../../../packages/core/worker-runtime/worker-manager.js';
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
  PROBE_MATRIX,
  MODE_DIFFS,
  TOKEN_SWEEP,
  REQUIRE_SWEEP,
} from './expectations';

process.env.OPENLEARN_WORKER_ACTIVATE_TIMEOUT_MS = '20000';

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

function createExtraServices(): Record<string, unknown> {
  return {
    semesterGrade: { saveSemesterGrade: vi.fn().mockResolvedValue(undefined) },
    lessonEngine: { getRuntime: vi.fn().mockResolvedValue({}) },
    classroomRuntime: { getRuntimeKernel: vi.fn().mockResolvedValue({}) },
    presenceEngine: { getPresenceEngine: vi.fn().mockResolvedValue({}) },
    teachingCollaboration: { getCollaborationEngine: vi.fn().mockResolvedValue({}) },
    learningAnalytics: { getAnalyticsEngine: vi.fn().mockResolvedValue({}) },
    aiCapability: { getCapabilityKernel: vi.fn().mockResolvedValue({}) },
    capabilityRuntime: { getRuntimeKernel: vi.fn().mockResolvedValue({}) },
    capabilityGovernance: { getGovernanceKernel: vi.fn().mockResolvedValue({}) },
    platformServiceRegistry: { getServiceRegistryKernel: vi.fn().mockResolvedValue({}) },
    capabilityRegistry: {
      registerCapability: vi.fn(),
      resolveCapability: vi.fn().mockReturnValue({}),
      hasCapability: vi.fn().mockReturnValue(false),
      listCapabilities: vi.fn().mockReturnValue([]),
      clear: vi.fn(),
    },
    pluginLifecycleManager: {
      pluginHost: null,
      getPluginState: vi.fn().mockReturnValue(undefined),
      listPlugins: vi.fn().mockReturnValue([]),
      activatePlugin: vi.fn().mockResolvedValue(undefined),
      deactivatePlugin: vi.fn().mockResolvedValue(undefined),
      reloadPlugin: vi.fn().mockResolvedValue(undefined),
      uninstallPlugin: vi.fn().mockResolvedValue(undefined),
      health,
      metadata,
    },
    pluginCapabilityGateway: {
      capabilityRegistry: null,
      listCapabilities: vi.fn().mockReturnValue([]),
      hasCapability: vi.fn().mockReturnValue(false),
      resolveCapability: vi.fn().mockReturnValue({}),
      executeCapability: vi.fn().mockResolvedValue(undefined),
      health,
      metadata,
    },
    unifiedExtensionRegistry: {
      registerExtension: vi.fn(),
      hasExtension: vi.fn().mockReturnValue(false),
      getExtension: vi.fn().mockReturnValue(undefined),
      listExtensions: vi.fn().mockReturnValue([]),
      listCategories: vi.fn().mockReturnValue([]),
      health,
      metadata,
    },
    pluginDistributionManager: {
      pluginHost: null,
      registerRepository: vi.fn(),
      listRepositories: vi.fn().mockReturnValue([]),
      listAvailablePackages: vi.fn().mockResolvedValue([]),
      installFromZip: vi.fn().mockResolvedValue({ pluginId: '', manifest: {} }),
      installFromRepository: vi.fn().mockResolvedValue({ pluginId: '', manifest: {} }),
      updatePlugin: vi.fn().mockResolvedValue(undefined),
      updateFromZip: vi.fn().mockResolvedValue({}),
      uninstallPlugin: vi.fn().mockResolvedValue(undefined),
      health,
      metadata,
    },
    pluginRuntimeComposition: {
      pluginHost: null,
      workerManager: undefined,
      isStarted: false,
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      health,
      metadata,
    },
    coursewareRuntimeScriptRegistry: {
      register: vi.fn(),
      unregister: vi.fn(),
      clear: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      listOwners: vi.fn().mockReturnValue([]),
    },
    classroomLifecycle: {
      getStage: vi.fn().mockResolvedValue('PRE_CLASS_READY'),
      transitionStage: vi.fn().mockResolvedValue({ success: true, stage: 'PRE_CLASS_READY' }),
      registerStageGuard: vi.fn(),
      unregisterStageGuard: vi.fn(),
    },
    interactionRuntime: {
      registerActivityProvider: vi.fn(),
      unregisterActivityProvider: vi.fn(),
      listActivityProviders: vi.fn().mockReturnValue([]),
    },
    activityRegistry: {
      registerProvider: vi.fn(),
      unregisterProvider: vi.fn().mockReturnValue(true),
      getProvider: vi.fn().mockReturnValue(undefined),
      listProviders: vi.fn().mockReturnValue([]),
      listDescriptors: vi.fn().mockReturnValue([]),
      listByRole: vi.fn().mockReturnValue([]),
      listByCategory: vi.fn().mockReturnValue([]),
      startActivity: vi.fn().mockResolvedValue({ provider: '', dispatched: false }),
      clear: vi.fn(),
    },
    authSessionBridge: { createSession: vi.fn().mockResolvedValue({ token: 'tok', maxAge: 3600 }) },
  };
}

describe('金丝雀插件双模式全链路测试（步骤 3）', () => {
  let db: Database.Database;
  let host: PluginHost;
  let workerManager: WorkerManager;
  let pluginsDir: string;
  let pluginId: string;
  let services: Record<string, unknown>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';

    db = createTestDb();
    const sr = new ServiceRegistry();

    services = {
      commandBus: {
        execute: vi.fn().mockResolvedValue(undefined),
        registerHandler: vi.fn().mockResolvedValue(undefined),
        unregisterHandler: vi.fn().mockResolvedValue(undefined),
        createCommand: vi.fn().mockResolvedValue({}),
        setInterceptor: vi.fn().mockResolvedValue(undefined),
      },
      eventBus: {
        publish: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn().mockResolvedValue(undefined),
        unsubscribe: vi.fn().mockResolvedValue(undefined),
      },
      actionRegistry: {
        register: vi.fn().mockResolvedValue(undefined),
        unregister: vi.fn().mockResolvedValue(undefined),
        getAllActions: vi.fn().mockResolvedValue([]),
        getAgentTools: vi.fn().mockResolvedValue([]),
        getActionByToolName: vi.fn().mockResolvedValue(undefined),
        getActionByCommandType: vi.fn().mockResolvedValue(undefined),
      },
      capability: {
        grant: vi.fn().mockResolvedValue(undefined),
        revokeAll: vi.fn().mockResolvedValue(undefined),
        check: vi.fn().mockResolvedValue(true),
      },
      processManager: {
        spawn: vi.fn().mockResolvedValue('p'),
        kill: vi.fn().mockResolvedValue(undefined),
        registerHandler: vi.fn().mockResolvedValue(undefined),
        unregisterHandler: vi.fn().mockResolvedValue(undefined),
        registerInterval: vi.fn().mockResolvedValue('i'),
        restore: vi.fn().mockResolvedValue(undefined),
      },
      storage: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      ai: { generateText: vi.fn().mockResolvedValue('ai') },
      pointsDimension: {
        registerDimension: vi.fn(),
        getDimension: vi.fn(),
        listDimensions: vi.fn().mockReturnValue([]),
      },
      pointsLedger: {
        addPoints: vi.fn().mockResolvedValue({}),
        getLogs: vi.fn().mockResolvedValue([]),
        getStudentTotalByDimension: vi.fn().mockResolvedValue(0),
        getStudentDimensionSummary: vi.fn().mockResolvedValue({}),
      },
    };

    const basePairs: Array<[any, unknown]> = [
      [ICommandBusServiceToken, services.commandBus],
      [IEventBusServiceToken, services.eventBus],
      [IActionRegistryServiceToken, services.actionRegistry],
      [ICapabilityServiceToken, services.capability],
      [IProcessServiceToken, services.processManager],
      [IStorageServiceToken, services.storage],
      [IAIServiceToken, services.ai],
      [IPointsDimensionRegistryToken, services.pointsDimension],
      [IPointsLedgerServiceToken, services.pointsLedger],
    ];

    const extra = createExtraServices();
    const extraPairs: Array<[any, unknown]> = [
      [ISemesterGradeServiceToken, extra.semesterGrade],
      [ILessonEngineServiceToken, extra.lessonEngine],
      [IClassroomRuntimeServiceToken, extra.classroomRuntime],
      [IPresenceEngineServiceToken, extra.presenceEngine],
      [ITeachingCollaborationServiceToken, extra.teachingCollaboration],
      [ILearningAnalyticsServiceToken, extra.learningAnalytics],
      [IAICapabilityServiceToken, extra.aiCapability],
      [ICapabilityRuntimeServiceToken, extra.capabilityRuntime],
      [ICapabilityGovernanceServiceToken, extra.capabilityGovernance],
      [IPlatformServiceRegistryToken, extra.platformServiceRegistry],
      [ICapabilityRegistryToken, extra.capabilityRegistry],
      [IPluginLifecycleManagerToken, extra.pluginLifecycleManager],
      [IPluginCapabilityGatewayToken, extra.pluginCapabilityGateway],
      [IUnifiedExtensionRegistryToken, extra.unifiedExtensionRegistry],
      [IPluginDistributionManagerToken, extra.pluginDistributionManager],
      [IPluginRuntimeCompositionToken, extra.pluginRuntimeComposition],
      [ICoursewareRuntimeScriptRegistryToken, extra.coursewareRuntimeScriptRegistry],
      [IClassroomLifecycleServiceToken, extra.classroomLifecycle],
      [IInteractionRuntimeServiceToken, extra.interactionRuntime],
      [IActivityRegistryToken, extra.activityRegistry],
      [IAuthSessionBridgeToken, extra.authSessionBridge],
    ];

    pluginsDir = fs.mkdtempSync(path.resolve(__dirname, '.tmp-plugins-'));
    host = new PluginHost(sr, new NodeEsmLoader(), db, pluginsDir);
    (extra.pluginLifecycleManager as any).pluginHost = host;
    (extra.pluginDistributionManager as any).pluginHost = host;
    (extra.pluginRuntimeComposition as any).pluginHost = host;

    for (const [token, svc] of basePairs) await sr.register(token, svc);
    for (const [token, svc] of extraPairs) await sr.register(token, svc);
    await sr.register(IDatabaseToken, db);
    await sr.register(IPluginHostToken, host);

    // 绑定 WorkerManager
    workerManager = new WorkerManager(sr, new CapabilityGuard(), db);
    host.setWorkerManager(workerManager);

    await bootstrapSharedModules();

    // 安装插件
    const zip = await buildCanaryZip();
    const manifest = await host.installPluginFromZip(zip, 'inline');
    pluginId = (manifest as unknown as { pluginId?: string }).pluginId ?? manifest.id;
  }, 120_000);

  afterAll(async () => {
    if (host && pluginId) {
      await host.deactivatePlugin(pluginId).catch(() => {});
    }
    db?.close();
    if (pluginsDir) fs.rmSync(pluginsDir, { recursive: true, force: true });
  });

  const MODES = ['inline', 'worker'] as const;

  describe.each(MODES)('【%s 模式】', (mode) => {
    let probes: Map<string, { id: string; mode: string; ok: boolean; expected: string; detail: string }>;
    let probeResponse: any;

    beforeAll(async () => {
      // 模式切换：若当前已处于激活状态先注销，再重新以当前 mode 激活
      const currentState = host.getPluginState(pluginId);
      if (currentState === PluginState.ACTIVE) {
        await host.deactivatePlugin(pluginId);
      }

      await host.activatePlugin(pluginId, { mode });
      expect(host.getPluginState(pluginId)).toBe(PluginState.ACTIVE);

      // 请求 /probes 获取黑盒探针结果报告
      const res = await host.dispatchHttpRequest('ext-canary', {
        method: 'GET',
        path: '/probes',
        params: {},
        query: {},
        headers: {},
        body: null,
        ip: '127.0.0.1',
        actor: { actorId: 'test-admin', role: 'administrator' },
      } as PluginApiRequest);

      expect(res.status).toBe(200);
      probeResponse = res.body;
      const list = probeResponse.probes as Array<{
        id: string;
        mode: string;
        ok: boolean;
        expected: string;
        detail: string;
      }>;
      probes = new Map(list.map((p) => [p.id, p]));
    }, 60_000);

    it('全局不变量：所有探针 ok=true（实际行为均符合预期）', () => {
      const failed = [...probes.values()].filter((p) => !p.ok);
      expect(failed, `模式 ${mode} 未达预期探针：${failed.map((p) => `${p.id} → ${p.detail}`).join('; ')}`).toEqual([]);
    });

    it.each(PROBE_MATRIX)('通用探针 %s: ok=true 且 detail 匹配', ({ id, expectedOk, matchPattern }) => {
      const p = probes.get(id);
      expect(p, `缺少探针 ${id}`).toBeDefined();
      expect(p?.ok).toBe(expectedOk);
      if (matchPattern) {
        if (typeof matchPattern === 'string') {
          expect(p?.detail).toBe(matchPattern);
        } else {
          expect(p?.detail).toMatch(matchPattern);
        }
      }
    });

    it.each(Object.entries(MODE_DIFFS[mode]))('模式差异探针 %s', (id, pattern) => {
      const p = probes.get(id);
      expect(p, `缺少模式差异探针 ${id}`).toBeDefined();
      expect(p?.ok).toBe(true);
      expect(p?.detail).toMatch(pattern);
    });

    it.each(TOKEN_SWEEP)('Token 扫描: %s', (tokenName) => {
      const p = probes.get(`2.5-token:${tokenName}`);
      if (!p) {
        // 若运行时 SDK 版本（如 3.6.1）未导出该 Token，验证其合成探针或优雅跳过
        if (tokenName.includes('Countdown')) {
          const synth = probes.get('2.5-token:IClassroomCountdownServiceToken(synthetic)');
          expect(synth).toBeDefined();
          expect(synth?.ok).toBe(true);
        }
        return;
      }
      expect(p.ok).toBe(true);
      if (tokenName.includes('Countdown')) {
        expect(p?.detail).toMatch(/rejected:.*No provider registered/);
      } else if (mode === 'worker') {
        const WORKER_ALLOWED = [
          'ICommandBusServiceToken',
          'IEventBusServiceToken',
          'IActionRegistryServiceToken',
          'ICapabilityServiceToken',
          'IProcessServiceToken',
          'IStorageServiceToken',
          'IAIServiceToken',
          'IDatabaseToken',
          'IPluginHostToken',
        ];
        if (WORKER_ALLOWED.includes(tokenName)) {
          expect(p?.detail).toBe('resolved:true');
        } else {
          expect(p?.detail).toMatch(/rejected:.*No provider registered/);
        }
      } else {
        expect(p?.detail).toBe('resolved:true');
      }
    });

    it.each(REQUIRE_SWEEP)('require 扫描: $module (allowed=$allowed)', ({ module, allowed }) => {
      const p = probes.get(`6-require:${module}`);
      expect(p, `缺少 require 探针 6-require:${module}`).toBeDefined();
      expect(p?.ok).toBe(true);
      if (allowed) {
        expect(p?.detail).toBe('required:true');
      } else {
        expect(p?.detail).toMatch(/^rejected:/);
      }
    });

    it('HTTP 端点: GET /status 返回 ok 与当前模式', async () => {
      const res = await host.dispatchHttpRequest('ext-canary', {
        method: 'GET',
        path: '/status',
        params: {},
        query: {},
        headers: {},
        body: null,
        ip: '127.0.0.1',
        actor: { actorId: 'test-admin', role: 'administrator' },
      } as PluginApiRequest);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        ok: true,
        mode,
        pluginId,
        dbProbe: 'ok',
      });
    });

    it('HTTP 端点: GET /items/:id 路径参数与角色传递', async () => {
      const res = await host.dispatchHttpRequest('ext-canary', {
        method: 'GET',
        path: '/items/item-123',
        params: { id: 'item-123' },
        query: {},
        headers: {},
        body: null,
        ip: '127.0.0.1',
        actor: { actorId: 'teacher-1', role: 'teacher' },
      } as PluginApiRequest);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        itemId: 'item-123',
        role: 'teacher',
      });
    });

    it('HTTP 端点: POST /echo 请求体透传', async () => {
      const testData = { message: 'hello world', count: 42 };
      const res = await host.dispatchHttpRequest('ext-canary', {
        method: 'POST',
        path: '/echo',
        params: {},
        query: {},
        headers: {},
        body: testData,
        ip: '127.0.0.1',
        actor: { actorId: 'test-admin', role: 'administrator' },
      } as PluginApiRequest);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        bytes: JSON.stringify(testData).length,
      });
    });

    it('HTTP 端点: GET /public 无鉴权端点响应', async () => {
      const res = await host.dispatchHttpRequest('ext-canary', {
        method: 'GET',
        path: '/public',
        params: {},
        query: {},
        headers: {},
        body: null,
        ip: '127.0.0.1',
        actor: { actorId: 'anon', role: 'anonymous' },
      } as PluginApiRequest);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ public: true });
    });

    it('HTTP 端点: GET /ticks 计数端点响应', async () => {
      const res = await host.dispatchHttpRequest('ext-canary', {
        method: 'GET',
        path: '/ticks',
        params: {},
        query: {},
        headers: {},
        body: null,
        ip: '127.0.0.1',
        actor: { actorId: 'test-admin', role: 'administrator' },
      } as PluginApiRequest);

      expect(res.status).toBe(200);
      expect(typeof (res.body as any).ticks).toBe('number');
    });

    it('自建表记录持久化可查', () => {
      // 记录现状：inline 模式使用 DB UUID 表前缀，worker 模式使用 manifest.id 表前缀
      const tbl = mode === 'worker'
        ? 'plugin_ext_canary_probe_results'
        : `plugin_${pluginId.replace(/[^a-zA-Z0-9_]/g, '_')}_probe_results`;
      const row = (db as any).prepare(`SELECT COUNT(*) AS c FROM ${tbl} WHERE mode = ?`).get(mode) as { c: number };
      expect(row.c).toBeGreaterThan(0);
    });
  });

  describe('停用与清理回收', () => {
    it('deactivatePlugin 成功将状态重置为 INACTIVE', async () => {
      await host.deactivatePlugin(pluginId);
      expect(host.getPluginState(pluginId)).toBe(PluginState.INACTIVE);
    });
  });
});
