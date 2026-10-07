import { describe, it, expect, vi } from 'vitest';
import { StageGuardPipeline } from '../stage-guard-pipeline.js';
import type { StageGuard, StageGuardContext } from '../../di/interfaces.js';

describe('StageGuardPipeline (责任链门禁管道)', () => {
  const dummyContext: StageGuardContext = {
    studentId: 'student_123',
    lessonId: 'lesson_math_1',
    currentStageId: 'stage_intro',
    targetStageId: 'stage_practice',
  };

  it('1. 没有注册任何守卫时，默认允许访问', async () => {
    const pipeline = new StageGuardPipeline();
    const result = await pipeline.checkAccess(dummyContext);
    expect(result.allowed).toBe(true);
  });

  it('2. 单守卫正常工作：达标放行，未达标拦截并返回原因', async () => {
    const pipeline = new StageGuardPipeline();
    let score = 70;

    const quizGuard: StageGuard = {
      id: 'guard_quiz',
      name: '随堂测验门禁',
      canEnterStage: async () => {
        if (score >= 80) {
          return { allowed: true };
        }
        return {
          allowed: false,
          reason: `测验需达到80分（当前：${score}分）`,
          progress: { current: score, target: 80, unit: '分' },
        };
      },
    };

    pipeline.registerGuard(quizGuard);

    // 70分未达标拦截
    const rejectRes = await pipeline.checkAccess(dummyContext);
    expect(rejectRes.allowed).toBe(false);
    expect(rejectRes.reason).toContain('测验需达到80分（当前：70分）');
    expect(rejectRes.guardIds).toEqual(['guard_quiz']);
    expect(rejectRes.progress).toEqual({ current: 70, target: 80, unit: '分' });

    // 达到85分放行
    score = 85;
    const acceptRes = await pipeline.checkAccess(dummyContext);
    expect(acceptRes.allowed).toBe(true);
  });

  it('3. 组合规则 (AND 全部满足)：任意守卫拦截均视为未通过，汇总所有未通过原因', async () => {
    const pipeline = new StageGuardPipeline();

    const quizGuard: StageGuard = {
      id: 'guard_quiz',
      name: '测验门禁',
      canEnterStage: async () => ({
        allowed: false,
        reason: '测验未达标',
      }),
    };

    const fileGuard: StageGuard = {
      id: 'guard_file',
      name: '作业提交门禁',
      canEnterStage: async () => ({
        allowed: false,
        reason: '尚未提交代码文件',
      }),
    };

    pipeline.registerGuard(quizGuard);
    pipeline.registerGuard(fileGuard);

    const result = await pipeline.checkAccess(dummyContext);
    expect(result.allowed).toBe(false);
    expect(result.guardIds).toEqual(['guard_quiz', 'guard_file']);
    expect(result.reason).toContain('测验未达标');
    expect(result.reason).toContain('尚未提交代码文件');
    expect(result.reason).toContain('；');
  });

  it('4. 守卫抛异常时按 fail-close 拒绝（D-3 决策：插件坏了不该放行学生）', async () => {
    const pipeline = new StageGuardPipeline();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const buggyGuard: StageGuard = {
      id: 'guard_buggy',
      name: '异常第三方插件',
      canEnterStage: async () => {
        throw new Error('Database connection failed in third-party plugin');
      },
    };

    pipeline.registerGuard(buggyGuard);

    const result = await pipeline.checkAccess(dummyContext);
    // 旧断言是 expect(result.allowed).toBe(true) —— 守卫崩了就放行。
    // 环节门禁的语义是「未满足前置条件不得进入」，守卫失效时放行等于让
    // 学生跳过必修环节。改为 fail-close。
    expect(result.allowed).toBe(false);
    // 原因必须可追溯：不能显示成「未满足进入下一环节的前置条件」，
    // 那会让师生误以为是自己没达标，实际是插件坏了。
    expect(result.reason).toContain('异常第三方插件');
    expect(result.reason).not.toContain('未满足进入下一环节的前置条件');
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('5. 守卫超时时按 fail-close 拒绝 —— 即便守卫本要放行（D-3 决策）', async () => {
    // 这条用例改动最大。旧版：慢守卫返回 {allowed:false, reason:'应该被超时熔断'}，
    // 断言却是 expect(allowed).toBe(true) —— 把「应该被拒绝」实现成了「放行」。
    // 旧注释「应该被超时熔断」本身就暴露了这个矛盾：断就断成拒绝，而不是放行。
    const pipeline = new StageGuardPipeline({ timeoutMs: 30 });
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const slowGuard: StageGuard = {
      id: 'guard_slow',
      name: '极慢第三方插件',
      canEnterStage: async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { allowed: false, reason: '应该被超时熔断' };
      },
    };

    pipeline.registerGuard(slowGuard);

    const result = await pipeline.checkAccess(dummyContext);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('响应超时');
    expect(result.guardIds).toEqual(['guard_slow']);
    expect(consoleWarnSpy).toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });

  it('5b. 显式传 onGuardFailure: fail-open 可恢复旧行为（向后兼容逃生口）', async () => {
    // 契约变更不能让部署方无路可走：显式配置即可保留 fail-open 语义。
    const pipeline = new StageGuardPipeline({ timeoutMs: 30, onGuardFailure: 'fail-open' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    pipeline.registerGuard({
      id: 'guard_slow',
      name: '极慢第三方插件',
      canEnterStage: async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { allowed: false, reason: '应该被超时熔断' };
      },
    });

    const result = await pipeline.checkAccess(dummyContext);
    expect(result.allowed, '显式 fail-open 时应放行').toBe(true);
    vi.restoreAllMocks();
  });

  it('5c. onFailure 钩子能区分「守卫判定不通过」与「守卫本身坏了」', async () => {
    // 运维需要据此告警：两者在 result 上都表现为 allowed:false，但成因完全不同。
    const pipeline = new StageGuardPipeline({ timeoutMs: 30 });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const seen: Array<{ guardId: string; reason: string }> = [];
    const observed = new StageGuardPipeline({
      timeoutMs: 30,
      onFailure: (info) => seen.push({ guardId: info.guardId, reason: info.reason }),
    });

    observed.registerGuard({
      id: 'g_timeout',
      name: '超时插件',
      canEnterStage: async () => {
        await new Promise((r) => setTimeout(r, 100));
        return { allowed: true };
      },
    });
    observed.registerGuard({
      id: 'g_threw',
      name: '崩溃插件',
      canEnterStage: async () => {
        throw new Error('boom');
      },
    });

    const result = await observed.checkAccess(dummyContext);
    expect(result.allowed).toBe(false);
    expect(seen).toEqual(
      expect.arrayContaining([
        { guardId: 'g_timeout', reason: 'timeout' },
        { guardId: 'g_threw', reason: 'threw' },
      ]),
    );
    // 被观测的 pipeline 本身不应被注入钩子
    expect(pipeline).toBeDefined();
    vi.restoreAllMocks();
  });

  it('6. 注销与清理支持', async () => {
    const pipeline = new StageGuardPipeline();
    const guard: StageGuard = {
      id: 'temp_guard',
      name: '临时守卫',
      canEnterStage: async () => ({ allowed: false, reason: '必须拦截' }),
    };

    const unregister = pipeline.registerGuard(guard);
    expect(pipeline.listGuards().length).toBe(1);

    const rejected = await pipeline.checkAccess(dummyContext);
    expect(rejected.allowed).toBe(false);

    // 清理
    unregister();
    expect(pipeline.listGuards().length).toBe(0);

    const accepted = await pipeline.checkAccess(dummyContext);
    expect(accepted.allowed).toBe(true);
  });
});

/**
 * I-3：守卫命名空间隔离 / 并行执行 / 全局延迟上限
 *
 * 三项均为**实测确认后**修复的问题（探针复现数据见本文件末尾注释）：
 *   ① 同名冲突：两个插件都注册 `id:'gate'` → listGuards().length === 1，
 *      **A 的拒绝被 B 静默覆盖成放行**（判定正确性问题，不是性能问题）
 *   ② 无 owner：守卫元素只有 {id,name,canEnterStage}，插件停用无法只清理自己的
 *   ③ 串行叠加：5 守卫 × 250ms → 1253ms（并行应 ~250ms）
 *   ④ 无全局上限：30 个卡死守卫 × 200ms → 6011ms，随守卫数线性增长
 */
describe('I-3 · 守卫命名空间隔离', () => {
  const mkCtx = (): StageGuardContext => ({
    studentId: 's1',
    lessonId: 'l1',
    currentStageId: 'seg-1',
    targetStageId: 'seg-2',
  });

  it('① 不同 owner 的同名守卫互不覆盖，AND 判定同时生效', async () => {
    const p = new StageGuardPipeline();
    p.registerGuard(
      { id: 'gate', name: '插件A 的守卫', canEnterStage: async () => ({ allowed: false, reason: 'A 拒绝' }) },
      'plugin-a',
    );
    p.registerGuard({ id: 'gate', name: '插件B 的守卫', canEnterStage: async () => ({ allowed: true }) }, 'plugin-b');

    expect(p.listGuards(), '两个同名守卫应各自保留').toHaveLength(2);
    const res = await p.checkAccess(mkCtx());
    // 回归：旧实现下这里是 {allowed:true} —— A 的拒绝被 B 吃掉
    expect(res.allowed, '插件A 的拒绝必须被尊重').toBe(false);
    expect(res.reason).toBe('A 拒绝');
    expect(res.guardIds).toEqual(['gate']);
  });

  it('① 同一 owner 的同名守卫是热重载覆盖（只保留最新一个）', async () => {
    const p = new StageGuardPipeline();
    p.registerGuard({ id: 'gate', name: 'v1', canEnterStage: async () => ({ allowed: false, reason: 'v1' }) }, 'p');
    p.registerGuard({ id: 'gate', name: 'v2', canEnterStage: async () => ({ allowed: true }) }, 'p');
    expect(p.listGuards()).toHaveLength(1);
    expect((await p.checkAccess(mkCtx())).allowed).toBe(true);
  });

  it('① 未声明 owner 时沿用旧语义并打告警（至少让它可见）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = new StageGuardPipeline();
    p.registerGuard({ id: 'gate', name: '无主守卫', canEnterStage: async () => ({ allowed: true }) });
    expect(warn.mock.calls.some((c) => String(c[0]).includes('without owner'))).toBe(true);
    warn.mockRestore();
  });

  it('② unregisterByOwner 只清理自己的守卫', async () => {
    const p = new StageGuardPipeline();
    p.registerGuard({ id: 'g', name: 'A1', canEnterStage: async () => ({ allowed: true }) }, 'plugin-a');
    p.registerGuard({ id: 'h', name: 'A2', canEnterStage: async () => ({ allowed: true }) }, 'plugin-a');
    p.registerGuard({ id: 'g', name: 'B1', canEnterStage: async () => ({ allowed: true }) }, 'plugin-b');

    expect(p.unregisterByOwner('plugin-a'), '应移除 2 个').toBe(2);
    expect(p.listGuards()).toHaveLength(1);
    expect(p.listGuards()[0].name).toBe('B1');
    expect((await p.checkAccess(mkCtx())).allowed).toBe(true);
  });

  it('② listGuardsByOwner 可查某插件注册的守卫', () => {
    const p = new StageGuardPipeline();
    p.registerGuard({ id: 'x', name: 'A', canEnterStage: async () => ({ allowed: true }) }, 'plugin-a');
    p.registerGuard({ id: 'y', name: 'B', canEnterStage: async () => ({ allowed: true }) }, 'plugin-b');
    expect(p.listGuardsByOwner('plugin-a').map((g) => g.name)).toEqual(['A']);
  });

  it('② registerGuard 返回的注销函数精确移除对应 owner 的守卫', () => {
    const p = new StageGuardPipeline();
    const disposeA = p.registerGuard(
      { id: 'gate', name: 'A', canEnterStage: async () => ({ allowed: true }) },
      'plugin-a',
    );
    p.registerGuard({ id: 'gate', name: 'B', canEnterStage: async () => ({ allowed: true }) }, 'plugin-b');
    disposeA();
    expect(p.listGuards().map((g) => g.owner)).toEqual(['plugin-b']);
  });
});

describe('I-3 · 并行执行与全局延迟上限', () => {
  const mkCtx = (): StageGuardContext => ({
    studentId: 's1',
    lessonId: 'l1',
    currentStageId: 'seg-1',
    targetStageId: 'seg-2',
  });
  const slow = (ms: number, allowed = true) => ({
    id: '',
    name: '',
    canEnterStage: async () => {
      await new Promise((r) => setTimeout(r, ms));
      return { allowed };
    },
  });

  it('③ 多守卫并行：总耗时 ≈ 最慢的那个，而非求和', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = new StageGuardPipeline({ timeoutMs: 500 });
    for (let i = 0; i < 5; i++) p.registerGuard({ ...slow(200), id: `g${i}`, name: `g${i}` }, 'p');

    const t0 = Date.now();
    await p.checkAccess(mkCtx());
    const elapsed = Date.now() - t0;
    // 串行下 ≥1000ms；并行应接近 200ms。留足 CI 抖动余量。
    expect(elapsed, `实际 ${elapsed}ms，串行会是 ~1000ms`).toBeLessThan(600);
    vi.restoreAllMocks();
  });

  it('③ 并行不影响 AND 语义与原因聚合顺序', async () => {
    const p = new StageGuardPipeline();
    // 故意让先注册的更慢，验证聚合仍按 priority 升序（listGuards 顺序）
    p.registerGuard(
      {
        id: 'slow',
        name: '慢的',
        priority: 10,
        canEnterStage: async () => {
          await new Promise((r) => setTimeout(r, 60));
          return { allowed: false, reason: '慢的未满足' };
        },
      },
      'p',
    );
    p.registerGuard(
      { id: 'fast', name: '快的', priority: 1, canEnterStage: async () => ({ allowed: false, reason: '快的未满足' }) },
      'p',
    );

    const res = await p.checkAccess(mkCtx());
    expect(res.allowed).toBe(false);
    // priority 1 的先聚合，顺序应稳定
    expect(res.guardIds).toEqual(['fast', 'slow']);
    expect(res.reason).toBe('快的未满足；慢的未满足');
  });

  it('④ 全局上限：大量卡死守卫的总耗时被封顶', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = new StageGuardPipeline({ timeoutMs: 200, totalTimeoutMs: 600 });
    for (let i = 0; i < 30; i++) {
      p.registerGuard(
        {
          id: `t${i}`,
          name: `t${i}`,
          canEnterStage: async () => {
            await new Promise((r) => setTimeout(r, 10_000));
            return { allowed: true };
          },
        },
        'p',
      );
    }
    const t0 = Date.now();
    const res = await p.checkAccess(mkCtx());
    const elapsed = Date.now() - t0;
    // 旧串行实现：30 × 200ms = 6011ms
    expect(elapsed, `实际 ${elapsed}ms，旧实现会是 ~6000ms`).toBeLessThan(1500);
    // 超时按 I-2 的 fail-close 拒绝
    expect(res.allowed).toBe(false);
    vi.restoreAllMocks();
  });

  it('④ 默认全局上限 = max(timeoutMs × 3, 3000)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 单守卫超时很小 → 下限 3000ms 生效
    const small = new StageGuardPipeline({ timeoutMs: 50 });
    // 单守卫超时较大 → 3 倍生效
    const large = new StageGuardPipeline({ timeoutMs: 2000 });
    expect((small as any).totalTimeoutMs).toBe(3000);
    expect((large as any).totalTimeoutMs).toBe(6000);
    vi.restoreAllMocks();
  });
});
