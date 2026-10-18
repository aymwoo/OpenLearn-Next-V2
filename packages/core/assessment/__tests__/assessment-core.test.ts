import { describe, it, expect } from 'vitest';
import { defaultAssessmentSettings, parseAssessmentSettings, serializeAssessmentSettings } from '../settings.js';
import { aggregateScores, toPercent } from '../grading.js';
import { buildItemSnapshot, isAssessmentEditable, nextAssessmentStatus, validateItemSnapshot } from '../snapshot.js';
import { createQuestionTypeRegistry } from '../question-types/registry.js';
import { anonymousLabel, canRevealAnonymousIdentity, deriveAnonKey } from '../anonymous.js';
import {
  compareStudentAssignments,
  computeDeadline,
  readWindowState,
  remainingSeconds,
  settleAttempt,
} from '../timing.js';

describe('Issue #100 · 设置 / 快照 / 聚合 / 匿名 / 时间窗', () => {
  const registry = createQuestionTypeRegistry();

  describe('设置归一化', () => {
    it('survey 强制单次、不计分、不出解析；anonymous 只对 survey 生效', () => {
      const s = parseAssessmentSettings('survey', { anonymous: true, resultVisibility: 'immediate', maxAttempts: 5 });
      expect(s).toMatchObject({
        anonymous: true,
        maxAttempts: 1,
        countsTowardGrade: false,
        resultVisibility: 'score_only',
        showItemAnalysis: false,
      });
      // quiz 即使传了 anonymous 也无效
      expect(parseAssessmentSettings('quiz', { anonymous: true }).anonymous).toBe(false);
    });

    it('exam 强制单次、计入成绩，且不允许交卷即公布', () => {
      const s = parseAssessmentSettings('exam', {
        maxAttempts: 3,
        resultVisibility: 'immediate',
        countsTowardGrade: false,
      });
      expect(s.maxAttempts).toBe(1);
      expect(s.countsTowardGrade).toBe(true);
      expect(s.resultVisibility).toBe('after_release');
      // 显式 after_release 保持不变
      expect(parseAssessmentSettings('exam', { resultVisibility: 'after_release' }).resultVisibility).toBe(
        'after_release',
      );
    });

    it('非法取值落到默认（拼错不能静默放宽）', () => {
      const s = parseAssessmentSettings('quiz', {
        maxAttempts: 0,
        scorePolicy: 'bogus',
        resultVisibility: 'everywhere',
        partialCredit: 'maybe',
      });
      expect(s.maxAttempts).toBe(1);
      expect(s.scorePolicy).toBe('last');
      expect(s.resultVisibility).toBe('immediate');
      expect(s.partialCredit).toBe(true);
    });

    it('序列化后再解析结果稳定（往返一致）', () => {
      const s = parseAssessmentSettings('quiz', { maxAttempts: 3, scorePolicy: 'highest', partialCredit: false });
      expect(parseAssessmentSettings('quiz', JSON.parse(serializeAssessmentSettings(s)))).toEqual(s);
      expect(defaultAssessmentSettings('quiz')).toEqual(parseAssessmentSettings('quiz', {}));
    });
  });

  describe('组卷即快照', () => {
    const input = {
      id: 'item-1',
      assessmentId: 'as-1',
      bankItemId: 'bank-1',
      sortOrder: 0,
      type: 'single_choice',
      stem: '题干',
      config: { options: ['A', 'B'] },
      answerKey: { index: 0 },
      maxScore: 5,
    };

    it('快照是深拷贝：改原对象不影响快照', () => {
      const snapshot = buildItemSnapshot(input);
      input.config.options.push('C');
      (input.answerKey as { index: number }).index = 1;
      expect(snapshot.config.options).toEqual(['A', 'B']);
      expect(snapshot.answerKey).toEqual({ index: 0 });
    });

    it('校验：题型已注册 / 题干非空 / 分数为正 / 答案格式合法', () => {
      expect(validateItemSnapshot(registry, input)).toBeNull();
      expect(validateItemSnapshot(registry, { ...input, type: 'nope' })).toContain('未注册的题型');
      expect(validateItemSnapshot(registry, { ...input, stem: '  ' })).toContain('题干');
      expect(validateItemSnapshot(registry, { ...input, maxScore: 0 })).toContain('maxScore');
      expect(validateItemSnapshot(registry, { ...input, answerKey: { index: 9 } })).toContain('超出选项范围');
    });

    it('允许没有标准答案（进人工队列），不阻止组卷', () => {
      expect(validateItemSnapshot(registry, { ...input, answerKey: null })).toBeNull();
    });

    it('只有草稿可编辑；状态迁移只走合法边', () => {
      expect(isAssessmentEditable('draft')).toBe(true);
      for (const s of ['published', 'closed', 'archived'] as const) expect(isAssessmentEditable(s)).toBe(false);
      expect(nextAssessmentStatus('draft', 'publish')).toBe('published');
      expect(nextAssessmentStatus('published', 'publish')).toBeNull();
      expect(nextAssessmentStatus('published', 'close')).toBe('closed');
      expect(nextAssessmentStatus('closed', 'reopen')).toBe('published');
      expect(nextAssessmentStatus('draft', 'close')).toBeNull();
    });
  });

  describe('多次作答聚合', () => {
    const attempts = [
      { id: 'a1', score: 60, maxScore: 100, needsManualReview: false, submittedAt: 1000, attemptNo: 1 },
      { id: 'a2', score: 85, maxScore: 100, needsManualReview: false, submittedAt: 2000, attemptNo: 2 },
      { id: 'a3', score: 70, maxScore: 100, needsManualReview: true, submittedAt: 3000, attemptNo: 3 },
    ];

    it('first / last / highest / average', () => {
      expect(aggregateScores(attempts, 'first')).toMatchObject({ score: 60, attemptId: 'a1' });
      expect(aggregateScores(attempts, 'last')).toMatchObject({ score: 70, attemptId: 'a3' });
      expect(aggregateScores(attempts, 'highest')).toMatchObject({ score: 85, attemptId: 'a2' });
      expect(aggregateScores(attempts, 'average')).toMatchObject({ score: 71.67, attemptId: null });
    });

    it('存在待批改的尝试时结果标记为暂定', () => {
      expect(aggregateScores(attempts, 'highest').provisional).toBe(true);
      expect(aggregateScores(attempts.slice(0, 2), 'highest').provisional).toBe(false);
    });

    it('未判分的尝试被忽略；全都没判分时给 null 而不是 0', () => {
      const pending = [{ id: 'p1', score: null, maxScore: 100, needsManualReview: true, submittedAt: 1, attemptNo: 1 }];
      expect(aggregateScores(pending, 'last')).toMatchObject({ score: null, consideredAttempts: 0 });
      expect(aggregateScores([...pending, attempts[1]], 'last')).toMatchObject({ score: 85 });
    });

    it('toPercent 处理满分 0 / null', () => {
      expect(toPercent(85, 100)).toBe(85);
      expect(toPercent(0, 0)).toBeNull();
      expect(toPercent(null, 100)).toBeNull();
    });
  });

  describe('匿名问卷', () => {
    it('同一学生 + 同一布置 → 稳定同一个 key；不同布置/学生互不相同', () => {
      const k1 = deriveAnonKey('secret', 'asg-1', 'stu-1');
      expect(deriveAnonKey('secret', 'asg-1', 'stu-1')).toBe(k1);
      expect(deriveAnonKey('secret', 'asg-2', 'stu-1')).not.toBe(k1);
      expect(deriveAnonKey('secret', 'asg-1', 'stu-2')).not.toBe(k1);
      expect(deriveAnonKey('other-secret', 'asg-1', 'stu-1')).not.toBe(k1);
      expect(k1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('缺密钥直接抛错，绝不退化成可预测值', () => {
      expect(() => deriveAnonKey('', 'asg-1', 'stu-1')).toThrow(/secret/);
      expect(() => deriveAnonKey(null, 'asg-1', 'stu-1')).toThrow(/secret/);
      expect(() => deriveAnonKey('s', '', 'stu-1')).toThrow(/assignmentId/);
    });

    it('展示名不含身份；只有管理员可反查', () => {
      expect(anonymousLabel('abcdef123456')).toBe('匿名 abcdef');
      expect(anonymousLabel('abcdef123456', 2)).toBe('匿名 3');
      expect(canRevealAnonymousIdentity('administrator')).toBe(true);
      expect(canRevealAnonymousIdentity('teacher')).toBe(false);
      expect(canRevealAnonymousIdentity('student')).toBe(false);
    });
  });

  describe('时间窗与惰性结算', () => {
    it('opens_at 之前拒绝开始；closes_at 之后拒绝', () => {
      expect(readWindowState({ opensAt: 2000 }, 1000)).toBe('before_open');
      expect(readWindowState({ closesAt: 2000 }, 2000)).toBe('after_close');
      expect(readWindowState({ opensAt: 1000, closesAt: 2000 }, 1500)).toBe('open');
      expect(readWindowState({}, 1500)).toBe('untimed');
    });

    it('deadline 取 duration 与 closes_at 的更早者', () => {
      expect(computeDeadline({ durationSec: 60 }, 0)).toBe(60_000);
      expect(computeDeadline({ closesAt: 30_000 }, 0)).toBe(30_000);
      // 限时 60s 但 30s 后就截止 → 30s
      expect(computeDeadline({ durationSec: 60, closesAt: 30_000 }, 0)).toBe(30_000);
      // 续答时沿用既有 deadline（不会因为重新开始而重置计时）
      expect(computeDeadline({ durationSec: 60 }, 50_000, 60_000)).toBe(60_000);
      expect(computeDeadline({}, 0)).toBeNull();
    });

    it('惰性结算只在 in_progress 且已过期时触发，且幂等', () => {
      expect(settleAttempt({ status: 'in_progress', deadlineAt: 100, submittedAt: null }, 50)).toMatchObject({
        shouldSettle: false,
        status: 'in_progress',
      });
      expect(settleAttempt({ status: 'in_progress', deadlineAt: 100, submittedAt: null }, 150)).toMatchObject({
        shouldSettle: true,
        status: 'submitted',
        submittedAt: 100,
      });
      // 已交卷的不再被结算（重复读取不会改交卷时间）
      expect(settleAttempt({ status: 'submitted', deadlineAt: 100, submittedAt: 90 }, 999)).toMatchObject({
        shouldSettle: false,
        submittedAt: 90,
      });
    });

    it('remainingSeconds 与列表排序', () => {
      expect(remainingSeconds(null, 0)).toBeNull();
      expect(remainingSeconds(90_000, 30_000)).toBe(60);
      expect(remainingSeconds(90_000, 200_000)).toBe(0);

      const list = [
        { name: 'done-old', completed: true, deadlineAt: null, submittedAt: 100 },
        { name: 'todo-late', completed: false, deadlineAt: 9000, submittedAt: null },
        { name: 'done-new', completed: true, deadlineAt: null, submittedAt: 500 },
        { name: 'todo-none', completed: false, deadlineAt: null, submittedAt: null },
        { name: 'todo-soon', completed: false, deadlineAt: 3000, submittedAt: null },
      ];
      expect(list.sort(compareStudentAssignments).map((x) => x.name)).toEqual([
        'todo-soon',
        'todo-late',
        'todo-none',
        'done-new',
        'done-old',
      ]);
    });
  });
});
