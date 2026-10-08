/**
 * 认证中间件：Session 解析、角色检查、Capability 检查
 */
import type { Request, Response, NextFunction } from 'express';
import type { Socket } from 'socket.io';
import { kernelContainer } from '../../packages/core/kernel/index.js';

// ── Session 工具函数 ──────────────────────────────────────────────

export interface Session {
  userId?: string;
  studentId?: string;
  username?: string;
  name?: string;
  email?: string;
  role: string;
  subRole?: string;
  avatar?: string | null;
  permissions?: string[];
  [key: string]: unknown;
}

const SESSION_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟内不重复刷新 updated_at，降低写放大

/** 获取有效 session（自动检查过期 + 节流刷新空闲超时） */
export function getValidSession(token: string): Session | null {
  let sessionRow: any;
  try {
    sessionRow = kernelContainer.db.prepare('SELECT * FROM client_sessions WHERE id = ?').get(token);
  } catch {
    return null;
  }
  if (!sessionRow) return null;

  const now = Date.now();
  // 绝对过期检查
  if (sessionRow.expires_at && sessionRow.expires_at < now) {
    kernelContainer.db.prepare('DELETE FROM client_sessions WHERE id = ?').run(token);
    return null;
  }
  // 空闲超时检查（24h）
  const idleTimeout = 24 * 60 * 60 * 1000;
  if (sessionRow.updated_at && now - sessionRow.updated_at > idleTimeout) {
    kernelContainer.db.prepare('DELETE FROM client_sessions WHERE id = ?').run(token);
    return null;
  }
  // 节流刷新 updated_at（仅当距离上次更新超过 5 分钟）
  if (!sessionRow.updated_at || now - sessionRow.updated_at > SESSION_REFRESH_INTERVAL_MS) {
    kernelContainer.db.prepare('UPDATE client_sessions SET updated_at = ? WHERE id = ?').run(now, token);
  }
  let session: Session;
  try {
    session = JSON.parse(sessionRow.session_data) as Session;
  } catch {
    return null;
  }
  if (session && !session.userId && session.studentId) {
    session.userId = session.studentId;
  }
  // 入库加固：role 必须是白名单，禁止通过 session_data 注入任意角色字符串
  if (session.role && !['teacher', 'student', 'administrator', 'admin'].includes(session.role)) {
    // 非法 role 视为 anonymous，避免 capability 误判
    session.role = 'anonymous';
  }
  return session;
}

export function getCookieToken(req: Request): string | null {
  const rc = req.headers.cookie;
  if (!rc) return null;
  const parts = rc.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith('edu_os_token=')) {
      return trimmed.substring('edu_os_token='.length);
    }
  }
  return null;
}

export function getActorId(req: Request): string {
  const token = getCookieToken(req);
  if (!token) return 'anonymous';
  try {
    const session = getValidSession(token);
    if (!session) return 'anonymous';
    let role = session.subRole || session.role;
    if (
      session.username === 'admin' ||
      session.userId === 'usr_admin' ||
      role === 'admin' ||
      role === 'administrator'
    ) {
      role = 'administrator';
    }
    // 加固：userId 去除 ':' 与非法字符，防止 actorId 注入导致 capability 越权
    const rawUserId = session.userId || session.studentId || 'demo';
    const safeUserId = String(rawUserId).replace(/[:\s]/g, '_').slice(0, 64);
    if (role) {
      return `user:${safeUserId}:${role}`;
    }
    return 'anonymous';
  } catch {
    return 'anonymous';
  }
}

// ── Express 中间件 ────────────────────────────────────────────────

/** 要求认证中间件（可选指定允许的角色） */
export function requireAuth(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = getCookieToken(req);
    if (!token) return res.status(401).json({ success: false, error: 'Authentication required' });
    const session = getValidSession(token);
    if (!session) return res.status(401).json({ success: false, error: 'Session expired or invalid' });
    if (roles.length > 0) {
      let userRole = session.role;
      if (session.username === 'admin' || session.userId === 'usr_admin' || userRole === 'admin') {
        userRole = 'administrator';
      }
      const effectiveRoles = roles.map((r) => (r === 'admin' ? 'administrator' : r));
      if (!effectiveRoles.includes(userRole)) {
        return res
          .status(403)
          .json({ success: false, error: `Role ${session.role} not allowed. Required: ${roles.join(', ')}` });
      }
    }
    (req as any).session = session;
    next();
  };
}

// ── SEC-AUTH-06: 默认密码强制改密 ─────────────────────────────────

/** 改密强制期仍可访问的路径（查询/登出/改密本身） */
const PASSWORD_CHANGE_EXEMPT_PATHS = new Set([
  '/api/auth/change-password',
  '/api/auth/logout',
  '/api/auth/session',
  '/api/auth/me',
]);

/**
 * 默认密码写操作拦截。
 *
 * 背景：种子账号 admin/admin、teacher/teacher 仅在登录时打 `mustChangePassword`
 * 标记（存入 session_data，见 roster.ts login），前端全屏强制改密；
 * 本中间件在服务端兜底 —— 带标记的会话发起**非 GET** 请求（除豁免路径）一律 403，
 * 防止绕过前端直接调 API。GET 保持可用（登录后 /api/auth/session 恢复会话需要）。
 *
 * 适用面：teacher/administrator 入口（种子默认密码所在）；学生口令策略属另一议题。
 */
export function enforcePasswordChanged(req: Request, res: Response, next: NextFunction): void {
  if (process.env.PLAYWRIGHT_TEST) {
    return next();
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    if (!PASSWORD_CHANGE_EXEMPT_PATHS.has(req.path)) {
      const token = getCookieToken(req);
      if (token) {
        const session = getValidSession(token);
        if (session && (session as any).mustChangePassword) {
          res
            .status(403)
            .json({ success: false, code: 'FORBIDDEN_DEFAULT_PASSWORD', error: 'Default password must be changed first' });
          return;
        }
      }
    }
  }
  next();
}

/**
 * Socket.IO 连接握手鉴权（SEC-AUTH-SOCKET）。
 *
 * 从 cookie `edu_os_token=` 或 `socket.handshake.auth.token` 取 token 并校验
 * session；同时兜底 SEC-AUTH-06 —— 带 mustChangePassword 标记的会话直接拒绝
 * 连接（与 HTTP 层 enforcePasswordChanged 同码 FORBIDDEN_DEFAULT_PASSWORD）。
 * 改密/登出走 HTTP 豁免路径，不受影响；ForcedPasswordChangeGate 全屏期间
 * socket 静默重连无害。
 *
 * 测试环境支持未带 token 的 mock 连接（无 session 不拦，保持原顺序语义）。
 */
export function socketAuthMiddleware(socket: Socket, next: (err?: Error) => void): void {
  try {
    const cookieHeader = socket.handshake.headers.cookie;
    let token: string | null = null;
    if (cookieHeader) {
      const parts = cookieHeader.split(';');
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.startsWith('edu_os_token=')) {
          token = trimmed.substring('edu_os_token='.length);
          break;
        }
      }
    }
    if (!token && socket.handshake.auth?.token) {
      token = socket.handshake.auth.token;
    }

    // 测试环境支持未带 token 的 mock 连接
    if (process.env.NODE_ENV === 'test' && !token) {
      return next();
    }

    if (!token) {
      return next(new Error('Authentication required: missing edu_os_token'));
    }

    const session = getValidSession(token);
    if (!session) {
      return next(new Error('Authentication required: session expired or invalid'));
    }

    // SEC-AUTH-06 兜底：默认密码未改的会话不允许建立 socket 连接
    if ((session as any).mustChangePassword) {
      return next(new Error('FORBIDDEN_DEFAULT_PASSWORD'));
    }

    socket.data.session = session;
    socket.data.userId = session.userId;
    socket.data.role = session.role;
    next();
  } catch (err: any) {
    next(new Error(`Authentication error: ${err.message}`));
  }
}

/** 教师/管理员检查（旧版兼容包装） */
export function checkIsTeacherOrAdmin(req: Request): boolean {
  const token = getCookieToken(req);
  if (!token) return false;
  try {
    const session = getValidSession(token);
    if (!session) return false;
    return session.role === 'teacher' || session.role === 'administrator';
  } catch {
    return false;
  }
}
