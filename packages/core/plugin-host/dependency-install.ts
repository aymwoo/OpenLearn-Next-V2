/**
 * 插件 npm 依赖的安装与校验（H-4 / 原始编号 L-3）。
 *
 * ## 这个模块要解决的三个问题
 *
 * **① 硬编码 `registry.npmmirror.com`**
 * 两条安装路径都把 registry 写死成 npmmirror。后果有三：
 *   · 所有部署（包括境外服务器）都被强制走同一家镜像，镜像故障即全平台装不上依赖；
 *   · 供应链信任面被静默固定到一个第三方域名，而 `manifest.dependencies` 的解析结果
 *     直接决定要执行哪些代码（`--ignore-scripts` 之外仍有 require 面）；
 *   · 私有 registry / 内网源的部署者无法覆盖，只能改代码。
 *
 * 改为：**默认不传 `--registry`**（即用 npm 自身的配置与环境），需要时用
 * `OPENLEARN_NPM_REGISTRY` 显式覆盖。生产不设该变量 ⇒ 行为回归 npm 原生语义。
 *
 * **② 安装失败被吞掉，插件仍进入 ACTIVE**
 * 原实现在两条路径上都是 `catch { console.error(...) }` 然后继续往下走 ——
 * 部署脚本、贡献注册、DB 落库、状态机全都照常执行，最后插件是 ACTIVE 的，
 * 只是 `node_modules` 残缺。故障会以「插件运行时莫名报 MODULE_NOT_FOUND」的形式
 * 在**很久之后**、在**别的上下文**里出现，而不是在安装点。
 *
 * 改为：`installPluginDependencies()` **抛错**，由调用方决定策略；
 * 两处调用点都改成向上传播，让安装事务整体回滚。
 *
 * **③ 更新路径漏 `--ignore-scripts`**
 * 安装路径有 `--ignore-scripts`（SEC-RCE-01，防 postinstall 钩子执行任意命令），
 * 更新路径**没有**。于是「装一次安全、从市场更新一次就不安全」——
 * 而更新是第三方插件最常见的安装途径。这个不一致本身就是漏洞。
 *
 * 两条路径现在共用同一函数，参数与行为完全一致，不可能再漂移。
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** 依赖安装失败。调用方应向上传播，使安装事务回滚。 */
export class DependencyInstallError extends Error {
  constructor(
    message: string,
    readonly pluginId: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DependencyInstallError';
  }
}

/**
 * 拼出 npm install 的参数数组。
 *
 * 刻意用 `execFileSync(参数数组)` 而非 `execSync(命令字符串)`：
 * 后者要自己处理引号，且参数拼接处是命令注入面（`cwd` 与参数都由外部数据拼出）。
 *
 * @param registry - 显式 registry；不给则不传 `--registry`，用 npm 自身配置
 */
function buildArgs(registry: string | undefined): string[] {
  const args = [
    'install',
    // 只装生产依赖：插件的 devDependencies 不该进运行时
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    // npm 7+ 对 peer deps 严格校验，第三方插件常声明不完整的 peerDeps；
    // 沿用既有行为，不在本项范围内改变语义
    '--legacy-peer-deps',
    // SEC-RCE-01：禁止 postinstall/preinstall 钩子执行任意命令。
    // 注意：这条**必须**在安装与更新两条路径上都存在，否则「更新」就成了绕过通道。
    '--ignore-scripts',
  ];
  if (registry) args.push(`--registry=${registry}`);
  return args;
}

/** 读 `OPENLEARN_PLUGINS_NPM_REGISTRY`；未设或空白则返回 undefined（用 npm 默认） */
function resolveRegistry(): string | undefined {
  const raw = process.env.OPENLEARN_PLUGINS_NPM_REGISTRY;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * 校验 lockfile 的完整性：每个声明的依赖都必须在 lockfile 里有落点。
 *
 * ## 为什么需要这一步
 *
 * `npm install` 退出码为 0 **不等于**依赖都装上了。实测过的失败形态：
 * registry 返回 404 的 tarball、lockfile 与 package.json 不一致导致静默跳过、
 * `--omit=dev` 误伤被误标为 dev 的包。这些情况下 npm 可能仍以 0 退出。
 *
 * 若不校验，故障会以「插件激活后 MODULE_NOT_FOUND」的形式在别处暴露，
 * 定位成本远高于在这里报「依赖 X 未落 lockfile」。
 *
 * ## 检查方式与它的边界
 *
 * 检查「声明的依赖名是否作为 lockfile 里某个 package 的 name 出现」——
 * 这是**存在性**检查，不是完整性校验（不做 hash/semver 比对）。
 * 够用的理由：lockfile 本身由 npm 生成且带 integrity 字段，
 * 我们要防的是「依赖压根没被装」这一类，不是「被篡改」那一类。
 */
export function assertDependenciesResolved(
  pluginDir: string,
  dependencies: PluginDependencies,
  pluginId: string,
): void {
  const names = dependencyNames(dependencies);
  // 无依赖声明：nothing to verify
  if (names.length === 0) return;

  const lockPath = path.join(pluginDir, 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    throw new DependencyInstallError(
      `依赖安装未产出 package-lock.json —— 无法确认依赖已落盘。pluginId=${pluginId}，声明依赖：${names.join(', ')}`,
      pluginId,
    );
  }

  let lock: { packages?: Record<string, { name?: string }>; dependencies?: Record<string, unknown> };
  try {
    lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as typeof lock;
  } catch (err) {
    throw new DependencyInstallError(
      `package-lock.json 不是合法 JSON —— 依赖安装结果不可信。pluginId=${pluginId}`,
      pluginId,
      err,
    );
  }

  // lockfile v2/v3 用 packages（键是 node_modules/xxx 路径），v1 用 dependencies（键是包名）
  const landed = new Set<string>();
  for (const [key, meta] of Object.entries(lock.packages ?? {})) {
    if (meta?.name) landed.add(meta.name);
    const tail = key.split('node_modules/').pop();
    if (tail) landed.add(tail);
  }
  for (const name of Object.keys(lock.dependencies ?? {})) landed.add(name);

  const missing = names.filter((n) => !landed.has(n));
  if (missing.length > 0) {
    throw new DependencyInstallError(
      `以下声明依赖未出现在 package-lock.json 中，视为安装失败：${missing.join(', ')}（pluginId=${pluginId}）`,
      pluginId,
    );
  }
}

/**
 * 插件依赖声明的两种形态。
 *
 * 实测线上真实形态是 **npm 的对象写法**（`{"cookie": "^0.5.0"}`，见仓库
 * `plugins` 目录下各插件的 manifest.json），调用点也是用
 * `Object.keys(manifest.dependencies)` 判空的。
 * 数组写法（`["exceljs@^4.0.0"]`）一并接受，便于将来 schema 收敛到更严格的类型。
 *
 * 注意：`dependencies` **不在 manifestSchema 里**（manifest-schema.ts 中无此字段），
 * 所以它的类型来自插件作者的自由书写 —— 这也是这里必须两种形态都容忍的原因。
 */
export type PluginDependencies = Record<string, string> | string[] | undefined;

/** 把两种形态统一成 `{ 包名: semver 范围 }` */
export function toNpmDependencyMap(dependencies: PluginDependencies): Record<string, string> {
  if (!dependencies) return {};

  // 对象形态：已是 npm 写法，原样透传（键是包名，值是范围）
  if (!Array.isArray(dependencies)) {
    const out: Record<string, string> = {};
    for (const [name, range] of Object.entries(dependencies)) {
      if (typeof name === 'string' && name.length > 0) out[name] = typeof range === 'string' && range ? range : '*';
    }
    return out;
  }

  // 数组形态：`exceljs@^4.0.0` / `uuid` / `@scope/name@^1`
  const out: Record<string, string> = {};
  for (const spec of dependencies) {
    if (typeof spec !== 'string' || spec.length === 0) continue;
    const at = spec.lastIndexOf('@');
    if (at > 0) out[spec.slice(0, at)] = spec.slice(at + 1) || '*';
    else out[spec] = '*';
  }
  return out;
}

/**
 * 把 `manifest.dependencies`（类型为 `unknown`）窄化为受支持的两种形态。
 *
 * ## 为什么要运行时窄化而不是 `as PluginDependencies`
 *
 * `dependencies` **不在 manifestSchema 里**，所以它的类型是 `unknown` ——
 * 值完全由插件作者书写。直接 `as` 断言等于「相信作者写了正确形状」，
 * 而 `manifest.dependencies = "cookie"` 这种写法会让后续 `Object.keys()` 拿到
 * 字符索引、`toNpmDependencyMap` 静默产出 `{}`，于是依赖**装不上也不报错** ——
 * 又一次「故障在别处才出现」。
 *
 * 形状非法时抛错，让安装事务在这里就失败。
 *
 * @param value - manifest.dependencies 原始值
 * @param pluginId - 报错信息用的插件 id
 */
export function parsePluginDependencies(value: unknown, pluginId: string): PluginDependencies {
  if (value === undefined || value === null) return undefined;

  // 数组形态
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === 'string')) return value as string[];
    throw new DependencyInstallError(
      `manifest.dependencies 数组形态里出现了非字符串元素：${JSON.stringify(value)}（pluginId=${pluginId}）`,
      pluginId,
    );
  }

  // 对象形态：值必须是字符串（semver 范围），否则 npm 会拒绝或装错版本
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const bad = entries.filter(([, v]) => typeof v !== 'string');
    if (bad.length > 0) {
      throw new DependencyInstallError(
        `manifest.dependencies 的值必须是 semver 字符串，以下键的值不合法：${bad
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(', ')}（pluginId=${pluginId}）`,
        pluginId,
      );
    }
    return value as Record<string, string>;
  }

  // string / number / boolean 等：形状本身就不被支持
  throw new DependencyInstallError(
    `manifest.dependencies 形态不被支持：期望 { 包名: semver } 对象或字符串数组，实际收到 ${typeof value}` +
      `（pluginId=${pluginId}）`,
    pluginId,
  );
}

/** 依赖的包名集合，用于 lockfile 落点校验 */
function dependencyNames(dependencies: PluginDependencies): string[] {
  return Object.keys(toNpmDependencyMap(dependencies));
}

export interface InstallDepsOptions {
  /** manifest.id，仅用于报错信息 */
  pluginId: string;
  /** manifest.dependencies（npm 对象写法为主，数组写法亦可） */
  dependencies?: PluginDependencies;
  /**
   * 操作标签，进入报错信息以区分安装 / 更新。
   * 默认 'install'。存在的原因见文件头 ③：两条路径曾经一个带 --ignore-scripts
   * 一个不带，共用本函数后行为不可能再漂移，但报错信息仍需能区分是哪条路径。
   */
  operation?: 'install' | 'update';
}

/** 执行 npm 的函数签名（与 `execFileSync` 兼容） */
export type NpmExecutor = (
  command: string,
  args: string[],
  options: { cwd: string; stdio: 'ignore'; timeout: number; env: NodeJS.ProcessEnv },
) => unknown;

/**
 * 为插件安装 npm 依赖。**失败时抛错**，不吞异常。
 *
 * @param runNpm - npm 执行器，默认为 `execFileSync`。刻意做成可注入而非依赖
 *   `vi.mock`：测试要断言的是「最终传给 npm 的参数数组」，
 *   走 mock node:child_process 会把测试绑在 vitest 的模块拦截机制上
 *   （实测该机制在本仓库 `pool: 'forks'` 下对 `node:` 内置模块不生效，
 *     而失败形态是「断言读到空数组」—— 又是空转）。
 *   注入一个记录器则完全确定。
 *
 * @throws DependencyInstallError - npm 执行失败或 lockfile 校验不通过
 */
export function installPluginDependencies(
  pluginDir: string,
  opts: InstallDepsOptions,
  runNpm: NpmExecutor = execFileSync,
): void {
  const { pluginId, dependencies, operation = 'install' } = opts;

  // 无依赖声明则不调 npm —— 省一次子进程启动，也让「无依赖插件」不依赖 npm 可用。
  //
  // 判空用归一化后的 map，而不是 `Array.isArray(dependencies)`：
  // 真实形态是 npm 的**对象**写法（`{ cookie: '^0.5.0' }`），
  // 按数组判断会让所有对象形态的插件**静默跳过依赖安装** ——
  // 而测试恰好因为「默认不传 --registry」这个断言而通过，把 bug 掩盖了。
  // 这也是本轮第三次「断言与被测对象不一致」：断言测的是参数，
  // 而实际根本没走到产生参数的代码。
  const depMap = toNpmDependencyMap(dependencies);
  if (Object.keys(depMap).length === 0) return;

  const pkgJsonPath = path.join(pluginDir, 'package.json');
  // version 用 manifest 里的值才有意义，但此处拿不到 —— dependency-install 不关心版本，
  // 由调用方在写 package.json 后自行修正；留 0.0.0 是 npm 唯一接受的占位（空串会被拒）
  fs.writeFileSync(
    pkgJsonPath,
    JSON.stringify({ name: pluginId, version: '0.0.0', dependencies: depMap }, null, 2),
    'utf-8',
  );

  const registry = resolveRegistry();
  const args = buildArgs(registry);
  if (registry) {
    console.log(`[PluginHost] Installing dependencies for "${pluginId}" via registry ${registry}`);
  }

  try {
    // 用 execFileSync(参数数组) 而非 execSync(命令字符串)：后者需自行处理引号，
    // 且拼接命令串本身是注入面（pluginDir 来自解压产物路径）
    runNpm('npm', args, {
      cwd: pluginDir,
      stdio: 'ignore',
      timeout: 10 * 60_000,
      // --registry 给了就以它为准；没给则让 npm 读自己的 .npmrc / 环境变量
      // （这是「不再硬编码 npmmirror」的关键）
      env: { ...process.env, npm_config_update_notifier: 'false' },
    });
  } catch (err) {
    throw new DependencyInstallError(
      `npm install 失败（${operation}，pluginId=${pluginId}，registry=${registry ?? 'npm 默认'}）`,
      pluginId,
      err,
    );
  }

  // 退出码 0 不等于依赖都装上了 —— 必须查 lockfile（见 assertDependenciesResolved 注释）
  assertDependenciesResolved(pluginDir, dependencies, pluginId);
}
