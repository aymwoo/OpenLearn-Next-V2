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

  it('4. 容错降级策略 (Fail-Open)：守卫抛出异常时不阻塞学生，安全放行', async () => {
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
    expect(result.allowed).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('5. 容错降级策略 (Fail-Open)：守卫超时时不挂起界面，安全放行', async () => {
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
    expect(result.allowed).toBe(true);
    expect(consoleWarnSpy).toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
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
