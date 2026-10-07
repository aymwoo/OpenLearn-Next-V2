/**
 * 子进程隔离原语的 spawn 工厂（L-1 P1 阶段 2）。
 *
 * ## 最要紧的一件事：**不要继承宿主 env**
 *
 * `child_process` 默认继承全部环境变量。实测在当前开发环境下，一个「什么都没做」
 * 的子进程能读到 **10 个疑似密钥**的环境变量：
 *
 * ```
 * XAI_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, HL_INITIAL_WORKSPACE_TOKEN,
 * STARSHIP_SESSION_KEY, …
 * ```
 *
 * I-4 给 worker bootstrap 加了 `process.env` 遮蔽，但那是**运行期**的补救 ——
 * 密钥已经躺在进程的环境里了。子进程可以在遮蔽生效前读到它，也可以从
 * `/proc/self/environ` 读到原始值。
 *
 * 所以这里**从一开始就只给最小 env**（见 `buildMinimalEnv`）。这严格优于
 * worker_threads 的处境：worker 是「给了再遮蔽」，子进程是「根本不给」。
 *
 * ## 另一条实测结论：必须排除 `NODE_OPTIONS`
 *
 * 宿主若设了 `NODE_OPTIONS=--require <path>`，子进程会继承并尝试加载它。
 * 实测指向不存在的模块时子进程**直接崩溃**（起不来）；指向存在但非预期的模块时，
 * 那段代码会在插件进程里执行 —— 与插件无关的代码被注入到插件沙箱起点。
 *
 * 故 `buildMinimalEnv` 只按白名单取，且显式**不取** `NODE_OPTIONS`。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { ChildProcessTransport } from './child-transport.js';
import { ChildProcessIsolate } from './child-isolate.js';

/** 传给子进程的环境变量白名单 */
const ENV_ALLOWLIST = [
  'PATH',
  'LANG',
  'LC_ALL',
  'TZ',
  'NODE_ENV',
  // npm 相关：插件若合法地读取自己的包信息会用到；不含任何凭据
  'npm_config_user_agent',
] as const;

/** 无论白名单如何都**必须**排除的变量 */
const ENV_DENYLIST = new Set([
  'NODE_OPTIONS', // --require / --import 会注入代码；指向不存在模块时子进程直接起不来（实测）
  'NODE_REPL_EXTERNAL_MODULE',
]);

/** 注入给 bootstrap 的数据（对应 worker_threads 的 `workerData`） */
export interface PluginWorkerData {
  pluginId: string;
  manifestId: string;
  serviceTokens: readonly string[];
  pluginDir?: string;
}

/** bootstrap 数据的环境变量名 */
export const WORKER_DATA_ENV = '__PLUGIN_WORKER_DATA';

/**
 * 构造最小环境变量表。
 *
 * 刻意**不做**「先全继承、再删除敏感项」—— 那种写法依赖一份需要持续维护的
 * 敏感名单，而新增一个 `*_API_KEY` 就会漏。白名单是默认拒绝，更难出错。
 *
 * @param data - 注入给 bootstrap 的数据
 * @param overrides - 额外变量（同样过白名单/黑名单），用于测试或特殊场景
 */
export function buildMinimalEnv(
  data: PluginWorkerData,
  overrides: Record<string, string | undefined> = {},
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const key of ENV_ALLOWLIST) {
    const v = process.env[key];
    if (typeof v === 'string' && v.length > 0) out[key] = v;
  }

  for (const [key, v] of Object.entries(overrides)) {
    if (v === undefined) continue;
    if (ENV_DENYLIST.has(key)) continue;
    out[key] = v;
  }

  out[WORKER_DATA_ENV] = JSON.stringify(data);
  return out;
}

export interface SpawnChildOptions {
  /** bootstrap 源码（ESM，含顶层 await） */
  bootstrapCode: string;
  data: PluginWorkerData;
  /** SIGKILL 前的 SIGTERM 宽限期（ms），默认 0 = 立即强杀 */
  termGraceMs?: number;
  /** 工作目录，默认沿用宿主 cwd */
  cwd?: string;
}

/**
 * 以子进程方式启动插件 bootstrap。
 *
 * ## 为什么用 `--input-type=module --eval` 而不是写临时文件
 *
 * 实测三种方式（`--eval` / `--import <dataUrl>` + 空主模块 / 临时文件）都能跑通，
 * 复杂类型在 `serialization:'advanced'` 下也都存活。选择 `--eval` 的理由：
 * **不写磁盘**（临时文件会散落在系统 tmp 里，且要处理清理与并发命名）。
 *
 * 代价：bootstrap 全文出现在子进程的 argv 里，因而出现在 `ps` 输出中。
 * bootstrap 本身**不含密钥**（密钥只在 `__PLUGIN_WORKER_DATA` 里，且那里面
 * 只有 pluginId / token 名列表），故这个暴露面可接受。若将来 bootstrap 里
 * 出现了凭据，必须改回临时文件方案。
 */
export function spawnPluginChild(opts: SpawnChildOptions): {
  child: ChildProcess;
  transport: ChildProcessTransport;
  isolate: ChildProcessIsolate;
} {
  const child = spawn(process.execPath, ['--input-type=module', '--eval', opts.bootstrapCode], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: buildMinimalEnv(opts.data),
    cwd: opts.cwd,
    // ★ 必须显式指定：默认 json 会静默降级 10/13 个探针（见模块注释与
    //   ipc-serialization-parity.test.ts）。它是 spawn 选项，对双向生效。
    serialization: 'advanced',
    windowsHide: true,
  });

  const transport = new ChildProcessTransport(child);
  const isolate = new ChildProcessIsolate(child, opts.termGraceMs ?? 0);
  return { child, transport, isolate };
}