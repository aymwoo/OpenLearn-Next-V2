/**
 * 路由数据范围白名单（Issue #140）。
 *
 * 迁移期允许「已知但暂缓声明」的已认证路由列在这里，**每条必须带理由**。
 * 默认应保持为空：新增路由必须直接用 `requireScopedAuth('<scope>')` 声明，
 * 而不是加白名单绕过审计。
 *
 * 审计入口见 `server/security/route-scope.ts` 的 `assertRouteDataScopes()`；
 * CI 门禁测试见 `server/__tests__/route-data-scope.test.ts`。
 */

import type { RouteScopeWhitelistEntry } from './route-scope.js';

export const ROUTE_SCOPE_WHITELIST: RouteScopeWhitelistEntry[] = [];
