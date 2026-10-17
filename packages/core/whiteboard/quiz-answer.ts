/**
 * 白板「随堂测验」的答案字段归一化（Issue #107）。
 *
 * ## 为什么需要这一层
 *
 * 同一个「正确答案」在仓库里有两个字段，不同模块各读各的，于是出现
 * 「服务端按 `correctAnswer` 判分、大屏按 `correctIndex` 统计」这种互相矛盾的组合：
 *
 * | 写入方 | 字段 |
 * | --- | --- |
 * | 组件默认数据（`object-registry` / `teaching-object-registry`） | `correctIndex: 0` |
 * | 属性栏「正确答案」下拉（历史版本） | `correctAnswer` = **选项文本** |
 * | 服务端判分 / 环节门禁 `looksLikeQuiz` | 只读 `correctAnswer` |
 * | 全屏测验视图 统计与高亮 | 只读 `correctIndex` |
 *
 * 现在统一以**选项索引** `correctIndex` 为权威：
 * - 属性栏写 `correctIndex`（同时把 `correctAnswer` 同步成选项文本，兼容仍在读旧字段的代码）；
 * - 学生提交发送选项索引；
 * - 服务端判分、大屏统计、环节门禁都走本模块做解析。
 *
 * 旧数据只有 `correctAnswer` 时按「选项文本 → 字母 → 数字」的顺序换算成索引，
 * 因此不需要写数据迁移也能正确判分。
 */

/** 只关心答案解析所需的最小子集，不绑定具体 payload 类型。 */
export interface QuizAnswerLike {
  options?: unknown;
  correctIndex?: unknown;
  correctAnswer?: unknown;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** 把 `options` 规整成字符串数组（非字符串项转成字符串，非法输入给空数组）。 */
export function readQuizOptions(data: QuizAnswerLike | null | undefined): string[] {
  const raw = data?.options;
  if (!Array.isArray(raw)) return [];
  return raw.map((o) => (typeof o === 'string' ? o : o === null || o === undefined ? '' : String(o)));
}

function toIndex(value: unknown, optionCount: number): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && (optionCount === 0 || value < optionCount) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const n = Number(trimmed);
    return optionCount === 0 || n < optionCount ? n : null;
  }
  return null;
}

function letterToIndex(value: string, optionCount: number): number | null {
  const upper = value.trim().toUpperCase();
  if (upper.length !== 1) return null;
  const idx = LETTERS.indexOf(upper);
  if (idx < 0) return null;
  return optionCount === 0 || idx < optionCount ? idx : null;
}

function textToIndex(value: string, options: string[]): number | null {
  const needle = value.trim();
  if (!needle) return null;
  const exact = options.findIndex((o) => o.trim() === needle);
  if (exact >= 0) return exact;
  const lower = needle.toLowerCase();
  const loose = options.findIndex((o) => o.trim().toLowerCase() === lower);
  return loose >= 0 ? loose : null;
}

/**
 * 解析「这门题的正确答案索引」（0-based）。无法判定时返回 `null`。
 *
 * 解析顺序：
 * 1. `correctIndex`（权威字段，数字或纯数字字符串）；
 * 2. `correctAnswer` 与某个**选项文本**相同 —— 历史属性栏下拉写的就是选项文本，故文本优先于字母
 *    （选项本身是 'A'/'B'/… 时两者一致，不冲突）；
 * 3. `correctAnswer` 是单个字母（A–Z）且落在选项范围内；
 * 4. `correctAnswer` 是数字（或纯数字字符串）。
 */
export function resolveCorrectIndex(data: QuizAnswerLike | null | undefined): number | null {
  if (!data) return null;
  const options = readQuizOptions(data);

  const direct = toIndex(data.correctIndex, options.length);
  if (direct !== null) return direct;

  const legacy = data.correctAnswer;
  if (legacy === undefined || legacy === null) return null;
  if (typeof legacy === 'number') return toIndex(legacy, options.length);

  const raw = String(legacy);
  if (!raw.trim()) return null;

  const byText = textToIndex(raw, options);
  if (byText !== null) return byText;

  const byLetter = letterToIndex(raw, options.length);
  if (byLetter !== null) return byLetter;

  return toIndex(raw, options.length);
}

/**
 * 解析「学生提交的作答」对应的选项索引（0-based）。无法判定时返回 `null`。
 *
 * 解析顺序与 {@link resolveCorrectIndex} **故意不同**：
 * 1. 数字 / 纯数字字符串（新协议：客户端直接发明选项索引）；
 * 2. 单个字母（历史协议：客户端发的是 `LETTERS[idx]`）；
 * 3. 选项文本（历史协议：`correctAnswer` 不是字母时客户端发选项原文）；
 * 4. 对象的 `optionIndex` / `answer` 字段（历史本地缓存结构）。
 */
export function resolveSubmittedIndex(answer: unknown, options: string[]): number | null {
  if (answer !== null && typeof answer === 'object') {
    const obj = answer as Record<string, unknown>;
    const nested = resolveSubmittedIndex(obj.optionIndex, options);
    if (nested !== null) return nested;
    return resolveSubmittedIndex(obj.answer, options);
  }
  if (answer === undefined || answer === null) return null;

  const numeric = toIndex(answer, options.length);
  if (numeric !== null) return numeric;

  if (typeof answer !== 'string') return null;
  if (!answer.trim()) return null;

  const byLetter = letterToIndex(answer, options.length);
  if (byLetter !== null) return byLetter;

  return textToIndex(answer, options);
}

export interface QuizGrade {
  /** 是否判对。`resolved === false` 时恒为 false（题目本身没答案，无法判对）。 */
  isCorrect: boolean;
  /** 0 或 100（沿用既有二值判分口径）。 */
  score: number;
  /** 题目本身能否判定正确答案；false 表示教师还没设置正确答案。 */
  resolved: boolean;
  correctIndex: number | null;
  answerIndex: number | null;
}

/**
 * 判分：以选项索引为准，旧字段/旧作答格式自动归一化。
 *
 * 题目没有可判定的正确答案时返回 `resolved: false, score: 0` —— 与修复前
 * 「没设置答案一律 0 分」的行为一致，避免把未配置答案的测验算成全员满分。
 *
 * 例外：题干没有选项数组、`correctAnswer` 是一段自由文本（历史数据里存在这种
 * 「文本对答」测验），此时索引无从谈起，退回修复前的**字符串等值比较**语义。
 */
export function gradeQuizSubmission(data: QuizAnswerLike | null | undefined, answer: unknown): QuizGrade {
  const options = readQuizOptions(data);
  const correctIndex = resolveCorrectIndex(data);
  const answerIndex = resolveSubmittedIndex(answer, options);

  if (correctIndex === null) {
    const legacy = data?.correctAnswer;
    if (legacy !== undefined && legacy !== null && String(legacy).trim() !== '') {
      const normalize = (v: unknown) => String(v).trim().toLowerCase();
      const isCorrect = normalize(answer) === normalize(legacy);
      return { isCorrect, score: isCorrect ? 100 : 0, resolved: true, correctIndex: null, answerIndex };
    }
    return { isCorrect: false, score: 0, resolved: false, correctIndex: null, answerIndex };
  }

  let isCorrect = answerIndex !== null && answerIndex === correctIndex;
  // 兜底：作答索引解析不出来（如选项文本重复、奇异值），但原文就等于正确选项文本时仍算对。
  if (!isCorrect && typeof answer === 'string' && options[correctIndex] !== undefined) {
    isCorrect = answer.trim().toLowerCase() === options[correctIndex].trim().toLowerCase();
  }

  return { isCorrect, score: isCorrect ? 100 : 0, resolved: true, correctIndex, answerIndex };
}

/**
 * 生成落库/落 payload 的成对答案字段：`correctIndex` 权威 + `correctAnswer` 文本兼容。
 *
 * `index` 为 `null` 表示「清除正确答案」，两个字段一并清空。
 */
export function buildQuizAnswerFields(
  index: number | null,
  options: string[],
): { correctIndex: number | null; correctAnswer: string | null } {
  if (index === null || index < 0 || index >= options.length) {
    return { correctIndex: null, correctAnswer: null };
  }
  return { correctIndex: index, correctAnswer: options[index] ?? null };
}

/** 环节门禁识别「这是不是一道测验」：`correctIndex` 与旧字段 `correctAnswer` 都算。 */
export function looksLikeQuizAnswerData(data: QuizAnswerLike | null | undefined): boolean {
  if (!data) return false;
  if (resolveCorrectIndex(data) !== null) return true;
  // 显式设置了空答案（'' / null）时也算「配置过答案字段」，只是还没选具体选项
  const legacy = data.correctAnswer;
  return legacy !== undefined && legacy !== null && String(legacy).trim() !== '';
}
