/**
 * 第三方插件的执行模式策略（审计 H-4）。
 *
 * `normalizeExecutionMode` 只做「脏字符串 → 合法枚举」，未知值仍落成 `inline`，
 * 那是可预测的归一化，不是信任决策。信任决策在这里：
 *
 * - 只有 `@openlearn/` 内置插件，或管理员写进 `OPENLEARN_TRUSTED_INLINE_PLUGINS`
 *   的 manifest id，可以在宿主进程内运行（`inline` / `worker`）。
 * - 其余插件一律 `process`：子进程 + `buildMinimalEnv` 白名单，不继承宿主的
 *   密钥类环境变量。插件清单自己写 `executionMode: inline` 无效。
 *
 * Vitest 会设置 `VITEST`。生命周期夹具大量使用非内置 id 走 inline 路径，
 * 因此测试进程默认视为受信任，除非该用例显式设置
 * `OPENLEARN_ENFORCE_PLUGIN_ISOLATION=1`。生产进程没有 `VITEST`，这条例外不生效。
 */

import { normalizeExecutionMode, type PluginExecutionMode } from './types.js';

const TRUSTED_PREFIX = '@openlearn/';

export function trustedInlineAllowlist(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.OPENLEARN_TRUSTED_INLINE_PLUGINS ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );
}

export function isTrustedInProcessPlugin(
  manifestId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!manifestId) return false;
  if (manifestId.startsWith(TRUSTED_PREFIX)) return true;
  if (trustedInlineAllowlist(env).has(manifestId)) return true;
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
 */
export function resolvePluginExecutionMode(
  manifestId: string | null | undefined,
  requested: unknown,
  env: NodeJS.ProcessEnv = process.env,
): ExecutionModeDecision {
  const normalized = normalizeExecutionMode(requested);
  if (isTrustedInProcessPlugin(manifestId, env)) {
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
      `requested "${normalized}" was forced to "process"`,
  };
}
