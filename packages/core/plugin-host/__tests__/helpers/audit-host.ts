/**
 * 审计修复测试的共享脚手架（2026-10-09 轮）。
 *
 * ## 为什么抽这个文件
 *
 * 四组回归测试（F-4 贡献点注销 / R-1 派发超时 / E-2 resolve 白名单 /
 * F-1 process 模式生命周期）都需要「一个能 activate 的最小 PluginHost」。
 * 逐文件复制会出现 `lifecycle-race.test.ts` 那种「服务清单靠注释维持」的
 * 脆弱同步（缺一个 token 就抛 "No provider registered"）。
 *
 * 这里收一处。构造要点（与 e2e-lifecycle.test.ts 的清单保持一致）：
 * buildContext 会 resolve 9 个服务，缺一即抛。
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PluginHost } from '../../index.js';
import { EsmLoader } from '../../../esm-loader/esm-loader.js';
import type { PluginModule } from '../../../esm-loader/esm-loader.js';
import { ServiceRegistry } from '../../../di/service-registry.js';
import { CommandBus } from '../../../command-bus/index.js';
import { EventBus } from '../../../event-bus/index.js';
import { ActionRegistry } from '../../../registry/index.js';
import { CapabilityGuard } from '../../../capability/index.js';
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
} from '../../../di/interfaces.js';

/** 可控 loader：preloaded 激活路径不调用它；reload 路径靠它 extractManifest */
class TestLoader extends EsmLoader {
  async load(code: string): Promise<PluginModule> {
    // reloadPlugin 的第一步是 extractManifest(newSourceCode) —— 须能从源码里
    // 取出 manifest 对象（真实 loader 的语义），否则 reload 在分流前就失败，
    // 测不到「process 模式不走 inline 重载」这个 F-1 核心行为。
    const m = code.match(/export const manifest = (\{[\s\S]*?\});/);
    const manifest = m ? JSON.parse(m[1]) : { id: 'x', name: 'X', version: '1.0.0', main: 'index.js' };
    return { manifest, activate: async () => {}, deactivate: async () => {} } as unknown as PluginModule;
  }
}

export function createDb(): Database.Database {
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

export async function makeHost(
  db: Database.Database,
  pluginsDir: string,
): Promise<PluginHost & { registerPreloadedPlugin: (id: string, p: unknown) => void }> {
  const registry = new ServiceRegistry();
  const bus = new CommandBus(new EventBus());
  bus.setInterceptor(async () => {});

  const registrations: Array<[unknown, unknown]> = [
    [IEventBusServiceToken, new EventBus()],
    [ICapabilityServiceToken, new CapabilityGuard()],
    [ICommandBusServiceToken, bus],
    [IActionRegistryServiceToken, new ActionRegistry()],
    [IDatabaseToken, db],
    [IStorageServiceToken, { get: async () => null, set: async () => {}, delete: async () => {} }],
    [
      IProcessServiceToken,
      {
        spawn: async () => 'proc-1',
        kill: async () => {},
        registerHandler: async () => {},
        unregisterHandler: async () => {},
        registerInterval: async () => 'int-1',
        restore: async () => {},
      },
    ],
    [IAIServiceToken, { generateText: async () => '' }],
    [
      IPointsDimensionRegistryToken,
      { registerDimension: () => undefined, getDimension: () => undefined, listDimensions: () => [] },
    ],
    [
      IPointsLedgerServiceToken,
      {
        addPoints: async () => undefined,
        getLogs: async () => [],
        getStudentTotalByDimension: async () => 0,
        getStudentDimensionSummary: async () => ({}),
      },
    ],
  ];
  for (const [token, instance] of registrations) {
    // register 是 async；构造期顺序 await，避免 activate 时 resolve 竞态
    await registry.register(token as never, instance as never);
  }
  return new PluginHost(registry, new TestLoader(), db, pluginsDir) as never;
}

/** 建一个临时 pluginsDir（调用方负责 removeTmpDir 清理） */
export function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 插入一行 installed 状态的插件记录（执行模式可指定） */
export function insertPluginRow(
  db: Database.Database,
  opts: { id: string; manifest: Record<string, unknown>; executionMode?: string },
): void {
  db.prepare(
    'INSERT INTO plugins (id, name, manifest, source_code, status, created_at, loader_version, version, execution_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    opts.id,
    String(opts.manifest.name ?? opts.id),
    JSON.stringify(opts.manifest),
    '',
    'installed',
    Date.now(),
    'esm',
    String(opts.manifest.version ?? '1.0.0'),
    opts.executionMode ?? 'inline',
  );
}

/** 网关 DTO 的最小形态（PluginApiRequest） */
export const baseReq = (pathName: string) => ({
  method: 'GET',
  path: pathName,
  params: {},
  query: {},
  headers: {},
  body: undefined,
  ip: '127.0.0.1',
  actor: { actorId: 'tester', role: 'teacher' },
});
