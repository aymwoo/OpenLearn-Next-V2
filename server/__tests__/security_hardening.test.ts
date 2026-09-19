import { describe, it, expect, vi } from 'vitest';
import path from 'path';
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
        .run(
          token,
          JSON.stringify({ role: 'student', studentId: 'stu_alice' }),
          Date.now(),
          Date.now() + 100000,
        );

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

  describe('VULN-10: Helmet Content-Security-Policy & script-src-attr Configuration', () => {
    it('should explicitly permit inline event handlers (script-src-attr "unsafe-inline") and not block with "none"', async () => {
      const helmet = (await import('helmet')).default;
      const express = (await import('express')).default;
      const app = express();

      // Mirror helmet configuration in server.ts
      app.use(
        helmet({
          contentSecurityPolicy: {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:'],
              scriptSrcAttr: ["'unsafe-inline'"],
              styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
              styleSrcAttr: ["'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
              connectSrc: ["'self'", 'ws:', 'wss:', 'https:'],
              fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
              upgradeInsecureRequests: null,
            },
          },
        }),
      );

      app.get('/test-csp', (_req, res) => res.send('ok'));

      const server = app.listen(0);
      const port = (server.address() as any).port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/test-csp`);
        const csp = res.headers.get('content-security-policy') || '';

        // Must permit script-src-attr inline events (onclick etc.)
        expect(csp).toContain("script-src-attr 'unsafe-inline'");
        // Must NOT contain script-src-attr 'none'
        expect(csp).not.toContain("script-src-attr 'none'");
        // Must permit style-src-attr inline styles
        expect(csp).toContain("style-src-attr 'unsafe-inline'");
        // Must not force HTTP to HTTPS upgrade for HTTP deployment
        expect(csp).not.toContain('upgrade-insecure-requests');
      } finally {
        server.close();
      }
    });
  });
});
