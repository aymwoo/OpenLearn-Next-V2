/**
 * H-2 回归测试：`listContributions(pluginId)` 的键匹配。
 *
 * ## 这个缺陷的形态
 *
 * 宿主内部存在两套「插件标识符」命名空间，而两处对它的理解不一致：
 *
 * | 位置 | 用的是 |
 * |---|---|
 * | `contributionRegistry.register(manifest.id, …)`（index.ts:1011 / 2010 / 2477） | **`manifest.id`**，如 `ext-canary` |
 * | `ContributionRegistry` 的两级索引（contribution-registry.ts:277） | 同上，源码注释明写 `@param pluginId - The manifest.id` |
 * | `listContributions(pluginId)`（修复前的 index.ts:833） | 先 `resolvePluginUuid()` **转成 DB UUID**，再查 |
 *
 * `resolvePluginUuid()` 的职责是「把 manifest.id 别名解析为 DB 真实 UUID」（index.ts:928），
 * 而 `summary()` → `getByPlugin()` 是纯 `Map.get(pluginId)`（contribution-registry.ts:340），
 * **不做任何反向解析**。
 *
 * ⇒ 传 `manifest.id` 会被转成 UUID，再去查一个以 manifest.id 为键的 Map，**必然落空返回 `[]`**。
 * 这比原始描述更糟：不是「用 UUID 查会空」，而是**唯一语义正确的输入被主动改成了查不到的形式**；
 * 而 UUID 入参同样落空，因为根本没有「UUID → manifest.id」这一步。
 *
 * ## 为什么现有测试没发现
 *
 * `server/__tests__/canary/canary.step5.test.ts:311` 是全仓唯一一处调用点：
 *
 *   const contributions = host.listContributions('ext-canary');
 *   expect(Array.isArray(contributions) ? contributions.length : 0).toBe(0);
 *
 * 它断言的是**卸载之后**为 0 —— 无论查询正确命中空集合、还是查错键落空，
 * 结果都是 0。**这个断言无法区分「查到空」与「查不到」**，属空转断言。
 *
 * 本文件改为断言**非空**：先注册贡献再查，必须查得回来，键不匹配会立刻暴露。
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
} from '../../di/interfaces.js';
import { CommandBus } from '../../command-bus/index.js';
import { EventBus } from '../../event-bus/index.js';
import { ActionRegistry } from '../../registry/index.js';
import { CapabilityGuard } from '../../capability/index.js';

/** DB 主键故意与 manifest.id 不同 —— 这正是「UUID vs manifest.id」混淆的来源 */
const DB_UUID = '11111111-2222-3333-4444-555555555555';
const MANIFEST_ID = 'ext-contrib-probe';

const MANIFEST = {
  id: MANIFEST_ID,
  name: '贡献探针',
  version: '1.0.0',
  main: 'index.js',
  contributes: {
    dashboardWidgets: [{ id: 'w-probe', label: '探针挂件' }],
  },
};

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

function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, manifest TEXT NOT NULL,
      source_code TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL,
      loader_version TEXT, execution_mode TEXT,
      version TEXT, file_path TEXT
    );
  `);
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
  await sr.register(IStorageServiceToken, {
    get: async () => null,
    set: async () => {},
    delete: async () => {},
  } as any);
  await sr.register(IProcessServiceToken, {
    spawn: async () => 'proc-1',
    kill: async () => {},
    registerHandler: async () => {},
    unregisterHandler: async () => {},
    registerInterval: async () => 'int-1',
    restore: async () => {},
  } as any);
  await sr.register(IAIServiceToken, { generateText: async () => '' } as any);
  await sr.register(IPointsDimensionRegistryToken, {
    registerDimension: () => undefined,
    getDimension: () => undefined,
    listDimensions: () => [],
  } as any);
  await sr.register(IPointsLedgerServiceToken, {
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
  } as any);

  return sr;
}

describe('H-2 · listContributions 的键匹配（registry 以 manifest.id 为键）', () => {
  let db: Database.Database;
  let host: PluginHost;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-h2-'));
    db = new Database(':memory:');
    createTables(db);
    db.prepare(
      `INSERT INTO plugins (id, name, manifest, source_code, status, created_at, execution_mode)
       VALUES (?, ?, ?, ?, 'ACTIVE', ?, 'inline')`,
    ).run(DB_UUID, MANIFEST.name, JSON.stringify(MANIFEST), '// noop', Date.now());

    host = new PluginHost(await setupServiceRegistry(db), new TestEsmLoader(new Map()), db, tmpDir);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('前置事实：registry 的键是 manifest.id，不是 DB UUID', () => {
    // 若此用例失败，说明键的约定变了，本文件其余用例需重新解读
    host.contributions.register(MANIFEST_ID, MANIFEST.contributes);
    expect(host.contributions.summary(MANIFEST_ID).length, 'registry 应能以 manifest.id 命中').toBeGreaterThan(0);
    expect(host.contributions.summary(DB_UUID).length, 'registry 不应以 DB UUID 命中 —— 它的键是 manifest.id').toBe(0);
  });

  it('resolveManifestId 能把 DB 主键反查回 manifest.id（修复所依赖的反向解析）', () => {
    expect(host.resolveManifestId(DB_UUID), 'DB 主键应能反查回 manifest.id —— 这是本次修复的基础').toBe(MANIFEST_ID);
    // 已知的别名应原样返回（幂等）
    expect(host.resolveManifestId(MANIFEST_ID)).toBe(MANIFEST_ID);
    // 未知标识返回空串，不抛异常
    expect(host.resolveManifestId('nope-not-a-plugin')).toBe('');
  });

  it('listContributions(manifest.id) 必须查得到已注册的贡献', () => {
    host.contributions.register(MANIFEST_ID, MANIFEST.contributes);

    const result = host.listContributions(MANIFEST_ID) as Array<{ slot: string; count: number }>;

    // 关键断言：**非空**。修复前这里返回 []，而 canary.step5 的「卸载后为 0」对此完全无感。
    expect(Array.isArray(result), '应返回数组').toBe(true);
    expect(
      result.length,
      `listContributions('${MANIFEST_ID}') 返回空 —— 键不匹配：注册用 manifest.id，查询却先转成 UUID`,
    ).toBeGreaterThan(0);
    expect(result[0].slot).toBe('dashboardWidgets');
    expect(result[0].count).toBe(1);
  });

  it('listContributions(DB UUID) 同样查得到（两种输入形态都支持）', () => {
    host.contributions.register(MANIFEST_ID, MANIFEST.contributes);
    const byUuid = host.listContributions(DB_UUID) as Array<{ slot: string }>;
    expect(byUuid.length, `listContributions('${DB_UUID}') 返回空 —— UUID 输入未被映射回 manifest.id`).toBeGreaterThan(
      0,
    );
    expect(byUuid[0].slot).toBe('dashboardWidgets');
  });

  it('未注册贡献时返回空（修正确保不引入虚假命中）', () => {
    // 空结果仍须是「真的没有」，而不是「查错了键」——
    // 若修复写成无条件回落到某个键，这条会因拿到 manifest.id 的注册残留而红。
    expect(host.listContributions(MANIFEST_ID)).toEqual([]);
    expect(host.listContributions(DB_UUID)).toEqual([]);
  });
});
