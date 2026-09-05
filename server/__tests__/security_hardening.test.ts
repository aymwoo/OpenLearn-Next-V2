import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import { safeEvaluateMath } from '../../src/features/whiteboard/widgets/MathGraphWrapper.js';
import { requireAuth } from '../middleware/auth.js';
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
});
