import type { HelmetOptions } from 'helmet';

export interface HostHelmetEnv {
  NODE_ENV?: string;
  ALLOWED_FRAME_ORIGINS?: string;
  LTI_ALLOWED_LMS_ORIGINS?: string;
  ENABLE_HSTS?: string;
  FORCE_HTTPS?: string;
}

function parseOriginList(raw?: string): string[] {
  return raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

/**
 * Build host Helmet security options for Express.
 * Ensures `upgradeInsecureRequests` is explicitly disabled (`null`) unless TLS/HSTS
 * is enabled, because Helmet v8 enables `useDefaults: true` and would otherwise emit
 * `upgrade-insecure-requests`, breaking plain-HTTP LAN IP deployments in Chrome.
 */
export function buildHostHelmetOptions(
  env: HostHelmetEnv = process.env,
  isProduction = env.NODE_ENV === 'production',
): HelmetOptions {
  const frameAllowedOrigins = env.ALLOWED_FRAME_ORIGINS
    ? parseOriginList(env.ALLOWED_FRAME_ORIGINS)
    : isProduction
      ? []
      : ['http://localhost:*', 'http://127.0.0.1:*'];

  const ltiAllowedOrigins = parseOriginList(env.LTI_ALLOWED_LMS_ORIGINS);
  const enableHsts = env.ENABLE_HSTS === 'true' || (isProduction && env.FORCE_HTTPS === 'true');

  return {
    // 允许在 AI Studio 及外部受信任环境 iframe 中嵌入
    xFrameOptions: { action: 'sameorigin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: isProduction ? ["'self'", 'blob:'] : ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:'],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        styleSrcAttr: ["'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        frameSrc: ["'self'", 'blob:', 'data:', ...frameAllowedOrigins, ...ltiAllowedOrigins],
        frameAncestors: ["'self'", ...frameAllowedOrigins, ...ltiAllowedOrigins],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        // Helmet v8 默认 useDefaults=true，缺省键仍会自动下发 upgrade-insecure-requests；
        // 仅在启用 HSTS / TLS 时下发，避免局域网 HTTP 部署被 Chrome 强升 HTTPS 导致静态资源加载失败。
        upgradeInsecureRequests: enableHsts ? [] : null,
      },
    },
    crossOriginOpenerPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // 允许沙箱 iframe（opaque origin）加载静态资源
    originAgentCluster: false,
    strictTransportSecurity: enableHsts ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  };
}
