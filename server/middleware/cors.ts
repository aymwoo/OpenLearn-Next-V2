import type { Request, Response, NextFunction, RequestHandler } from 'express';

export interface CorsOptions {
  allowedOrigins?: string[];
  isProduction?: boolean;
}

/**
 * 解析环境变量中的 ALLOWED_ORIGINS 字符串
 */
export function resolveConfiguredOrigins(envValue = process.env.ALLOWED_ORIGINS): string[] {
  if (!envValue) return [];
  return envValue
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 判断指定请求来源 (Origin) 是否允许跨域访问
 *
 * 评估维度：
 * 1. 无 Origin 标头：直接放行（curl、移动端或纯同源导航）
 * 2. 显式白名单匹配（或通配符 *）
 * 3. 生产环境到此为止：不反射 Host，也不放行回环地址
 * 4. 非生产：同源 Host 反射、本地回环，以及其余来源一律放行
 */
export function isOriginAllowed(origin: string | undefined, hostHeader?: string, options?: CorsOptions): boolean {
  if (!origin) return true;

  const configuredOrigins = options?.allowedOrigins ?? resolveConfiguredOrigins();
  const isProduction = options?.isProduction ?? process.env.NODE_ENV === 'production';

  // 1. 显式配置的白名单或通配符（生产与开发都认）
  if (configuredOrigins.length > 0) {
    if (configuredOrigins.includes(origin) || configuredOrigins.includes('*')) {
      return true;
    }
  }

  // 生产只接受 ALLOWED_ORIGINS。回环和「Origin host === Host」会让同一台机器上
  // 另一个端口的页面带着 edu_os_token 调用接口，反代改写 Host 时也会被当成同源。
  if (isProduction) {
    return false;
  }

  // 非生产：同源 Host 反射与本地回环仍放行（机房跨端口调试）。
  if (hostHeader) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host === hostHeader) {
        return true;
      }
    } catch {
      // 忽略非法 URL 格式
    }
  }

  try {
    const originUrl = new URL(origin);
    const hostname = originUrl.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '0.0.0.0') {
      return true;
    }
  } catch {
    // 忽略非法 URL 格式
  }

  // 其余来源在非生产一律放行（如 Vite 默认端口 5173 / 4173）。
  return true;
}

/**
 * 创建 Express CORS 统一防护中间件
 */
export function createCorsMiddleware(options?: CorsOptions): RequestHandler {
  const configuredOrigins = options?.allowedOrigins ?? resolveConfiguredOrigins();
  const wildcard = configuredOrigins.includes('*');

  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;

    if (origin && origin !== 'null' && origin !== undefined) {
      if (wildcard) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        res.setHeader('Access-Control-Max-Age', '86400');
      } else if (isOriginAllowed(origin, req.headers.host, options)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        res.setHeader('Access-Control-Max-Age', '86400');
      }
    } else {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      res.setHeader('Access-Control-Max-Age', '86400');
    }

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }

    next();
  };
}

/**
 * 创建适用于 Socket.IO 的 CORS 动态检查回调
 */
export function createSocketIoCors(options?: CorsOptions) {
  return (req: any, callback: (err: any, corsOptions: any) => void) => {
    const origin = req.headers.origin;
    const host = req.headers.host;
    const allowed = isOriginAllowed(origin, host, options);

    callback(null, {
      origin: allowed ? origin || true : false,
      methods: ['GET', 'POST'],
      credentials: true,
    });
  };
}
