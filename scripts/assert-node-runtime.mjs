#!/usr/bin/env node
/**
 * 安装期 Node 运行时守卫（`package.json` 的 `preinstall` 钩子）。
 *
 * ## 为什么需要这道闸
 *
 * 本平台的硬依赖 `better-sqlite3` 是**原生模块**：它的 `.node` 二进制按 Node 的
 * ABI（`process.versions.modules`）编译，**不是**跨 Node 版本通用的 JS 包。
 * 于是「换了个 Node 版本、但复用同一份 node_modules」会在运行期炸出：
 *
 *   ERR_DLOPEN_FAILED
 *   The module '.../better_sqlite3.node' was compiled against a different Node.js version
 *   using NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 147.
 *
 * 这条报错对客户毫无可操作性：它既没说「你的 Node 版本不被支持」，也没说
 * 「该重建还是该换版本」。而在**安装期**就把版本问题拦下来，报错就能说人话。
 *
 * ## 为什么是硬失败（而不是只告警）
 *
 * npm 的 `engines` 默认只是**警告**（除非用户开了 `engine-strict`），
 * 单靠 engines 拦不住跑在 Node 26 上的客户机 —— 装得上、起不来。
 * `preinstall` 是安装流程里唯一能在依赖装完前拿到控制权的钩子：这里失败，
 * 安装当场中止，用户看到的是一段可执行的修复指引，而不是半小时后的运行期栈。
 *
 * ## 支持范围为什么是 20.x / 22.x / 24.x
 *
 * - **20.x**：仍在现场的旧 LTS（better-sqlite3 官方提供预编译产物）。
 * - **22.x**：CI 全程、Docker 镜像（`node:22-alpine`）、`.nvmrc` / `.node-version` 都钉它。
 * - **24.x**：当前 LTS，本项目有全量单测通过的记录。
 * - **不含 21.x / 23.x**：非 LTS 奇数版本，且 better-sqlite3 官方 engines 不含 21.x
 *   （无预编译产物 → 客户机必须自带编译工具链，装不上）。
 * - **不含 25.x / 26.x**：本项目未验证；实测 Node 26 下复用 Node 22 装的
 *   node_modules 直接 `ERR_DLOPEN_FAILED`。对**未验证**的版本采取
 *   「拦住并说清楚」，而不是「放行然后在运行期炸」。
 *
 * `package.json` 的 `engines.node` 与本文件的 `SUPPORTED_NODE_MAJORS` 必须一致 ——
 * 由 `scripts/__tests__/node-runtime-guard.test.ts` 盯着，漂了就红。
 */

/**
 * 受支持的 Node 主版本。
 *
 * 与 `package.json` 的 `engines.node`（`20.x || 22.x || 24.x`）、CI 的
 * node-runtime-compat 矩阵、server 侧启动守卫共用同一份口径。
 */
export const SUPPORTED_NODE_MAJORS = Object.freeze([20, 22, 24]);

/** 对外文案里的支持范围描述。 */
export const SUPPORTED_NODE_TEXT = 'Node.js 20.x / 22.x / 24.x';

/** 仓库钉住的版本（.nvmrc / .node-version / Dockerfile 都用它）。 */
export const PINNED_NODE_MAJOR = 22;

/**
 * 从版本串里解析主版本号。
 *
 * @param {string} version 形如 `v22.16.0` / `22.16.0`
 * @returns {number|null} 主版本号；解析不出来返回 null
 */
export function parseNodeMajor(version) {
  if (typeof version !== 'string') return null;
  const matched = /^v?(\d+)\./.exec(version.trim());
  if (!matched) return null;
  const major = Number(matched[1]);
  return Number.isFinite(major) ? major : null;
}

/**
 * 判定某个 Node 版本是否受支持。
 *
 * 纯函数：不读 `process`、不打印、不退出，便于逐个版本覆盖单测。
 *
 * @param {string} version 待判定的版本串
 * @param {readonly number[]} [supported] 受支持的主版本列表
 * @returns {{ok: boolean, code: 'supported'|'unsupported'|'unparseable', major: number|null, message: string}}
 */
export function checkNodeVersion(version, supported = SUPPORTED_NODE_MAJORS) {
  const major = parseNodeMajor(version);
  if (major === null) {
    return {
      ok: false,
      code: 'unparseable',
      major: null,
      message: `无法解析 Node 版本「${version}」。`,
    };
  }
  if (supported.includes(major)) {
    return { ok: true, code: 'supported', major, message: '' };
  }
  return {
    ok: false,
    code: 'unsupported',
    major,
    message:
      `当前 Node 版本 v${major}.x 不受支持（支持范围：${SUPPORTED_NODE_TEXT}）。` +
      `本项目的原生依赖（better-sqlite3）按 Node ABI 编译，复用旧 node_modules 会在运行期报 ` +
      `ERR_DLOPEN_FAILED / NODE_MODULE_VERSION 不一致。`,
  };
}

/**
 * 生成可执行的修复指引。
 *
 * @param {number|null} major 当前主版本号
 * @returns {string} 多行指引文本
 */
export function buildFixGuidance(major) {
  const pinned = PINNED_NODE_MAJOR;
  const lines = [
    '怎么修（任选其一）：',
    `  1) 切到受支持的 Node 版本（本项目实测 ${SUPPORTED_NODE_MAJORS.join(' / ')}）：`,
    `       nvm install ${pinned} && nvm use ${pinned}`,
    `       fnm install ${pinned} && fnm use ${pinned}`,
    `       asdf install nodejs ${pinned}.16.0 && asdf local nodejs ${pinned}.16.0`,
    '     仓库根的 .nvmrc / .node-version 已钉住 ' + pinned + '，nvm / fnm 会自动采用。',
    '  2) 用官方容器镜像（内含 Node ' + pinned + '，宿主机无需装 Node）：',
    '       docker compose up -d',
    '  3) 确实要用别的 Node 版本：必须让原生模块按新 ABI 重新编译 ——',
    '     保留旧 node_modules 只会继续复用 ABI 不匹配的二进制：',
    '       rm -rf node_modules && pnpm install',
  ];
  if (major !== null && major === 21) {
    lines.push(
      '     注：Node 21 不是 LTS，且 better-sqlite3 官方不提供 21.x 预编译产物，',
      '     重装后仍需要本地编译工具链（python3 + make + g++），不建议用于生产。',
    );
  }
  return lines.join('\n');
}

/**
 * 组装完整的失败文案（标题 + 原因 + 修复指引）。
 *
 * @param {string} version 当前版本串
 * @param {ReturnType<typeof checkNodeVersion>} [check] 已算好的判定结果
 * @returns {string}
 */
export function formatUnsupportedMessage(version, check = checkNodeVersion(version)) {
  if (check.ok) return '';
  const head = `[NodeRuntime] FATAL: ${check.message}`;
  return `${head}\n\n${buildFixGuidance(check.major)}\n`;
}

/**
 * 以主模块方式运行时：判定当前 Node 版本，不受支持就打印并退出码 1。
 *
 * @returns {void}
 */
export function runCliGuard() {
  const result = checkNodeVersion(process.version);
  if (result.ok) return;
  console.error(formatUnsupportedMessage(process.version, result));
  process.exit(1);
}

// 仅在作为主入口脚本执行时唤起（被 import 时不触发 —— server / CLI 侧各自按需调用）
const invokedDirectly =
  process.argv[1] &&
  (process.argv[1].endsWith('assert-node-runtime.mjs') ||
    process.argv[1].endsWith('assert-node-runtime') ||
    process.argv[1].includes('assert-node-runtime'));

if (invokedDirectly) {
  runCliGuard();
}
