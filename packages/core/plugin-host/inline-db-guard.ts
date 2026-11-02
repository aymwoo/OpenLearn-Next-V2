/**
 * inline 插件的 SQL 守卫（Issue #367）。
 *
 * ## 背景
 *
 * `assertPluginSqlAllowed()` 此前只有 worker / process 路径（`service-host.ts`）调用，
 * 于是同一份代码在两种执行模式下安全口径完全不同：
 *
 * - inline 受信插件直查 `classes` / `students` / `whiteboard_elements` 能跑；
 * - 一旦移出信任名单切到 worker，同一段代码在同一个版本里一次性全炸；
 * - 插件作者本地跑的是「守卫不生效」的那条路径，事前没有任何信号。
 *
 * ## 为什么用开关而不是默认开启
 *
 * 默认开启会让一批存量 inline 插件在升级后立刻拒绝启动（它们普遍存在核心表直查与裸 DDL）。
 * 因此提供 `OPENLEARN_SQL_GUARD_ALL_MODES=1`：作者在本地打开自查，生产按需收紧。
 * 开关只影响 `ctx.resolve(IDatabaseToken)` 拿到的原始句柄，不改任何业务语义。
 */

import { assertPluginSqlAllowed } from './sql-guard.js';
import { listAllowedPluginTablePrefixes, pluginTablePrefix } from './plugin-tables.js';

const SQL_GUARD_ERROR_PREFIX = '[PluginHost] SQL 被拒绝';

/** `OPENLEARN_SQL_GUARD_ALL_MODES` 是否开启（1 / true / on / yes）。 */
export function isSqlGuardAllModesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.OPENLEARN_SQL_GUARD_ALL_MODES?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
}

type AnyDb = Record<PropertyKey, unknown>;

/**
 * 给原始 better-sqlite3 句柄套一层 SQL 守卫。
 *
 * 拦截 `prepare` / `exec` / `pragma` 三个入口 —— 插件能执行任意 SQL 只能经过它们；
 * 其余方法（事务、原生绑定等）原样透传，避免破坏事务语义。
 */
export function createGuardedPluginDatabase<T>(db: T, pluginId: string, manifestId?: string): T {
  const ownPrefix = pluginTablePrefix(pluginId, manifestId);
  const allowedPrefixes = listAllowedPluginTablePrefixes(pluginId, manifestId);

  const assertSql = (sql: unknown): void => {
    try {
      assertPluginSqlAllowed({ sql: typeof sql === 'string' ? sql : String(sql ?? ''), ownPrefix, allowedPrefixes });
    } catch (err: any) {
      const message = err?.message ? String(err.message) : String(err);
      const wrapped = new Error(`${SQL_GUARD_ERROR_PREFIX}：${message}（插件 "${pluginId}"）`);
      (wrapped as Error & { code?: string }).code = 'PLUGIN_SQL_REJECTED';
      throw wrapped;
    }
  };

  return new Proxy(db as unknown as AnyDb, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;

      if (prop === 'prepare') {
        return (sql: string, ...rest: unknown[]) => {
          assertSql(sql);
          return (value as (...args: unknown[]) => unknown).call(target, sql, ...rest);
        };
      }
      if (prop === 'exec') {
        return (sql: string, ...rest: unknown[]) => {
          assertSql(sql);
          return (value as (...args: unknown[]) => unknown).call(target, sql, ...rest);
        };
      }
      if (prop === 'pragma') {
        return (source: string, ...rest: unknown[]) => {
          // pragma() 的入参不带 PRAGMA 关键字，补上再交给守卫的禁用项检测
          assertSql(`PRAGMA ${String(source ?? '')}`);
          return (value as (...args: unknown[]) => unknown).call(target, source, ...rest);
        };
      }
      return (value as (...args: unknown[]) => unknown).bind(target);
    },
  }) as unknown as T;
}
