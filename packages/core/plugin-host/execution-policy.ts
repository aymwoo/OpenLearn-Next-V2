/**
 * 第三方插件的执行模式策略。
 *
 * 进程内身份（inline / worker）只来自两处：
 * - 管理员写进 `OPENLEARN_TRUSTED_INLINE_PLUGINS` 的 manifest id
 * - 插件文件真实位于内置目录 `packages/plugins`
 *
 * manifest id 以 `@openlearn/` 开头不能证明它是官方插件。
 * 预加载进宿主的内置代码由 PluginHost 在调用本函数之前单独放行。
 *
 * Vitest 会设置 `VITEST`。生命周期夹具大量使用非内置 id 走 inline 路径，
 * 因此测试进程默认视为受信任，除非该用例显式设置
 * `OPENLEARN_ENFORCE_PLUGIN_ISOLATION=1`。生产进程没有 `VITEST`，这条例外不生效。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeExecutionMode, type PluginExecutionMode } from './types.js';

export function trustedInlineAllowlist(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.OPENLEARN_TRUSTED_INLINE_PLUGINS ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );
}

/**
 * 名单条目的匹配规则（**仅用于进程内信任判定**）。
 *
 * - `*` —— 匹配任意 manifest id，即「所有插件都允许进程内运行」；
 * - `前缀*` —— 前缀匹配，如 `@ext/*`、`openlearn-plugin-*`；
 * - 其它 —— 精确相等。
 *
 * 为什么需要通配：精确名单在「本地反覆装/卸若干自研插件」的开发场景里维护成本很高，
 * 而写错的后果是**静默降档**（插件被改成子进程，前端 iframe 沙箱里缺宿主上下文，
 * 表现为「装了但页面不出来」，且不报任何错）。宁可将「全部信任」写成一个显式、
 * 可 grep、启动时会被大声告警的 `*`，也不要逼人去维护一串容易漏项的 id。
 *
 * 注意：本函数**不**参与 `isSystemPluginRecord()`（系统插件判定，会阻断更新与卸载）
 * —— 那里继续用精确 `has()`。「允许进程内运行」与「官方/系统插件」是两件事，
 * 否则一个 `*` 会把所有第三方插件变成不可更新、不可卸载。
 */
export function matchesTrustedInlinePattern(pattern: string, manifestId: string | null | undefined): boolean {
  if (!manifestId) return false;
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) return manifestId.startsWith(pattern.slice(0, -1));
  return pattern === manifestId;
}

/** 该 manifest id 是否命中信任名单（支持 `*` 与前缀通配）。 */
export function isInTrustedInlineAllowlist(
  manifestId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!manifestId) return false;
  for (const pattern of trustedInlineAllowlist(env)) {
    if (matchesTrustedInlinePattern(pattern, manifestId)) return true;
  }
  return false;
}

/** 仓库内置插件源码目录。安装到 `plugins/<uuid>` 的包不在这里。 */
export function builtinPluginsDir(): string {
  try {
    const url = import.meta.url;
    if (typeof url === 'string' && url.startsWith('file:')) {
      return path.resolve(path.dirname(fileURLToPath(url)), '../../plugins');
    }
  } catch {
    // dist/server.cjs 里 import.meta.url 为空，fileURLToPath 会抛。
  }
  if (typeof __dirname !== 'undefined') {
    return path.resolve(__dirname, '../packages/plugins');
  }
  return path.resolve(process.cwd(), 'packages/plugins');
}

export function isInsideBuiltinPluginsDir(
  sourcePath: string | null | undefined,
  builtinDir: string = builtinPluginsDir(),
): boolean {
  if (!sourcePath) return false;
  const root = path.resolve(builtinDir);
  const resolved = path.resolve(sourcePath);
  const relative = path.relative(root, resolved);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function isTrustedInProcessPlugin(
  manifestId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  sourcePath?: string | null,
): boolean {
  if (isInsideBuiltinPluginsDir(sourcePath)) return true;
  // 名单支持通配（`*` / `前缀*`），见 matchesTrustedInlinePattern 的注释。
  if (isInTrustedInlineAllowlist(manifestId, env)) return true;
  if (env.VITEST && env.OPENLEARN_ENFORCE_PLUGIN_ISOLATION !== '1') return true;
  return false;
}

export interface ExecutionModeDecision {
  mode: PluginExecutionMode;
  /** 请求的模式被策略改写（通常是 inline/worker → process） */
  coerced: boolean;
  reason?: string;
}

/**
 * 把「调用方想要的模式」收成实际允许的模式。
 *
 * `requested` 可以是 manifest、管理员覆盖或 DB 里的任意字符串。
 * `sourcePath` 是插件入口或目录。只有它落在内置目录里时，路径本身才构成信任。
 */
export function resolvePluginExecutionMode(
  manifestId: string | null | undefined,
  requested: unknown,
  env: NodeJS.ProcessEnv = process.env,
  sourcePath?: string | null,
): ExecutionModeDecision {
  const normalized = normalizeExecutionMode(requested);
  if (isTrustedInProcessPlugin(manifestId, env, sourcePath)) {
    return { mode: normalized, coerced: false };
  }
  if (normalized === 'process') {
    return { mode: 'process', coerced: false };
  }
  return {
    mode: 'process',
    coerced: true,
    reason:
      `Plugin "${manifestId ?? '(unknown)'}" is not trusted for in-process execution; ` +
      `requested "${normalized}" was forced to "process". ` +
      `Trust requires OPENLEARN_TRUSTED_INLINE_PLUGINS or the built-in plugins directory.`,
  };
}
