/**
 * 启动期运行时守卫：Node 版本 + 原生模块（better-sqlite3）ABI 失配。
 *
 * ## 为什么需要它（与 `scripts/assert-node-runtime.mjs` 的分工）
 *
 * `scripts/assert-node-runtime.mjs` 守的是**安装期**：版本不对就别装。
 * 本模块守的是**运行期**：装的时候版本是对的，但 node_modules 是从别处拷来的、
 * 或者客户在装好之后换了 Node 版本 —— 这时安装期那道闸已经拦不住了。
 *
 * 现象是运行期第一句就炸：
 *
 *   ERR_DLOPEN_FAILED
 *   The module '.../better_sqlite3.node' was compiled against a different Node.js version
 *   using NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 147.
 *
 * 这条原生报错对客户不可操作：它只说「二进制不匹配」，不说「该重建还是该换版本」。
 * 本模块把原生报错**翻译成一条可执行的修复指引**，并在服务真正启动前拦下来。
 *
 * ## 为什么必须跑在 DB 模块之前
 *
 * `packages/core/db/index.ts` 顶层 `import Database from 'better-sqlite3'` —— 静态
 * import 意味着原生绑定在**模块求值期**就会加载。若 ABI 不匹配，进程在
 * `startServer()` 被调用**之前**就已经抛异常退出，任何写在 startServer 里的检查
 * 都没机会执行。
 *
 * 所以本模块被 `server/security/runtime-preflight.ts` 以「第一个 import」的方式
 * 挂到 `server.ts` 顶部：ESM 的依赖求值顺序保证它先跑，探针失败时给出人话报错，
 * 而不是让 better-sqlite3 的原始栈先冒出来。
 *
 * 校验保持纯函数 + 副作用分离：`checkRuntimeEnvironment()` 不读 `process`、不打印、
 * 不退出，便于逐条覆盖；副作用集中在 `assertRuntimeEnvironment()`。
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  SUPPORTED_NODE_MAJORS,
  SUPPORTED_NODE_TEXT,
  checkNodeVersion,
  buildFixGuidance,
} from '../../scripts/assert-node-runtime.mjs';

export type RuntimeIssueSeverity = 'error' | 'warning';

export interface RuntimeIssue {
  key: string;
  severity: RuntimeIssueSeverity;
  message: string;
}

export interface RuntimeCheckResult {
  errors: RuntimeIssue[];
  warnings: RuntimeIssue[];
}

export { SUPPORTED_NODE_MAJORS, SUPPORTED_NODE_TEXT };

/** 从 better-sqlite3 的原生报错里抽出「模块是按哪个 ABI 编译的」。 */
const ABI_PATTERN = /NODE_MODULE_VERSION\s+(\d+)/i;

/** better-sqlite3 找不到 binding 文件（依赖没装 / 没编译 / 被裁剪）时的特征串。 */
const MISSING_BINDINGS_MARKERS = ['Could not locate the bindings file', 'bindings file'];

/**
 * 解析原生模块加载失败的性质。
 *
 * @param {unknown} error 捕获到的异常
 * @returns {{kind: 'abi-mismatch'|'missing-bindings'|'unknown', moduleAbi: number|null, runtimeAbi: number, detail: string}}
 */
export function detectNativeModuleFailure(error: unknown) {
  const runtimeAbi = Number(process.versions.modules);
  const message = error instanceof Error ? error.message : String(error);
  const abiMatch = ABI_PATTERN.exec(message);
  if (abiMatch) {
    return {
      kind: 'abi-mismatch' as const,
      // better-sqlite3 的报错里第一个 NODE_MODULE_VERSION 是「模块编译时的 ABI」，
      // 第二个是「当前运行时要求的 ABI」。
      moduleAbi: Number(abiMatch[1]),
      runtimeAbi,
      detail: message,
    };
  }
  if (MISSING_BINDINGS_MARKERS.some((marker) => message.includes(marker))) {
    return { kind: 'missing-bindings' as const, moduleAbi: null, runtimeAbi, detail: message };
  }
  return { kind: 'unknown' as const, moduleAbi: null, runtimeAbi, detail: message };
}

/**
 * 取得能解析到「本包自己依赖」的 require。
 *
 * 与 `packages/core/db/index.ts` 同一套兼容两种模块形态的写法：
 * - 源码经 tsx 以 ESM 跑：`import.meta.url` 可用；
 * - 生产产物经 esbuild 打成 CJS：`import.meta` 为空，但 `__filename` 指向产物自身，
 *   从它所在目录解析才能拿到本包自己的 node_modules（全局安装时 cwd 不是包目录）。
 */
function resolveRequire(): NodeRequire {
  if (typeof import.meta !== 'undefined' && import.meta.url) {
    return createRequire(import.meta.url);
  }
  if (typeof __filename !== 'undefined') {
    return createRequire(__filename);
  }
  return createRequire(path.join(process.cwd(), 'package.json'));
}

/**
 * 加载 better-sqlite3 原生绑定（探针）。
 *
 * @returns {void} 加载成功则正常返回；失败则抛出原始异常
 */
export function loadBetterSqlite3Binding(): void {
  resolveRequire()('better-sqlite3');
}

/**
 * 判定原生模块能否在当前运行时加载。
 *
 * @param {() => void} load 加载动作（测试注入用）
 * @returns {RuntimeIssue|null} 有问题返回 issue，否则 null
 */
export function checkNativeModule(load: () => void = loadBetterSqlite3Binding): RuntimeIssue | null {
  try {
    load();
    return null;
  } catch (error) {
    const failure = detectNativeModuleFailure(error);
    if (failure.kind === 'abi-mismatch') {
      return {
        key: 'native-module-abi',
        severity: 'error',
        message:
          `原生模块 better-sqlite3 与当前 Node 运行时不兼容：二进制是按 ABI ${failure.moduleAbi} 编译的，` +
          `当前运行时（Node ${process.versions.node}）要求 ABI ${failure.runtimeAbi}。\n` +
          `  常见原因：node_modules 是在另一个 Node 版本下安装/拷贝的。\n` +
          `  修复：rm -rf node_modules && pnpm install（按当前 Node 重新编译原生模块），\n` +
          `        或切回受支持的 Node 版本（${SUPPORTED_NODE_TEXT}）。`,
      };
    }
    if (failure.kind === 'missing-bindings') {
      return {
        key: 'native-module-missing',
        severity: 'error',
        message:
          `原生模块 better-sqlite3 的二进制不存在（未编译或依赖被裁剪）。\n` +
          `  修复：rm -rf node_modules && pnpm install（pnpm 需要 allowBuilds 放行 better-sqlite3 的构建脚本），\n` +
          `        或改用官方容器镜像（已内置编译好的二进制）。`,
      };
    }
    return {
      key: 'native-module-load',
      severity: 'error',
      message: `原生模块 better-sqlite3 加载失败：${failure.detail}`,
    };
  }
}

/**
 * 启动期的全部运行时检查。
 *
 * @param {{nodeVersion?: string, loadNativeModule?: () => void}} [input] 注入点（测试用）
 * @returns {RuntimeCheckResult}
 */
export function checkRuntimeEnvironment(
  input: { nodeVersion?: string; loadNativeModule?: () => void } = {},
): RuntimeCheckResult {
  const errors: RuntimeIssue[] = [];
  const warnings: RuntimeIssue[] = [];

  const nodeVersion = input.nodeVersion ?? process.version;
  const nodeCheck = checkNodeVersion(nodeVersion);
  if (!nodeCheck.ok) {
    errors.push({
      key: 'node-version',
      severity: 'error',
      message: `${nodeCheck.message}\n${buildFixGuidance(nodeCheck.major)}`,
    });
    // Node 版本不对时，原生模块的 ABI 结论不可靠（不同主版本的 ABI 不同），
    // 不再重复报同一件事，避免两段修复指引互相打架。
    return { errors, warnings };
  }

  const nativeIssue = checkNativeModule(input.loadNativeModule);
  if (nativeIssue) {
    errors.push(nativeIssue);
  }
  return { errors, warnings };
}

/**
 * 启动期硬门禁：有问题就打印全部问题并以退出码 1 终止。
 *
 * @returns {void}
 */
export function assertRuntimeEnvironment(): void {
  const { errors, warnings } = checkRuntimeEnvironment();
  for (const warning of warnings) {
    console.warn(`[NodeRuntime] WARN: ${warning.message}`);
  }
  if (errors.length === 0) return;
  console.error('[NodeRuntime] FATAL: 运行时环境不满足要求，拒绝启动。');
  for (const issue of errors) {
    console.error(`\n[NodeRuntime] ${issue.key}\n${issue.message}`);
  }
  process.exit(1);
}
