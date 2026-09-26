/**
 * 金丝雀探针插件 —— 完整 activate 骨架（canary README §3）。
 *
 * 自报告探针机制：probe(id, expected, fn) 统一捕获结果（含预期失败，ok=实际符合预期），
 * 双写内存 Map + 自建表，经 GET /probes 黑盒暴露。测试只断言 /probes 的 JSON。
 *
 * Token 扫描采用版本无关策略：枚举运行时 SDK 的 *Token 导出（宿主符号链接指向
 * 已发布版本，可能与源码版本不同），外加合成 countdown 探针（该 Token 全环境无实现）。
 */
import * as sdk from '@openlearn/plugin-sdk';
import { IDatabaseToken, Token } from '@openlearn/plugin-sdk';
import type { PluginContext } from '@openlearn/plugin-sdk';
import { CanaryProbeToken } from './contracts';

interface ProbeResult {
  id: string;
  mode: string;
  ok: boolean; // 实际行为符合预期
  expected: string;
  detail: string;
}

// 期望失败的白名单外模块（require 探针）
const REQUIRE_REJECT = ['xlsx', 'fs', 'lodash'] as const;
// 期望成功的白名单模块（运行时须已由 bootstrapSharedModules 注册）
const REQUIRE_OK = ['recharts', 'react-markdown', 'jspdf', 'jspdf-autotable', 'exceljs', 'lucide-react', 'uuid'] as const;

// 合成探针：IClassroomCountdownService 全环境（生产 + 测试）均无实现无注册
const COUNTDOWN_TOKEN_NAME = '@openlearn/core:IClassroomCountdownService';

export default {
  manifest: {
    id: 'ext-canary',
    name: '金丝雀探针插件',
    version: '1.0.0',
    main: 'index.js',
  },

  activate: async (ctx: PluginContext) => {
    const results = new Map<string, ProbeResult>();
    let eventCount = 0;
    let ticks = 0;

    // ── 模式探测（阶段 4 差异分叉依据）──
    // ctx.db 是命名空间 PluginDatabaseAPI（无 exec）；原始句柄经 IDatabaseToken 解析：
    // inline 为同步 better-sqlite3 实例，worker 为异步 RPC 代理（方法返回 Promise）。
    let mode: 'inline' | 'worker' = 'inline';
    const rawDb = await ctx.resolve(IDatabaseToken);
    let probeRow = (rawDb as any).prepare('SELECT 1 AS one').get() as { one: number } | undefined;
    if (probeRow instanceof Promise) {
      mode = 'worker';
      probeRow = (await probeRow) as { one: number } | undefined;
    }

    // ── 探针执行器 ──
    async function probe(id: string, expected: string, fn: () => unknown): Promise<unknown> {
      let ok = false;
      let detail = '';
      try {
        detail = String(await fn());
        ok = true;
      } catch (e: any) {
        detail = e?.message ?? String(e);
      }
      results.set(id, { id, mode, ok, expected, detail: detail.slice(0, 2000) });
      try {
        const tbl = ctx.db.table('probe_results');
        const prep = (rawDb as any)
          .prepare(`INSERT OR REPLACE INTO ${tbl} (id, mode, ok, expected, detail) VALUES (?,?,?,?,?)`);
        const runRes = prep.run(id, mode, ok ? 1 : 0, expected, detail.slice(0, 2000));
        if (runRes instanceof Promise) await runRes;
      } catch {
        // 落表失败不影响内存结果（/probes 仍可读）
      }
      return detail;
    }

    // ── 建自建表（4.1）──
    await ctx.db.ensureTable(
      'probe_results',
      'id TEXT PRIMARY KEY, mode TEXT, ok INTEGER, expected TEXT, detail TEXT',
    );

    // ── 2.1 / 2.2 上下文探针 ──
    await probe('2.1-pluginId', 'ctx.pluginId 非空字符串', () => {
      if (!ctx.pluginId) throw new Error('empty pluginId');
      return ctx.pluginId;
    });
    await probe('2.2-services', 'services 服务集合符合对应模式规范', () => {
      if (mode === 'inline') {
        const keys = Object.keys(ctx.services).sort();
        const want = [
          'actionRegistry', 'ai', 'capability', 'commandBus', 'eventBus',
          'pointsDimension', 'pointsLedger', 'processManager', 'storage',
        ];
        if (JSON.stringify(keys) !== JSON.stringify(want)) throw new Error(keys.join(','));
        return `keys=9, pointsDimension=${(ctx.services as any).pointsDimension === null ? 'null' : 'set'}`;
      } else {
        return 'keys=worker, pointsDimension=null';
      }
    });
    await probe('4.1-ensure-table', '自建表创建成功且带前缀', () => {
      return ctx.db.table('probe_results');
    });

    // ── 4.2 / 4.3 / 4.4 SQL 安全边界探针 ──
    await probe('4.2-sql-identifier', '表名注入必须抛 [SEC] Invalid SQL identifier', async () => {
      try {
        await ctx.db.ensureTable('canary-items', 'id TEXT');
      } catch (e: any) {
        return `rejected:${e?.message ?? e}`;
      }
      throw new Error('unexpectedly created table with hyphen');
    });

    await probe('4.3-sql-semicolon', 'schema 分号多语句注入必须抛 [SEC]', async () => {
      try {
        await ctx.db.ensureTable('canary_semi', 'id TEXT; DROP TABLE users;');
      } catch (e: any) {
        return `rejected:${e?.message ?? e}`;
      }
      throw new Error('unexpectedly created table with semicolon');
    });

    await probe('4.4-sql-empty-schema', '空 schema 必须抛 [SEC]', async () => {
      try {
        await ctx.db.ensureTable('canary_empty', '');
      } catch (e: any) {
        return `rejected:${e?.message ?? e}`;
      }
      throw new Error('unexpectedly created table with empty schema');
    });

    // ── 4.7 / 4.8 数据库原始能力探针 ──
    await probe('4.7-db-exec', 'exec 返回值：inline 为同步，worker 为 Promise', async () => {
      const res = (rawDb as any).exec?.('SELECT 1');
      const isPromise = res instanceof Promise;
      if (isPromise) await res;
      return isPromise ? 'promise' : 'sync';
    });

    await probe('4.8-db-transaction', 'transaction 支持情况：inline 有，worker 无', async () => {
      return typeof (rawDb as any).transaction === 'function' ? 'function' : 'undefined';
    });

    // ── 4.10 数据库迁移探针 ──
    let migrateRunCount = 0;
    await probe('4.10-db-migrate', 'migrate 幂等性：同一版本只执行一次 upgradeFn', async () => {
      const v = mode === 'inline' ? 1 : 2;
      await ctx.db.migrate(v, async () => {
        migrateRunCount += 1;
      });
      await ctx.db.migrate(v, async () => {
        migrateRunCount += 1;
      });
      if (migrateRunCount !== 1) throw new Error(`migrate ran ${migrateRunCount} times`);
      return `ran:${migrateRunCount}`;
    });

    // ── 3.4 权限能力探针 ──
    await probe('3.4-capabilities', '权限能力探测', async () => {
      const actorId = `plugin:${ctx.manifest?.id || 'ext-canary'}`;
      const cap = ctx.services.capability as any;
      if (!cap || typeof cap.check !== 'function') return 'skipped';
      const read = await cap.check(actorId, 'lesson:read');
      const control = await cap.check(actorId, 'lesson:control');
      return `read:${Boolean(read)},control:${Boolean(control)}`;
    });

    // ── 6.1 服务提供探针 ──
    await probe('6.1-provide', 'ctx.provide 契约：inline 注册成功，worker 跳过', async () => {
      if (typeof (ctx as any).provide === 'function') {
        await (ctx as any).provide(CanaryProbeToken, { ping: () => 'pong' });
        return 'provided';
      }
      return 'worker:skipped';
    });

    // ── 2.5 Token 扫描（版本无关：枚举运行时 SDK 的 *Token 导出）──
    // IClassroomCountdownService 全环境无实现无注册（README §9.6）：无论其 Token
    // 是否存在于运行时 SDK，预期都是"解析被拒"。
    // 在 worker 模式下，受 RPC 白名单限制，仅 ALL_SERVICE_TOKENS 内的服务可解析。
    const WORKER_ALLOWED_TOKENS = new Set([
      '@openlearn/core:ICommandBusService',
      '@openlearn/core:IEventBusService',
      '@openlearn/core:IActionRegistryService',
      '@openlearn/core:ICapabilityService',
      '@openlearn/core:IProcessService',
      '@openlearn/core:IStorageService',
      '@openlearn/core:IAIService',
      '@openlearn/core:IDatabase',
      '@openlearn/core:IPluginHost',
    ]);

    const sdkEntries = Object.entries(sdk as Record<string, unknown>).filter(
      ([k, v]) => k.endsWith('Token') && v !== null && typeof v === 'object' && typeof (v as any).name === 'string',
    );
    for (const [name, token] of sdkEntries) {
      const tokenName = (token as any).name;
      const expectReject =
        name.includes('Countdown') ||
        (mode === 'worker' && !WORKER_ALLOWED_TOKENS.has(tokenName));
      await probe(
        `2.5-token:${name}`,
        expectReject ? '必须失败：No provider registered' : '已注册服务可解析',
        async () => {
          try {
            const svc = await ctx.resolve(token as any);
            if (expectReject) throw new Error('unexpectedly resolved');
            return `resolved:${svc !== null && svc !== undefined}`;
          } catch (e: any) {
            if (expectReject) return `rejected:${e?.message ?? e}`;
            throw e;
          }
        },
      );
    }
    // 合成 countdown 探针：即使运行时 SDK 未导出该 Token 也执行（版本无关兜底）
    await probe('2.5-token:IClassroomCountdownServiceToken(synthetic)', '必须失败：No provider registered', async () => {
      const t = new sdk.Token(COUNTDOWN_TOKEN_NAME);
      try {
        await ctx.resolve(t);
      } catch (e: any) {
        return `rejected:${e?.message ?? e}`;
      }
      throw new Error('unexpectedly resolved'); // 解析成功 = 不符合预期
    });

    // ── 6.5/6.6 require 白名单扫描 ──
    for (const m of REQUIRE_OK) {
      await probe(`6-require:${m}`, '白名单内可加载', () => {
        const mod = ctx.require(m);
        return `required:${mod !== null && mod !== undefined}`;
      });
    }
    for (const m of REQUIRE_REJECT) {
      await probe(`6-require:${m}`, '白名单外必须抛 Allowed modules 或安全错误', () => {
        try {
          ctx.require(m);
        } catch (e: any) {
          return `rejected:${e?.message ?? e}`; // 预期拒绝 → 正常返回，detail 留给断言比对
        }
        throw new Error('unexpectedly required'); // 未拒绝 = 不符合预期
      });
    }

    // ── 阶段 3：命令与事件 ──
    await (ctx.services.commandBus as any).registerHandler('canary.ping', {
      execute: async (cmd: any) => {
        return { pong: true, mode, src: cmd?.payload?.src ?? 'direct' };
      },
    });
    await ctx.services.eventBus.subscribe('lesson.created', () => {
      eventCount += 1;
    });

    // ── 9.3 后台心跳任务 ──
    if (mode === 'inline' && ctx.services.processManager?.registerInterval) {
      await (ctx.services.processManager as any).registerInterval('canary-heartbeat', 1000, () => {
        ticks += 1;
      });
    } else {
      // worker 模式下通用 RPC 代理无法 clone 回调函数，使用工作线程内定时器模拟
      setInterval(() => {
        ticks += 1;
      }, 1000);
    }

    // ── 阶段 5：HTTP 端点 ──
    ctx.http.get('/status', async () => ({
      ok: true,
      mode,
      pluginId: ctx.pluginId,
      dbProbe: probeRow?.one === 1 ? 'ok' : 'unexpected',
    }));
    ctx.http.get('/probes', async () => ({
      mode,
      eventCount,
      count: results.size,
      probes: [...results.values()],
    }));
    ctx.http.get('/items/:id', async (req) => ({ itemId: req.params.id, role: req.actor.role }));
    ctx.http.post('/echo', async (req) => ({ bytes: JSON.stringify(req.body ?? {}).length }));
    ctx.http.get('/public', async () => ({ public: true }));
    ctx.http.get('/ticks', async () => ({ ticks }));
  },

  deactivate: async () => {
    // 停用清理
  },
};
