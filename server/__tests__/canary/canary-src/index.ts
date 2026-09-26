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
        (rawDb as any)
          .prepare(`INSERT OR REPLACE INTO ${tbl} (id, mode, ok, expected, detail) VALUES (?,?,?,?,?)`)
          .run(id, mode, ok ? 1 : 0, expected, detail.slice(0, 2000));
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
    await probe('2.2-services', 'services 恰好 9 个键', () => {
      const keys = Object.keys(ctx.services).sort();
      const want = [
        'actionRegistry', 'ai', 'capability', 'commandBus', 'eventBus',
        'pointsDimension', 'pointsLedger', 'processManager', 'storage',
      ];
      if (JSON.stringify(keys) !== JSON.stringify(want)) throw new Error(keys.join(','));
      return `keys=9, pointsDimension=${(ctx.services as any).pointsDimension === null ? 'null' : 'set'}`;
    });
    await probe('4.1-ensure-table', '自建表创建成功且带前缀', () => {
      return ctx.db.table('probe_results');
    });

    // ── 2.5 Token 扫描（版本无关：枚举运行时 SDK 的 *Token 导出）──
    // IClassroomCountdownService 全环境无实现无注册（README §9.6）：无论其 Token
    // 是否存在于运行时 SDK，预期都是"解析被拒"。
    const sdkEntries = Object.entries(sdk as Record<string, unknown>).filter(
      ([k, v]) => k.endsWith('Token') && v !== null && typeof v === 'object' && typeof (v as any).name === 'string',
    );
    for (const [name, token] of sdkEntries) {
      const expectReject = name.includes('Countdown');
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
      await probe(`6-require:${m}`, '白名单外必须抛 Allowed modules', () => {
        try {
          ctx.require(m);
        } catch (e: any) {
          return `rejected:${e?.message ?? e}`; // 预期拒绝 → 正常返回，detail 留给断言比对
        }
        throw new Error('unexpectedly required'); // 未拒绝 = 不符合预期
      });
    }

    // ── 阶段 3：命令与事件 ──
    await (ctx.services.commandBus as any).registerHandler('canary.ping', async (cmd: any) => {
      return { pong: true, mode, src: cmd?.payload?.src ?? 'direct' };
    });
    await ctx.services.eventBus.subscribe('lesson.created', () => {
      eventCount += 1;
    });

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
  },
};
