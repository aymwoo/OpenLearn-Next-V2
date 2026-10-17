/**
 * 富文本净化（前后端共用）。
 *
 * 教师私有备忘（`students.private_notes`）以 `{"category","html"}` JSON 或裸 HTML 存储，
 * 编辑器会把 html 直接写入 contentEditable。任何未经净化的写入（PUT 接口、CSV 导入、
 * 历史脏数据）都等于给教师端注入存储型 XSS。这里给出唯一的白名单净化入口：
 *
 * - 写入侧（服务端）：`updateStudent` / `importStudents` 落库前净化；
 * - 读取侧（前端）：编辑器 `innerHTML` 赋值前再次净化，覆盖修复前的历史数据。
 */
import { filterXSS, type IFilterXSSOptions } from 'xss';

/** 备忘编辑器实际会产生的标签（execCommand 输出）。其余一律剥离。 */
const NOTES_XSS_OPTIONS: IFilterXSSOptions = {
  whiteList: {
    div: [],
    p: [],
    br: [],
    hr: [],
    b: [],
    strong: [],
    i: [],
    em: [],
    u: [],
    s: [],
    strike: [],
    del: [],
    ul: [],
    ol: [],
    li: [],
    blockquote: [],
    h2: [],
    h3: [],
    h4: [],
    code: [],
    pre: [],
    span: ['style'],
  },
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style'],
  css: {
    whiteList: {
      color: true,
      'background-color': true,
      'text-align': true,
      'font-weight': true,
      'font-style': true,
      'text-decoration': true,
    },
  },
};

export const PRIVATE_NOTE_CATEGORIES = ['General', 'Academic', 'Behavioral', 'SpecialCare'] as const;
export type PrivateNoteCategory = (typeof PRIVATE_NOTE_CATEGORIES)[number];

const CATEGORY_SET = new Set<string>(PRIVATE_NOTE_CATEGORIES);

/** 净化一段备忘 HTML；`null`/`undefined` 归一为空串。 */
export function sanitizeRichTextHtml(html: string | null | undefined): string {
  if (!html) return '';
  return filterXSS(String(html), NOTES_XSS_OPTIONS);
}

/**
 * 净化 `students.private_notes` 的存储值。
 *
 * 保持既有存储格式：`{"category","html"}` 结构会被保留（category 非法则回落 General），
 * 裸 HTML / 纯文本原样净化后返回。纯空白返回空串，`null`/`undefined` 返回 `null`。
 */
export function sanitizePrivateNotes(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw);
  if (!text.trim()) return '';

  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && typeof (parsed as any).html === 'string') {
        const category = CATEGORY_SET.has(parsed.category) ? parsed.category : 'General';
        return JSON.stringify({ category, html: sanitizeRichTextHtml(parsed.html) });
      }
    } catch {
      // 不是合法 JSON：按裸 HTML 处理
    }
  }
  return sanitizeRichTextHtml(text);
}
