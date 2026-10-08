/**
 * Bootstrap section 2/5 · I-4 遮蔽 `process`。
 *
 * `worker_threads` 与主进程**同进程同内存空间**，`process` 是裸全局 —— 插件不需要
 * 任何绕过手段就能读到宿主全部环境变量。实测可读到 10+ 个密钥
 * （`ANTHROPIC_AUTH_TOKEN` / `*_API_KEY` …），`process.kill` / `chdir` / `exit` 均可用。
 *
 * 安装期已有两道真门（esbuild `platform:neutral` 拒绝一切裸 specifier、
 * `assertPluginCodeSafe()` 拦 eval / new Function / 计算式 import()），所以
 * `await import('node:fs')` 这类路径插件作者绕不过。但 `process` 不需要绕 ——
 * 它就在全局作用域里。
 *
 * ## 为什么这段仍然是字符串而不是真模块
 *
 * 它闭包捕获了 bootstrap 的 `parentPort`，且是**安全关键**路径。若改用
 * `fn.toString()` 内联真模块，esbuild 打包一旦加上 `--minify`，标识符会被重命名，
 * 产出的函数体会引用 bootstrap 作用域里**不存在**的名字 —— 而且只在**生产环境**
 * 炸（测试跑在源码上，抓不到）。为了不在安全路径上埋这种雷，保留字符串。
 *
 * 测试侧的验证入口见本文件末尾导出的 `extractProcessMaskingBlock()`。
 */

export const PROCESS_MASKING_SECTION = `
/* __PROCESS_MASKING_START__ */
// ── I-4：遮蔽 process（D-1 决策：平台要做第三方开发者生态）─────────────────────
//
// worker_threads 与主进程**同进程同内存空间**，'process' 是裸全局 —— 插件不需要
// 任何绕过手段就能读到宿主的全部环境变量。实测（'new Worker(url,{eval:false})'）：
//   process.env          → 可读到 10+ 个密钥（ANTHROPIC_AUTH_TOKEN / *API_KEY …）
//   process.kill/chdir   → 可用
//   process.exit()       → 可用（只终结本线程，主进程存活）
//
// 安装期已有两道真门（esbuild 'platform:'neutral'' 拒绝一切裸 specifier、
// assertPluginCodeSafe() 拦 eval / new Function / 计算式 import()），所以
// 'await import('node:fs')' 这类路径插件作者绕不过。但 'process' 不需要绕 ——
// 它就在全局作用域里。因此这里必须遮蔽。
//
// 遮蔽后插件仍能拿到：argv(仅 worker 启动参数)、version、platform、versions、
// cwd/pid/hrtime 这类无敏感信息项。**环境变量一律不给**。
// 真实的 exit 引用：bootstrap 自身的错误处理器需要真正退出 worker，
// 但 process.exit 已对插件遮蔽。这里在遮蔽**之前**取出闭包，插件拿不到它。
var realExit = process.exit.bind(process);

// 不保留原 env 引用：留一份 'const __REAL_ENV = process.env' 在作用域里，
// 插件可以闭包捕获它再读回来，等于遮蔽失效。
Object.defineProperty(process, 'env', {
  configurable: false,
  writable: false,
  value: Object.freeze(Object.create(null)),
});
process.exit = function(code) {
  parentPort.postMessage({
    type: 'error',
    message: 'process.exit() is not available inside a plugin worker.'
  });
  throw new Error('[SecurityError] process.exit() is forbidden in plugin worker.');
};
// 名单里**刻意不含 chdir** —— 实测（I-4 落地时逐个试出来的）：
// process.chdir 一旦被 redefine 成不可写属性，exceljs 的 require 链会在
// Object.setPrototypeOf 上炸出 'Cyclic __proto__ value'。而 exceljs 在
// PLUGIN_SHARED_MODULES 白名单里，是官方支持的插件依赖 —— 为了挡一个威胁
// 有限的 API 而打断一条受支持的加载路径，是净损失。
//
// 名单只留三类真威胁：
//   · kill / abort          —— 能杀宿主进程
//   · setuid / setgid / seteuid / setegid —— 能改宿主进程身份
//   · dlopen / binding      —— 低层原生入口，可绕过模块级 denylist
for (const __blocked of ['kill', 'abort', 'setuid', 'setgid', 'seteuid', 'setegid', 'dlopen', 'binding']) {
  try {
    Object.defineProperty(process, __blocked, {
      configurable: false,
      writable: false,
      value: function() {
        throw new Error('[SecurityError] process.' + __blocked + '() is forbidden in plugin worker.');
      }
    });
  } catch (__e) {
    // 某些 Node 版本上这些属性可能不可重定义 —— 失败不应阻断整个 worker 启动，
    // 但必须让运维知道遮蔽不完整。见下方 SELF_CHECK 报告。
  }
}
// argv 里可能带宿主命令行参数（含路径、偶尔含内网地址）—— 只保留 worker 自身标识
try {
  process.argv = Object.freeze(['node', 'openlearn-plugin-worker']);
} catch (__e) {}
/* __PROCESS_MASKING_END__ */

process.on('unhandledRejection', function(reason) {
  var msg = (reason && reason.message) ? reason.message : String(reason);
  var stack = (reason && reason.stack) || '';
  console.error('[Worker unhandledRejection for ' + workerData.pluginId + ']:', msg, stack);
  try {
    parentPort.postMessage({
      type: 'error',
      message: 'Unhandled rejection in worker: ' + msg,
      stack: stack
    });
  } catch (e) {}
  // 用真正的进程退出而非 process.exit(1)：后者已被 I-4 遮蔽成抛错，
  // 而错误处理器里再抛错会变成新的 unhandledRejection。
  setTimeout(function() {
    realExit(1);
  }, 10);
});

process.on('uncaughtException', function(err) {
  var msg = (err && err.message) ? err.message : String(err);
  var stack = (err && err.stack) || '';
  console.error('[Worker uncaughtException for ' + workerData.pluginId + ']:', msg, stack);
  try {
    parentPort.postMessage({
      type: 'error',
      message: 'Uncaught exception in worker: ' + msg,
      stack: stack
    });
  } catch (e) {}
  setTimeout(function() {
    realExit(1);
  }, 10);
});
`;

/** 遮蔽块的定界标记。必须与 {@link PROCESS_MASKING_SECTION} 里的字面量一致。 */
const PROCESS_MASKING_START = '/* __PROCESS_MASKING_START__ */';
const PROCESS_MASKING_END = '/* __PROCESS_MASKING_END__ */';

/**
 * 抽取遮蔽段的代码文本，供测试**直接执行**。
 *
 * 遮蔽逻辑写在动态生成的字符串里，无法 import 共享模块 —— 这是本模块存在的
 * 根本原因，也是 L-2 之前的困境：那时这段代码埋在 881 行的
 * `generateBootstrapCode()` 模板中段中段，测试只能在**整个** bootstrap 里靠哨兵
 * 标记做字符串手术。拆分之后手术范围缩到这一个 section，且标记与被测代码同源，
 * 测试覆盖的仍是生产实际执行的那段文本。
 */
export function extractProcessMaskingBlock(): string {
  const start = PROCESS_MASKING_SECTION.indexOf(PROCESS_MASKING_START);
  const end = PROCESS_MASKING_SECTION.indexOf(PROCESS_MASKING_END, start + PROCESS_MASKING_START.length);
  if (start === -1 || end === -1) {
    throw new Error(
      'process masking markers not found in PROCESS_MASKING_SECTION — ' +
        'sandbox-confinement.test.ts 依赖它们定位遮蔽块',
    );
  }
  return PROCESS_MASKING_SECTION.slice(start + PROCESS_MASKING_START.length, end).trim();
}
