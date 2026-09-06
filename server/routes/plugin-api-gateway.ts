/**
 * plugin-api-gateway.ts — 插件安全 RESTful API 网关
 *
 * 架构防线：
 * 1. 命名空间强制隔离：仅拦截 /api/plugins/:pluginId/* 路由
 * 2. 系统保留端点避让：放行 toggle, config, contributions 等平台核心操作
 * 3. 路径遍历防御：规范化路径并阻断 ../ 等攻击
 * 4. 前置认证与 RBAC：支持 Manifest 静态规则匹配，默认要求登录
 * 5. 独立内存限流：按 IP + 插件实施滑动窗口限流，防御 DoS
 * 6. 纯 DTO 转换与 Payload 限制：请求体硬限制 1MB，剥离底层 Socket 与 Cookie 密文
 * 7. 跨线程/Inline 安全派发与 504 超时熔断守卫
 * 8. 响应 Header 安全清洗：强制剥离 Set-Cookie 与高危标头
 *
 * @module
 */

import type { Request, Response, NextFunction } from 'express';
import path from 'node:path';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getActorId, getCookieToken, getValidSession } from '../middleware/auth.js';
import { sendSafeError } from '../utils/error-handler.js';
import type { PluginApiRequest, PluginApiResponse } from '../../packages/core/plugin-host/types.js';
import { compileRoutePattern } from '../../packages/core/plugin-host/http-router.js';

/** 平台已有的保留管理动作路径（当只有单段子路径且完全匹配时放行给后续 Express 路由） */
const RESERVED_ACTIONS = new Set([
  'config',
  'toggle',
  'contributions',
  'check-update',
  'one-click-update',
]);

/** 响应头危险黑名单：绝对禁止插件向外部注入或篡改 */
const FORBIDDEN_RESPONSE_HEADERS = new Set([
  'set-cookie',
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'content-security-policy',
  'x-frame-options',
  'transfer-encoding',
  'connection',
  'host',
]);

/** 请求体上限：1MB（针对 JSON/轻量结构） */
const MAX_PAYLOAD_BYTES = 1024 * 1024; // 1MB

/**
 * 轻量滑动窗口内存限流器（按 客户端 IP + 插件 ID 分组）
 */
class PluginRateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  /**
   * 检查并递增计数。返回 true 表示放行，false 表示限流。
   */
  consume(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const entry = this.buckets.get(key);

    if (!entry || now > entry.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }

    if (entry.count >= limit) {
      return false;
    }

    entry.count += 1;
    return true;
  }

  /**
   * 清理过期桶
   */
  cleanup(): void {
    const now = Date.now();
    for (const [k, v] of this.buckets) {
      if (now > v.resetAt) {
        this.buckets.delete(k);
      }
    }
  }
}

const rateLimiter = new PluginRateLimiter();
// 每 5 分钟定时清理过期限流桶
setInterval(() => rateLimiter.cleanup(), 5 * 60 * 1000).unref();

/**
 * 提取当前登录用户的认证信息
 */
function resolveAuthContext(req: Request): {
  actorId: string;
  userId?: string;
  username?: string;
  role: string;
  permissions?: string[];
  isAuthenticated: boolean;
} {
  const actorId = getActorId(req);
  let token = getCookieToken(req);

  // 也支持从 Authorization: Bearer <token> 提取
  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7).trim();
  }

  if (!token) {
    return {
      actorId,
      role: 'anonymous',
      isAuthenticated: false,
    };
  }

  const session = getValidSession(token);
  if (!session) {
    return {
      actorId: 'anonymous',
      role: 'anonymous',
      isAuthenticated: false,
    };
  }

  let userRole = session.subRole || session.role || 'anonymous';
  if (session.username === 'admin' || session.userId === 'usr_admin' || userRole === 'admin') {
    userRole = 'administrator';
  }

  return {
    actorId,
    userId: session.userId,
    username: session.username,
    role: userRole,
    permissions: session.permissions,
    isAuthenticated: true,
  };
}

/**
 * 插件 RESTful API 统一网关处理器
 */
export async function pluginApiGatewayMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const pluginId = req.params.pluginId;
  const rawSubPath = (req.params as any)[0] || '';

  // 1. 系统保留动作避让检查：如果子路径是单个保留词且为特定方法，交由后续核心路由处理
  if (RESERVED_ACTIONS.has(rawSubPath)) {
    return next();
  }

  // 2. 路径归一化与遍历攻击拦截 (Path Traversal Protection)
  if (rawSubPath.includes('..') || rawSubPath.toLowerCase().includes('%2e%2e')) {
    res.status(400).json({ success: false, error: 'Path traversal attempt detected' });
    return;
  }
  const normalizedSubPath = path.posix.normalize('/' + rawSubPath);
  if (normalizedSubPath.includes('..')) {
    res.status(400).json({ success: false, error: 'Path traversal attempt detected' });
    return;
  }

  const pluginHost = kernelContainer.pluginHost;
  if (!pluginHost) {
    res.status(503).json({ success: false, error: 'Plugin system is not initialized' });
    return;
  }

  // 3. 插件状态与合法性检查
  const resolvedUuid = pluginHost.resolvePluginUuid(pluginId);
  const manifest = pluginHost.getPluginManifest(pluginId);

  // 4. Payload 体积硬限制检查（防超大请求体 OOM）
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > MAX_PAYLOAD_BYTES) {
    res.status(413).json({
      success: false,
      error: `Payload too large. Maximum allowed size is ${MAX_PAYLOAD_BYTES / 1024}KB`,
    });
    return;
  }

  // 5. 提取身份上下文
  const auth = resolveAuthContext(req);

  // 6. 前置安全与 RBAC 规则匹配
  const method = req.method.toUpperCase();
  const manifestRoutes = manifest?.api?.routes || [];

  // 在 Manifest 中查找是否有匹配该请求的方法与路径的规则
  let matchedRule: (typeof manifestRoutes)[0] | undefined;
  for (const r of manifestRoutes) {
    if (r.method.toUpperCase() === method) {
      const compiled = compileRoutePattern(r.path);
      if (compiled.regex.test(normalizedSubPath)) {
        matchedRule = r;
        break;
      }
    }
  }

  // 6.1 鉴权守卫（默认需要认证，除非 Manifest 明确声明 auth: false）
  const requiresAuth = matchedRule?.auth !== false;
  if (requiresAuth && !auth.isAuthenticated) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }

  // 6.2 角色白名单守卫（RBAC）
  if (matchedRule?.roles && matchedRule.roles.length > 0) {
    const isSuperAdmin = auth.role === 'administrator';
    const hasRole = matchedRule.roles.includes(auth.role);
    if (!isSuperAdmin && !hasRole) {
      res.status(403).json({
        success: false,
        error: `Forbidden. Required roles: ${matchedRule.roles.join(', ')}`,
      });
      return;
    }
  }

  // 7. 速率限制守卫（Rate Limiter 防刷防 DoS）
  const clientIp = req.ip || req.socket?.remoteAddress || 'unknown-ip';
  const rateLimitKey = `${clientIp}:${resolvedUuid || pluginId}:${method}:${normalizedSubPath}`;
  const windowMs = matchedRule?.rateLimit?.windowMs ?? 60 * 1000;
  const maxRequests = matchedRule?.rateLimit?.max ?? 120; // 默认单个端点每分钟最多 120 次请求

  if (!rateLimiter.consume(rateLimitKey, maxRequests, windowMs)) {
    res.setHeader('Retry-After', Math.ceil(windowMs / 1000).toString());
    res.status(429).json({
      success: false,
      error: 'Too many requests, please slow down',
    });
    return;
  }

  // 8. 组装安全的只读 PluginApiRequest DTO
  const safeHeaders: Record<string, string> = {};
  const ALLOWED_REQUEST_HEADERS = [
    'content-type',
    'accept',
    'user-agent',
    'x-request-id',
    'accept-language',
  ];
  for (const h of ALLOWED_REQUEST_HEADERS) {
    const val = req.headers[h];
    if (typeof val === 'string') {
      safeHeaders[h] = val;
    }
  }

  const reqDto: PluginApiRequest = {
    method,
    path: normalizedSubPath,
    params: {}, // 由 PluginHttpRouter 在内部根据路由模板动态补全
    query: req.query as Record<string, string | string[]>,
    headers: safeHeaders,
    body: req.body,
    ip: clientIp,
    actor: {
      actorId: auth.actorId,
      userId: auth.userId,
      username: auth.username,
      role: auth.role,
      permissions: auth.permissions,
    },
  };

  // 9. 派发请求并等待响应（带 5000ms 超时熔断守卫）
  try {
    const response: PluginApiResponse = await pluginHost.dispatchHttpRequest(
      pluginId,
      reqDto,
      5000,
    );

    // 10. 响应安全清洗与返回
    const status = (typeof response.status === 'number' && response.status >= 100 && response.status <= 599)
      ? response.status
      : 200;

    // 清洗响应 Header（剔除高危头）
    if (response.headers && typeof response.headers === 'object') {
      for (const [k, v] of Object.entries(response.headers)) {
        const lowerKey = k.toLowerCase();
        if (!FORBIDDEN_RESPONSE_HEADERS.has(lowerKey)) {
          res.setHeader(k, v);
        }
      }
    }

    if (res.getHeader('content-type') === undefined) {
      res.setHeader('content-type', 'application/json; charset=utf-8');
    }

    res.status(status).send(response.body);
  } catch (err: any) {
    if (err.name === 'GatewayTimeoutError' || err.message?.includes('timed out')) {
      res.status(504).json({ success: false, error: 'Gateway Timeout: Plugin did not respond in time' });
      return;
    }
    console.error(`[PluginApiGateway] Error handling ${method} ${req.originalUrl}:`, err);
    sendSafeError(res, err);
  }
}
