/**
 * @vitest-environment node
 *
 * 测试库与本地开发库的物理隔离（Issue #194，防退化）。
 *
 * ## 背景
 *
 * `dbPath` 的解析原先让 `process.env.OPENLEARN_DB_PATH` **优先于** `process.env.VITEST`。
 * 本地 `.env` 恰好声明了 `OPENLEARN_DB_PATH=<repo>/packages/core/db/educational_os.db`，
 * 而 `dotenv` 不覆写已存在的键 —— 于是任何把 `.env` 灌进 `process.env` 的路径
 * （`server.ts` 的 `dotenv.config()`、开发者 `export`、`pnpm dev` 继承的环境）
 * 都会让测试写进**真实开发库**。
 *
 * 实测后果：`plugin-audit-poc.test.ts` 里 `new Kernel(...)` 触发高危命令拦截，
 * `audit.poc.highrisk.*` 被永久留在开发库的 `pending_commands` 表里，后台待审批列表
 * 挂着一条既批不掉也删不掉的死项；而 `pnpm test` 依旧全绿，没有任何失败信号。
 *
 * ## 两道防线（本文件各锁一条）
 *
 * 1. `vitest.setup.ts` 在任何测试模块之前把 `OPENLEARN_DB_PATH` / `OPENLEARN_DATA_DIR`
 *    重定向到临时目录；
 * 2. `packages/core/db/index.ts` 里 `VITEST` 分支优先于 `OPENLEARN_DB_PATH` ——
 *    即使第一道被绕过（例如某测试自己 `dotenv.config()` 之后才动态 import db），
 *    测试进程仍然不可能落到真实数据目录。
 */
import { describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';

/** 仓库里的本地开发库（`.env` 的默认指向）。测试一旦写到它就是事故。 */
const DEV_DB = path.resolve(process.cwd(), 'packages/core/db/educational_os.db');

const TEST_DB_DIR = path.join(os.tmpdir(), 'openlearn_test_dbs');

describe('Vitest 与本地开发库物理隔离', () => {
  it('vitest.setup.ts 清除继承的 OPENLEARN_DB_PATH（防第一道防线退化）', () => {
    // 开发机的 .env 会声明这个变量；setup 必须把它清掉，否则 db 模块会直接用它。
    expect(process.env.OPENLEARN_DB_PATH).toBeUndefined();

    // 数据目录同属一条隔离链，必须落在临时目录而不是仓库里。
    const dataDir = process.env.OPENLEARN_DATA_DIR;
    expect(dataDir, 'vitest.setup.ts 必须把 OPENLEARN_DATA_DIR 指到临时目录').toBeTruthy();
    expect(path.resolve(String(dataDir)).startsWith(os.tmpdir())).toBe(true);
  });

  it('清掉的 OPENLEARN_DB_PATH 不会被写回（cli-cleaner 一类的读者靠这个前提工作）', () => {
    // 回归：曾把该变量“改写成临时库路径”，导致 cli-cleaner.test.ts 的 dbPath
    // 解析跑到无关文件上，三条用例变红。清除才是对的语义。
    expect(process.env.OPENLEARN_DB_PATH).toBeUndefined();
  });

  it('db 单例的路径落在临时目录，绝不是仓库里的 educational_os.db', async () => {
    const { getDbPath } = await import('../index.js');
    const resolved = path.resolve(getDbPath());

    expect(resolved).not.toBe(DEV_DB);
    expect(resolved.startsWith(os.tmpdir())).toBe(true);
    expect(path.dirname(resolved)).toBe(TEST_DB_DIR);
  });

  it('库文件名带 pool id 与 pid（进程级唯一，新 run 天然拿到空库）', async () => {
    const { getDbPath } = await import('../index.js');
    const poolId = process.env.VITEST_POOL_ID || '1';
    // 回归：曾只用 pool id 命名，而 pool id 会跨进程世代复用 —— 两个世代共享同一库文件
    // 并同时跑迁移，实测报 `UNIQUE constraint failed: _migrations.name`。
    expect(path.basename(path.resolve(getDbPath()))).toBe(`openlearn_test_${poolId}_${process.pid}.db`);
  });

  it('即便环境里已注入 OPENLEARN_DB_PATH（模拟 .env 被 dotenv 灌入），VITEST 仍然优先走临时库', async () => {
    const saved = process.env.OPENLEARN_DB_PATH;
    // 直接把它指向真实开发库：这正是事故现场的环境。第二道防线必须拦住。
    process.env.OPENLEARN_DB_PATH = DEV_DB;
    vi.resetModules();
    try {
      const mod = await import('../index.js');
      expect(path.resolve(mod.getDbPath())).not.toBe(DEV_DB);
      expect(path.dirname(path.resolve(mod.getDbPath()))).toBe(TEST_DB_DIR);
    } finally {
      if (saved === undefined) delete process.env.OPENLEARN_DB_PATH;
      else process.env.OPENLEARN_DB_PATH = saved;
      vi.resetModules();
    }
  });
});
