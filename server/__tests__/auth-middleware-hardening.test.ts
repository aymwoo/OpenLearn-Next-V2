/**
 * Auth 中间件加固测试（P0 — 修复 MUT-M2 存活缺口）
 *
 * ## 为什么需要这个文件
 *
 * 变异测试（MUT-M2）同时删掉 `server/middleware/auth.ts` 的两处加固：
 *   - L60  role 白名单：非法 role 一律降级为 `anonymous`
 *   - L97  actorId 净化：`userId` 去除 `:` / 空白并截断 64 字符
 * 而当时全量 2243 个测试 **依然全绿**。原因：`security_hardening.test.ts:87`
 * 只用 `stu_alice` 这种不含 `:` 和空白的 userId 调 `getActorId`，
 * 净化逻辑对它的输出没有任何影响，因此删掉也不改变断言结果。
 *
 * 本文件用**真正含注入字符**的输入锁死这两处行为。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { getValidSession, getCookieToken, getActorId, requireAuth, checkIsTeacherOrAdmin } from '../middleware/auth.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('Auth 中间件加固（role 白名单 + actorId 净化）', () => {
  const db = kernelContainer.db as any;

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
    if (token !== null) headers.cookie = `edu_os_token=${token}; other=1`;
    return { headers } as unknown as Request;
  };

  const mkRes = () => {
    const res: any = {};
    res.status = vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    });
    res.json = vi.fn((body: unknown) => {
      res.body = body;
      return res;
    });
    return res as Response & { statusCode?: number; body?: any };
  };

  beforeAll(() => {
    // 角色为超管角色的账号（白名单内）
    mkSession('tok-harden-admin', { userId: 'usr_harden_admin', role: 'admin', username: 'admin' });
    mkSession('tok-harden-administrator', { userId: 'usr_harden_admin2', role: 'administrator', username: 'a2' });
    mkSession('tok-harden-teacher', { userId: 'usr_harden_teacher', role: 'teacher', username: 't1' });
    mkSession('tok-harden-student', { userId: 'stu_harden_1', role: 'student', username: 's1' });

    // 注入尝试：session_data 里塞入白名单外的角色
    mkSession('tok-harden-badrole', { userId: 'usr_harden_evil', role: 'superadmin', username: 'evil' });
    mkSession('tok-harden-badrole2', { userId: 'usr_harden_evil2', role: 'ADMIN', username: 'evil2' });
    mkSession('tok-harden-badrole3', { userId: 'usr_harden_evil3', role: 'root', username: 'evil3' });

    // 注入尝试：userId 含 capability 语法分隔符
    mkSession('tok-harden-inject1', { userId: 'usr_a:administrator', role: 'teacher', username: 'inj1' });
    mkSession('tok-harden-inject2', { userId: 'usr b\tc', role: 'teacher', username: 'inj2' });
    mkSession('tok-harden-inject3', { userId: 'usr_d:student:administrator', role: 'student', username: 'inj3' });
    mkSession('tok-harden-longid', { userId: 'x'.repeat(200), role: 'teacher', username: 'long1' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getCookieToken', () => {
    it('无 cookie 头 → null', () => {
      expect(getCookieToken({ headers: {} } as unknown as Request)).toBeNull();
    });

    it('从多个 cookie 中正确取出 edu_os_token', () => {
      const req = { headers: { cookie: 'foo=1; edu_os_token=abc123; bar=2' } } as unknown as Request;
      expect(getCookieToken(req)).toBe('abc123');
    });

    it('cookie 名等号两侧有空格时取不到 token（记录当前严格行为）', () => {
      // `getCookieToken` 匹配的是整串 'edu_os_token='，`=` 前有空格即不匹配。
      // 真实浏览器按 RFC 6265 序列化 cookie，不会产出这种形式，故此处
      // 断言的是「不宽松匹配」这一事实，而非期望放行。
      const req = { headers: { cookie: 'edu_os_token =spaced' } } as unknown as Request;
      expect(getCookieToken(req)).toBeNull();
    });

    it('token 值的尾部空格随分号切分被丢弃，前导空格保留', () => {
      // `getCookieToken` 先 split(';') 再对每段 trim()，因此尾部空格在切分时即被去除，
      // 而位于 '=' 之后的空格属于值的一部分、被保留。
      const req = { headers: { cookie: 'edu_os_token=   spaced  ; x=1' } } as unknown as Request;
      expect(getCookieToken(req)).toBe('   spaced');
    });

    it('最后一个 cookie 段也能正确取出', () => {
      const req = { headers: { cookie: 'x=1; edu_os_token=lastseg' } } as unknown as Request;
      expect(getCookieToken(req)).toBe('lastseg');
    });
  });

  describe('getValidSession — role 白名单（MUT-M2 回归锁）', () => {
    it('白名单内的 4 种角色被原样保留', () => {
      expect(getValidSession('tok-harden-admin')?.role).toBe('admin');
      expect(getValidSession('tok-harden-administrator')?.role).toBe('administrator');
      expect(getValidSession('tok-harden-teacher')?.role).toBe('teacher');
      expect(getValidSession('tok-harden-student')?.role).toBe('student');
    });

    it.each([
      ['tok-harden-badrole', 'superadmin'],
      ['tok-harden-badrole2', 'ADMIN'],
      ['tok-harden-badrole3', 'root'],
    ])('白名单外角色 %s（%s）被降级为 anonymous', (token, originalRole) => {
      const session = getValidSession(token);
      expect(session).not.toBeNull();
      expect(session!.role).toBe('anonymous');
      expect(session!.role).not.toBe(originalRole);
    });

    it('不存在 / 已过期的 token → null', () => {
      expect(getValidSession('tok-that-never-existed')).toBeNull();
    });

    it('过期 session 被删除且返回 null', () => {
      const token = 'tok-harden-expired';
      db.prepare('DELETE FROM client_sessions WHERE id = ?').run(token);
      const past = Date.now() - 60 * 60 * 1000;
      db.prepare('INSERT INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)').run(
        token,
        JSON.stringify({ userId: 'usr_expired', role: 'teacher' }),
        past,
        past, // 已过期
      );
      expect(getValidSession(token)).toBeNull();
      const left = db.prepare('SELECT COUNT(*) AS c FROM client_sessions WHERE id = ?').get(token) as { c: number };
      expect(left.c).toBe(0);
    });

    it('只有 studentId 而无 userId 时，userId 回填为 studentId', () => {
      const token = 'tok-harden-studentid-only';
      mkSession(token, { studentId: 'stu_only_1', role: 'student' });
      const session = getValidSession(token);
      expect(session!.studentId).toBe('stu_only_1');
      expect(session!.userId).toBe('stu_only_1');
    });
  });

  describe('getActorId — actorId 净化（MUT-M2 回归锁）', () => {
    it('正常 userId 原样输出', () => {
      expect(getActorId(reqWithCookie('tok-harden-teacher'))).toBe('user:usr_harden_teacher:teacher');
    });

    it('无 token → anonymous', () => {
      expect(getActorId(reqWithCookie(null))).toBe('anonymous');
    });

    it('非法 token → anonymous', () => {
      expect(getActorId(reqWithCookie('tok-nope'))).toBe('anonymous');
    });

    it.each([
      ['tok-harden-inject1', 'usr_a:administrator', 'usr_a_administrator'],
      ['tok-harden-inject2', 'usr b\tc', 'usr_b_c'],
      ['tok-harden-inject3', 'usr_d:student:administrator', 'usr_d_student_administrator'],
    ])('%s 的 userId %j 被净化为 %j（分隔符不得透传）', (token, _raw, expectedUserId) => {
      const actorId = getActorId(reqWithCookie(token));
      expect(actorId).toBe(
        `user:${expectedUserId}:teacher`.replace(':teacher', token === 'tok-harden-inject3' ? ':student' : ':teacher'),
      );
      // 关键：actorId 的分段数必须是 3，`:` 不得从 userId 泄漏进分段结构
      expect(actorId.split(':').length).toBe(3);
    });

    it('超长 userId 被截断到 64 字符', () => {
      const actorId = getActorId(reqWithCookie('tok-harden-longid'));
      const userId = actorId.slice('user:'.length, actorId.lastIndexOf(':'));
      expect(userId).toHaveLength(64);
    });

    it('非法角色的 actorId 不得携带越权角色段', () => {
      const actorId = getActorId(reqWithCookie('tok-harden-badrole'));
      expect(actorId.endsWith(':anonymous')).toBe(true);
      expect(actorId).not.toContain('superadmin');
    });

    it('admin / administrator 角色统一归一为 administrator', () => {
      expect(getActorId(reqWithCookie('tok-harden-admin')).endsWith(':administrator')).toBe(true);
      expect(getActorId(reqWithCookie('tok-harden-administrator')).endsWith(':administrator')).toBe(true);
    });
  });

  describe('requireAuth 中间件', () => {
    const run = (token: string | null, ...roles: string[]) => {
      const res = mkRes();
      const next = vi.fn();
      requireAuth(...roles)(reqWithCookie(token), res, next);
      return { res, next };
    };

    it('无 token → 401 且不调用 next', () => {
      const { res, next } = run(null);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('非法 token → 401 且不调用 next', () => {
      const { res, next } = run('tok-nope');
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('有效 session 且未指定角色 → 放行', () => {
      const { res, next } = run('tok-harden-student');
      expect(res.status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('角色匹配 → 放行', () => {
      const { res, next } = run('tok-harden-teacher', 'teacher');
      expect(res.status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('角色不匹配 → 403 且不调用 next', () => {
      const { res, next } = run('tok-harden-student', 'teacher', 'administrator');
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('被降级为 anonymous 的非法角色无法通过任何特权角色门禁', () => {
      // 不把 'anonymous' 列入 roles：它是降级后的兜底值，不是可授予的权限
      for (const role of ['teacher', 'administrator', 'admin']) {
        const { res, next } = run('tok-harden-badrole', role);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
      }
    });

    it('requireAuth 未指定角色时，非法角色仍可进入（门禁交由下游 capability 判定）', () => {
      // 记录当前设计语义：requireAuth() 无参只校验「已登录」，角色鉴权靠 capability 层。
      // 本用例防止未来误把「降级为 anonymous」当作「认证失败」而误改行为。
      const { res, next } = run('tok-harden-badrole');
      expect(res.status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('requireAuth("admin") 与 requireAuth("administrator") 等价', () => {
      const viaAdmin = run('tok-harden-administrator', 'admin');
      const viaAdministrator = run('tok-harden-administrator', 'administrator');
      expect(viaAdmin.next).toHaveBeenCalledTimes(1);
      expect(viaAdministrator.next).toHaveBeenCalledTimes(1);
    });

    it('username=admin 的会话获得 administrator 权限', () => {
      const token = 'tok-harden-username-admin';
      mkSession(token, { userId: 'usr_plain', role: 'teacher', username: 'admin' });
      const { next } = run(token, 'administrator');
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkIsTeacherOrAdmin', () => {
    it('无 token → false', () => {
      expect(checkIsTeacherOrAdmin(reqWithCookie(null))).toBe(false);
    });

    it('teacher → true', () => {
      expect(checkIsTeacherOrAdmin(reqWithCookie('tok-harden-teacher'))).toBe(true);
    });

    it('administrator → true', () => {
      expect(checkIsTeacherOrAdmin(reqWithCookie('tok-harden-administrator'))).toBe(true);
    });

    it('student → false', () => {
      expect(checkIsTeacherOrAdmin(reqWithCookie('tok-harden-student'))).toBe(false);
    });

    it('被降级为 anonymous 的非法角色 → false', () => {
      expect(checkIsTeacherOrAdmin(reqWithCookie('tok-harden-badrole'))).toBe(false);
    });
  });
});
