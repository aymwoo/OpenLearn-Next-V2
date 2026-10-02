/**
 * CSRF 门控（Phase B1）—— 全局写请求的跨站来源校验。
 *
 * 背景：会话为 cookie-only（edu_os_token，HttpOnly + SameSite=Lax）。Lax 已保证
 * 跨站 form/顶层导航不附会话 cookie，但对「支持 Sec-Fetch 元数据的新浏览器」里
 * 由跨站页面发起的 fetch/XHR（会自动附 cookie 的 same-site 子域场景等）仍值得
 * 显式拒绝。判定模式复用 bridge.ts /runtime 门控的既有设计（SEC-AUTH 注释）。
 *
 * 判定表（仅拦非 GET/HEAD/OPTIONS）：
 *   Sec-Fetch-Site ∈ {same-origin, same-site, none}  → 放行
 *     （none = 地址栏/书签直发，通常不附会话 cookie，保守放行）
 *   Sec-Fetch-Site: cross-site                        → 豁免清单内放行，否则 403
 *   头缺失 + 头缺失                                   → 放行（curl / API 客户端，
 *     靠会话本身；拒绝会破坏脚本化集成）
 *   头缺失 + Dest 存在且非 document                   → 放行（沙箱 iframe 子资源，
 *     opaque origin 的 Site 恒为 cross-site，以浏览器自动附加的 Dest 判定）
 *   头缺失 + Dest = document                          → 放行（老浏览器，Lax 兜底）
 *
 * 豁免清单：沙箱课件直连端点（Origin: null，SameSite=Lax 承担实际防线）与
 * 登录前路径。伪造 Sec-Fetch 头仅限非浏览器客户端（与 bridge.ts 同等残余风险）。
 */
import type { Request, Response, NextFunction } from 'express';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** 沙箱 iframe 直连 + 登录前豁免（精确前缀匹配） */
const EXEMPT_PREFIXES = [
  '/api/courseware/attempts/', // log / submit / adopt（courseware.ts，沙箱直连）
  '/api/auth/login', // 登录前无会话
];

export function csrfGuard(req: Request, res: Response, next: NextFunction): void {
  if (!WRITE_METHODS.has(req.method)) {
    next();
    return;
  }

  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== '') {
    if (site === 'same-origin' || site === 'same-site' || site === 'none') {
      next();
      return;
    }
    // cross-site：仅豁免清单内路径
    const path = req.path;
    if (EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(p))) {
      next();
      return;
    }
    res.status(403).json({ success: false, code: 'FORBIDDEN_CROSS_SITE', error: 'Cross-site write request blocked' });
    return;
  }

  // Sec-Fetch-Site 缺失时：降级到 Origin / Referer 双重校验（OWASP 防御纵深）
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const host = req.headers.host;
  const path = req.path;

  // 1. 如果带有 Origin 头
  if (typeof origin === 'string' && origin !== '') {
    if (origin === 'null') {
      // opaque origin（如非同源沙箱 iframe）仅允许豁免路径
      if (!EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(p))) {
        res.status(403).json({ success: false, code: 'FORBIDDEN_CROSS_SITE', error: 'Opaque origin write request blocked' });
        return;
      }
    } else {
      try {
        const originHost = new URL(origin).host;
        if (host && originHost.toLowerCase() !== host.toLowerCase()) {
          if (!EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(p))) {
            res.status(403).json({ success: false, code: 'FORBIDDEN_CROSS_SITE', error: 'Cross-site write request blocked (Origin mismatch)' });
            return;
          }
        }
      } catch {
        res.status(403).json({ success: false, code: 'FORBIDDEN_CROSS_SITE', error: 'Invalid Origin header' });
        return;
      }
    }
  } else if (typeof referer === 'string' && referer !== '') {
    // 2. 无 Origin 但带有 Referer
    try {
      const refererHost = new URL(referer).host;
      if (host && refererHost.toLowerCase() !== host.toLowerCase()) {
        if (!EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(p))) {
          res.status(403).json({ success: false, code: 'FORBIDDEN_CROSS_SITE', error: 'Cross-site write request blocked (Referer mismatch)' });
          return;
        }
      }
    } catch {
      res.status(403).json({ success: false, code: 'FORBIDDEN_CROSS_SITE', error: 'Invalid Referer header' });
      return;
    }
  }

  // Sec-Fetch-Site、Origin 与 Referer 均无：非浏览器客户端（curl/API）或内部直接调用，放行
  next();
}
