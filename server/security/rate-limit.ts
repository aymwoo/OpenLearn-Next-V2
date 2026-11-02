/**
 * 登录与写请求限流。
 *
 * 登录桶按规范化用户名或学号划分，不把可伪造的 X-Forwarded-For 放进 key。
 * 写请求桶使用 Express 在当前 trust proxy 设置下解析出的 req.ip：
 * 默认不信任转发头时，轮换 X-Forwarded-For 不会换桶。
 *
 * ⚠️ 按 IP 分桶的写桶在**真实教室**里是共享的：同一间机房/校园网下的
 * N 台设备共用一个公网出口 IP，所有人的白板保存、插件轮询都挤在同一个
 * 180 次/分的桶里。本文件新增的**会话桶**（session-scoped）就是为这件事准备的：
 * 插件 API 流量改用会话桶，登录用户之间互不抢占。
 */
import type { Request } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { getCookieToken, getValidSession } from '../middleware/auth.js';

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

/**
 * 会话级分桶键：已登录按「用户/学号」分桶，未登录回落到 IP。
 *
 * 为什么插件 API 需要它：教室里的学生机共享同一个出口 IP，
 * 按 IP 分桶会让「A 学生的插件轮询」把「B 学生的插件轮询」和
 * 「教师的白板保存」一起限掉（实测 14 台设备轮询 3s 一次即触发 429）。
 * 按会话分桶后，每个客户端各自享有预算，彼此不抢占。
 */
export function sessionRateLimitKey(req: Request): string {
  try {
    const token = getCookieToken(req);
    const session = token ? getValidSession(token) : null;
    if (session) {
      const identity = String(session.userId || session.studentId || session.username || '').trim();
      if (identity) return `session:${identity.slice(0, 64)}`;
    }
  } catch {
    // 会话解析失败一律回落到 IP 分桶
  }
  return `ip:${writeRateLimitKey(req)}`;
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

/**
 * 会话级写限流（登录用户按账号/学号分桶，未登录回落到 IP）。
 *
 * 用于「同一间教室多台设备共享一个出口 IP」的场景：给插件 API 通道
 * 单独开一个按会话分桶的预算，既不让客户端之间互相抢配额，
 * 也不放弃防刷保护。
 */
export function createSessionWriteLimiter(max: number) {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
    keyGenerator: sessionRateLimitKey,
    message: { error: '请求过于频繁，请稍后再试。Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: limiterValidation,
  });
}
