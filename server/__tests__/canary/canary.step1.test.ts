/**
 * 金丝雀第 1 步：最小合法 ZIP 安装闭环（canary README §7 步骤 1，风险 R2）。
 *
 * 白盒口径（与 packages/core/plugin-host/__tests__/plugin-host.test.ts 同构）：
 * 真实 PluginHost + 真实 NodeEsmLoader + 真实 esbuild 安装链路，临时 SQLite 与
 * 临时 pluginsDir（避免污染仓库 plugins/ 目录）。
 *
 * ⚠️ NODE_ENV 处理：激活路径在 NODE_ENV !== 'test' 时才走 file:// 导入 +
 * ensureHostSdkResolution 符号链接（plugin-host/index.ts:1235-1243）；vitest 默认
 * NODE_ENV=test 会退化为 data: URL 加载，无法解析 external 的 @openlearn/* 导入。
 * 因此本文件显式切到 'production' 以复现生产行为（vitest forks 池下仅影响本文件进程）。
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
} from '../../../packages/core/di/interfaces.js';
import { buildCanaryZip } from './canary.builder';

// ── 测试环境（复刻 plugin-host.test.ts 的最小 mock services）──

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

function createMockServices(): Record<string, unknown> {
  const noop = () => Promise.resolve();
  return {
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
      spawn: vi.fn().mockResolvedValue('process-id'),
      kill: vi.fn().mockResolvedValue(undefined),
      registerHandler: vi.fn().mockResolvedValue(undefined),
      unregisterHandler: vi.fn().mockResolvedValue(undefined),
      registerInterval: vi.fn().mockResolvedValue('interval-id'),
      restore: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    ai: { generateText: vi.fn().mockResolvedValue('AI response') },
    pointsDimension: {
      registerDimension: vi.fn(),
      getDimension: vi.fn().mockReturnValue(undefined),
      listDimensions: vi.fn().mockReturnValue([]),
    },
    pointsLedger: {
      addPoints: vi.fn().mockResolvedValue({}),
      getLogs: vi.fn().mockResolvedValue([]),
      getStudentTotalByDimension: vi.fn().mockResolvedValue(0),
      getStudentDimensionSummary: vi.fn().mockResolvedValue({}),
    },
  } as Record<string, unknown>;
}

describe('金丝雀第 1 步：最小 ZIP 安装闭环（inline）', () => {
  let db: Database.Database;
  let host: PluginHost;
  let pluginsDir: string;
  let pluginId: string;

  beforeAll(async () => {
    // 复现生产激活路径（file:// + SDK 符号链接），见文件头注释
    process.env.NODE_ENV = 'production';

    db = createTestDb();
    const sr = new ServiceRegistry();
    const services = createMockServices();
    await sr.register(ICommandBusServiceToken, services.commandBus);
    await sr.register(IEventBusServiceToken, services.eventBus);
    await sr.register(IActionRegistryServiceToken, services.actionRegistry);
    await sr.register(ICapabilityServiceToken, services.capability);
    await sr.register(IProcessServiceToken, services.processManager);
    await sr.register(IStorageServiceToken, services.storage);
    await sr.register(IAIServiceToken, services.ai);
    await sr.register(IPointsDimensionRegistryToken, services.pointsDimension);
    await sr.register(IPointsLedgerServiceToken, services.pointsLedger);
    // 生产内核（kernel/index.ts）同样把原生 db 注册为 IDatabaseToken —— 金丝雀的
    // ctx.resolve(IDatabaseToken) 探针依赖它（与宿主共享同一 SQLite 实例）
    await sr.register(IDatabaseToken, db);

    // pluginsDir 必须位于 vite root（仓库）内：激活时 host 用 import(file://...) 加载
    // 插件入口，vitest 的 module runner 对 root 外的 /tmp 路径会抛 ERR_MODULE_NOT_FOUND。
    // afterAll 清理；.gitignore 已忽略 .tmp-plugins
    pluginsDir = fs.mkdtempSync(path.resolve(__dirname, '.tmp-plugins-'));
    host = new PluginHost(sr, new NodeEsmLoader(), db, pluginsDir);
  });

  afterAll(() => {
    db?.close();
    if (pluginsDir) fs.rmSync(pluginsDir, { recursive: true, force: true });
  });

  it('1a. installFromZip —— manifest 解析、token-enforcer 扫描、esbuild 打包、落库', async () => {
    const zip = await buildCanaryZip();
    const manifest = await host.installPluginFromZip(zip, 'inline');

    expect(manifest.id).toBe('ext-canary');
    pluginId = (manifest as unknown as { pluginId?: string }).pluginId ?? manifest.id;
    expect(host.getPluginState(pluginId)).toBe(PluginState.INSTALLED);
  }, 60_000);

  it('1b. activatePlugin(inline) —— file:// 加载 + SDK 符号链接解析成功（R2）', async () => {
    await host.activatePlugin(pluginId, { mode: 'inline' });
    expect(host.getPluginState(pluginId)).toBe(PluginState.ACTIVE);
  }, 60_000);

  it('1c. dispatchHttpRequest —— /status 200 且 external SDK 导入真实可用', async () => {
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
    // 记录现状：ZIP 安装插件的 ctx.pluginId 是 DB UUID（非 manifest.id），
    // 与 plugin-sdk.md "唯一实例标识" 的表述存在口径差异 → 后续文档/代码讨论项
    expect(res.body).toMatchObject({
      ok: true,
      mode: 'inline',
      pluginId, // 1a 返回的 DB UUID
      dbProbe: 'ok', // ← IDatabaseToken 经 external 导入解析并执行 SQL 成功
    });
  }, 60_000);

  it('1d. deactivatePlugin —— 状态回到 INACTIVE', async () => {
    await host.deactivatePlugin(pluginId);
    expect(host.getPluginState(pluginId)).toBe(PluginState.INACTIVE);
  }, 60_000);
});
