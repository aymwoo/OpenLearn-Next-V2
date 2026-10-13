/**
 * 插件公开路由的管理员批准表（审计 H-4）。
 *
 * manifest 里的 `auth: false` 只表示插件**希望**匿名访问，不是授权。
 * 网关放行匿名请求的唯一条件是：该 method + path 同时出现在本表中。
 * 行由管理员在安装时传入 `approvePublicRoutes: true`，或事后调用
 * `POST /api/plugins/:id/public-routes` 写入。
 */

import type Database from 'better-sqlite3';

export interface PublicRouteRef {
  method: string;
  path: string;
}

export function ensurePublicRouteTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_public_routes (
      plugin_key TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      approved_at INTEGER NOT NULL,
      PRIMARY KEY (plugin_key, method, path)
    );
  `);
}

export function declaredPublicRoutes(manifest: unknown): PublicRouteRef[] {
  const api = (manifest as { api?: { routes?: unknown } } | null | undefined)?.api;
  const routes = Array.isArray(api?.routes) ? api.routes : [];
  const out: PublicRouteRef[] = [];
  for (const raw of routes) {
    if (!raw || typeof raw !== 'object') continue;
    const route = raw as { method?: unknown; path?: unknown; auth?: unknown };
    if (route.auth !== false) continue;
    if (typeof route.method !== 'string' || typeof route.path !== 'string') continue;
    if (!route.path.startsWith('/')) continue;
    out.push({ method: route.method.toUpperCase(), path: route.path });
  }
  return out;
}

/** 批准 manifest 中声明了 `auth: false` 的路由。返回实际写入的 `METHOD path` 列表。 */
export function approveDeclaredPublicRoutes(db: Database.Database, pluginKeys: string[], manifest: unknown): string[] {
  ensurePublicRouteTable(db);
  const routes = declaredPublicRoutes(manifest);
  const keys = [...new Set(pluginKeys.filter((key) => key.length > 0))];
  const stmt = db.prepare(
    `INSERT INTO plugin_public_routes (plugin_key, method, path, approved_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(plugin_key, method, path) DO UPDATE SET approved_at = excluded.approved_at`,
  );
  const now = Date.now();
  const approved = new Set<string>();
  const write = db.transaction(() => {
    for (const key of keys) {
      for (const route of routes) {
        stmt.run(key, route.method, route.path, now);
        approved.add(`${route.method} ${route.path}`);
      }
    }
  });
  write();
  return [...approved];
}

export function clearPublicRouteApprovals(db: Database.Database, pluginKeys: string[]): void {
  try {
    ensurePublicRouteTable(db);
    const stmt = db.prepare('DELETE FROM plugin_public_routes WHERE plugin_key = ?');
    for (const key of pluginKeys) {
      if (key) stmt.run(key);
    }
  } catch {
    // 测试库可能没有写权限或尚未建表；卸载清理失败不应挡住卸载本身。
  }
}

export function isPublicRouteApproved(
  db: Database.Database,
  pluginKeys: string[],
  method: string,
  routePath: string,
): boolean {
  const keys = pluginKeys.filter((key) => key.length > 0);
  if (keys.length === 0 || !method || !routePath) return false;
  try {
    ensurePublicRouteTable(db);
    const stmt = db.prepare(
      `SELECT 1 AS ok FROM plugin_public_routes
        WHERE plugin_key = ? AND method = ? AND path = ?
        LIMIT 1`,
    );
    const upper = method.toUpperCase();
    return keys.some((key) => stmt.get(key, upper, routePath) !== undefined);
  } catch {
    return false;
  }
}
