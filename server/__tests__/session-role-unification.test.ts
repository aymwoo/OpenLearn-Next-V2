/**
 * 会话角色口径统一（Issue #226）。
 *
 * 修复前，同一个账号在两类接口上权限表现相反：
 * - `requireAuth` 读 `session.role`（staff 会话恒为 'teacher'）；
 * - `getActorId` 读 `session.subRole || session.role`（管理员身份只在这里）。
 *
 * 于是通过用户管理创建的 `role='administrator'` 账号：
 * `requireAuth('administrator')` → 403（被当成 teacher），
 * 而能力判定（getActorId）→ 管理员放行。
 *
 * 本文件用真实会话表锁死统一后的口径。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import { getActorId, requireAuth, checkIsTeacherOrAdmin } from '../middleware/auth.js';
import { isAdministrator, isTeacher } from '../services/class-access.js';
import { resolveSessionRole } from '../services/session-role.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

interface MockResponse {
  statusCode?: number;
  body?: unknown;
  status: (code: number) => MockResponse;
  json: (body: unknown) => MockResponse;
}

describe('会话角色口径统一（Issue #226）', () => {
  const db = kernelContainer.db;

  const mkSession = (token: string, data: Record<string, unknown>) => {
    const now = Date.now();
    db.prepare('DELETE FROM client_sessions WHERE id = ?').run(token);
    db.prepare('INSERT INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)').run(
      token,
      JSON.stringify(data),
      now,
      now + 86400000,
    );
  };

  const reqWithCookie = (token: string | null): Request => {
    const headers: Record<string, string> = {};
    if (token !== null) headers.cookie = `edu_os_token=${token}`;
    return { headers } as unknown as Request;
  };

  const mkRes = () => {
    const res: MockResponse = {
      status: vi.fn((code: number) => {
        res.statusCode = code;
        return res;
      }),
      json: vi.fn((body: unknown) => {
        res.body = body;
        return res;
      }),
    };
    return res as unknown as Response & MockResponse;
  };

  const runAuth = (token: string | null, ...roles: string[]) => {
    const res = mkRes();
    const next = vi.fn();
    requireAuth(...roles)(reqWithCookie(token), res, next);
    return { res, next };
  };

  beforeAll(() => {
    // 通过用户管理创建的普通管理员账号：登录时 session.role 恒为 'teacher'，
    // 管理员身份在 subRole 里（见 server/routes/roster.ts 的 staff 登录分支）。
    mkSession('tok-admin-subrole', {
      role: 'teacher',
      subRole: 'administrator',
      userId: 'usr_admin_2',
      username: 'admin2',
    });

    // bootstrap 管理员（seed 用户）：同样是 role='teacher' + subRole='administrator'
    mkSession('tok-admin-bootstrap', {
      role: 'teacher',
      subRole: 'administrator',
      userId: 'usr_admin',
      username: 'admin',
    });

    // 普通教师
    mkSession('tok-plain-teacher', {
      role: 'teacher',
      subRole: 'teacher',
      userId: 'usr_t_1',
      username: 't1',
    });

    // 学生
    mkSession('tok-plain-student', {
      role: 'student',
      userId: 'stu_s_1',
      studentId: 'stu_s_1',
      username: 's1',
    });

    // 非法 subRole 注入（session_data 是持久化数据，不能靠它提权）
    mkSession('tok-bad-subrole', {
      role: 'teacher',
      subRole: 'superadmin',
      userId: 'usr_evil_1',
      username: 'evil1',
    });

    // 只有 username='admin' 的普通教师 —— 不得再因硬编码身份获得管理员权限
    mkSession('tok-username-admin-only', {
      role: 'teacher',
      subRole: 'teacher',
      userId: 'usr_plain',
      username: 'admin',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveSessionRole —— 唯一真源', () => {
    it('subRole 优先于 role', () => {
      expect(resolveSessionRole({ role: 'teacher', subRole: 'administrator' })).toBe('administrator');
      expect(resolveSessionRole({ role: 'teacher', subRole: 'teacher' })).toBe('teacher');
    });

    it('没有 subRole 时回退 role', () => {
      expect(resolveSessionRole({ role: 'student' })).toBe('student');
      expect(resolveSessionRole({ role: 'administrator' })).toBe('administrator');
    });

    it("'admin' 归一为 'administrator'", () => {
      expect(resolveSessionRole({ role: 'admin' })).toBe('administrator');
      expect(resolveSessionRole({ role: 'teacher', subRole: 'admin' })).toBe('administrator');
    });

    it('白名单外的角色降级为 anonymous', () => {
      expect(resolveSessionRole({ role: 'superadmin' })).toBe('anonymous');
      expect(resolveSessionRole({ role: 'teacher', subRole: 'superadmin' })).toBe('teacher');
      expect(resolveSessionRole(null)).toBe('anonymous');
      expect(resolveSessionRole(undefined)).toBe('anonymous');
    });
  });

  describe('管理员账号：路由守卫与能力判定口径一致', () => {
    it('普通管理员账号能通过 requireAuth("administrator")（修复前是 403）', () => {
      const { res, next } = runAuth('tok-admin-subrole', 'administrator');
      expect(res.status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('bootstrap 管理员同样能通过 requireAuth("administrator")', () => {
      const { res, next } = runAuth('tok-admin-bootstrap', 'administrator');
      expect(res.status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('getActorId 把该账号判为 administrator（与路由守卫一致）', () => {
      expect(getActorId(reqWithCookie('tok-admin-subrole'))).toBe('user:usr_admin_2:administrator');
      expect(getActorId(reqWithCookie('tok-admin-bootstrap'))).toBe('user:usr_admin:administrator');
    });

    it('isAdministrator 判定一致', () => {
      const session = { role: 'teacher', subRole: 'administrator' };
      expect(isAdministrator(session)).toBe(true);
      expect(isTeacher(session)).toBe(false);
    });

    it('checkIsTeacherOrAdmin 一致', () => {
      expect(checkIsTeacherOrAdmin(reqWithCookie('tok-admin-subrole'))).toBe(true);
      expect(checkIsTeacherOrAdmin(reqWithCookie('tok-plain-teacher'))).toBe(true);
      expect(checkIsTeacherOrAdmin(reqWithCookie('tok-plain-student'))).toBe(false);
    });
  });

  describe('非管理员账号不被提权', () => {
    it('普通教师过不了 requireAuth("administrator")', () => {
      const { res, next } = runAuth('tok-plain-teacher', 'administrator');
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('普通教师能过 requireAuth("teacher")', () => {
      const { res, next } = runAuth('tok-plain-teacher', 'teacher');
      expect(res.status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('学生过不了教师/管理员门禁', () => {
      for (const role of ['teacher', 'administrator']) {
        const { res, next } = runAuth('tok-plain-student', role);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
      }
    });

    it('非法的 subRole 不产生越权 actorId', () => {
      const actorId = getActorId(reqWithCookie('tok-bad-subrole'));
      expect(actorId).not.toContain('superadmin');
      expect(actorId).toBe('user:usr_evil_1:teacher');
    });

    it('username="admin" 不再自动获得管理员权限（硬编码身份兜底移除）', () => {
      // 修复前：只要 username==='admin' 就会被判成 administrator。
      const { res, next } = runAuth('tok-username-admin-only', 'administrator');
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();

      expect(getActorId(reqWithCookie('tok-username-admin-only'))).toBe('user:usr_plain:teacher');
    });
  });
});
