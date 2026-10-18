/**
 * 答案文本归一化（填空 / 简答判分的基础）。
 *
 * 只做**确定性**变换，不做模糊匹配（编辑距离、同义词、分词）——那类规则会让
 * "为什么这题判错了"变成玄学，且无法给学生一个稳定解释。需要的模糊语义交给插件题型。
 */

/** 全角字符 → 半角（ASCII 可见字符区间 + 全角空格）。 */
export function toHalfWidth(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code === 0x3000) {
      out += ' ';
    } else if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCodePoint(code - 0xfee0);
    } else {
      out += ch;
    }
  }
  return out;
}

/** 归一化空白：全角空格转半角、连续空白折叠为单空格、去首尾。 */
export function normalizeWhitespace(text: string): string {
  return toHalfWidth(text).replace(/\s+/g, ' ').trim();
}

/**
 * 文本答案归一化。
 *
 * 顺序：全角转半角 → 空白折叠 → （可选）大小写折叠。
 * `caseSensitive` 默认 false：填空题里 `Photosynthesis` 与 `photosynthesis` 视为同答。
 */
export function normalizeTextAnswer(value: unknown, caseSensitive = false): string {
  if (value === undefined || value === null) return '';
  const text = normalizeWhitespace(String(value));
  return caseSensitive ? text : text.toLowerCase();
}

/** 数值答案：容忍 `"12.0"`、`" 12 "`、`"12分"` 之外的任何非数值输入（返回 null）。 */
export function toNumericAnswer(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = normalizeWhitespace(value).replace(/[,\s]/g, '');
  if (!cleaned || !/^[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** 数值比较（`tolerance` 只在显式配置时生效，默认严格相等）。 */
export function numbersEqual(a: number, b: number, tolerance?: number): boolean {
  if (typeof tolerance === 'number' && Number.isFinite(tolerance) && tolerance >= 0) {
    return Math.abs(a - b) <= tolerance;
  }
  return a === b;
}

/** 去重 + 稳定排序，用于把索引数组当作集合比较。 */
export function uniqueSortedIndexes(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  const set = new Set<number>();
  for (const v of values) {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    if (Number.isInteger(n) && n >= 0) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/** 取整数索引；不是整数返回 null。 */
export function toIndexOrNull(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** 布尔规范化：`true`/`false`/`"true"`/`"false"`/1/0/`"对"`/`"错"` 等。无法判定返回 null。 */
export function toBooleanAnswer(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === 0) return value === 1;
  if (typeof value !== 'string') return null;
  const text = normalizeTextAnswer(value);
  if (['true', 't', 'yes', 'y', '1', '对', '正确', '是'].includes(text)) return true;
  if (['false', 'f', 'no', 'n', '0', '错', '错误', '否'].includes(text)) return false;
  return null;
}
