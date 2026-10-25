import { TextEncoder, TextDecoder } from 'util';
import crypto from 'node:crypto';
import { expect, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import nodeFs from 'fs';
import { fileURLToPath } from 'url';

/**
 * 全局守卫：还原被测试用例修改的 global.fetch。
 *
 * 防止部分测试直接执行 `global.fetch = vi.fn(...)` 且未恢复，
 * 导致同一 Worker 内后续运行的测试文件遭遇跨用例污染 (Flaky)。
 */
const originalGlobalFetch = globalThis.fetch;
afterEach(() => {
  if (globalThis.fetch !== originalGlobalFetch) {
    globalThis.fetch = originalGlobalFetch;
  }
});

// 测试进程自己准备一把随机钥匙，避免解析器把密钥写进仓库的 storage/。
// 这不是产品默认密钥：每个 worker 现场生成，生产代码里没有写死的 hex。
if (!/^[0-9a-fA-F]{64}$/.test((process.env.ENCRYPTION_KEY || '').trim())) {
  process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
}

/**
 * 测试库物理隔离（Issue #194）。
 *
 * ## 为什么必须在这里动手
 *
 * `packages/core/db/index.ts` 的 `dbPath` 解析原先让 `process.env.OPENLEARN_DB_PATH`
 * **优先于** `process.env.VITEST`。本地开发机的 `.env` 恰好声明了
 * `OPENLEARN_DB_PATH=<repo>/packages/core/db/educational_os.db`，而 `dotenv` 不覆写
 * 已存在的 env 键 —— 所以只要有任何一条路径把 `.env` 灌进 `process.env`
 * （`server.ts` 的 `dotenv.config()`、开发者自己 `export`、`pnpm dev` 继承的环境），
 * 测试就会把数据写进**真实开发库**。
 *
 * 实测后果（非推断）：
 * - 插件的审计用例（如 `plugin-audit-poc.test.ts` 里 `new Kernel(...)` 触发高危命令
 *   拦截）会把 `audit.poc.highrisk.*` 记录永久留在开发库的 `pending_commands` 里，
 *   后台待审批列表挂着一条永远批不掉的死项；
 * - 这类污染不带任何失败信号，`pnpm test` 依旧全绿，只能在数据库里发现。
 *
 * 因此在**任何测试模块、`ensureTestSchema()` 之前**做两件事：
 * 1. **清除**继承来的 `OPENLEARN_DB_PATH`（而不是改写成临时路径 —— 理由见下方注释，
 *    全局变量还有其他读者，改写会误伤 `cli-cleaner`）；
 * 2. 把 `OPENLEARN_DATA_DIR` 重定向到临时目录（storage/ 与插件产物都从它派生）。
 *
 * 清掉后路径由 `packages/core/db/index.ts` 的 `VITEST` 分支接管；那里另有一道
 * 「`VITEST` 优先于 `OPENLEARN_DB_PATH`」的硬防线（双层），即使某测试自己先调了
 * `dotenv.config()` 再 import db，也落不到真实数据目录。
 */
{
  const poolId = process.env.VITEST_POOL_ID || '1';
  // 与 vitest.config.ts 里的隔离键一致：一个 worker 一个库文件，进程生命周期内复用。
  // 不复用会变成「每个测试文件一个库」：`kernelContainer` 这类单例在进程内只初始化一次，
  // 文件间删各自临时库会产生「A 删掉 B 还在用」的竞态。
  const testDbDir = path.join(os.tmpdir(), 'openlearn_test_dbs');
  nodeFs.mkdirSync(testDbDir, { recursive: true });

  /**
   * 回收旧进程留下的库文件（按小时粒度，不碰当前进程的库）。
   *
   * 库文件名带 `process.pid`（见 `packages/core/db/index.ts` 的 `VITEST` 分支），
   * 所以**每个 worker 进程天然拿到一份全新的库**：不需要“启动时删除”，也就没有
   * “删除与使用之间的竞态” —— 曾用 pid 哨兵文件做过一轮，被 pid 复用坑了：
   * 新一轮复用到同一 pid 就跳过重置，带着上一轮残留的 `_migrations` 行再跑迁移，
   * 实测报 `UNIQUE constraint failed: _migrations.name`。
   *
   * 代价是旧 pid 的文件会留在 /tmp：这里按 24h 粗粒度收回（24 小时前的文件不可能是
   * 正在跑的套件），避免无限堆积。失败不影响测试。
   */
  try {
    const now = Date.now();
    for (const entry of nodeFs.readdirSync(testDbDir)) {
      if (!/^openlearn_test_.*\.db(-wal|-shm)?$/.test(entry)) continue;
      const full = path.join(testDbDir, entry);
      if (now - nodeFs.statSync(full).mtimeMs > 24 * 60 * 60 * 1000) nodeFs.rmSync(full, { force: true });
    }
    // 清理历史遗留的 pid 哨兵（旧方案产物）。
    for (const entry of nodeFs.readdirSync(testDbDir)) {
      if (entry.startsWith('.reset-')) nodeFs.rmSync(path.join(testDbDir, entry), { force: true });
    }
  } catch {
    // 回收失败不影响测试正确性。
  }

  const ambientDbPath = process.env.OPENLEARN_DB_PATH;
  if (ambientDbPath) {
    // 不静默吞掉：开发者需要知道自己的 OPENLEARN_DB_PATH 在测试里被无视了。
    console.warn(
      `[vitest.setup] 已清除继承的 OPENLEARN_DB_PATH=${ambientDbPath}，` +
        '测试一律使用临时库，避免自动化测试污染本地开发库（Issue #194）。',
    );
  }
  // 为什么是“清除”而不是“改写成一个临时路径”：
  //
  // 该变量是**全局**的，除 db 模块之外还有读者，而它们的语义并不一致。
  // 实例：`cli-cleaner.mjs` 的 `dataDir` 尊重调用方传入的 customDataDir，但
  // `dbPath` 无条件优先 `OPENLEARN_DB_PATH` —— 若我们把它改成临时库路径，
  // `packages/core/__tests__/cli-cleaner.test.ts` 就会去清一个不相关的文件，
  // 三条用例立即变红（实测）。清除后各读者各自回到自己的默认逻辑：
  // - `packages/core/db/index.ts` → 走 `VITEST` 分支（临时库）
  // - `server/utils/paths.ts` / `cli-cleaner.mjs` → 回到调用方指定的目录
  delete process.env.OPENLEARN_DB_PATH;

  // ── BACKUP_DIR 同样必须清掉（与 OPENLEARN_DB_PATH 同一类泄漏）──────────
  //
  // 背景：本地开发机常把 `BACKUP_DIR` 导进 shell 环境（生产部署的 .env 也会声明它），
  // 而 `packages/core/db/migrator.ts` 与 `cli-data.mjs` 都是
  // `process.env.BACKUP_DIR || <默认目录>` 的写法 —— 不清掉的话，测试会
  //   1) 把「迁移前快照 / 还原安全副本」写进**生产备份目录**（实测：测试运行期间
  //      backups/ 下多出 pre_migration_*.db / pre_restore_*.db，全是测试库残骸）；
  //   2) 让断言「快照落在临时目录」的用例必然失败（实测：migrate-safety /
  //      cli-data-restore / cli-enhanced 三条用例因备份目录指向生产路径而变红）。
  //
  // 为什么必须「清除」而不是「改写成临时路径」：BACKUP_DIR 的读者语义各不相同
  // （`server/utils/paths.ts` 的 getBackupsDir、`cli-data.mjs` 的 runRestore、
  // `scripts/site-backup.mjs`），改写会让某些读者指向一个语义不对的目录。
  // 清除后各读者回到自己的默认逻辑（库文件同级 backups/），测试用例里
  // 自己 set 的值（v061-upgrade.test.ts 等）依然生效 —— setup 先于用例运行。
  const ambientBackupDir = process.env.BACKUP_DIR;
  if (ambientBackupDir) {
    console.warn(
      `[vitest.setup] 已清除继承的 BACKUP_DIR=${ambientBackupDir}，` +
        '测试的备份/快照一律落在临时目录，避免污染生产备份目录。',
    );
  }
  delete process.env.BACKUP_DIR;

  // 数据目录同属一条隔离链（storage/ 与插件产物路径都从这里派生），一并重定向；
  // 测试自己如果在用例里赋值会覆盖本值（setup 先于用例运行）。
  process.env.OPENLEARN_DATA_DIR = path.join(os.tmpdir(), `openlearn_test_data_${poolId}`);
}

const nodeUint8Array = new TextEncoder().encode('').constructor;
global.Uint8Array = nodeUint8Array as unknown as typeof Uint8Array;
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as unknown as typeof globalThis.TextDecoder;
process.env.OPENLEARN_MAX_ZIP_SIZE = process.env.OPENLEARN_MAX_ZIP_SIZE || String(5 * 1024 * 1024);

/**
 * 服务端集成测试的 Schema 兜底。
 *
 * 课堂相关表（classroom_sessions / classroom_feed / teaching_modes …）只存在于
 * migrations/*.sql，内联 schema 块里没有，而 runMigrations 仅在 server.ts 启动时执行。
 * 过去靠 7 个测试文件各自在 beforeAll 手动补跑，其余文件则依赖「同 worker 里恰好有别人跑过」——
 * 在 fileParallelism 下 worker 分配不确定，于是间歇性 `no such table: classroom_sessions`。
 *
 * 这里统一兜底：仅当当前测试文件位于 server/__tests__ 下时才加载 DB 并补齐迁移，
 * 避免让 200+ 个纯前端测试付出加载 better-sqlite3 与读迁移文件的代价。
 * 详见 server/__tests__/helpers/test-schema.ts 的注释。
 */
/**
 * 把 `kernelContainer` 单例的插件目录指向本次测试运行专属的临时目录。
 *
 * ## 为什么必须在这里设
 *
 * `kernelContainer` 是懒加载 Proxy（kernel/index.ts），内部 `new Kernel()` 无参 ⇒
 * 落到 `<cwd>/plugins`。而 `server/__tests__/` 与 `packages/core/__tests__/` 里有数十个
 * 测试文件 import 这个单例，其中一部分会安装插件。
 *
 * 这些文件**无法逐个改造** —— 单例是 import 进来的，没有构造注入点。env 是唯一能在
 * 「import 之前」生效的通道，而 `vitest.setup.ts` 恰好在所有测试模块之前运行。
 *
 * ## 为什么是「每次运行一个」而不是「每个测试文件一个」
 *
 * 单例在同一进程内只初始化一次，多个测试文件共享它。若每个文件各建一个临时目录并
 * 在自己的 afterEach 里删，会出现「A 文件删掉 B 文件还在用」的竞态。故按 VITEST_POOL_ID
 * 分目录（与 vitest.config.ts 里 SQLite 测试库的隔离键一致），一个 worker 一个目录，
 * 生命周期等于整个测试进程。
 *
 * 兜底：若仍有人把插件产物写进 `plugins/`，下面的守卫会硬失败 ——
 * env 覆盖是**预防**，守卫是**检测**，两者都需要。
 *
 * ## 位置很重要：必须在 ensureTestSchema() 之前
 *
 * `ensureTestSchema()`（下方 server 测试分支）会构造 Kernel，
 * 而 Kernel 构造时就要读这个变量。原先本块放在文件末尾，
 * 于是所有 server 测试拿到的都是 undefined、回落到 `cwd/plugins`。
 * 换句话说：**server 测试的插件产物一直在写工作树**，只是没人发现。
 * `resolvePluginsDirOverride()` 现在在 Vitest 下直接抛错，就是为了防止顺序再被调换。
 */
{
  const poolId = process.env.VITEST_POOL_ID || '1';
  const runDir = path.join(os.tmpdir(), `openlearn-plugins-run-${poolId}`);
  nodeFs.mkdirSync(runDir, { recursive: true });
  process.env.OPENLEARN_PLUGINS_DIR = runDir;
}

const testPath: string = (() => {
  try {
    return String((expect.getState() as { testPath?: string }).testPath ?? '');
  } catch {
    return '';
  }
})();

const isServerTest = testPath.includes(`${path.sep}server${path.sep}__tests__${path.sep}`);

if (isServerTest) {
  const { ensureTestSchema } = await import('./server/__tests__/helpers/test-schema.js');
  ensureTestSchema();
}

/**
 * 全局守卫：禁止测试写入仓库的 `plugins/` 目录（H-1）。
 *
 * ## 为什么需要
 *
 * `PluginHost` 的第 4 个构造参数 `pluginsDir` 是可选的，缺省回退到
 * `path.resolve(process.cwd(), 'plugins')`（index.ts:268）。而测试里散落着
 * 10 处 `new PluginHost(a, b, c)` 没传它 —— 于是每次跑测试都在**仓库工作树**里
 * 建插件目录，且测试自己 `rmSync` 掉的是别处的路径。
 *
 * 实测后果：仓库 `plugins/` 下积累了 **1705 个孤儿目录 / 24MB**，且每次 `pnpm test`
 * 继续增长。这些目录**被 `.gitignore` 忽略**，所以 `git status` 看不见 —— 污染完全隐形。
 *
 * ## 为什么做成全局守卫而不是只修那10 处
 *
 * 只修已知调用点挡不住**下一个**新增的 `new PluginHost(a, b, c)`：漏了不会有任何
 * 报错，只是安静地往工作树里堆垃圾。所以这里把「写入仓库 plugins/」变成**硬失败**，
 * 让漏传 `pluginsDir` 在测试当场炸出来，而不是几个月后从磁盘占用上发现。
 *
 * ## 为什么 patch `node:fs` 有效
 *
 * 实测确认（非推断）：`vitest.setup.ts` 里替换 `node:fs` 的导出，测试文件与被测源码
 * 拿到的是**同一个 CJS 模块对象**（node:fs 被 vite 外部化），故替换对所有
 * `import fs from 'node:fs'` 生效。若哪天 vite 改为内联 node:fs，此守卫会静默失效 ——
 * `verify-fs-guard.test.ts` 断言守卫确实在生效，失效会立刻红。
 *
 * 只拦写操作（mkdir / writeFile / cp / rm 等），不拦读；否则连「检查目录是否干净」
 * 这类诊断脚本都会被误伤。
 */
const FORBIDDEN_ROOT = path.resolve(process.cwd(), 'plugins');

/** 目标路径是否落在仓库 plugins/ 内（含 plugins 本身）。已做 path.resolve 归一。 */
function isForbidden(target: unknown): boolean {
  if (typeof target !== 'string' && !(target instanceof URL)) return false;
  let p: string;
  try {
    p = target instanceof URL ? fileURLToPath(target) : path.resolve(target);
  } catch {
    return false;
  }
  return p === FORBIDDEN_ROOT || p.startsWith(FORBIDDEN_ROOT + path.sep);
}

function forbid(caller: string): never {
  const err = new Error(
    `[H-1 守卫] 禁止在测试中写入仓库的 plugins/ 目录。\n` +
      `  触发操作：${caller}\n` +
      `  原因：PluginHost 的 pluginsDir 参数缺省回退到 process.cwd()/plugins（plugin-host/index.ts:268），\n` +
      `        漏传会让测试把插件产物堆进工作树 —— 该目录被 .gitignore 忽略，污染完全隐形。\n` +
      `  修法：new PluginHost(sr, loader, db, <临时目录>)，并在 afterEach 里 fs.rmSync 清理。\n` +
      `  临时目录写法：fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-<用途>-'))`,
  );
  // 抛 Error 而非仅 log：必须让测试红，否则守卫等于没有
  throw err;
}

// ── 需要拦截的写操作 ──
// 覆盖 PluginHost 在安装/更新路径上用到的全部写操作（index.ts:1181/2146/2192/2507 等）
// 一律走 default import 拿到的 CJS module.exports：`import * as fs` 的 namespace 属性是
// 只读的，赋值会抛 "Cannot redefine property"（实测踩过）。
const fsWritable = nodeFs as unknown as Record<string, (...a: unknown[]) => unknown>;

const WRITE_OPS = [
  'mkdirSync',
  'writeFileSync',
  'appendFileSync',
  'cpSync',
  'copyFileSync',
  'rmSync',
  'mkdir',
  'writeFile',
  'appendFile',
  'cp',
  'copyFile',
  'rm',
] as const;

for (const op of WRITE_OPS) {
  const orig = fsWritable[op];
  // Node 版本差异：某个 API 不存在就跳过，不为它报错
  if (typeof orig !== 'function') continue;
  fsWritable[op] = function guarded(this: unknown, ...args: unknown[]) {
    if (isForbidden(args[0])) forbid(`fs.${op}`);
    return orig.apply(this, args);
  };
}
