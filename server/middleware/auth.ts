/**
 * 认证中间件：Session 解析、角色检查、Capability 检查
 */
import type { Request, Response, NextFunction } from 'express';
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
