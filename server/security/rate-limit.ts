/**
 * 登录与写请求限流。
 *
 * 登录桶按规范化用户名或学号划分，不把可伪造的 X-Forwarded-For 放进 key。
 * 写请求桶使用 Express 在当前 trust proxy 设置下解析出的 req.ip：
 * 默认不信任转发头时，轮换 X-Forwarded-For 不会换桶。
 */
import type { Request } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

export function loginRateLimitKey(req: Request): string {
  const body = (req.body ?? {}) as { username?: unknown; studentId?: unknown; studentName?: unknown };
  const raw = body.username ?? body.studentId ?? body.studentName ?? '';
  const user = String(raw).trim().toLowerCase().slice(0, 64);
  if (user) return `acct:${user}`;
  return `anon:${writeRateLimitKey(req)}`;
}

export function writeRateLimitKey(req: Request): string {
  const ip = typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : req.socket?.remoteAddress || '';
  if (!ip) return 'unknown';
  try {
    return ipKeyGenerator(ip);
  } catch {
    return ip;
  }
}

const limiterValidation = {
  xForwardedForHeader: false,
  trustProxy: false,
  keyGeneratorIpFallback: false,
} as const;

export function createLoginLimiter(max: number) {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
    keyGenerator: loginRateLimitKey,
    message: { error: '登录尝试过于频繁，请稍后再试。Too many login attempts, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: limiterValidation,
  });
}

export function createWriteLimiter(max: number) {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
    keyGenerator: writeRateLimitKey,
    message: { error: '请求过于频繁，请稍后再试。Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: limiterValidation,
  });
}

export function createAiLimiter(max: number) {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
    keyGenerator: writeRateLimitKey,
    message: { error: 'AI 请求过于频繁，请稍后再试。Too many AI requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: limiterValidation,
  });
}
