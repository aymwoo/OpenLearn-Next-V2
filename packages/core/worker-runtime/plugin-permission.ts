/**
 * 插件能力面收敛（L-1 P2）：Node Permission Model。
 *
 * ## 为什么需要它
 *
 * P1 只解决了**崩溃**隔离（子进程爆炸半径 = 一个进程）与**环境变量**泄漏
 * （`buildMinimalEnv` 白名单）。但插件仍能在**同一个操作系统用户**的权限下
 * 任意读写文件、拉起子进程、创建 worker。宿主自身的源码、`.env`、其它插件的
 * 目录都在它的射程内 —— 而 P1 的进程隔离对「主动恶意」无效：一个进程能做的事，
 * 它的子进程也能做。
 *
 * Node 的权限模型（`--permission`）把这一层补上。
 *
 * ## 实测结论（Node v24.1.0）—— 先测再写，别照抄文档
 *
 * | 能力 | `--permission` 最小权限下 | 备注 |
 * | --- | --- | --- |
 * | data URL 动态 `import()`（**插件加载路径本身**） | ✅ 放行 | **不被打断**，这是方案能落地的前提 |
 * | `eval` / `new Function` | ⛔ `EvalError` | 由 `--disallow-code-generation-from-strings` 拦，**该旗标独立于** `--permission` |
 * | 读 / 写 `pluginDir`（含嵌套 `node_modules`） | ✅ 放行 | 通配符 `*` **会跨 `/`** |
 * | 读 `pluginDir` 之外（如 `/etc/hostname`） | ⛔ `ERR_ACCESS_DENIED` | |
 * | `child_process` 拉子进程 | ⛔ 默认即禁 | 需显式 `--allow-child-process` 才放行 |
 * | 创建 worker | ⛔ 默认即禁 | 同上，需 `--allow-worker` |
 * | IPC `process.send` / `on('message')` | ✅ 放行 | transport 不受影响 |
 * | **网络（`net` / `dns` / `http`）** | ⚠️ **完全不受限** | 本版本**没有** `--allow-net` 旗标，无法收紧 |
 *
 * ### 旗标名在版本间变过
 *
 * 提案原文写的是 `--experimental-permission`。**Node v24.1.0 已不接受该旗标**
 * （实测 `bad option: --experimental-permission`）—— 它在 Node 23.5.0 随权限模型
 * 转正时被移除。本模块统一用 `--permission`。
 *
 * ## 两个必须说清的缺口
 *
 * 1. **不覆盖网络。** 没有 `--allow-net`，插件在权限模式下仍可任意发起出站连接，
 *    也可读任意 DNS。要收敛只能靠别的东西（见 `docs/architecture/`
 *    `plugin-worker-isolation-l1-proposal.md` 的后续规划）。
 * 2. **不覆盖 CPU。** 权限模型管的是「能做什么」，不是「能算多久」。吃 CPU 但让出
 *    事件循环的插件仍能通过存活探活 —— 那一类要靠进程级资源配额，不是这里。
 *
 * ## 与 `ctx.require` 共享模块的协调
 *
 * bootstrap 里 `createRequire('<宿主 cwd>/package.json')` 意味着共享模块
 * （`PLUGIN_SHARED_MODULES`：recharts / jspdf / exceljs …）是从**仓库的
 * `node_modules`** 解析的，不在 `pluginDir` 内。所以权限模式必须额外放行
 * `<root>/node_modules/*` 的**读**，否则 `ctx.require('jspdf')` 会被拒。
 *
 * 放行的范围刻意只到 `node_modules` 子树：宿主自己的源码、`.env`、迁移文件
 * 都读不到。代价是该子树下的任何文件对插件可读 —— 里面只有 JS 依赖，可接受。
 */

/** 能力面策略 */
export type PluginPermissionPolicy =
  /** 读 pluginDir + 共享依赖；写 pluginDir。禁子进程、禁 worker、禁 eval —— 默认 */
  | 'rw'
  /** 同 `rw` 但不可写。适合纯计算类插件 */
  | 'ro'
  /** 完全关闭权限模型（逃生舱：合法需要 spawn / 联网 / 写外部路径的插件） */
  | 'off';

export const PERMISSION_POLICIES: readonly PluginPermissionPolicy[] = ['rw', 'ro', 'off'];

/** 默认策略：只给 pluginDir 的读写 + 共享依赖的读 */
export const DEFAULT_PERMISSION_POLICY: PluginPermissionPolicy = 'rw';

export interface PermissionSpec {
  policy: PluginPermissionPolicy;
  /** 插件自己的目录；同时是它的依赖安装目标 */
  pluginDir?: string;
  /** 宿主工作目录（`ctx.require` 共享模块从这里解析） */
  rootPath?: string;
}

/**
 * 归一化环境变量取值。
 *
 * 未知值落到**默认策略**而不是 `off` —— 因为 `off` 是权限最宽的那个，
 * 把拼错的 `OPENLEARN_PLUGIN_PERMISSION=rw-only` 当成 `off` 会静默关掉隔离，
 * 而拼错 `...=false` 的人多半是想关。方向相反才安全。
 */
export function normalizePermissionPolicy(raw: unknown): PluginPermissionPolicy {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : undefined;
  if (v === 'rw' || v === 'ro' || v === 'off') return v;
  return DEFAULT_PERMISSION_POLICY;
}

/** 归一化路径并转成正斜杠 —— Node 权限模型的通配符不认反斜杠 */
function globPath(p: string): string {
  return `${p.replace(/\\/g, '/').replace(/\/+$/, '')}/*`;
}

/**
 * 构造权限模型旗标。
 *
 * ## 为什么**从不**加 `--allow-child-process` / `--allow-worker`
 *
 * 这两个旗标是 P2 要拦的核心：它们让插件能拉起**不受权限模型约束**的新执行单元 ——
 * 加上 `--allow-child-process`，插件 spawn 出来的孙进程就不再是权限模式的受限上下文，
 * 沙箱当场失效。所以除非 `policy === 'off'`（整体关掉权限模型），
 * 否则一律不给。
 */
export function buildPermissionArgs(spec: PermissionSpec): string[] {
  if (spec.policy === 'off') return [];

  const args: string[] = [
    // 启用权限模型
    '--permission',
    // 代码生成禁令。**独立于** --permission 生效，且是内核级保证 ——
    // 比 worker-manager 里那套源码 lint 强：lint 要靠正则匹配源码，
    // 而字符串拼接出的 eval 根本不在源码里（见下方「与 lint 的关系」）。
    '--disallow-code-generation-from-strings',
  ];

  // 插件自己的目录（含其 node_modules）
  if (spec.pluginDir) {
    args.push(`--allow-fs-read=${globPath(spec.pluginDir)}`);
    if (spec.policy === 'rw') args.push(`--allow-fs-write=${globPath(spec.pluginDir)}`);
  }

  // 共享模块解析目标。只放行 node_modules 子树，宿主源码/.env 仍不可读。
  if (spec.rootPath) {
    args.push(`--allow-fs-read=${globPath(`${spec.rootPath}/node_modules`)}`);
  }

  return args;
}

/**
 * 拼出诊断串，写进子进程 stderr 前的日志与文档，避免使用者面对
 * `Use --allow-fs-write to manage permissions` 时不知道该改哪里。
 */
export function describePermissionPolicy(spec: PermissionSpec): string {
  if (spec.policy === 'off') return '权限模型关闭（插件拥有宿主用户的全部文件/进程能力）';
  const bits = ['可读 pluginDir', '可读共享依赖 node_modules'];
  if (spec.pluginDir) bits.push(spec.policy === 'rw' ? '可写 pluginDir' : '只读');
  bits.push('禁 eval/new Function', '禁 spawn 子进程', '禁创建 worker');
  bits.push('⚠ 网络不受限（本版本无 --allow-net）');
  return `权限模型[${spec.policy}]：${bits.join('；')}`;
}
