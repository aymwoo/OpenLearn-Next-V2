import { TextEncoder, TextDecoder } from 'util';
import { expect } from 'vitest';
import path from 'path';
import os from 'os';
import nodeFs from 'fs';
import { fileURLToPath } from 'url';

const nodeUint8Array = new TextEncoder().encode('').constructor;
global.Uint8Array = nodeUint8Array as unknown as typeof Uint8Array;
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as unknown as typeof TextDecoder;
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
