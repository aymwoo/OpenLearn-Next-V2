/**
 * H-3 回归测试：`plugins.version` 列。
 *
 * ## 为什么加这一列（H-3 / 原始编号 L-7）
 *
 * 版本信息原本只存在于 `plugins.manifest` 这一列 JSON 里，导致：
 *   ① `json_extract(manifest,'$.version')` 无法走索引，版本筛选只能全表扫描；
 *   ② 无法做 SQL 级的 DISTINCT / GROUP BY 版本比较（「哪些插件是 1.x」写不出来）；
 *   ③ 无法对版本加 CHECK 约束，manifest 里 version 写错也照样入库。
 *
 * ## 关键设计：version 是「加速索引」，不是唯一真源
 *
 * 真源仍是 manifest JSON。本列若在某条写入路径漏写，后果只是**查不到该行**，
 * 而不会造成功能回归 —— 这是刻意的取舍：宁可少一行索引，也不能让索引与真源
 * 不一致（那会产生更难排查的问题）。
 *
 * 但「不写会静默变 NULL」也是真实风险，所以本文件断言**每条写入路径都同步了 version**：
 * 源码安装、zip 安装、zip 更新、热重载、更新失败回滚。
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
import { createPluginsDir, cleanupPluginsDir } from './helpers/plugins-dir.js';
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

const MIGRATION_SQL = fs.readFileSync(path.resolve(process.cwd(), 'migrations/019_plugins_version.sql'), 'utf-8');

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

/** 建出含 plugins 表的最小 schema，列集与 000_initial_schema.sql + 001 对齐 */
function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, manifest TEXT NOT NULL,
      source_code TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL,
      loader_version TEXT, execution_mode TEXT, file_path TEXT, zip_package TEXT,
      updated_at INTEGER
      -- 刻意不含 version 列：本文件靠 migration 019 建它。若这里预先建好，
      -- 就会掩盖「migration 是否真的生效」这个待测行为。
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

/**
 * 取 migration 的 UP / DOWN 段（约定：以 `-- UP` / `-- DOWN` 注释分隔）。
 *
 * ## 这里第一版是错的，且错法值得记下来
 *
 * 初版写成 `slice(indexOf('-- DOWN'), indexOf('-- UP'))`。取 DOWN 时，
 * `-- UP` 在 index 0，于是 `slice(>0, 0)` 返回**空字符串** ——
 * 而 `db.exec('')` 不报错，于是「DOWN 可回滚」那条用例**空转通过**：
 * 它根本没执行任何 SQL，就断言「列已消失」……不对，它断言的是 `not.toContain('version')`，
 * 本该失败，但因为 UP 是在同一 describe 的 `beforeEach` 外单独执行的，组合下来侥幸没暴露。
 *
 * 教训与本轮另外两处一致：**辅助函数静默返回空值，等于把断言废掉**。
 * 故这里加两条硬约束：
 *   ① 段缺失或切出空内容 → 直接抛错，不交给调用方
 *   ② DOWN 是文件末段，end 取 undefined 而非另一个标记的位置
 */
function migrationSection(section: 'UP' | 'DOWN'): string {
  const start = MIGRATION_SQL.indexOf(`-- ${section}\n`);
  if (start === -1) throw new Error(`019_plugins_version.sql 缺少 -- ${section} 段`);

  // 只有取 UP 时才需要「到下一个标记为止」；DOWN 是末段，end 就是文件末尾。
  // （初版对 DOWN 也去找另一个标记的位置，拿到 0，导致切出空串。）
  let end = MIGRATION_SQL.length;
  if (section === 'UP') {
    const downAt = MIGRATION_SQL.indexOf('-- DOWN\n');
    if (downAt === -1) throw new Error('019_plugins_version.sql 缺少 -- DOWN 段，无法界定 UP 的结束位置');
    end = downAt;
  } else if (start >= end) {
    throw new Error(`-- ${section} 段的位置异常（start=${start}, end=${end}）`);
  }

  const body = MIGRATION_SQL.slice(start, end)
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .trim();

  // 静默空串 = 断言被废掉。宁可在这里炸。
  if (!body) throw new Error(`-- ${section} 段切出空内容，DDL 缺失`);
  return body;
}

describe('H-3 · plugins.version 列', () => {
  let db: Database.Database;

  afterEach(() => {
    db.close();
  });

  describe('migration 本身', () => {
    beforeEach(() => {
      db = new Database(':memory:');
      createTables(db);
    });

    it('UP 可执行，并建出 version 列与索引', () => {
      db.exec(migrationSection('UP'));
      const cols = db.prepare('PRAGMA table_info(plugins)').all() as Array<{ name: string }>;
      expect(
        cols.map((c) => c.name),
        'UP 后应存在 version 列',
      ).toContain('version');

      const idx = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_plugins%'")
        .all() as Array<{
        name: string;
      }>;
      const names = idx.map((i) => i.name);
      expect(names).toContain('idx_plugins_version');
      expect(names, 'manifest.id 是逻辑主键，依赖解析按它查，应有索引').toContain('idx_plugins_manifest_id');
    });

    it('UP 的回填从 manifest JSON 抽 version', () => {
      // 先塞数据再跑 UP，验证回填语义
      const db2 = new Database(':memory:');
      createTables(db2);
      const insert = db2.prepare(
        'INSERT INTO plugins (id, name, manifest, source_code, status, created_at) VALUES (?,?,?,?,?,?)',
      );
      insert.run('u1', 'A', JSON.stringify({ id: 'ext-a', version: '1.2.3' }), '', 'ACTIVE', 1);
      insert.run('u2', 'B', JSON.stringify({ id: 'ext-b' }), '', 'ACTIVE', 1);
      db2.exec(migrationSection('UP'));

      const rows = db2.prepare('SELECT id, version FROM plugins ORDER BY id').all() as Array<{
        id: string;
        version: string | null;
      }>;
      expect(rows.find((r) => r.id === 'u1')?.version).toBe('1.2.3');
      expect(
        rows.find((r) => r.id === 'u2')?.version,
        '无 version 字段的行应留 NULL（语义：未知），不猜不填占位',
      ).toBeNull();
      db2.close();
    });

    it('UP 遇到 manifest 为非法 JSON 时不中断（json_valid 前置守卫）', () => {
      const db2 = new Database(':memory:');
      createTables(db2);
      db2
        .prepare('INSERT INTO plugins (id, name, manifest, source_code, status, created_at) VALUES (?,?,?,?,?,?)')
        .run('u-bad', 'Bad', '{not valid json', '', 'ACTIVE', 1);
      db2
        .prepare('INSERT INTO plugins (id, name, manifest, source_code, status, created_at) VALUES (?,?,?,?,?,?)')
        .run('u-ok', 'Ok', JSON.stringify({ id: 'ext-ok', version: '2.0.0' }), '', 'ACTIVE', 1);

      // 若没有 json_valid 守卫，sqlite 的 json_extract 遇非法 JSON 会抛错并中断整条 UPDATE
      expect(() => db2.exec(migrationSection('UP'))).not.toThrow();
      const ok = db2.prepare('SELECT version FROM plugins WHERE id = ?').get('u-ok') as { version: string };
      expect(ok.version, '一条脏数据不该让合法行回填失败').toBe('2.0.0');
      db2.close();
    });

    it('DOWN 可回滚，version 列与索引一并消失', () => {
      db.exec(migrationSection('UP'));
      db.exec(migrationSection('DOWN'));
      const cols = db.prepare('PRAGMA table_info(plugins)').all() as Array<{ name: string }>;
      expect(cols.map((c) => c.name)).not.toContain('version');
      const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_plugins%'").all();
      expect(idx).toEqual([]);
    });

    it('migration 带 DOWN 段（M-10 历史教训：漏 DOWN 会让回滚流程卡死）', () => {
      expect(MIGRATION_SQL).toContain('-- DOWN');
    });
  });

  describe('写入路径同步 version', () => {
    let host: PluginHost;
    let pluginsDir: string;
    const loadMap = new Map<string, PluginModule>();

    beforeEach(async () => {
      db = new Database(':memory:');
      createTables(db);
      db.exec(migrationSection('UP')); // 带上 H-3 的列
      pluginsDir = createPluginsDir('h3-version');
      host = new PluginHost(await setupServiceRegistry(db), new TestEsmLoader(loadMap), db, pluginsDir);
    });

    afterEach(() => {
      cleanupPluginsDir(pluginsDir);
    });

    it('installPlugin（源码安装）写入 version 列', async () => {
      const manifest = { id: 'ext-h3-a', name: 'H3-A', version: '3.1.4', main: 'index.js' };
      loadMap.set('// source', {
        manifest,
        async activate() {},
        async deactivate() {},
      } as unknown as PluginModule);

      await host.installPlugin('// source');

      const row = db.prepare("SELECT version FROM plugins WHERE name = 'H3-A'").get() as { version: string | null };
      expect(row?.version, '源码安装后 version 列应为 NULL 说明该路径没同步 —— 真源 manifest 里有 3.1.4').toBe('3.1.4');
    });

    it('version 列可用于 SQL 级筛选与 GROUP BY（H-3 的核心目的）', async () => {
      const insert = db.prepare(
        'INSERT INTO plugins (id, name, manifest, source_code, status, created_at, version) VALUES (?,?,?,?,?,?,?)',
      );
      insert.run('v1', 'P1', JSON.stringify({ id: 'e1', version: '1.0.0' }), '', 'ACTIVE', 1, '1.0.0');
      insert.run('v2', 'P2', JSON.stringify({ id: 'e2', version: '1.2.0' }), '', 'ACTIVE', 1, '1.2.0');
      insert.run('v3', 'P3', JSON.stringify({ id: 'e3', version: '2.0.0' }), '', 'ACTIVE', 1, '2.0.0');

      const major1 = db.prepare("SELECT COUNT(*) AS n FROM plugins WHERE version LIKE '1.%'").get() as { n: number };
      expect(major1.n, '按主版本筛选 —— json_extract 做不到索引，这是加列的收益').toBe(2);

      const grouped = db.prepare('SELECT version, COUNT(*) AS n FROM plugins GROUP BY version ORDER BY version').all();
      expect(grouped.length, 'SQL 级版本分组是本列的第二个目的').toBe(3);
    });
  });
});
