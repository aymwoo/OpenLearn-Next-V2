/**
 * 登录负面路径鉴权测试（P0 — 修复「认证可被完全绕过」的覆盖缺口）
 *
 * ## 为什么需要这个文件
 *
 * 变异测试（MUT-N1）把 `server/routes/roster.ts` 教师入口的
 * `verifyPassword(...)` 结果替换成硬编码 `{ valid: true }`，
 * 即「任何密码都能登录」，而当时全量 2243 个测试 **依然全绿**。
 * 变异-N4（删掉 `status === 'disabled'` 拦截，使禁用账号可登录）同样存活。
 *
 * 根因：既有测试只覆盖**登录成功**路径 ——
 *   - `class-passcode-auth.test.ts` 的 7 次 `/api/auth/login` 全部走**学生入口**；
 *   - 3 个 Playwright spec 一律用正确的 `admin/admin`，且只断言 `ok()` 为真。
 * 全仓库没有任何一处断言「错误密码被拒绝」。
 *
 * 本文件建立**能区分对错的成对断言**：每个负面用例都配一个正向对照，
 * 确保测试在「校验逻辑被删除」时变红、在「校验逻辑正常」时变绿，
 * 而不是在两种情况下都通过。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { registerRosterRoutes } from '../routes/roster.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { setAuditSinkForTests, type AuditRecord } from '../../packages/core/observability/audit-log.js';

const GENERIC_LOGIN_FAILURE = 'Incorrect username or password';

describe('登录负面路径鉴权（教师入口 + 学生入口）', () => {
  let server: Server;
  let baseUrl: string;

  const db = kernelContainer.db as any;

  // 独立命名前缀，避免与其他 server 测试的用户/学生冲突
  const bcryptUserId = 'usr-negtest-bcrypt';
  const bcryptUsername = 'negtest_bcrypt_teacher';
  const bcryptPwd = 'CorrectHorse-Battery-9';

  const shaUserId = 'usr-negtest-sha';
  const shaUsername = 'negtest_sha_teacher';
  const shaPwd = 'LegacySha-Password-3';

  const disabledUserId = 'usr-negtest-disabled';
  const disabledUsername = 'negtest_disabled_teacher';
  const disabledPwd = 'Disabled-Account-Pwd-7';

  const studentId = 'stu-negtest-001';
  const studentNumber = 'NEG9001';
  const studentPwd = 'Student-Personal-Pwd-5';

  const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

  beforeAll(async () => {
    const app = express();
    app.use(express.json());

    // 关闭限流，否则负面用例会被 429 抢先、掩盖鉴权语义
    const noopLimiter = (_req: any, _res: any, next: any) => next();
    registerRosterRoutes({ app, io: undefined, loginLimiter: noopLimiter } as any);

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const now = Date.now();
    const insertUser = db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );

    // 1. 正常 bcrypt 教师账号（作为正向对照）
    db.prepare('DELETE FROM users WHERE id IN (?, ?, ?)').run(bcryptUserId, shaUserId, disabledUserId);
    insertUser.run(
      bcryptUserId,
      bcryptUsername,
      bcrypt.hashSync(bcryptPwd, 10),
      'teacher',
      '负面测试教师A',
      now,
      'active',
    );

    // 2. 旧 SHA-256 哈希教师账号 —— 覆盖 verifyPassword 的 needsUpgrade 自动升级分支
    insertUser.run(shaUserId, shaUsername, sha256(shaPwd), 'teacher', '负面测试教师B', now, 'active');

    // 3. 被禁用账号 —— 密码正确也必须被拒
    insertUser.run(
      disabledUserId,
      disabledUsername,
      bcrypt.hashSync(disabledPwd, 10),
      'teacher',
      '负面测试教师C',
      now,
      'disabled',
    );

    // 4. 学生账号
    db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
    db.prepare(
      'INSERT INTO students (id, student_number, name, email, password, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(studentId, studentNumber, '负面测试学生', 'neg@school.edu', bcrypt.hashSync(studentPwd, 10), now);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const login = (body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const teacherLogin = (username: string, password: string) => login({ entrance: 'teacher', username, password });

  describe('教师入口 — 密码校验（MUT-N1 的直接回归锁）', () => {
    it('正向对照：正确密码 + 存在的账号 → 200，且返回 teacher 会话', async () => {
      const res = await teacherLogin(bcryptUsername, bcryptPwd);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.session?.role).toBe('teacher');
      expect(body.session?.username).toBe(bcryptUsername);
    });

    it('错误密码 → 401，客户端文案不区分「密码错误」，且不创建任何会话', async () => {
      const res = await teacherLogin(bcryptUsername, 'WrongPassword-0000');
      expect(res.status).toBe(401);
      const body: any = await res.json();
      expect(body.error).toBe(GENERIC_LOGIN_FAILURE);
      // 响应体绝不能带出 session/token
      expect(body.session).toBeUndefined();
      expect(body.token).toBeUndefined();
    });

    it('空密码 → 400 入参门禁，而不是 200', async () => {
      const res = await teacherLogin(bcryptUsername, '');
      expect(res.status).toBe(400);
    });

    it('密码大小写错误 → 401（大小写必须敏感）', async () => {
      const res = await teacherLogin(bcryptUsername, bcryptPwd.toUpperCase());
      expect(res.status).toBe(401);
    });

    it('正确账号 + 另一个账号的密码 → 401（不得跨账号放行）', async () => {
      const res = await teacherLogin(bcryptUsername, disabledPwd);
      expect(res.status).toBe(401);
    });

    it('旧 SHA-256 哈希账号：错误密码 → 401', async () => {
      const res = await teacherLogin(shaUsername, 'NotTheLegacyPassword');
      expect(res.status).toBe(401);
      const body: any = await res.json();
      expect(body.error).toBe(GENERIC_LOGIN_FAILURE);
    });

    it('旧 SHA-256 哈希账号：正确密码 → 200，且哈希自动升级为 bcrypt', async () => {
      const res = await teacherLogin(shaUsername, shaPwd);
      expect(res.status).toBe(200);

      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(shaUserId) as {
        password_hash: string;
      };
      expect(row.password_hash).toMatch(/^\$2[aby]\$/);
      // 升级后的哈希必须仍能通过校验
      expect(bcrypt.compareSync(shaPwd, row.password_hash)).toBe(true);
    });
  });

  describe('教师入口 — 账号状态与入参门禁', () => {
    it('被禁用账号：即使密码正确也必须 403（MUT-N4 的直接回归锁）', async () => {
      const res = await teacherLogin(disabledUsername, disabledPwd);
      expect(res.status).toBe(403);
      const body: any = await res.json();
      expect(body.error).toMatch(/disabled/i);
      expect(body.session).toBeUndefined();
    });

    it('不存在的用户名 → 401，客户端文案与错误密码相同', async () => {
      const res = await teacherLogin('negtest_no_such_user_at_all', 'whatever');
      expect(res.status).toBe(401);
      const body: any = await res.json();
      expect(body.error).toBe(GENERIC_LOGIN_FAILURE);
    });

    it('用户不存在与密码错误共用客户端文案，审计原因不同且不含口令', async () => {
      const seen: AuditRecord[] = [];
      setAuditSinkForTests((record) => seen.push(record));
      const wrongPassword = 'WrongPassword-Audit-1';
      try {
        const missing = await teacherLogin('negtest_no_such_user_audit', wrongPassword);
        const bad = await teacherLogin(bcryptUsername, wrongPassword);
        expect(missing.status).toBe(401);
        expect(bad.status).toBe(401);
        const missingBody: any = await missing.json();
        const badBody: any = await bad.json();
        expect(missingBody.error).toBe(GENERIC_LOGIN_FAILURE);
        expect(badBody.error).toBe(missingBody.error);
        expect(JSON.stringify(missingBody)).not.toContain(wrongPassword);
        expect(JSON.stringify(badBody)).not.toContain(wrongPassword);

        const reasons = seen.filter((row) => row.event === 'auth.login_failed').map((row) => row.reason);
        expect(reasons).toContain('user_not_found');
        expect(reasons).toContain('bad_password');
        expect(JSON.stringify(seen)).not.toContain(wrongPassword);
      } finally {
        setAuditSinkForTests(null);
      }
    });

    it('缺少密码字段 → 400', async () => {
      const res = await login({ entrance: 'teacher', username: bcryptUsername });
      expect(res.status).toBe(400);
    });

    it('缺少用户名字段 → 400', async () => {
      const res = await login({ entrance: 'teacher', password: bcryptPwd });
      expect(res.status).toBe(400);
    });

    it('未知 entrance → 400 Unsupported entry type，且不建立会话', async () => {
      const before = db.prepare('SELECT COUNT(*) AS c FROM client_sessions').get() as { c: number };
      const res = await login({ entrance: 'principal', username: bcryptUsername, password: bcryptPwd });
      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.error).toBe('Unsupported entry type');
      expect(body.session).toBeUndefined();
      const after = db.prepare('SELECT COUNT(*) AS c FROM client_sessions').get() as { c: number };
      expect(after.c).toBe(before.c);
    });

    it('被禁用账号的登录尝试不得写入 client_sessions', async () => {
      const before = db.prepare('SELECT COUNT(*) AS c FROM client_sessions').get() as { c: number };
      await teacherLogin(disabledUsername, disabledPwd);
      const after = db.prepare('SELECT COUNT(*) AS c FROM client_sessions').get() as { c: number };
      expect(after.c).toBe(before.c);
    });

    it('错误密码的登录尝试不得写入 client_sessions', async () => {
      const before = db.prepare('SELECT COUNT(*) AS c FROM client_sessions').get() as { c: number };
      await teacherLogin(bcryptUsername, 'WrongPassword-0000');
      const after = db.prepare('SELECT COUNT(*) AS c FROM client_sessions').get() as { c: number };
      expect(after.c).toBe(before.c);
    });
  });

  describe('学生入口 — 个人密码校验', () => {
    it('正向对照：正确学号 + 正确个人密码 → 200', async () => {
      const res = await login({ entrance: 'student', studentId: studentNumber, password: studentPwd });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.session?.role).toBe('student');
    });

    it('错误个人密码且无匹配的班级口令 → 401', async () => {
      const res = await login({ entrance: 'student', studentId: studentNumber, password: 'WrongStudentPwd-1' });
      expect(res.status).toBe(401);
      const body: any = await res.json();
      expect(body.session).toBeUndefined();
    });

    it('空密码 → 400', async () => {
      const res = await login({ entrance: 'student', studentId: studentNumber, password: '' });
      expect(res.status).toBe(400);
    });

    it('不存在的学号与错误个人密码共用客户端文案，审计原因不同', async () => {
      const seen: AuditRecord[] = [];
      setAuditSinkForTests((record) => seen.push(record));
      try {
        const missing = await login({ entrance: 'student', studentId: 'NEG0000', password: studentPwd });
        const bad = await login({ entrance: 'student', studentId: studentNumber, password: 'WrongStudentPwd-1' });
        expect(missing.status).toBe(401);
        expect(bad.status).toBe(401);
        const missingBody: any = await missing.json();
        const badBody: any = await bad.json();
        expect(missingBody.error).toBe(GENERIC_LOGIN_FAILURE);
        expect(badBody.error).toBe(missingBody.error);
        const reasons = seen.filter((row) => row.event === 'auth.login_failed').map((row) => row.reason);
        expect(reasons).toContain('student_not_found');
        expect(reasons).toContain('bad_credentials');
      } finally {
        setAuditSinkForTests(null);
      }
    });

    it('明文库存口令不能登录，也不被改写成哈希', async () => {
      const plainId = 'stu-negtest-plain';
      const plainNumber = 'NEG9002';
      const plainPassword = 'PlainText-Secret-1';
      db.prepare('DELETE FROM students WHERE id = ?').run(plainId);
      db.prepare(
        'INSERT INTO students (id, student_number, name, email, password, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(plainId, plainNumber, '明文学生', 'plain@school.edu', plainPassword, Date.now());

      const seen: AuditRecord[] = [];
      setAuditSinkForTests((record) => seen.push(record));
      try {
        const res = await login({ entrance: 'student', studentId: plainNumber, password: plainPassword });
        expect(res.status).toBe(401);
        const body: any = await res.json();
        expect(body.error).toBe(GENERIC_LOGIN_FAILURE);
        expect(body.session).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain(plainPassword);

        const stored = db.prepare('SELECT password FROM students WHERE id = ?').get(plainId) as { password: string };
        expect(stored.password).toBe(plainPassword);

        const rejected = seen.find((row) => row.reason === 'plaintext_password_rejected');
        expect(rejected?.event).toBe('auth.login_failed');
        expect(JSON.stringify(seen)).not.toContain(plainPassword);
      } finally {
        setAuditSinkForTests(null);
        db.prepare('DELETE FROM students WHERE id = ?').run(plainId);
      }
    });

    it('旧 SHA-256 学生口令：正确密码 → 200，且升级为 bcrypt', async () => {
      const shaStudentId = 'stu-negtest-sha';
      const shaStudentNumber = 'NEG9003';
      const shaStudentPwd = 'LegacyStudent-Sha-4';
      db.prepare('DELETE FROM students WHERE id = ?').run(shaStudentId);
      db.prepare(
        'INSERT INTO students (id, student_number, name, email, password, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(shaStudentId, shaStudentNumber, '哈希学生', 'sha@school.edu', sha256(shaStudentPwd), Date.now());

      const res = await login({ entrance: 'student', studentId: shaStudentNumber, password: shaStudentPwd });
      expect(res.status).toBe(200);
      const row = db.prepare('SELECT password FROM students WHERE id = ?').get(shaStudentId) as { password: string };
      expect(row.password).toMatch(/^\$2[aby]\$/);
      expect(bcrypt.compareSync(shaStudentPwd, row.password)).toBe(true);
      db.prepare('DELETE FROM students WHERE id = ?').run(shaStudentId);
    });
  });
});
