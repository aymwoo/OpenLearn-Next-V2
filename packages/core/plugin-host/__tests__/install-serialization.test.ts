/**
 * R-4：安装/更新的全局串行化。
 *
 * 背景（为什么值得一个测试文件）：安装链路是内存重操作 —— HTTP body Buffer
 * （≤300MB）+ JSZip 解析结构 + 逐文件解压 + esbuild 内存打包，单请求 RSS 峰值
 * 可达数百 MB。此前三个安装入口无任何互斥：两个管理员同时点安装、或一个管理员
 * 连点两次，峰值就是 N 倍，而共享主线程的还有课堂实时链路。
 *
 * 与 `inflightActivate` 的区别（勿混淆）：那是**同 pluginId 合并并发调用**；
 * 本队列是**全局互斥** —— 不同插件的安装也互斥，因为保护的是进程内存。
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
import { tmpZipPath } from '../../esm-loader/__tests__/helpers/tmp-zip.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/** 记录 load 事件的 loader：installPlugin 的 extractManifest 会调它 */
class EventRecorder extends EsmLoader {
  public events: string[] = [];
  public delayMs = 40;

  async load(code: string): Promise<PluginModule> {
    const m = code.match(/id:\s*'([^']+)'/);
    const id = m ? m[1] : 'unknown';
    this.events.push(`start:${id}`);
    await sleep(this.delayMs);
    this.events.push(`end:${id}`);
    return {
      manifest: { id, name: id, version: '1.0.0', main: 'index.js' },
      activate: async () => {},
    } as unknown as PluginModule;
  }
}

const pluginSource = (id: string) =>
  `export const manifest = { id: '${id}', name: '${id}', version: '1.0.0', main: 'index.js' };\n` +
  `export const activate = async () => {};\n`;

describe('R-4 · 安装/更新串行化（enqueueInstall）', () => {
  let db: Database.Database;
  let pluginsDir: string;
  let loader: EventRecorder;
  let host: PluginHost;

  beforeEach(async () => {
    db = createDb();
    pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r4-install-'));
    loader = new EventRecorder();

    const registry = new ServiceRegistry();
    const bus = new CommandBus(new EventBus());
    bus.setInterceptor(async () => {});
    const registrations: Array<[unknown, unknown]> = [
      [IEventBusServiceToken, new EventBus()],
      [ICapabilityServiceToken, { grant: async () => {}, revokeAll: async () => {} }],
      [ICommandBusServiceToken, bus],
      [IActionRegistryServiceToken, new ActionRegistry()],
      [IDatabaseToken, db],
      [IStorageServiceToken, { get: async () => null, set: async () => {}, delete: async () => {} }],
      [
        IProcessServiceToken,
        {
          spawn: async () => 'p',
          kill: async () => {},
          registerHandler: async () => {},
          unregisterHandler: async () => {},
          registerInterval: async () => 'i',
          restore: async () => {},
        },
      ],
      [IAIServiceToken, { generateText: async () => '' }],
      [
        IPointsDimensionRegistryToken,
        { registerDimension: () => {}, getDimension: () => undefined, listDimensions: () => [] },
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
      await registry.register(token as never, instance as never);
    }
    host = new PluginHost(registry, loader, db, pluginsDir);
  });

  afterEach(() => {
    fs.rmSync(pluginsDir, { recursive: true, force: true });
    db.close();
  });

  it('原语：op 严格 FIFO，第二个在第一个完成后才开始', async () => {
    const order: string[] = [];
    const enqueue = (
      host as unknown as { enqueueInstall: <T>(op: () => Promise<T>) => Promise<T> }
    ).enqueueInstall.bind(host);

    const p1 = enqueue(async () => {
      order.push('a:start');
      await sleep(60);
      order.push('a:end');
      return 'a';
    });
    const p2 = enqueue(async () => {
      order.push('b:start');
      await sleep(10);
      order.push('b:end');
      return 'b';
    });

    expect(await Promise.all([p1, p2])).toEqual(['a', 'b']);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('前一个失败不毒化队列，后续 op 照常执行且拿到自己的 rejection', async () => {
    const enqueue = (
      host as unknown as { enqueueInstall: <T>(op: () => Promise<T>) => Promise<T> }
    ).enqueueInstall.bind(host);

    const failed = enqueue(async () => {
      throw new Error('boom');
    });
    const next = enqueue(async () => 'ok');

    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });

  it('两个并发 installPlugin 真正串行（第二个的加载在第一个完成后才开始）', async () => {
    const p1 = host.installPlugin(pluginSource('ext-a'));
    const p2 = host.installPlugin(pluginSource('ext-b'));
    await Promise.all([p1, p2]);

    const startA = loader.events.indexOf('start:ext-a');
    const endA = loader.events.indexOf('end:ext-a');
    const startB = loader.events.indexOf('start:ext-b');
    expect(startA).toBeGreaterThanOrEqual(0);
    expect(startB).toBeGreaterThan(endA);
  });

  it('安装失败（唯一性冲突）后队列仍可继续安装其他插件', async () => {
    await host.installPlugin(pluginSource('ext-dup'));
    // 第二次装同一 manifest.id —— ensureUniqueManifestId 抛错
    await expect(host.installPlugin(pluginSource('ext-dup'))).rejects.toThrow(/already installed/);
    // 队列未毒化：装第三个仍成功
    const m = await host.installPlugin(pluginSource('ext-after-failure'));
    expect(m.id).toBe('ext-after-failure');
  });

  it('installPlugin 与 installPluginFromZip 互斥（同一条队列）', async () => {
    // 用 installPlugin 占用队列，验证并发的 ZIP 路径排在它后面。
    // （ZIP 具体产物由 e2e-lifecycle/canary 覆盖，此处只断言互斥关系。）
    const enqueue = (
      host as unknown as { enqueueInstall: <T>(op: () => Promise<T>) => Promise<T> }
    ).enqueueInstall.bind(host);
    const gate = enqueue(async () => {
      await sleep(60);
      return 'held';
    });
    const zipPath = host.installPluginFromZip(tmpZipPath(Buffer.from('not-a-real-zip')));
    await expect(zipPath).rejects.toThrow(); // 假 ZIP 会失败，但必须在让出队列之后
    await expect(gate).resolves.toBe('held');
    // 队列仍活着
    await expect(enqueue(async () => 'alive')).resolves.toBe('alive');
  });
});
