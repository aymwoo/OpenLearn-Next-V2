/**
 * 认证中间件：Session 解析、角色检查、Capability 检查
 */
import type { Request, Response, NextFunction } from 'express';
import { kernelContainer } from '../../packages/core/kernel/index.js';

// ── Session 工具函数 ──────────────────────────────────────────────

/** 获取有效 session（自动检查过期 + 刷新空闲超时） */
export function getValidSession(token: string): any | null {
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
  if (sessionRow.updated_at && (now - sessionRow.updated_at) > idleTimeout) {
    kernelContainer.db.prepare('DELETE FROM client_sessions WHERE id = ?').run(token);
    return null;
  }
  // 刷新 updated_at
  kernelContainer.db.prepare('UPDATE client_sessions SET updated_at = ? WHERE id = ?').run(now, token);
  return JSON.parse(sessionRow.session_data);
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
  if (!token) return 'user-frontend';
  try {
    const session = getValidSession(token);
    if (!session) return 'user-frontend';
    const role = session.subRole || session.role;
    if (role) {
      return `user:${session.userId || 'demo'}:${role}`;
    }
    return 'user-frontend';
  } catch {
    return 'user-frontend';
  }
}

// ── Express 中间件 ────────────────────────────────────────────────

/** 要求认证中间件（可选指定允许的角色） */
export function requireAuth(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = getCookieToken(req);
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const session = getValidSession(token);
    if (!session) return res.status(401).json({ error: 'Session expired or invalid' });
    if (roles.length > 0) {
      const userRole = session.role;
      if (!roles.includes(userRole)) {
        return res.status(403).json({ error: `Role ${userRole} not allowed. Required: ${roles.join(', ')}` });
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
