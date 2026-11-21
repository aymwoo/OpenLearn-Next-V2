/**
 * 旧 `/api/activities/*` 别名调用计数（Phase 2 后续）。
 *
 * 目的：在摘除别名前，用真实调用数据判断是否仍有外部客户端依赖。
 * - 纯内存、按 `METHOD 路由模式` 聚合（路由模式取自 `req.route.path`，
 *   不会因 id 不同而无限膨胀）；
 * - 键上限 `MAX_KEYS`，超限淘汰最早出现的键，保持内存有界；
 * - 只读快照经 `GET /api/system/legacy-activity-routes` 暴露给管理员。
 */

/** 路由键上限（崩溃兜底；正常别名路由数量远小于此值）。 */
const MAX_KEYS = 100;

export interface LegacyActivityRouteUsageItem {
  route: string;
  count: number;
  lastSeenAt: number;
}

export interface LegacyActivityRouteUsageSnapshot {
  total: number;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  routes: LegacyActivityRouteUsageItem[];
}

interface RouteUsageEntry {
  count: number;
  lastSeenAt: number;
}

const usage = new Map<string, RouteUsageEntry>();
let total = 0;
let firstSeenAt: number | null = null;
let lastSeenAt: number | null = null;

/**
 * 由请求推导稳定的路由键：优先使用 Express 注册的路由模式，
 * 取不到时退化为具体 path（受 MAX_KEYS 保护）。
 */
export function legacyActivityRouteKey(req: {
  method?: string;
  route?: { path?: string };
  path?: string;
}): string {
  const pattern = req.route?.path || req.path || 'unknown';
  return `${(req.method || 'GET').toUpperCase()} ${pattern}`;
}

export function recordLegacyActivityRouteHit(route: string, at = Date.now()): void {
  total += 1;
  firstSeenAt ??= at;
  lastSeenAt = at;

  const entry = usage.get(route);
  if (entry) {
    entry.count += 1;
    entry.lastSeenAt = at;
    return;
  }

  if (usage.size >= MAX_KEYS) {
    // 达到上限时淘汰最早建立的键，保持内存有界
    const oldest = usage.keys().next().value;
    if (oldest !== undefined) usage.delete(oldest);
  }
  usage.set(route, { count: 1, lastSeenAt: at });
}

export function getLegacyActivityRouteUsage(): LegacyActivityRouteUsageSnapshot {
  return {
    total,
    firstSeenAt,
    lastSeenAt,
    routes: Array.from(usage.entries())
      .map(([route, entry]) => ({ route, count: entry.count, lastSeenAt: entry.lastSeenAt }))
      .sort((a, b) => b.count - a.count || a.route.localeCompare(b.route)),
  };
}

/** 测试辅助：清空计数。 */
export function resetLegacyActivityRouteUsage(): void {
  usage.clear();
  total = 0;
  firstSeenAt = null;
  lastSeenAt = null;
}
