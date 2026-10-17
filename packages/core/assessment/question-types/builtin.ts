/**
 * 5 种内置题型（P0 范围）：单选、多选、判断、填空、简答。
 *
 * 判分口径（讨论结论，见 issue #100 评论）：
 * - 多选：全对满分；**错选（选了错误项）得 0**；少选按 `命中数/正确总数 × 满分`（受
 *   `partialCredit` 开关控制）。这符合国内考试通识，也挡住"全选拿分"。
 * - 填空：每空等分；答案接受列表任一命中即得该空分；归一化只做 trim + 全角折叠 + 大小写
 *   折叠（可关），`numeric` 按数值比较（容差仅在显式配置时生效）；不做模糊匹配。
 * - 判断：严格 true/false（容忍 `对/错`、`1/0` 等常见写法）。
 * - 简答：无确定性判分 → `score: null` + `needsManualReview: true`，绝不兜底。
 */
import {
  normalizeTextAnswer,
  numbersEqual,
  toBooleanAnswer,
  toIndexOrNull,
  toNumericAnswer,
  uniqueSortedIndexes,
} from '../normalize.js';
import type { ItemGradeResult } from '../types.js';
import { clampScore, roundScore, type GradeContext, type QuestionTypeDefinition } from './types.js';

const ALL_KINDS = ['quiz', 'exam', 'survey'] as const;

/* ─────────────────────────────── 单选 ─────────────────────────────── */

export interface SingleChoiceConfig {
  options: string[];
}

export interface SingleChoiceAnswerKey {
  index: number;
}

export const singleChoiceType: QuestionTypeDefinition<SingleChoiceConfig, unknown> = {
  type: 'single_choice',
  label: { zh: '单选题', en: 'Single choice' },
  category: 'objective',
  supports: [...ALL_KINDS],
  autoGradable: true,

  createDefaultConfig: () => ({ options: ['选项 A', '选项 B', '选项 C', '选项 D'] }),

  validateConfig(config) {
    const options = (config as SingleChoiceConfig | null)?.options;
    if (!Array.isArray(options)) return 'options 必须是数组';
    if (options.length < 2) return '至少需要 2 个选项';
    if (options.some((o) => typeof o !== 'string')) return '选项必须是字符串';
    return null;
  },

  validateAnswer(_config, answer) {
    return toIndexOrNull(answer) === null ? '作答必须是选项索引（0 起的整数）' : null;
  },

  validateAnswerKey(config, answerKey) {
    if (answerKey === undefined || answerKey === null) return null;
    const options = Array.isArray((config as SingleChoiceConfig | null)?.options)
      ? (config as SingleChoiceConfig).options
      : [];
    const index = toIndexOrNull((answerKey as SingleChoiceAnswerKey | null)?.index);
    if (index === null) return '标准答案必须是 { index: 选项索引 }';
    if (index >= options.length) return '标准答案索引超出选项范围';
    return null;
  },

  grade(config, answerKey, answer, ctx): ItemGradeResult {
    const options = Array.isArray(config?.options) ? config.options : [];
    const keyIndex = toIndexOrNull((answerKey as SingleChoiceAnswerKey | null)?.index);
    const answerIndex = toIndexOrNull(answer);
    // 题目没配标准答案：无法判分 → 人工（不兜底成 0）
    if (keyIndex === null || keyIndex >= options.length) {
      return { score: null, isCorrect: null, needsManualReview: true, feedback: '该题未设置标准答案' };
    }
    if (answerIndex === null) return { score: 0, isCorrect: false };
    const isCorrect = answerIndex === keyIndex;
    return { score: isCorrect ? clampScore(ctx.maxScore, ctx.maxScore) : 0, isCorrect };
  },
};

/* ─────────────────────────────── 多选 ─────────────────────────────── */

export interface MultipleChoiceConfig {
  options: string[];
}

export interface MultipleChoiceAnswerKey {
  indexes: number[];
}

export const multipleChoiceType: QuestionTypeDefinition<MultipleChoiceConfig, unknown> = {
  type: 'multiple_choice',
  label: { zh: '多选题', en: 'Multiple choice' },
  category: 'objective',
  supports: [...ALL_KINDS],
  autoGradable: true,

  createDefaultConfig: () => ({ options: ['选项 A', '选项 B', '选项 C', '选项 D'] }),

  validateConfig(config) {
    const options = (config as MultipleChoiceConfig | null)?.options;
    if (!Array.isArray(options)) return 'options 必须是数组';
    if (options.length < 2) return '至少需要 2 个选项';
    if (options.some((o) => typeof o !== 'string')) return '选项必须是字符串';
    return null;
  },

  validateAnswer(_config, answer) {
    if (!Array.isArray(answer)) return '多选作答必须是索引数组';
    if (answer.length === 0) return null; // 允许空作答（= 未选，得 0 分）
    return answer.every((v) => toIndexOrNull(v) !== null) ? null : '作答索引必须是非负整数';
  },

  validateAnswerKey(config, answerKey) {
    if (answerKey === undefined || answerKey === null) return null;
    const options = Array.isArray((config as MultipleChoiceConfig | null)?.options)
      ? (config as MultipleChoiceConfig).options
      : [];
    const indexes = (answerKey as MultipleChoiceAnswerKey | null)?.indexes;
    if (!Array.isArray(indexes) || indexes.length === 0) return '标准答案必须是 { indexes: [选项索引] }';
    if (indexes.some((i) => toIndexOrNull(i) === null)) return '标准答案索引必须是非负整数';
    if (indexes.some((i) => (toIndexOrNull(i) as number) >= options.length)) return '标准答案索引超出选项范围';
    return null;
  },

  grade(config, answerKey, answer, ctx): ItemGradeResult {
    const options = Array.isArray(config?.options) ? config.options : [];
    const correct = uniqueSortedIndexes((answerKey as MultipleChoiceAnswerKey | null)?.indexes).filter(
      (i) => i < options.length,
    );
    if (correct.length === 0) {
      return { score: null, isCorrect: null, needsManualReview: true, feedback: '该题未设置标准答案' };
    }

    const chosen = uniqueSortedIndexes(answer).filter((i) => i < options.length);
    const correctSet = new Set(correct);
    const wrongPicked = chosen.filter((i) => !correctSet.has(i));
    const hits = chosen.filter((i) => correctSet.has(i));

    // 错选 → 0 分（错选与少选是两回事）
    if (wrongPicked.length > 0) return { score: 0, isCorrect: false };
    if (hits.length === correct.length) return { score: clampScore(ctx.maxScore, ctx.maxScore), isCorrect: true };
    if (!ctx.partialCredit) return { score: 0, isCorrect: false };

    return {
      score: clampScore(roundScore((ctx.maxScore * hits.length) / correct.length), ctx.maxScore),
      isCorrect: false,
    };
  },
};

/* ─────────────────────────────── 判断 ─────────────────────────────── */

export interface TrueFalseConfig {
  trueLabel?: string;
  falseLabel?: string;
}

export interface TrueFalseAnswerKey {
  value: boolean;
}

export const trueFalseType: QuestionTypeDefinition<TrueFalseConfig, unknown> = {
  type: 'true_false',
  label: { zh: '判断题', en: 'True / false' },
  category: 'objective',
  supports: [...ALL_KINDS],
  autoGradable: true,

  createDefaultConfig: () => ({ trueLabel: '正确', falseLabel: '错误' }),

  validateConfig(config) {
    const c = config as TrueFalseConfig | null;
    if (c && c.trueLabel !== undefined && typeof c.trueLabel !== 'string') return 'trueLabel 必须是字符串';
    if (c && c.falseLabel !== undefined && typeof c.falseLabel !== 'string') return 'falseLabel 必须是字符串';
    return null;
  },

  validateAnswer(_config, answer) {
    return toBooleanAnswer(answer) === null ? '判断作答必须是 true / false' : null;
  },

  validateAnswerKey(_config, answerKey) {
    if (answerKey === undefined || answerKey === null) return null;
    return toBooleanAnswer((answerKey as TrueFalseAnswerKey | null)?.value) === null
      ? '标准答案必须是 { value: true | false }'
      : null;
  },

  grade(_config, answerKey, answer, ctx): ItemGradeResult {
    const key = toBooleanAnswer((answerKey as TrueFalseAnswerKey | null)?.value);
    if (key === null) {
      return { score: null, isCorrect: null, needsManualReview: true, feedback: '该题未设置标准答案' };
    }
    const picked = toBooleanAnswer(answer);
    if (picked === null) return { score: 0, isCorrect: false };
    const isCorrect = picked === key;
    return { score: isCorrect ? clampScore(ctx.maxScore, ctx.maxScore) : 0, isCorrect };
  },
};

/* ─────────────────────────────── 填空 ─────────────────────────────── */

export interface FillBlankConfig {
  /** 空位定义：顺序即作答顺序 */
  blanks: Array<{
    id: string;
    placeholder?: string;
    /** `numeric` 时按数值比较 */
    inputType?: 'text' | 'numeric';
    /** 仅 `numeric` 生效 */
    tolerance?: number;
  }>;
}

/** 每空一个「可接受答案列表」，任一命中即得该空分。 */
export interface FillBlankAnswerKey {
  blanks: string[][];
}

function readBlankAnswer(answer: unknown, index: number, blankId: string): unknown {
  if (Array.isArray(answer)) return answer[index];
  if (answer && typeof answer === 'object') return (answer as Record<string, unknown>)[blankId];
  // 只有一个空时允许直接提交标量（"光合作用" / 3.14），前端单空输入框就是这个形状
  if (index === 0) return answer;
  return undefined;
}

export const fillBlankType: QuestionTypeDefinition<FillBlankConfig, unknown> = {
  type: 'fill_blank',
  label: { zh: '填空题', en: 'Fill in the blank' },
  category: 'objective',
  supports: [...ALL_KINDS],
  autoGradable: true,

  createDefaultConfig: () => ({ blanks: [{ id: 'b1', inputType: 'text' }] }),

  validateConfig(config) {
    const blanks = (config as FillBlankConfig | null)?.blanks;
    if (!Array.isArray(blanks) || blanks.length === 0) return '至少需要一个空位';
    for (const b of blanks) {
      if (!b || typeof b.id !== 'string' || !b.id.trim()) return '每个空位必须有 id';
      if (b.inputType !== undefined && b.inputType !== 'text' && b.inputType !== 'numeric') {
        return 'inputType 只能是 text 或 numeric';
      }
      if (b.tolerance !== undefined && (typeof b.tolerance !== 'number' || b.tolerance < 0)) {
        return 'tolerance 必须是非负数';
      }
    }
    const ids = new Set(blanks.map((b) => b.id));
    if (ids.size !== blanks.length) return '空位 id 不能重复';
    return null;
  },

  validateAnswer() {
    // 空作答合法（等于没填），结构错误由判分时按 0 分处理
    return null;
  },

  validateAnswerKey(config, answerKey) {
    if (answerKey === undefined || answerKey === null) return null;
    const blanks = Array.isArray((config as FillBlankConfig | null)?.blanks) ? (config as FillBlankConfig).blanks : [];
    const accepted = (answerKey as FillBlankAnswerKey | null)?.blanks;
    if (!Array.isArray(accepted)) return '标准答案必须是 { blanks: [[可接受答案…]] }';
    if (accepted.length !== blanks.length) return '标准答案的空位数量与题目不一致';
    if (accepted.some((list) => !Array.isArray(list) || list.length === 0)) {
      return '每个空位至少需要一个可接受答案';
    }
    return null;
  },

  grade(config, answerKey, answer, ctx): ItemGradeResult {
    const blanks = Array.isArray(config?.blanks) ? config.blanks : [];
    const accepted = (answerKey as FillBlankAnswerKey | null)?.blanks;
    if (blanks.length === 0 || !Array.isArray(accepted) || accepted.length !== blanks.length) {
      return { score: null, isCorrect: null, needsManualReview: true, feedback: '该题未设置标准答案' };
    }

    const perBlank = ctx.maxScore / blanks.length;
    let earned = 0;
    let allCorrect = true;

    for (let i = 0; i < blanks.length; i++) {
      const blank = blanks[i];
      const candidates = Array.isArray(accepted[i]) ? accepted[i] : [];
      const raw = readBlankAnswer(answer, i, blank.id);
      const matched = candidates.some((candidate) => {
        if (blank.inputType === 'numeric') {
          const a = toNumericAnswer(raw);
          const b = toNumericAnswer(candidate);
          return a !== null && b !== null && numbersEqual(a, b, blank.tolerance);
        }
        const target = normalizeTextAnswer(candidate, ctx.caseSensitive);
        return target !== '' && normalizeTextAnswer(raw, ctx.caseSensitive) === target;
      });
      if (matched) {
        earned += perBlank;
      } else {
        allCorrect = false;
      }
    }

    return {
      score: clampScore(roundScore(earned), ctx.maxScore),
      isCorrect: allCorrect,
    };
  },
};

/* ─────────────────────────────── 简答 ─────────────────────────────── */

export interface ShortAnswerConfig {
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
}

export const shortAnswerType: QuestionTypeDefinition<ShortAnswerConfig, unknown> = {
  type: 'short_answer',
  label: { zh: '简答/论述', en: 'Short answer' },
  category: 'subjective',
  supports: [...ALL_KINDS],
  autoGradable: false,

  createDefaultConfig: () => ({ placeholder: '请输入你的作答', maxLength: 2000 }),

  validateConfig(config) {
    const c = config as ShortAnswerConfig | null;
    if (c?.minLength !== undefined && (typeof c.minLength !== 'number' || c.minLength < 0)) {
      return 'minLength 必须是非负数';
    }
    if (c?.maxLength !== undefined && (typeof c.maxLength !== 'number' || c.maxLength < 1)) {
      return 'maxLength 必须是正整数';
    }
    if (c?.minLength !== undefined && c?.maxLength !== undefined && c.minLength > c.maxLength) {
      return 'minLength 不能大于 maxLength';
    }
    return null;
  },

  validateAnswer(config, answer) {
    if (answer === undefined || answer === null || answer === '') return null;
    if (typeof answer !== 'string') return '简答作答必须是字符串';
    const c = (config ?? {}) as ShortAnswerConfig;
    const length = answer.trim().length;
    if (c.minLength !== undefined && length > 0 && length < c.minLength) return `至少需要 ${c.minLength} 个字`;
    if (c.maxLength !== undefined && length > c.maxLength) return `最多 ${c.maxLength} 个字`;
    return null;
  },

  grade(_config, _answerKey, _answer, _ctx): ItemGradeResult {
    // 简答永远进人工队列；即使教师填了参考答案也不自动给分。
    return { score: null, isCorrect: null, needsManualReview: true, feedback: '待人工批改' };
  },
};

/** P0 的全部内置题型，按展示顺序排列。 */
export const BUILTIN_QUESTION_TYPES: ReadonlyArray<QuestionTypeDefinition<any, any>> = [
  singleChoiceType,
  multipleChoiceType,
  trueFalseType,
  fillBlankType,
  shortAnswerType,
];
