/**
 * 金丝雀第 2 步：activate 骨架完整化 —— 探针报告 + Token/require 扫描（canary README §7 步骤 2）。
 *
 * 与步骤 1 的差异：
 *   1. 测试环境注册全部 32 个可解析 Token 的 mock 服务（对齐生产内核注册面，
 *      唯 IClassroomCountdownService 无实现无注册）；
 *   2. 调用 bootstrapSharedModules() 注册真实共享模块（require 白名单第二层校验可过）；
 *   3. 断言焦点从 /status 转向 /probes 的自报告结果。
 */
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
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

// ── 额外 22 个 Token 的 mock 服务（对齐生产内核注册面；接口签名见 di/interfaces.ts）──
function createExtraServices(hostRef: { current: PluginHost | null }): Record<string, unknown> {
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
      pluginHost: null, // host 创建后回填
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

describe('金丝雀第 2 步：探针报告与 Token/require 扫描', () => {
  let db: Database.Database;
  let host: PluginHost;
  let pluginsDir: string;
  let pluginId: string;
  let services: Record<string, unknown>;
  let probes: Map<string, { id: string; mode: string; ok: boolean; expected: string; detail: string }>;
  let eventCount = -1;

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';

    db = createTestDb();
    const sr = new ServiceRegistry();

    // 基础 9 服务（复刻步骤 1）
    services = {
      commandBus: { execute: vi.fn().mockResolvedValue(undefined), registerHandler: vi.fn().mockResolvedValue(undefined), unregisterHandler: vi.fn().mockResolvedValue(undefined), createCommand: vi.fn().mockResolvedValue({}), setInterceptor: vi.fn().mockResolvedValue(undefined) },
      eventBus: { publish: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn().mockResolvedValue(undefined), unsubscribe: vi.fn().mockResolvedValue(undefined) },
      actionRegistry: { register: vi.fn().mockResolvedValue(undefined), unregister: vi.fn().mockResolvedValue(undefined), getAllActions: vi.fn().mockResolvedValue([]), getAgentTools: vi.fn().mockResolvedValue([]), getActionByToolName: vi.fn().mockResolvedValue(undefined), getActionByCommandType: vi.fn().mockResolvedValue(undefined) },
      capability: { grant: vi.fn().mockResolvedValue(undefined), revokeAll: vi.fn().mockResolvedValue(undefined), check: vi.fn().mockResolvedValue(true) },
      processManager: { spawn: vi.fn().mockResolvedValue('p'), kill: vi.fn().mockResolvedValue(undefined), registerHandler: vi.fn().mockResolvedValue(undefined), unregisterHandler: vi.fn().mockResolvedValue(undefined), registerInterval: vi.fn().mockResolvedValue('i'), restore: vi.fn().mockResolvedValue(undefined) },
      storage: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) },
      ai: { generateText: vi.fn().mockResolvedValue('ai') },
      pointsDimension: { registerDimension: vi.fn(), getDimension: vi.fn(), listDimensions: vi.fn().mockReturnValue([]) },
      pointsLedger: { addPoints: vi.fn().mockResolvedValue({}), getLogs: vi.fn().mockResolvedValue([]), getStudentTotalByDimension: vi.fn().mockResolvedValue(0), getStudentDimensionSummary: vi.fn().mockResolvedValue({}) },
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
      // 生产内核同样注册原生 db（金丝雀探针依赖）
      // [IDatabaseToken, db] —— db 创建后注册，见下
    ];

    const extra = createExtraServices({ current: null });
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

    // 真实共享模块注册（require 白名单第二层校验；与生产 kernel 启动一致）
    await bootstrapSharedModules();

    // 安装并激活
    const zip = await buildCanaryZip();
    const manifest = await host.installPluginFromZip(zip, 'inline');
    pluginId = (manifest as unknown as { pluginId?: string }).pluginId ?? manifest.id;
    await host.activatePlugin(pluginId, { mode: 'inline' });
    expect(host.getPluginState(pluginId)).toBe(PluginState.ACTIVE);

    // 拉取探针报告
    const res = await host.dispatchHttpRequest('ext-canary', {
      method: 'GET', path: '/probes', params: {}, query: {}, headers: {}, body: null, ip: '127.0.0.1',
      actor: { actorId: 'test-admin', role: 'administrator' },
    } as PluginApiRequest);
    expect(res.status).toBe(200);
    const list = (res.body as any).probes as Array<{ id: string; mode: string; ok: boolean; expected: string; detail: string }>;
    eventCount = (res.body as any).eventCount;
    probes = new Map(list.map((p) => [p.id, p]));
  }, 120_000);

  afterAll(() => {
    host?.deactivatePlugin(pluginId).catch(() => {});
    db?.close();
    if (pluginsDir) fs.rmSync(pluginsDir, { recursive: true, force: true });
  });

  it('2a. 全局不变量：所有探针 ok=true（实际行为均符合预期）', () => {
    const failed = [...probes.values()].filter((p) => !p.ok);
    expect(failed, `未达预期探针：${failed.map((p) => `${p.id} → ${p.detail}`).join('; ')}`).toEqual([]);
  });

  it('2b. Token 扫描覆盖面 ≥ 25（版本无关下限；3.6.1 运行时为 29，3.7.0 为 33）', () => {
    const tokenProbes = [...probes.keys()].filter((k) => k.startsWith('2.5-token:'));
    expect(tokenProbes.length).toBeGreaterThanOrEqual(25);
  });

  it('2c. 合成 countdown 探针：必须解析失败且报 No provider registered', () => {
    const p = probes.get('2.5-token:IClassroomCountdownServiceToken(synthetic)');
    expect(p?.ok).toBe(true);
    expect(p?.detail).toMatch(/No provider registered for token: @openlearn\/core:IClassroomCountdownService/);
  });

  it('2d. services 恰好 9 键且 pointsDimension 非空（本环境已注册）', () => {
    expect(probes.get('2.2-services')?.detail).toMatch(/keys=9, pointsDimension=set/);
  });

  it('2e. require 白名单全部可加载', () => {
    for (const m of ['recharts', 'react-markdown', 'jspdf', 'jspdf-autotable', 'exceljs', 'lucide-react', 'uuid']) {
      const p = probes.get(`6-require:${m}`);
      expect(p?.ok, `${m}: ${p?.detail}`).toBe(true);
      expect(p?.detail).toBe('required:true');
    }
  });

  it('2f. require 白名单外逐条拒绝且报 Allowed modules', () => {
    for (const m of ['xlsx', 'fs', 'lodash']) {
      const p = probes.get(`6-require:${m}`);
      expect(p?.ok, `${m}: ${p?.detail}`).toBe(true);
      expect(p?.detail).toMatch(new RegExp(`rejected:.*cannot require "${m}".*Allowed modules`));
    }
  });

  it('2g. lesson.created 订阅已注册且事件计数为 0（未触发）', () => {
    expect(eventCount).toBe(0);
    expect((services.eventBus as any).subscribe).toHaveBeenCalledWith('lesson.created', expect.any(Function));
  });

  it('2h. 探针结果已持久化到自建表（plugin_<uuid>_probe_results）', () => {
    const tbl = `plugin_${pluginId.replace(/[^a-zA-Z0-9_]/g, '_')}_probe_results`;
    const row = (db as unknown as { prepare(sql: string): { get(): unknown } }).prepare(
      `SELECT COUNT(*) AS c FROM ${tbl}`,
    ).get() as { c: number };
    expect(row.c).toBeGreaterThan(0);
  });
});
