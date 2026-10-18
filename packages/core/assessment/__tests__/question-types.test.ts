import { describe, it, expect } from 'vitest';
import {
  createQuestionTypeRegistry,
  QuestionTypeRegistry,
  isValidPluginQuestionType,
} from '../question-types/registry.js';
import { gradeAttempt, gradeItem } from '../grading.js';
import type { GradeContext } from '../question-types/types.js';
import type { AssessmentItemRecord } from '../types.js';
import { normalizeTextAnswer, toBooleanAnswer, toHalfWidth, toNumericAnswer } from '../normalize.js';

const ctx: Omit<GradeContext, 'maxScore'> = {
  assessmentId: 'as-1',
  attemptId: 'at-1',
  studentId: 'stu-1',
  assessmentKind: 'quiz',
  partialCredit: true,
  caseSensitive: false,
};

function item(overrides: Partial<AssessmentItemRecord>): AssessmentItemRecord {
  return {
    id: 'item-1',
    assessmentId: 'as-1',
    bankItemId: null,
    section: null,
    sortOrder: 0,
    type: 'single_choice',
    stem: '题干',
    config: { options: ['A', 'B', 'C', 'D'] },
    answerKey: { index: 1 },
    maxScore: 10,
    ...overrides,
  };
}

describe('Issue #100 · 题型与判分引擎', () => {
  const registry = createQuestionTypeRegistry();

  describe('注册表', () => {
    it('内置 5 种题型都已注册，且都能取到判分实现', () => {
      expect(registry.types().sort()).toEqual(
        ['fill_blank', 'multiple_choice', 'short_answer', 'single_choice', 'true_false'].sort(),
      );
      for (const type of registry.types()) {
        expect(registry.get(type)?.grade).toBeTypeOf('function');
      }
    });

    it('重复注册抛错（静默覆盖会把"题型被顶掉"变成幽灵 bug）', () => {
      const r = new QuestionTypeRegistry();
      r.register({ ...registry.get('single_choice')! });
      expect(() => r.register({ ...registry.get('single_choice')! })).toThrow(/duplicate/);
    });

    it('插件题型必须带命名空间前缀；内置题型不得使用命名空间', () => {
      const r = new QuestionTypeRegistry();
      const def = { ...registry.get('single_choice')!, type: 'ext-code:python' };
      expect(() => r.register(def, { pluginId: 'ext-code' })).not.toThrow();
      expect(isValidPluginQuestionType('ext-code:python')).toBe(true);
      expect(isValidPluginQuestionType('python')).toBe(false);
      // 内置题型不得占用插件命名空间（否则插件注册同名题型时会被"先到先得"挡住）
      expect(() => r.register({ ...registry.get('single_choice')!, type: 'ext-code:rust' })).toThrow(
        /must not use a plugin namespace/,
      );
      expect(() => r.register({ ...registry.get('single_choice')!, type: 'plain' }, { pluginId: 'p' })).toThrow(
        /namespaced/,
      );
    });

    it('clearOwned 只清理该插件的题型，且不误伤内置题型', () => {
      const r = createQuestionTypeRegistry();
      r.register({ ...registry.get('single_choice')!, type: 'ext-a:one' }, { pluginId: 'ext-a' });
      r.register({ ...registry.get('single_choice')!, type: 'ext-b:two' }, { pluginId: 'ext-b' });
      expect(r.clearOwned('ext-a')).toBe(1);
      expect(r.has('ext-a:one')).toBe(false);
      expect(r.has('ext-b:two')).toBe(true);
      expect(r.has('single_choice')).toBe(true);
      // 别人的题型不能按 type 卸掉
      expect(r.unregister('ext-b:two', 'ext-a')).toBe(false);
      expect(r.has('ext-b:two')).toBe(true);
    });
  });

  describe('单选', () => {
    it('选对满分、选错 0 分', () => {
      const it1 = item({});
      expect(gradeItem(registry, it1, 1, ctx)).toMatchObject({ score: 10, isCorrect: true });
      expect(gradeItem(registry, it1, 0, ctx)).toMatchObject({ score: 0, isCorrect: false });
    });

    it('未设标准答案 → score null 进人工，不兜底成 0 或满分', () => {
      const r = gradeItem(registry, item({ answerKey: null }), 0, ctx);
      expect(r.score).toBeNull();
      expect(r.needsManualReview).toBe(true);
    });

    it('标准答案索引越界视为未设置（坏数据不能变成"人人满分"）', () => {
      const r = gradeItem(registry, item({ answerKey: { index: 9 } }), 0, ctx);
      expect(r.score).toBeNull();
      expect(r.needsManualReview).toBe(true);
    });

    it('空作答（null）得 0 分而不是崩溃', () => {
      expect(gradeItem(registry, item({}), null, ctx)).toMatchObject({ score: 0, isCorrect: false });
    });
  });

  describe('多选（讨论结论：全对满分 / 少选按比例 / 错选 0）', () => {
    const mc = (indexes: number[], maxScore = 10) =>
      item({ type: 'multiple_choice', answerKey: { indexes }, maxScore });

    it('全对满分', () => {
      expect(gradeItem(registry, mc([0, 2]), [2, 0], ctx)).toMatchObject({ score: 10, isCorrect: true });
    });

    it('少选按命中比例给分', () => {
      expect(gradeItem(registry, mc([0, 1, 2]), [0], ctx).score).toBeCloseTo(3.33, 2);
      expect(gradeItem(registry, mc([0, 1, 2]), [0, 2], ctx).score).toBeCloseTo(6.67, 2);
    });

    it('错选一律 0 分（挡住"全选拿分"）', () => {
      expect(gradeItem(registry, mc([0, 1]), [0, 1, 2], ctx)).toMatchObject({ score: 0, isCorrect: false });
      expect(gradeItem(registry, mc([0, 1]), [3], ctx)).toMatchObject({ score: 0 });
    });

    it('partialCredit 关闭时少选得 0', () => {
      expect(gradeItem(registry, mc([0, 1, 2]), [0], { ...ctx, partialCredit: false }).score).toBe(0);
    });

    it('重复選択去重、越界索引忽略', () => {
      expect(gradeItem(registry, mc([0, 1]), [0, 0, 1], ctx)).toMatchObject({ score: 10, isCorrect: true });
      expect(gradeItem(registry, mc([0]), [0, 99], ctx)).toMatchObject({ score: 10, isCorrect: true });
    });

    it('空作答 0 分；未设答案 null', () => {
      expect(gradeItem(registry, mc([0, 1]), [], ctx).score).toBe(0);
      expect(gradeItem(registry, item({ type: 'multiple_choice', answerKey: null }), [0], ctx).score).toBeNull();
    });
  });

  describe('判断', () => {
    const tf = item({ type: 'true_false', answerKey: { value: true }, config: {} });
    it('true/false 与常见中文写法都能判', () => {
      expect(gradeItem(registry, tf, true, ctx)).toMatchObject({ score: 10, isCorrect: true });
      expect(gradeItem(registry, tf, '对', ctx)).toMatchObject({ score: 10, isCorrect: true });
      expect(gradeItem(registry, tf, 'false', ctx)).toMatchObject({ score: 0, isCorrect: false });
    });
    it('无法解析的作答得 0 分', () => {
      expect(gradeItem(registry, tf, 'maybe', ctx)).toMatchObject({ score: 0 });
    });
  });

  describe('填空（多空等分 / 可接受列表 / 确定性归一化）', () => {
    const fill = item({
      type: 'fill_blank',
      config: {
        blanks: [{ id: 'b1' }, { id: 'b2', inputType: 'numeric', tolerance: 0.01 }, { id: 'b3' }],
      },
      answerKey: { blanks: [['光合作用'], ['3.14'], ['H2O', '水']] },
      maxScore: 9,
    });

    it('三空全对得满分（每空等分 3 分）', () => {
      expect(gradeItem(registry, fill, ['光合作用', '3.14', '水'], ctx)).toMatchObject({
        score: 9,
        isCorrect: true,
      });
    });

    it('部分空对按空给分', () => {
      expect(gradeItem(registry, fill, ['光合作用', '3.1', 'H2O'], ctx)).toMatchObject({ score: 6, isCorrect: false });
      expect(gradeItem(registry, fill, ['错的', '', ''], ctx)).toMatchObject({ score: 0, isCorrect: false });
    });

    it('归一化：首尾空白、全角、大小写（可配）', () => {
      const text = item({
        type: 'fill_blank',
        config: { blanks: [{ id: 'b1' }] },
        answerKey: { blanks: [['photosynthesis']] },
        maxScore: 5,
      });
      expect(gradeItem(registry, text, '  ＰＨＯＴＯＳＹＮＴＨＥＳＩＳ ', ctx).score).toBe(5);
      expect(gradeItem(registry, text, 'PHOTOSYNTHESIS', { ...ctx, caseSensitive: true }).score).toBe(0);
    });

    it('numeric 按数值比较，容差只在显式配置时生效', () => {
      const noTol = item({
        type: 'fill_blank',
        config: { blanks: [{ id: 'b1', inputType: 'numeric' }] },
        answerKey: { blanks: [['3.14']] },
        maxScore: 5,
      });
      expect(gradeItem(registry, noTol, '3.140', ctx).score).toBe(5);
      expect(gradeItem(registry, noTol, '3.1416', ctx).score).toBe(0);
    });

    it('对象形式的作答（按 blankId）同样支持', () => {
      expect(gradeItem(registry, fill, { b1: '光合作用', b2: '3.14', b3: 'H2O' }, ctx).score).toBe(9);
    });

    it('答案空位数量与题目不一致 → 视为未配置，进人工', () => {
      const broken = item({ ...fill, answerKey: { blanks: [['只有一个']] } });
      const r = gradeItem(registry, broken, ['x', 'y', 'z'], ctx);
      expect(r.score).toBeNull();
      expect(r.needsManualReview).toBe(true);
    });
  });

  describe('简答（永不自动判分）', () => {
    it('无论填了什么参考答案都返回 null + 人工队列', () => {
      const r = gradeItem(
        registry,
        item({ type: 'short_answer', answerKey: { reference: '参考答案' } }),
        '学生的答案',
        ctx,
      );
      expect(r.score).toBeNull();
      expect(r.needsManualReview).toBe(true);
    });
  });

  describe('未注册题型（插件被卸载）', () => {
    it('进人工队列而不是判 0 —— 不冤枉学生', () => {
      const r = gradeItem(registry, item({ type: 'ext-gone:typing' }), 'x', ctx);
      expect(r.score).toBeNull();
      expect(r.needsManualReview).toBe(true);
      expect(r.feedback).toContain('未注册');
    });
  });

  describe('整卷判分', () => {
    const items = [
      item({ id: 'i1', sortOrder: 2, maxScore: 10 }),
      item({ id: 'i2', sortOrder: 0, type: 'true_false', answerKey: { value: false }, config: {}, maxScore: 5 }),
      item({ id: 'i3', sortOrder: 1, type: 'short_answer', answerKey: null, maxScore: 20 }),
    ];

    it('按 sortOrder 汇总；缺答的客观题 0 分，主观题仍进人工', () => {
      const summary = gradeAttempt(registry, items, { i1: 1, i2: false }, ctx);
      expect(summary.items.map((i) => i.itemId)).toEqual(['i2', 'i3', 'i1']);
      expect(summary.score).toBe(15);
      expect(summary.maxScore).toBe(35);
      expect(summary.needsManualReview).toBe(true);
    });

    it('判分幂等：同样输入重复调用结果完全一致', () => {
      const a = gradeAttempt(registry, items, { i1: 1, i2: true, i3: 'x' }, ctx);
      const b = gradeAttempt(registry, items, { i1: 1, i2: true, i3: 'x' }, ctx);
      expect(b).toEqual(a);
    });

    it('grade 越界返回时被夹到 [0, maxScore]', () => {
      const r = new QuestionTypeRegistry();
      r.register(
        { ...registry.get('single_choice')!, type: 'bad:overflow', grade: () => ({ score: 999 }) },
        { pluginId: 'bad' },
      );
      const out = gradeItem(r, item({ type: 'bad:overflow', maxScore: 10 }), 1, ctx);
      expect(out.score).toBe(10);
    });
  });

  describe('归一化工具', () => {
    it('全角转半角、空白折叠', () => {
      expect(toHalfWidth('ＡＢ１２　')).toBe('AB12 ');
      expect(normalizeTextAnswer('  Ab   C ')).toBe('ab c');
    });
    it('toNumericAnswer 拒绝非数值', () => {
      expect(toNumericAnswer(' 12.5 ')).toBe(12.5);
      expect(toNumericAnswer('1,234')).toBe(1234);
      expect(toNumericAnswer('十二')).toBeNull();
      expect(toNumericAnswer('')).toBeNull();
    });
    it('toBooleanAnswer 容忍常见写法', () => {
      expect(toBooleanAnswer('正确')).toBe(true);
      expect(toBooleanAnswer('否')).toBe(false);
      expect(toBooleanAnswer('嗯')).toBeNull();
    });
  });
});
