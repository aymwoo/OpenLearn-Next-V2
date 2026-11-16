/**
 * 学案互评 / 讨论区等 UGC 文本净化（前后端共用）。
 *
 * 互评与讨论属于用户生成内容：需要去掉 HTML，并让外链不可点击，
 * 避免存储型 XSS 与钓鱼跳转。站内相对路径予以保留为纯文本。
 */
import { filterXSS } from 'xss';
import { sanitizeHref } from './url-safety.js';

const STRIP_ALL_HTML: Parameters<typeof filterXSS>[1] = {
  whiteList: {},
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style'],
};

/** 识别文本中可能被自动成链的 URL / 协议相对地址。 */
const URL_LIKE_PATTERN = /(?:https?:\/\/|www\.|[a-zA-Z][a-zA-Z0-9+.-]*:)[^\s<>"'`]+|\/\/[^\s<>"'`]+/gi;

export const EXTERNAL_LINK_PLACEHOLDER = '「外部链接已隐藏」';

/** 去掉全部 HTML 标签，只保留纯文本。 */
export function stripUgcHtml(raw: unknown): string {
  if (raw == null) return '';
  return filterXSS(String(raw), STRIP_ALL_HTML)
    .replace(/\u0000/g, '')
    .trim();
}

/**
 * 把文本中的外链替换为占位符；`javascript:` / `data:` 等非法协议同样隐藏。
 * 合法的站内相对路径（不以 // 开头、无 scheme）保留原样。
 */
export function neutralizeExternalLinks(text: string): string {
  if (!text) return '';
  return text.replace(URL_LIKE_PATTERN, (match) => {
    const href = sanitizeHref(match.startsWith('www.') ? `https://${match}` : match);
    if (!href) return EXTERNAL_LINK_PLACEHOLDER;
    if (/^https?:/i.test(href) || href.startsWith('//')) return EXTERNAL_LINK_PLACEHOLDER;
    return match;
  });
}

/** 写入侧入口：去 HTML + 隐藏外链，并限制长度。 */
export function sanitizeUgcText(raw: unknown, maxLength = 4000): string {
  const stripped = stripUgcHtml(raw);
  const neutralized = neutralizeExternalLinks(stripped);
  if (neutralized.length <= maxLength) return neutralized;
  return neutralized.slice(0, maxLength);
}
