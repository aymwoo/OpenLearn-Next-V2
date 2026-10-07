/**
 * 门禁集成测试 —— **服务端权威**（I-1）
 *
 * ## 这份测试为什么整体重写
 *
 * 原测试通过 `store.registerStageGuard()` 在**浏览器里**注册守卫，然后调
 * `store.checkStageAccess()` —— 全程不碰服务端。当时那条路径是：
 *
 *   store.checkStageAccess → coreRuntime.stageGuard.checkAccess()
 *   coreRuntime = new LessonRuntime({ eventBus: frontendEventBus })   ← 客户端
 *
 * 学生改 DevTools 本地 state、或直接调 store 方法，就能解锁任意环节。I-2 把
 * fail-open 改成 fail-close 的语义，一行也落不到服务端 —— 因为**根本没有服务端**。
 *
 * 现在改为：
 *   store.checkStageAccess → POST /api/lessons/:id/stage-access → 内核 DI 的 StageGuardPipeline
 *
 * 守卫是**函数**，无法跨进程传递，所以守卫注册天然只能在服务端 in-process DI 完成。
 * store 上的 `registerStageGuard` / `unregisterStageGuard` 因此被移除（零生产调用方）。
 *
 * ## 测试分层
 *
 *   A 组 —— 门禁**语义**（进程内，直接测 StageGuardPipeline，含 I-2 的 fail-close）
 *   B 组 —— 客户端**确实在问服务端**，且失败即拒绝
 *   C 组 —— 客户端**改本地 state 也绕不过**
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { StageGuardPipeline } from '../../../../packages/core/lesson-engine/stage-guard-pipeline.js';
import type { StageGuard, StageGuardContext } from '../../../../packages/core/di/interfaces.js';
import { useLessonEngineStore } from '../lessonEngineStore.js';

const ctx: StageGuardContext = {
  studentId: 'student_001',
  lessonId: 'les_1',
  currentStageId: 'stage_intro',
  targetStageId: 'stage_lab',
};

// ────────────────────────────────────────────────────────────────────────────
// A 组：门禁语义（进程内）
// ────────────────────────────────────────────────────────────────────────────

describe('A 组 · 门禁语义（服务端进程内）', () => {
  it('A1. 无守卫时放行', async () => {
    const p = new StageGuardPipeline();
    expect((await p.checkAccess(ctx)).allowed).toBe(true);
  });

  it('A2. 守卫判定不通过时拒绝并给出明确原因', async () => {
    const p = new StageGuardPipeline();
    p.registerGuard({
      id: 'ext-quiz-gate',
      name: '随堂测验达标守卫',
      canEnterStage: async () => ({
        allowed: false,
        reason: '进入实验探究环节需先通过随堂测验且得分≥80分',
        progress: { current: 60, target: 80, unit: '分' },
      }),
    });
    const res = await p.checkAccess(ctx);
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('需先通过随堂测验');
    expect(res.progress).toEqual({ current: 60, target: 80, unit: '分' });
  });

  it('A3. 多守卫 AND 组合，未满足项全部汇总', async () => {
    const p = new StageGuardPipeline();
    p.registerGuard({
      id: 'quiz',
      name: '测验',
      canEnterStage: async () => ({ allowed: false, reason: '测验未达标' }),
    });
    p.registerGuard({
      id: 'file',
      name: '报告',
      canEnterStage: async () => ({ allowed: false, reason: '未提交实验报告' }),
    });
    const res = await p.checkAccess(ctx);
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('测验未达标');
    expect(res.reason).toContain('未提交实验报告');
    expect(res.guardIds?.sort()).toEqual(['file', 'quiz']);
  });

  it('A4. 守卫抛异常 → fail-close（I-2 决策）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = new StageGuardPipeline();
    p.registerGuard({
      id: 'boom',
      name: '崩溃插件',
      canEnterStage: async () => {
        throw new Error('plugin exploded');
      },
    });
    const res = await p.checkAccess(ctx);
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('崩溃插件');
    vi.restoreAllMocks();
  });

  it('A5. 守卫超时 → fail-close（I-2 决策）', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = new StageGuardPipeline({ timeoutMs: 20 });
    p.registerGuard({
      id: 'slow',
      name: '极慢插件',
      canEnterStage: async () => {
        await new Promise((r) => setTimeout(r, 200));
        return { allowed: true };
      },
    });
    const res = await p.checkAccess(ctx);
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('响应超时');
    vi.restoreAllMocks();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// B 组 + C 组：客户端行为
// ────────────────────────────────────────────────────────────────────────────

describe('B/C 组 · 客户端走服务端权威判定（I-1）', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  /** 服务端判定结果，测试里切换它来模拟门禁通过/拒绝 */
  let serverVerdict: { allowed: boolean; reason?: string };
  /** 记录客户端发出去的请求体，验证它确实把 studentId / lessonId 传了上去 */
  let sentBodies: any[];

  beforeEach(() => {
    serverVerdict = { allowed: true };
    sentBodies = [];
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input: any, init?: any) => {
      if (init?.body) sentBodies.push(JSON.parse(init.body));
      return {
        ok: true,
        status: 200,
        json: async () => serverVerdict,
      } as any;
    });

    const store = useLessonEngineStore.getState();
    store.stageGuardPipeline.clear();
    // currentLesson 由 initializeLesson 驱动 coreRuntime 后写入；这里只需要 id，
    // 直接 setState 最直接，避免把整个 LessonRuntime 拉起来。
    useLessonEngineStore.setState({ currentLesson: { id: 'les_1' } as any });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('B1. checkStageAccess 调服务端端点，而不是本地管道', async () => {
    await useLessonEngineStore.getState().checkStageAccess('stage_lab', 'student_001');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, any];
    expect(url).toContain('/api/lessons/les_1/stage-access');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(sentBodies[0]).toMatchObject({ targetStageId: 'stage_lab' });
  });

  it('B2. 直接采用服务端判定结果', async () => {
    serverVerdict = { allowed: false, reason: '需先通过随堂测验且得分≥80分' };
    const res = await useLessonEngineStore.getState().checkStageAccess('stage_lab', 'student_001');
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('需先通过随堂测验');
  });

  it('C1. 绕过本地管道（本地守卫放行）也无效 —— 判定只认服务端', async () => {
    // 在本地管道里注册一个「永远放行」的守卫。若客户端仍用本地管道，这里就会放行。
    const store = useLessonEngineStore.getState();
    store.stageGuardPipeline.registerGuard({
      id: 'always-allow',
      name: '本地放行守卫',
      canEnterStage: async () => ({ allowed: true }),
    } as StageGuard);

    serverVerdict = { allowed: false, reason: '服务端判定拒绝' };
    const res = await store.checkStageAccess('stage_lab', 'student_001');
    expect(res.allowed, '本地管道被绕过是预期 —— 判定只认服务端').toBe(false);
    expect(res.reason).toBe('服务端判定拒绝');
  });

  it('C2. 服务端不可达时拒绝（失败即拒绝，不回退本地）', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));
    const res = await useLessonEngineStore.getState().checkStageAccess('stage_lab', 'student_001');
    expect(res.allowed, '服务不可达时不得放行').toBe(false);
    expect(res.reason).toContain('不可达');
  });

  it('C3. 服务端 500 时拒绝', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as any);
    const res = await useLessonEngineStore.getState().checkStageAccess('stage_lab', 'student_001');
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('500');
  });

  it('C4. 服务端返回无法识别的结果时拒绝（解析失败 ≠ 放行）', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ foo: 'bar' }) } as any);
    const res = await useLessonEngineStore.getState().checkStageAccess('stage_lab', 'student_001');
    expect(res.allowed, '契约不符必须按拒绝处理').toBe(false);
    expect(res.reason).toContain('无法识别');
  });

  it('C5. 缺少 lessonId 时直接拒绝，不发请求', async () => {
    useLessonEngineStore.setState({ currentLesson: null });
    const res = await useLessonEngineStore.getState().checkStageAccess('stage_lab', 'student_001');
    expect(res.allowed).toBe(false);
    expect(fetchSpy, 'lessonId 缺失时不应发起无意义的请求').not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('C6. store 不再暴露客户端守卫注册 API（守卫是函数，无法跨进程传递）', () => {
    const store = useLessonEngineStore.getState() as any;
    expect('registerStageGuard' in store, '客户端守卫注册 API 应已移除').toBe(false);
    expect('unregisterStageGuard' in store).toBe(false);
    // 本地管道仅作为离线预览/测试通道保留
    expect(typeof store.checkStageAccessLocally).toBe('function');
  });
});
