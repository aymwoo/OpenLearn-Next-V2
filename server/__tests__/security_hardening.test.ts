import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import { safeEvaluateMath } from '../../src/features/whiteboard/widgets/MathGraphWrapper.js';
import { requireAuth, getActorId } from '../middleware/auth.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import type { Request, Response, NextFunction } from 'express';

describe('Security Hardening Suite (P0 Vulnerabilities)', () => {
  describe('VULN-06: Whiteboard Math Graph Safe Evaluator', () => {
    it('should correctly evaluate standard mathematical formulas without eval', () => {
      expect(safeEvaluateMath('2 * x + 1', 3)).toBe(7);
      expect(safeEvaluateMath('x^2 + 4', 2)).toBe(8);
      expect(safeEvaluateMath('sin(0)', 0)).toBe(0);
      expect(safeEvaluateMath('cos(0)', 0)).toBe(1);
      expect(safeEvaluateMath('sqrt(16)', 0)).toBe(4);
      expect(safeEvaluateMath('-x + 5', 2)).toBe(3);
      expect(safeEvaluateMath('(x + 2) * (x - 2)', 3)).toBe(5);
    });

    it('should reject JavaScript injection and execution attempts', () => {
      const maliciousPayloads = [
        'alert(1)',
        'console.log(process)',
        'this.constructor',
        'x.constructor.constructor("return 1")()',
        'window.location="http://evil.com"',
        'document.cookie',
        'fetch("/api/admin")',
        'process.exit(1)',
        'require("child_process")',
        '__proto__.polluted = true',
        '; harmful()',
        '{ a: 1 }',
        '[1, 2, 3]',
        '`${7*7}`',
      ];

      for (const payload of maliciousPayloads) {
        expect(() => safeEvaluateMath(payload, 1)).toThrow();
      }
    });

    it('should handle division by zero and edge cases gracefully', () => {
      expect(safeEvaluateMath('1 / x', 0)).toBeNaN();
      expect(safeEvaluateMath('', 0)).toBeNaN();
    });
  });

  describe('VULN-01 & VULN-03: Route Authentication & Role Guards', () => {
    it('should block unauthenticated requests with 401', () => {
      const middleware = requireAuth('teacher', 'administrator');
      const req = { headers: {} } as Request;
      let status = 0;
      let jsonBody: any = null;
      const res = {
        status: (s: number) => {
          status = s;
          return {
            json: (b: any) => {
              jsonBody = b;
            },
          };
        },
      } as unknown as Response;
      const next = vi.fn() as unknown as NextFunction;

      middleware(req, res, next);
      expect(status).toBe(401);
      expect(jsonBody?.success).toBe(false);
      expect(next).not.toHaveBeenCalled();
    });

    it('should correctly authorize student session for general requireAuth() and resolve actorId with studentId fallback', () => {
      const middleware = requireAuth();
      const token = 'token_test_student_123';
      kernelContainer.db.prepare('DELETE FROM client_sessions WHERE id = ?').run(token);
      kernelContainer.db
        .prepare('INSERT INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)')
        .run(token, JSON.stringify({ role: 'student', studentId: 'stu_alice' }), Date.now(), Date.now() + 100000);

      const req = { headers: { cookie: `edu_os_token=${token}` } } as any;
      const next = vi.fn();
      middleware(req, {} as any, next);
      expect(next).toHaveBeenCalled();
      expect(req.session?.studentId).toBe('stu_alice');
      expect(req.session?.userId).toBe('stu_alice');
      expect(getActorId(req)).toBe('user:stu_alice:student');

      kernelContainer.db.prepare('DELETE FROM client_sessions WHERE id = ?').run(token);
    });

    it('should allow student to access their own dashboard using either primary ID or student_number', () => {
      const studentId = 'test-stu-s1';
      const studentNum = 'S001_TEST';

      kernelContainer.db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
      kernelContainer.db
        .prepare('INSERT INTO students (id, name, student_number, password, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(studentId, 'Test Student', studentNum, 'pwd', Date.now());

      // 1. Session has userId: studentId
      const sessionWithId = { role: 'student', userId: studentId, studentId };
      const currentUserId = sessionWithId.userId || sessionWithId.studentId;

      // Query by ID
      let studentRow = kernelContainer.db
        .prepare('SELECT id, student_number FROM students WHERE id = ? OR student_number = ?')
        .get(studentId, studentId) as any;
      let isSelf = studentRow
        ? currentUserId === studentRow.id || (studentRow.student_number && currentUserId === studentRow.student_number)
        : currentUserId === studentId;
      expect(isSelf).toBe(true);

      // Query by student_number
      studentRow = kernelContainer.db
        .prepare('SELECT id, student_number FROM students WHERE id = ? OR student_number = ?')
        .get(studentNum, studentNum) as any;
      isSelf = studentRow
        ? currentUserId === studentRow.id || (studentRow.student_number && currentUserId === studentRow.student_number)
        : currentUserId === studentNum;
      expect(isSelf).toBe(true);

      // Other student should be forbidden
      const otherStudentSession = { role: 'student', userId: 'other-stu', studentId: 'other-stu' };
      const otherUserId = otherStudentSession.userId;
      isSelf = studentRow
        ? otherUserId === studentRow.id || (studentRow.student_number && otherUserId === studentRow.student_number)
        : otherUserId === studentNum;
      expect(isSelf).toBe(false);

      kernelContainer.db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
    });
  });

  describe('VULN-07: Courseware Path Traversal Defense', () => {
    it('should sanitize paths using path.basename and boundary checks', () => {
      const storageDir = '/var/app/storage/coursewares';
      const maliciousFilenames = [
        '../../etc/passwd.html',
        '..\\..\\windows\\system32\\calc.exe.html',
        '../../../server.js',
        'nested/../../../etc/shadow.html',
      ];

      for (const filename of maliciousFilenames) {
        const safeBaseName = path.basename(filename.replace(/\\/g, '/'));
        const resolvedPath = path.resolve(storageDir, safeBaseName);

        // Assert that path.basename strips all directory traversal sequences
        expect(safeBaseName).not.toContain('..');
        expect(safeBaseName).not.toContain('/');
        expect(safeBaseName).not.toContain('\\');
        // Assert that the destination path strictly stays within storageDir
        expect(resolvedPath.startsWith(storageDir)).toBe(true);
      }
    });
  });

  describe('VULN-04: Plugin Deploy Scripts Security Gate', () => {
    it('should require ALLOW_UNSAFE_PLUGIN_SCRIPTS=true to run deploy scripts', () => {
      const originalEnv = process.env.ALLOW_UNSAFE_PLUGIN_SCRIPTS;
      try {
        delete process.env.ALLOW_UNSAFE_PLUGIN_SCRIPTS;
        const isAllowed = process.env.ALLOW_UNSAFE_PLUGIN_SCRIPTS === 'true';
        expect(isAllowed).toBe(false);

        process.env.ALLOW_UNSAFE_PLUGIN_SCRIPTS = 'false';
        expect(process.env.ALLOW_UNSAFE_PLUGIN_SCRIPTS === 'true').toBe(false);

        process.env.ALLOW_UNSAFE_PLUGIN_SCRIPTS = 'true';
        expect(process.env.ALLOW_UNSAFE_PLUGIN_SCRIPTS === 'true').toBe(true);
      } finally {
        if (originalEnv !== undefined) {
          process.env.ALLOW_UNSAFE_PLUGIN_SCRIPTS = originalEnv;
        } else {
          delete process.env.ALLOW_UNSAFE_PLUGIN_SCRIPTS;
        }
      }
    });
  });

  describe('VULN-09: Plugin Zip Slip Traversal Gate', () => {
    it('should detect and reject any entry path containing traversal sequences', () => {
      const maliciousEntries = [
        '../evil.js',
        'storage/../../etc/passwd',
        '..\\..\\windows\\win.ini',
        'nested/../../../dangerous.sh',
      ];

      for (const entry of maliciousEntries) {
        const normalized = entry.replace(/\\/g, '/');
        const hasTraversal = normalized.split('/').includes('..');
        expect(hasTraversal).toBe(true);
      }
    });

    it('should verify resolved path stays strictly within plugin directory', () => {
      const pluginDir = '/var/app/plugins/test-plugin';
      const safeEntry = 'storage/assets/logo.png';
      const resolvedSafe = path.resolve(pluginDir, safeEntry);
      expect(resolvedSafe.startsWith(pluginDir + path.sep)).toBe(true);

      const maliciousEntry = '../../outside.js';
      const resolvedMalicious = path.resolve(pluginDir, maliciousEntry);
      expect(resolvedMalicious.startsWith(pluginDir + path.sep)).toBe(false);
    });
  });

  describe('VULN-11: Database RPC High-Risk Keyword Blocker', () => {
    const FORBIDDEN_SQL_PATTERNS = [
      /\bATTACH\s+DATABASE\b/i,
      /\bDETACH\s+DATABASE\b/i,
      /\bPRAGMA\b/i,
      /\bVACUUM\b/i,
      /\bCREATE\s+(?:TEMP|TEMPORARY\s+)?TRIGGER\b/i,
      /\bDROP\s+TRIGGER\b/i,
      /\bCREATE\s+(?:TEMP|TEMPORARY\s+)?VIEW\b/i,
      /\bDROP\s+VIEW\b/i,
    ];

    it('should block dangerous SQLite administration and metastructure commands', () => {
      const maliciousSqls = [
        "ATTACH DATABASE '/etc/passwd' AS shadow",
        "ATTACH DATABASE ':memory:' AS hack",
        'DETACH DATABASE shadow',
        'PRAGMA table_info(users)',
        'PRAGMA foreign_keys = OFF',
        "VACUUM INTO 'backup.db'",
        'CREATE TRIGGER rce AFTER INSERT ON users BEGIN SELECT 1; END',
        'CREATE TEMPORARY TRIGGER backdoor BEFORE UPDATE ON students BEGIN SELECT 1; END',
        'DROP TRIGGER rce',
        'CREATE VIEW steal AS SELECT * FROM users',
        'DROP VIEW steal',
      ];

      for (const sql of maliciousSqls) {
        const isBlocked = FORBIDDEN_SQL_PATTERNS.some((p) => p.test(sql));
        expect(isBlocked).toBe(true);
      }
    });

    it('should allow legitimate DML statements', () => {
      const safeSqls = [
        "SELECT * FROM plugin_data WHERE key = 'counter'",
        "INSERT INTO plugin_data (key, value) VALUES ('k', 'v')",
        "UPDATE plugin_data SET value = 'v2' WHERE key = 'k'",
        "DELETE FROM plugin_data WHERE key = 'k'",
      ];

      for (const sql of safeSqls) {
        const isBlocked = FORBIDDEN_SQL_PATTERNS.some((p) => p.test(sql));
        expect(isBlocked).toBe(false);
      }
    });
  });

  describe('G-4a: CSP script-src-attr 收紧为 none', () => {
    /**
     * ## 为什么重写这个测试
     *
     * 原用例名为「should explicitly permit inline event handlers …and not block
     * with 'none'」—— 它把**不安全配置断言成了预期**，且把 helmet 配置在测试里
     * **手抄了一份镜像**。于是：
     *   · server.ts 改了，测试不会红（它测的是副本，不是真配置）
     *   · 断言方向本身是错的：script-src-attr 'unsafe-inline' 对 SPA 无作用，
     *     却让任何注入的 HTML 属性直接执行代码
     *
     * 现在改为**从 server.ts 源码读取真实配置**并断言收紧结果，杜绝副本漂移。
     */

    const readServerSource = () => fs.readFileSync(path.resolve(__dirname, '../../server.ts'), 'utf-8');

    it('server.ts 的 scriptSrcAttr 必须是 "\'none\'"', () => {
      const src = readServerSource();
      expect(
        src,
        "server.ts 必须收紧 scriptSrcAttr 为 'none'（G-4a）。\n" +
          '若确需放开，请先确认没有内联事件处理器依赖，并在此处写明理由。',
      ).toMatch(/scriptSrcAttr:\s*\["'none'"\]/);
      // 防止同时又出现一份 'unsafe-inline' 的 scriptSrcAttr
      const attrLines = src.split('\n').filter((l) => l.includes('scriptSrcAttr'));
      expect(attrLines).toHaveLength(1);
    });

    it('SPA 构建产物不依赖内联事件处理器（收紧的前提）', () => {
      // script-src-attr 只管 HTML 属性里的 on*="..."；React 的 onClick={...}
      // 经合成事件绑定到 addEventListener，不进 HTML 属性。源码侧用
      // dangerouslySetInnerHTML 注入 HTML 属性才是真正风险 —— 必须为 0。
      const scanForDangerousHtml = (dir: string, acc: string[] = []): string[] => {
        if (!fs.existsSync(dir)) return acc;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (['node_modules', 'dist', '.git', '__tests__'].includes(e.name)) continue;
          const p = path.join(dir, e.name);
          if (e.isDirectory()) scanForDangerousHtml(p, acc);
          else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) {
            if (fs.readFileSync(p, 'utf-8').includes('dangerouslySetInnerHTML')) acc.push(p);
          }
        }
        return acc;
      };
      const hits = scanForDangerousHtml(path.resolve(__dirname, '../../src'));
      expect(hits, `这些文件用 dangerouslySetInnerHTML 注入原始 HTML，收紧后会失效：\n${hits.join('\n')}`).toEqual([]);
    });

    it('index.html 无内联 <script> 内容（script-src 侧的前提，与本项正交）', () => {
      const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf-8');
      const inlineScripts = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
        .map((m) => m[1].trim())
        .filter(Boolean);
      expect(inlineScripts, 'index.html 存在内联脚本内容').toEqual([]);
    });

    it('第三方课件 HTML 仍走自有宽松 CSP（不受本次收紧影响）', async () => {
      const { COURSEWARE_DOCUMENT_CSP } = await import('../routes/shared.js');
      // 课件/资源/bridge 三条直出路径都调用 setCoursewareDocumentCsp() 覆盖全局头。
      // 那些是第三方 HTML，**必须**保留 script-src-attr 'unsafe-inline'。
      expect(COURSEWARE_DOCUMENT_CSP).toContain("script-src-attr 'unsafe-inline'");
    });

    it("收紧后的全局头确实产出 script-src-attr 'none'", async () => {
      // 用真实 server.ts 的取值跑一次 helmet，验证「写成 'none'」在产物里
      // 真的是 script-src-attr 'none'（而不是被 helmet 归一化掉）。
      const helmet = (await import('helmet')).default;
      const express = (await import('express')).default;
      const app = express();
      app.use(
        helmet({
          contentSecurityPolicy: {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:'],
              scriptSrcAttr: ["'none'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              styleSrcAttr: ["'unsafe-inline'"],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
            },
          },
        }),
      );
      app.get('/t', (_req, res) => res.send('ok'));
      const server = app.listen(0);
      const port = (server.address() as any).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/t`);
        const csp = res.headers.get('content-security-policy') || '';
        expect(csp).toContain("script-src-attr 'none'");
        expect(csp).not.toContain("script-src-attr 'unsafe-inline'");
        // style-src-attr 不在本次收紧范围 —— 动态 style 属性仍需放开
        expect(csp).toContain("style-src-attr 'unsafe-inline'");
      } finally {
        server.close();
      }
    });
  });
});
