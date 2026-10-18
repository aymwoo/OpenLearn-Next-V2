/**
 * @vitest-environment node
 *
 * 路由数据范围门禁（Issue #140）。
 *
 * 本文件覆盖三层防线：
 * 1. `requireScopedAuth` 的角色下限（admin / class-staff / self）。
 * 2. Express 路由栈审计：未声明 scope 的 `requireAuth()` 路由必须被识别。
 * 3. 源码静态扫描：`server/routes/*.ts` 中不允许再出现零参数 `requireAuth()`，
 *    且所有 `requireScopedAuth` 的 scope 必须是合法值（CI 门禁）。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { requireAuth } from '../middleware/auth.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import { auditRouteScopes, assertRouteDataScopes, collectAuthRoutes, type DataScope } from '../security/route-scope.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { PluginHttpRouter } from '../../packages/core/plugin-host/http-router.js';

const VALID_SCOPES: DataScope[] = ['public', 'authenticated', 'self', 'class-member', 'class-staff', 'admin'];

const db = () => kernelContainer.db as any;

function seedSession(token: string, data: Record<string, unknown>) {
  const now = Date.now();
  db().prepare('DELETE FROM client_sessions WHERE id = ?').run(token);
  db()
    .prepare('INSERT INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, JSON.stringify(data), now, now + 86400000);
}

function mkReq(token: string | null) {
  return { headers: token ? { cookie: `edu_os_token=${token}` } : {} } as any;
}

function mkRes() {
  const res: any = {};
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

function runMiddleware(middleware: any, req: any) {
  const res = mkRes();
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

describe('requireScopedAuth 角色下限', () => {
  beforeAll(() => {
    seedSession('tok-scope-student', { userId: 'stu_scope_1', role: 'student', username: 's1' });
    seedSession('tok-scope-teacher', { userId: 'usr_scope_t1', role: 'teacher', username: 't1' });
    seedSession('tok-scope-admin', { userId: 'usr_scope_admin', role: 'administrator', username: 'admin' });
  });

  it('self：学生本人可进入', () => {
    const { res, nextCalled } = runMiddleware(requireScopedAuth('self'), mkReq('tok-scope-student'));
    expect(nextCalled).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('class-member：学生可进入（班级归属由 handler 校验）', () => {
    const { nextCalled } = runMiddleware(requireScopedAuth('class-member'), mkReq('tok-scope-student'));
    expect(nextCalled).toBe(true);
  });

  it('class-staff：学生被 403，教师通过', () => {
    const student = runMiddleware(requireScopedAuth('class-staff'), mkReq('tok-scope-student'));
    expect(student.nextCalled).toBe(false);
    expect(student.res.statusCode).toBe(403);

    const teacher = runMiddleware(requireScopedAuth('class-staff'), mkReq('tok-scope-teacher'));
    expect(teacher.nextCalled).toBe(true);
  });

  it('admin：教师被 403，管理员通过', () => {
    const teacher = runMiddleware(requireScopedAuth('admin'), mkReq('tok-scope-teacher'));
    expect(teacher.nextCalled).toBe(false);
    expect(teacher.res.statusCode).toBe(403);

    const admin = runMiddleware(requireScopedAuth('admin'), mkReq('tok-scope-admin'));
    expect(admin.nextCalled).toBe(true);
  });

  it('未登录一律 401', () => {
    const { res, nextCalled } = runMiddleware(requireScopedAuth('self'), mkReq(null));
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('public 不允许与 requireScopedAuth 混用', () => {
    expect(() => requireScopedAuth('public')).toThrow(/public/);
  });

  it('会在 req 上记录 dataScope', () => {
    const req = mkReq('tok-scope-student');
    runMiddleware(requireScopedAuth('class-member'), req);
    expect(req.dataScope).toBe('class-member');
  });
});

describe('路由栈审计', () => {
  it('识别未声明 scope 的 requireAuth() 路由', () => {
    const app = express();
    app.get('/api/undeclared', requireAuth(), (_req, res) => res.end());
    app.get('/api/declared', requireScopedAuth('self'), (_req, res) => res.end());
    app.get('/api/role-gated', requireAuth('teacher'), (_req, res) => res.end());

    const audit = auditRouteScopes(app);
    expect(audit.undeclared.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /api/undeclared']);
    expect(audit.declared.map((r) => `${r.method} ${r.path}`)).toContain('GET /api/declared');
    expect(audit.roleGated.map((r) => `${r.method} ${r.path}`)).toContain('GET /api/role-gated');
  });

  it('白名单可暂缓已知路由，但必须显式匹配 method + path', () => {
    const app = express();
    app.get('/api/legacy', requireAuth(), (_req, res) => res.end());
    app.post('/api/legacy', requireAuth(), (_req, res) => res.end());

    const whitelist = [{ method: 'GET', path: '/api/legacy', reason: '迁移期遗留，见 #140' }];
    const audit = auditRouteScopes(app, whitelist);
    expect(audit.undeclared.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /api/legacy']);
  });

  it('warn 模式只告警，enforce 模式抛错', () => {
    const app = express();
    app.get('/api/undeclared', requireAuth(), (_req, res) => res.end());

    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    expect(() => assertRouteDataScopes(app, { logger })).not.toThrow();
    expect(logger.warn).toHaveBeenCalledOnce();

    const quiet = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    expect(() => assertRouteDataScopes(app, { logger: quiet, enforce: true })).toThrow(/未声明数据范围/);
    expect(quiet.error).toHaveBeenCalledOnce();
  });

  it('collectAuthRoutes 能从真实路由栈提取 scope 与角色', () => {
    const app = express();
    app.get('/api/a', requireAuth(), (_req, res) => res.end());
    app.get('/api/b', requireScopedAuth('class-staff'), (_req, res) => res.end());

    const routes = collectAuthRoutes(app);
    expect(routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'GET', path: '/api/a', roles: [] }),
        expect.objectContaining({ method: 'GET', path: '/api/b', scope: 'class-staff' }),
      ]),
    );
  });
});

describe('源码静态扫描（CI 门禁）', () => {
  const routesDir = path.resolve(process.cwd(), 'server/routes');

  function scanRouteFiles() {
    const findings: { file: string; line: number; kind: string; text: string }[] = [];
    for (const file of fs.readdirSync(routesDir).filter((f) => f.endsWith('.ts'))) {
      const full = path.join(routesDir, file);
      const src = fs.readFileSync(full, 'utf8');
      const sf = ts.createSourceFile(full, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const routeMethods = new Set(['get', 'post', 'put', 'delete', 'patch', 'all']);

      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const obj = node.expression.expression;
          const method = node.expression.name.text;
          if (obj && ts.isIdentifier(obj) && obj.text === 'app' && routeMethods.has(method)) {
            for (const arg of node.arguments) {
              if (ts.isCallExpression(arg) && ts.isIdentifier(arg.expression)) {
                const line = sf.getLineAndCharacterOfPosition(arg.getStart(sf)).line + 1;
                if (arg.expression.text === 'requireAuth' && arg.arguments.length === 0) {
                  findings.push({ file, line, kind: 'bare-requireAuth', text: arg.getText(sf) });
                }
                if (arg.expression.text === 'requireScopedAuth') {
                  const scopeArg = arg.arguments[0];
                  const scope = scopeArg && ts.isStringLiteral(scopeArg) ? scopeArg.text : '';
                  if (!VALID_SCOPES.includes(scope as DataScope)) {
                    findings.push({ file, line, kind: 'invalid-scope', text: arg.getText(sf) });
                  }
                }
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };

      visit(sf);
    }
    return findings;
  }

  it('server/routes 中不存在零参数 requireAuth() 路由', () => {
    const bare = scanRouteFiles().filter((f) => f.kind === 'bare-requireAuth');
    expect(
      bare.map((f) => `${f.file}:${f.line} ${f.text}`),
      '新增路由必须使用 requireScopedAuth("<scope>") 声明数据范围',
    ).toEqual([]);
  });

  it('所有 requireScopedAuth 的 scope 合法', () => {
    const invalid = scanRouteFiles().filter((f) => f.kind === 'invalid-scope');
    expect(invalid.map((f) => `${f.file}:${f.line} ${f.text}`)).toEqual([]);
  });

  it('合法 scope 集合与文档一致', () => {
    expect(VALID_SCOPES).toEqual(['public', 'authenticated', 'self', 'class-member', 'class-staff', 'admin']);
  });
});

describe('插件路由迁移期告警', () => {
  it('未声明 scope 的插件路由触发告警，声明后不再告警', () => {
    const unscoped: Array<{ pluginId?: string; method: string; pattern: string }> = [];
    const router = new PluginHttpRouter({
      pluginId: '@test/plugin',
      onUnscopedRoute: (info) => unscoped.push(info),
    });

    router.get('/items', async () => ({}));
    router.post('/items', async () => ({}), { scope: 'self' });
    router.delete('/items/:id', async () => ({}), { scope: 'admin' });

    expect(unscoped).toEqual([{ pluginId: '@test/plugin', method: 'GET', pattern: '/items' }]);
    expect(router.getUnscopedRoutes()).toEqual([{ method: 'GET', pattern: '/items' }]);
    expect(router.getRegisteredRoutes()).toEqual([
      expect.objectContaining({ method: 'GET', pattern: '/items' }),
      expect.objectContaining({ method: 'POST', pattern: '/items', scope: 'self' }),
      expect.objectContaining({ method: 'DELETE', pattern: '/items/:id', scope: 'admin' }),
    ]);
  });
});
