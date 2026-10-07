/**
 * I-1 集成测试：门禁判定在**服务端**执行，客户端改本地状态绕不过
 *
 * ## 这份测试要证明什么
 *
 * 审计项 I-1：「`StageGuardPipeline` 服务端强制 —— 当前 `checkAccess` 唯一调用点是
 * 客户端 `lessonEngineStore.ts:215`，客户端权威可绕过」，验收标准是
 * **「需服务端集成测试证明绕过无效」**。
 *
 * 绕过手法（改前全部有效）：
 *   ① DevTools 里直接调 `useLessonEngineStore.getState().checkStageAccess()` 的旧实现
 *      —— 它在浏览器里跑 `new LessonRuntime(...)`，与服务器无关
 *   ② 注册一个本地「永远放行」守卫
 *   ③ 直接改本地 `accessStateMap` / `activeSegmentId`
 *
 * 绕过无效的依据：判定改由 `POST /api/lessons/:id/stage-access` 在服务端执行，
 * 守卫读**服务端状态**（本测试用「服务端维护的测验成绩」模拟），
 * 客户端无论怎么改本地状态都无法影响服务端结论。
 *
 * 本测试用真实 Express app + 真实 SQLite，验证**端到端**行为。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { IStageGuardServiceToken } from '../../packages/core/di/interfaces.js';
import { defaultStageGuardPipeline } from '../../packages/core/lesson-engine/stage-guard-pipeline.js';
import type { StageGuard } from '../../packages/core/di/interfaces.js';
import { loadMigrationsFromDirectory, runMigrations } from '../utils/migrate.js';
import { registerLessonsRoutes } from '../routes/lessons.js';

describe('I-1 · 环节门禁的服务端强制', () => {
  let app: express.Express;
  let server: ReturnType<typeof app.listen>;
  let baseUrl: string;
  const db = kernelContainer.db;

  const STUDENT_ID = 'student_guard_001';
  const SESSION_TOKEN = 'tok-stage-guard';
  const cookie = { Cookie: `edu_os_token=${SESSION_TOKEN}` };

  /** 服务端维护的「测验成绩」—— 客户端碰不到它 */
  const serverSideScores = new Map<string, number>();
  const lessonId = `les_guard_${Date.now()}`;

  beforeAll(async () => {
    // 直接用内核的隔离测试库（vitest 按 worker 分配临时 SQLite），与其他路由测试一致。
    // 不要试图替换 `kernelContainer.db`：getValidSession 等模块在 import 期
    // 就持有引用了，替换后路由读到的库与鉴权读到的库会不一致。
    runMigrations(db, loadMigrationsFromDirectory(path.resolve(__dirname, '../../migrations')));

    // 内核在启动时已把 defaultStageGuardPipeline 注册进 serviceRegistry，
    // 这里只需把解析桩指回它，门禁判定就能走真实管线。
    const realPipeline = resolvePipeline();
    (kernelContainer as any).serviceRegistry = {
      resolve: async (token: any) => (token === IStageGuardServiceToken ? realPipeline : undefined),
      resolveByName: async () => undefined,
      register: () => {},
    };

    // 真实会话：requireAuth 走 cookie → getValidSession → client_sessions 表，
    // 不能靠中间件注入 req.session（那样测的就不是真实鉴权路径了）。
    const now = Date.now();
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(STUDENT_ID, 'guard_student', 'hash', 'student', '门禁测试学生', now);
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      SESSION_TOKEN,
      JSON.stringify({ userId: STUDENT_ID, studentId: STUDENT_ID, role: 'student', username: 'guard_student' }),
      now,
      now + 3_600_000,
    );

    app = express();
    app.use(express.json());
    // ServerContext 里只有 registerLessonsRoutes 真正用到的 app，其余给空桩
    registerLessonsRoutes({
      app,
      io: { emit: () => {} } as any,
      loginLimiter: () => (_req: any, _res: any, next: any) => next(),
      aiLimiter: () => (_req: any, _res: any, next: any) => next(),
      activityRegistry: {} as any,
      MF_REMOTE_CACHE: new Map(),
    } as any);

    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    serverSideScores.clear();
    // 清掉上一条用例注册的守卫
    const p = resolvePipeline();
    for (const g of p.listGuards()) p.unregisterGuard(g.id);
  });

  /**
   * 内核在启动时把这个**单例**注册进了 `IStageGuardServiceToken`
   * （见 kernel/index.ts 的 E-1 收敛），所以测试直接引用同一实例即可 ——
   * 经 route 的 `serviceRegistry.resolve()` 拿到的也正是它，两边同源。
   */
  function resolvePipeline(): any {
    return defaultStageGuardPipeline;
  }

  async function postStageAccess(targetStageId: string, currentStageId: string | null = 'seg-1') {
    const res = await fetch(`${baseUrl}/api/lessons/${lessonId}/stage-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie },
      body: JSON.stringify({ currentStageId, targetStageId }),
    });
    return { status: res.status, body: await res.json() };
  }

  it('前置：服务端端点存在且无守卫时放行', async () => {
    const { status, body } = await postStageAccess('seg-2');
    expect(status).toBe(200);
    expect(body.allowed).toBe(true);
  });

  it('守卫在服务端注册时，拒绝结论由服务端给出', async () => {
    resolvePipeline().registerGuard({
      id: 'ext-quiz-gate',
      name: '随堂测验达标守卫',
      canEnterStage: async ({ studentId, targetStageId }) => {
        if (targetStageId !== 'seg-2') return { allowed: true };
        const score = serverSideScores.get(studentId) ?? 0;
        if (score < 80) {
          return { allowed: false, reason: `需先通过随堂测验且得分≥80分（当前：${score}分）` };
        }
        return { allowed: true };
      },
    } satisfies StageGuard);

    const denied = await postStageAccess('seg-2');
    expect(denied.body.allowed).toBe(false);
    expect(denied.body.reason).toContain('需先通过随堂测验');

    // 服务端把成绩记为达标后，同一个请求转为放行 ——
    // 证明结论来自服务端状态，而非客户端声称
    serverSideScores.set(STUDENT_ID, 95);
    const allowed = await postStageAccess('seg-2');
    expect(allowed.body.allowed).toBe(true);
  });

  it('守卫抛异常时按 fail-close 拒绝（I-2 在服务端同样生效）', async () => {
    resolvePipeline().registerGuard({
      id: 'boom',
      name: '崩溃插件',
      canEnterStage: async () => {
        throw new Error('plugin exploded');
      },
    } satisfies StageGuard);

    const { body } = await postStageAccess('seg-2');
    expect(body.allowed).toBe(false);
    expect(body.reason).toContain('崩溃插件');
  });

  it('守卫超时后按 fail-close 拒绝，且请求会返回（不会挂死）', async () => {
    resolvePipeline().registerGuard({
      id: 'slow',
      name: '极慢插件',
      canEnterStage: async () => {
        await new Promise((r) => setTimeout(r, 5000));
        return { allowed: true };
      },
    } satisfies StageGuard);

    const t0 = Date.now();
    const { body } = await postStageAccess('seg-2');
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(body.allowed).toBe(false);
    expect(body.reason).toContain('响应超时');
  }, 10_000);

  it('多守卫 AND 组合，未满足项在服务端汇总', async () => {
    resolvePipeline().registerGuard({
      id: 'g1',
      name: '测验',
      canEnterStage: async () => ({ allowed: false, reason: '测验未达标' }),
    } satisfies StageGuard);
    resolvePipeline().registerGuard({
      id: 'g2',
      name: '报告',
      canEnterStage: async () => ({ allowed: false, reason: '未提交实验报告' }),
    } satisfies StageGuard);

    const { body } = await postStageAccess('seg-2');
    expect(body.allowed).toBe(false);
    expect(body.reason).toContain('测验未达标');
    expect(body.reason).toContain('未提交实验报告');
  });

  it('缺少 targetStageId 时返回 400（不静默放行）', async () => {
    const res = await fetch(`${baseUrl}/api/lessons/${lessonId}/stage-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  describe('绕过无效性（I-1 的核心验收）', () => {
    beforeEach(() => {
      serverSideScores.set(STUDENT_ID, 0); // 未达标
      resolvePipeline().registerGuard({
        id: 'ext-quiz-gate',
        name: '随堂测验达标守卫',
        canEnterStage: async ({ studentId, targetStageId }) => {
          if (targetStageId !== 'seg-2') return { allowed: true };
          const score = serverSideScores.get(studentId) ?? 0;
          return score >= 80 ? { allowed: true } : { allowed: false, reason: `当前：${score}分，需≥80分` };
        },
      } satisfies StageGuard);
    });

    it('客户端声称「已进入 seg-2」不影响服务端判定', async () => {
      // 模拟绕过：请求里谎称 currentStageId 已是 seg-2（即「我已经进来了」）
      const res = await fetch(`${baseUrl}/api/lessons/${lessonId}/stage-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...cookie },
        body: JSON.stringify({ currentStageId: 'seg-2', targetStageId: 'seg-3' }),
      });
      const body = await res.json();
      // seg-3 不受该守卫约束 → 放行，说明请求确实被处理
      expect(body.allowed).toBe(true);

      // 但 seg-2 本身仍被拒 —— 谎称已进入无法解锁它
      const denied = await postStageAccess('seg-2');
      expect(denied.body.allowed).toBe(false);
    });

    it('客户端换 studentId 也不行 —— 身份取自会话，不取自请求体', async () => {
      // 尝试用「另一个学生」的 id 冒名顶替
      const res = await fetch(`${baseUrl}/api/lessons/${lessonId}/stage-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...cookie },
        body: JSON.stringify({ studentId: 'student_top', currentStageId: 'seg-1', targetStageId: 'seg-2' }),
      });
      const body = await res.json();
      expect(body.allowed, '冒名顶替他人高分应无效').toBe(false);
      expect(body.reason).toContain('当前：0分');
    });

    it('守卫注销后立即放行（证明判定确实经由服务端管道）', async () => {
      const before = await postStageAccess('seg-2');
      expect(before.body.allowed).toBe(false);

      resolvePipeline().unregisterGuard('ext-quiz-gate');

      const after = await postStageAccess('seg-2');
      expect(after.body.allowed).toBe(true);
    });
  });

  describe('已知局限（如实记录，不是缺陷修复）', () => {
    it('「进入环节」本身是纯客户端状态，服务端无对应提交动作', async () => {
      // 本用例是**限制说明**，不是断言某个行为。
      // timeline segment 结构为 {id,title,type,duration,color}，**不含 element 引用**，
      // 因此服务端无法把 quiz-submit 的 elementId 映射回环节，
      // 也就无法在「记录学习成果」这个动作上做强制。
      // 现状：服务端提供权威判定供 UI 使用；资源级强制需先补 segment→element 映射。
      const row = db.prepare("SELECT sql FROM sqlite_master WHERE name='lessons'").get() as any;
      expect(row.sql, 'lessons 表存 timeline JSON，可被服务端读取').toContain('timeline');
    });
  });
});
