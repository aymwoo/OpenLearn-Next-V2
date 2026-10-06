import { describe, it, expect, beforeEach } from 'vitest';
import { useLessonEngineStore } from '../lessonEngineStore.js';
import type { StageGuard } from '../../../../packages/core/di/interfaces.js';

describe('Stage Gating Integration (前端 Store 与门禁管道集成测试)', () => {
  beforeEach(() => {
    // 重置并清理之前注册的守卫
    const store = useLessonEngineStore.getState();
    store.stageGuardPipeline.clear();
  });

  it('1. 默认无守卫时，访问任何环节均放行', async () => {
    const store = useLessonEngineStore.getState();
    const result = await store.checkStageAccess('stage_lab', 'student_001');

    expect(result.allowed).toBe(true);
  });

  it('2. 注册测验得分守卫：得分不足拦截并返回明确原因，达标后放行', async () => {
    const store = useLessonEngineStore.getState();
    let currentScore = 60;

    const quizScoreGuard: StageGuard = {
      id: 'ext-quiz-gate',
      name: '随堂测验达标守卫',
      canEnterStage: async ({ targetStageId }) => {
        if (targetStageId === 'stage_lab') {
          if (currentScore < 80) {
            return {
              allowed: false,
              reason: `进入实验探究环节需先通过随堂测验且得分≥80分（当前：${currentScore}分）`,
              progress: { current: currentScore, target: 80, unit: '分' },
            };
          }
        }
        return { allowed: true };
      },
    };

    const dispose = store.registerStageGuard(quizScoreGuard);

    // 60分时尝试进入 stage_lab，应被拦截
    const rejectRes = await store.checkStageAccess('stage_lab', 'student_001');
    expect(rejectRes.allowed).toBe(false);
    expect(rejectRes.reason).toContain('需先通过随堂测验且得分≥80分');
    expect(rejectRes.guardIds).toContain('ext-quiz-gate');
    expect(rejectRes.progress?.current).toBe(60);

    // 访问无需门禁的 stage_intro，应直接放行
    const introRes = await store.checkStageAccess('stage_intro', 'student_001');
    expect(introRes.allowed).toBe(true);

    // 提分至 85分，重新检查 stage_lab，应放行
    currentScore = 85;
    const acceptRes = await store.checkStageAccess('stage_lab', 'student_001');
    expect(acceptRes.allowed).toBe(true);

    // 注销守卫
    dispose();
    currentScore = 50;
    const afterDisposeRes = await store.checkStageAccess('stage_lab', 'student_001');
    expect(afterDisposeRes.allowed).toBe(true);
  });

  it('3. 测验守卫 + 文件提交守卫组合：必须全部满足 (AND 规则)，汇总所有未满足项', async () => {
    const store = useLessonEngineStore.getState();

    let hasSubmittedFile = false;
    let quizPassed = false;

    store.registerStageGuard({
      id: 'guard-quiz',
      name: '随堂测验守卫',
      canEnterStage: async () => {
        return quizPassed
          ? { allowed: true }
          : { allowed: false, reason: '随堂测验尚未及格' };
      },
    });

    store.registerStageGuard({
      id: 'guard-file',
      name: '实验报告文件守卫',
      canEnterStage: async () => {
        return hasSubmittedFile
          ? { allowed: true }
          : { allowed: false, reason: '尚未提交前置实验报告' };
      },
    });

    // 两项均未满足
    const bothFailed = await store.checkStageAccess('stage_final', 'student_002');
    expect(bothFailed.allowed).toBe(false);
    expect(bothFailed.guardIds).toEqual(['guard-quiz', 'guard-file']);
    expect(bothFailed.reason).toContain('随堂测验尚未及格');
    expect(bothFailed.reason).toContain('尚未提交前置实验报告');

    // 仅测验满足，文件未满足
    quizPassed = true;
    const fileStillFailed = await store.checkStageAccess('stage_final', 'student_002');
    expect(fileStillFailed.allowed).toBe(false);
    expect(fileStillFailed.guardIds).toEqual(['guard-file']);
    expect(fileStillFailed.reason).toBe('尚未提交前置实验报告');

    // 两项均满足
    hasSubmittedFile = true;
    const bothPassed = await store.checkStageAccess('stage_final', 'student_002');
    expect(bothPassed.allowed).toBe(true);
  });

  it('4. 第三方插件报错时执行 Fail-Open 降级放行，保障教学不中断', async () => {
    const store = useLessonEngineStore.getState();

    store.registerStageGuard({
      id: 'buggy-plugin',
      name: '异常插件',
      canEnterStage: async () => {
        throw new Error('Plugin unhandled exception');
      },
    });

    const res = await store.checkStageAccess('stage_any', 'student_003');
    expect(res.allowed).toBe(true);
  });
});
