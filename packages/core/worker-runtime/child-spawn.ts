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
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChildProcessTransport } from './child-transport.js';
import { ChildProcessIsolate } from './child-isolate.js';
import {
  buildPermissionArgs,
  describePermissionPolicy,
  normalizePermissionPolicy,
  type PluginPermissionPolicy,
} from './plugin-permission.js';
import { buildHeapLimitArgs, describeHeapLimit } from './plugin-limits.js';

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
  /** 与宿主建表/删表共用的前缀。缺省时 bootstrap 只用 pluginId，不用 manifest id。 */
  tablePrefix?: string;
  /** 管理员已批准的出站主机名。preload 在启动时拍下这份名单。 */
  approvedNetHosts?: string[];
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
  /**
   * 能力面收敛策略（L-1 P2）。不给则读 `OPENLEARN_PLUGIN_PERMISSION`。
   *
   * 刻意提供这个逃生舱：`off` 会让插件拿到宿主用户的全部文件与进程能力。
   * 合法需要 spawn / 联网 / 写外部路径的插件只能走它 —— 因为本版本
   * **没有** `--allow-net`，无法逐项放开网络。
   */
  permissionPolicy?: PluginPermissionPolicy;
  /** 权限模式里的 fs 放行范围；不给则用 `data.pluginDir` 与 `process.cwd()` */
  permissionPaths?: { pluginDir?: string; rootPath?: string };
  /** 堆上限（MB）。不给则读 `OPENLEARN_PLUGIN_MAX_HEAP_MB`；传 0 表示不设上限 */
  maxHeapMb?: number;
}

/**
 * 以子进程方式启动插件 bootstrap。
 *
 * ## 为什么把 bootstrap 写成临时 `.mjs` 文件而不是 `--eval`
 *
 * 实测 `--eval` / `--import <dataUrl>` + 空主模块 / 临时文件三种方式都能跑通，
 * 复杂类型在 `serialization:'advanced'` 下也都存活。**曾选用 `--eval`**（不写磁盘），
 * 但合成后的 bootstrap 约 32KB，作为 argv 载荷时，与权限旗标拼接后总命令行长度会逼近
 * Windows 的 32767 上限（实测 32899 → `spawn ENAMETOOLONG`，子进程激活全部失败）。
 * 故改为写临时 `.mjs`（0600，退出即删）：argv 与 bootstrap 体积解耦，任何平台都不再触顶。
 *
 * 安全取舍：bootstrap 本身**不含密钥**（密钥只在 `__PLUGIN_WORKER_DATA` 里，且那里面
 * 只有 pluginId / token 名列表），临时文件权限 0600 且随子进程退出删除；相比 `--eval`
 * 反而**减少**了 bootstrap 在 `ps` / argv 中的暴露。若将来把凭据放进 bootstrap，必须复审。
 *
 * ## 权限旗标放在脚本路径之前
 *
 * Node 要求权限相关旗标出现在**脚本之前**。实测把它们放在脚本参数之后会
 * 报 `bad option` 或被静默忽略，因此顺序固定为
 * `[...permissionArgs, ...netGuardArgs, ...heapArgs, bootstrapFile]`。
 */
export function spawnPluginChild(opts: SpawnChildOptions): {
  child: ChildProcess;
  transport: ChildProcessTransport;
  isolate: ChildProcessIsolate;
} {
  const policy = normalizePermissionPolicy(opts.permissionPolicy ?? process.env.OPENLEARN_PLUGIN_PERMISSION);
  const permissionArgs = buildPermissionArgs({
    policy,
    pluginDir: opts.permissionPaths?.pluginDir ?? opts.data.pluginDir,
    rootPath: opts.permissionPaths?.rootPath ?? process.cwd(),
  });

  // 堆上限与权限旗标放同一段（都在脚本参数之前）。
  // 实测（2026-10-08 更正）：这两个旗标放在 `--eval` **之后同样生效** ——
  //   --max-old-space-size=64  放在前 1361ms FATAL ERROR / 放在后 1353ms FATAL ERROR
  //   完全不给上限 → 存活，heapUsed=1236MB
  // 我曾断言「放在脚本之后会被静默忽略」，那是**错的**：当时的探针只跑了个
  // console.log、不做分配，根本区分不了生效与否。位置按惯例统一放前段，
  // 但**不要**把它当作正确性依赖 —— 真正的依赖见下方注释里指出的测试。
  const heapArgs = buildHeapLimitArgs(opts.maxHeapMb);
  const netGuardArgs: string[] = [];
  const envOverrides: Record<string, string | undefined> = {};
  if (policy !== 'off') {
    const preloadPath = resolveNetPreloadPath();
    netGuardArgs.push(`--require=${preloadPath}`);
    permissionArgs.push(`--allow-fs-read=${preloadPath}`);
    envOverrides.OPENLEARN_PLUGIN_NET_ALLOW = (opts.data.approvedNetHosts ?? []).join(',');
  }

  // ★ bootstrap 经临时文件传给子进程，**不放进 argv**。
  //
  // 合成后的 bootstrap 约 32KB；当它作为 `--eval` 载荷与权限旗标拼接时，总命令行长度
  // 会逼近 Windows 的 32767 上限（实测 32899），`spawn` 直接报 `ENAMETOOLONG`，子进程
  // 激活全失败。改用临时 `.mjs`（0600，子进程退出即删）后，argv 与 bootstrap 体积解耦，
  // 任何平台都不会再触顶。代价：磁盘上短暂出现一份 bootstrap（不含密钥，见模块注释）。
  const bootstrapFile = writeBootstrapTempFile(opts.bootstrapCode);
  if (policy !== 'off') {
    // 权限模型下，入口脚本本身也要显式放行读取。
    permissionArgs.push(`--allow-fs-read=${bootstrapFile}`);
  }

  const child = spawn(process.execPath, [...permissionArgs, ...netGuardArgs, ...heapArgs, bootstrapFile], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: buildMinimalEnv(opts.data, envOverrides),
    cwd: opts.cwd,
    // ★ 必须显式指定：默认 json 会静默降级 10/13 个探针（见模块注释与
    //   ipc-serialization-parity.test.ts）。它是 spawn 选项，对双向生效。
    serialization: 'advanced',
    windowsHide: true,
  });

  const removeBootstrapFile = () => {
    try {
      fs.unlinkSync(bootstrapFile);
    } catch {
      /* 已被清理或从未落盘 */
    }
  };
  child.once('exit', removeBootstrapFile);
  child.once('error', removeBootstrapFile);

  const approvedHosts = new Set((opts.data.approvedNetHosts ?? []).map((host) => host.trim().toLowerCase()));
  const transport = new ChildProcessTransport(child, approvedHosts);
  const isolate = new ChildProcessIsolate(child, opts.termGraceMs ?? 0);
  return { child, transport, isolate };
}

/**
 * 把 bootstrap 源码写到临时 `.mjs` 文件（权限 0600），供子进程以**脚本路径**方式加载。
 *
 * 不用 `--eval` 的原因：合成后的 bootstrap 约 32KB，作为命令行参数会与权限旗标一起
 * 逼近 Windows 的 32767 上限（实测总长 32899 → `spawn ENAMETOOLONG`，子进程激活全失败）。
 * 落成文件后 argv 恒定很短，与 bootstrap 体积无关。调用方负责在子进程退出后删除。
 */
export function writeBootstrapTempFile(code: string): string {
  const file = path.join(os.tmpdir(), `ol-bootstrap-${crypto.randomBytes(8).toString('hex')}.mjs`);
  fs.writeFileSync(file, code, { encoding: 'utf8', mode: 0o600 });
  return file;
}

/**
 * 启动或退出时扫描并清理临时目录下残留的 ol-bootstrap-*.mjs 文件。
 */
export function cleanupStaleBootstrapFiles(): number {
  try {
    const tmpDir = os.tmpdir();
    const files = fs.readdirSync(tmpDir);
    let cleaned = 0;
    for (const file of files) {
      if (file.startsWith('ol-bootstrap-') && file.endsWith('.mjs')) {
        try {
          fs.unlinkSync(path.join(tmpDir, file));
          cleaned++;
        } catch {
          /* 忽略被占用或无权限的文件 */
        }
      }
    }
    return cleaned;
  } catch {
    return 0;
  }
}

// 模块加载时执行一次孤儿清理
cleanupStaleBootstrapFiles();

/** 入口脚本既可能躺在源码目录，也可能在生产构建时被复制到 dist/。 */
export function resolveNetPreloadPath(): string {
  const candidates: string[] = [
    path.resolve(process.cwd(), 'packages/core/worker-runtime/plugin-net-preload.cjs'),
    path.resolve(process.cwd(), 'dist/plugin-net-preload.cjs'),
  ];
  try {
    const url = import.meta.url;
    if (typeof url === 'string' && url.startsWith('file:')) {
      candidates.unshift(path.join(path.dirname(fileURLToPath(url)), 'plugin-net-preload.cjs'));
    }
  } catch {
    // CJS 产物里 import.meta.url 不可用。
  }
  if (typeof __dirname !== 'undefined') {
    candidates.unshift(path.join(__dirname, 'plugin-net-preload.cjs'));
  }
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`[PluginNet] preload script not found. Looked in: ${candidates.join(', ')}`);
  }
  return found;
}

/** 诊断用：把当前生效的权限策略与堆上限渲染成一行人类可读文本 */
export function describeSpawnPermission(opts: {
  pluginDir?: string;
  policy?: PluginPermissionPolicy;
  maxHeapMb?: number;
}): string {
  return `${describeHeapLimit(opts.maxHeapMb)}｜${describePermissionPolicy({
    policy: normalizePermissionPolicy(opts.policy ?? process.env.OPENLEARN_PLUGIN_PERMISSION),
    pluginDir: opts.pluginDir,
    rootPath: process.cwd(),
  })}`;
}
