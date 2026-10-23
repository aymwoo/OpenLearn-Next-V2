/**
 * @vitest-environment node
 *
 * 路由数据范围声明门禁（Issue #229）。
 *
 * #140 建好了「声明 + 审计 + 白名单」三件套，但 `ROUTE_SCOPE_ENFORCE=true`
 * **从未在 CI 中启用**，而审计入口 `assertRouteDataScopes()` 甚至没有被任何地方调用 ——
 * 也就是说「已认证但未声明数据范围」的路由会持续静默放行。
 *
 * 本文件把门禁真正接上：
 *
 * 1. 用真实路由模块跑一遍**运行时**审计（覆盖 `router.get(...)`、
 *    `app.route(...)` 等静态扫描漏掉的注册方式），断言没有未声明路由；
 * 2. 断言服务端启动路径确实接了审计、且受 `ROUTE_SCOPE_ENFORCE` 控制；
 * 3. CI 自检：`.github/workflows/ci.yml` 里确实设置了 `ROUTE_SCOPE_ENFORCE=true`
 *    （防止后续被误删 —— 这正是 #229 建议修法的第 4 条）；
 * 4. 迁移期白名单必须保持为空。
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { auditRouteScopes, assertRouteDataScopes } from '../security/route-scope.js';
import { ROUTE_SCOPE_WHITELIST } from '../security/route-scope-whitelist.js';
import { registerOsRoutes } from '../routes/os.js';
import { registerResourcesRoutes } from '../routes/resources.js';
import { registerCoursewareRoutes } from '../routes/courseware.js';
import { registerBridgeRoutes } from '../routes/bridge.js';
import { registerLessonsRoutes } from '../routes/lessons.js';
import { registerCoursePackageRoutes } from '../routes/course-packages.js';
import { registerWorkspaceRoutes } from '../routes/workspace.js';
import { registerProcessesRoutes } from '../routes/processes.js';
import { registerAdminRoutes } from '../routes/admin.js';
import { registerDemoDataRoutes } from '../routes/demo-data.js';
import { registerRosterRoutes } from '../routes/roster.js';
import { registerAssignmentsRoutes } from '../routes/assignments.js';
import { registerAssignmentHubRoutes } from '../routes/assignment-hub.js';
import { registerSchedulesRoutes } from '../routes/schedules.js';
import { registerGradingRoutes } from '../routes/grading.js';
import { registerPluginsRoutes } from '../routes/plugins.js';
import { registerAssessmentRoutes } from '../routes/assessments.js';
import { registerClassroomExtrasRoutes } from '../routes/classroom-extras.js';
import { registerClassroomPeerReviewRoutes } from '../routes/classroom-peer-review.js';
import { registerClassroomRoutes } from '../routes/classroom.js';
import { ActivityRegistry } from '../../packages/activity-ecosystem/index.js';

function buildStubContext(app: express.Express) {
  const io: any = { emit: () => undefined, to: () => ({ emit: () => undefined }) };
  const noop = (_req: any, _res: any, next: any) => next();
  return {
    app,
    io,
    loginLimiter: noop,
    aiLimiter: noop,
    activityRegistry: new ActivityRegistry(),
    lessonActiveSegments: new Map<string, string>(),
    buildAgentSystemInstruction: () => '',
    buildAgentFinalMessage: () => '',
    normalizeToolSchema: (schema: any) => schema,
    buildOpenAITools: () => [],
    executeAgentToolCall: async () => undefined,
    buildOpenAIChatUrl: (apiUrl: string) => apiUrl,
    runGeminiAgentChat: async () => ({ text: '' }),
    runOpenAIAgentChat: async () => ({ text: '' }),
  } as any;
}

describe('路由数据范围声明门禁（Issue #229）', () => {
  describe('运行时审计（真实路由模块）', () => {
    it('没有任何「已认证但未声明数据范围」的路由', () => {
      const app = express();
      app.use(express.json());
      const ctx = buildStubContext(app);

      // 与 server.ts 的注册顺序保持一致（顺序不影响审计结果，但便于对照）。
      registerOsRoutes(ctx);
      registerResourcesRoutes(ctx);
      registerCoursewareRoutes(ctx);
      registerBridgeRoutes(ctx);
      registerLessonsRoutes(ctx);
      registerCoursePackageRoutes(ctx);
      registerWorkspaceRoutes(ctx);
      registerProcessesRoutes(ctx);
      registerAdminRoutes(ctx);
      registerDemoDataRoutes(ctx);
      registerRosterRoutes(ctx);
      registerAssignmentsRoutes(ctx);
      registerAssignmentHubRoutes(ctx);
      registerSchedulesRoutes(ctx);
      registerGradingRoutes(ctx);
      registerPluginsRoutes(ctx);
      registerAssessmentRoutes(ctx);
      registerClassroomExtrasRoutes(ctx.app);
      registerClassroomPeerReviewRoutes(ctx.app);
      // 课堂路由需要运行时服务；这里只借用其**注册**行为（审计只看路由栈），
      // 用最小 stub 即可 —— 不会真的跑课堂逻辑。
      registerClassroomRoutes(ctx, {} as any, {} as any);

      const audit = auditRouteScopes(app, ROUTE_SCOPE_WHITELIST);
      expect(
        audit.undeclared.map((r) => `${r.method} ${r.path}`),
        '这些已认证路由没有声明数据范围（requireScopedAuth），新增路由必须声明',
      ).toEqual([]);
      // 门禁本身要真的在工作（否则「零未声明」可能只是因为一个路由都没收集到）
      expect(audit.declared.length).toBeGreaterThan(0);
      expect(audit.roleGated.length).toBeGreaterThan(0);
    });

    it('enforce 模式下同样不抛错', () => {
      const app = express();
      app.use(express.json());
      const ctx = buildStubContext(app);
      registerLessonsRoutes(ctx);
      registerRosterRoutes(ctx);

      const quiet = { warn: () => undefined, error: () => undefined, info: () => undefined };
      expect(() =>
        assertRouteDataScopes(app, { whitelist: ROUTE_SCOPE_WHITELIST, enforce: true, logger: quiet }),
      ).not.toThrow();
    });
  });

  describe('迁移期白名单', () => {
    it('ROUTE_SCOPE_WHITELIST 必须保持为空', () => {
      // 白名单是「已知但暂缓声明」的清单，每条都要带理由；新增路由应直接声明，
      // 而不是往白名单里塞条目。
      expect(ROUTE_SCOPE_WHITELIST).toEqual([]);
    });
  });

  describe('接线与 CI 自检', () => {
    it('服务端启动路径接了审计，并受 ROUTE_SCOPE_ENFORCE 控制', () => {
      const src = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf8');
      expect(src).toContain('assertRouteDataScopes');
      expect(src).toContain('ROUTE_SCOPE_ENFORCE');
    });

    it('CI 配置里确实启用了 ROUTE_SCOPE_ENFORCE（防止被误删）', () => {
      const ci = fs.readFileSync(path.resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
      expect(ci).toMatch(/ROUTE_SCOPE_ENFORCE:\s*['"]?true['"]?/);
    });
  });
});
