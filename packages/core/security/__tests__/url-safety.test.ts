/**
 * 链接协议白名单（Issue #228）。
 *
 * 学生填的「链接作答」/「作品文件路径」、插件清单里的 repository / homepage，
 * 最终都会进 `<a href="...">`。协议不受限的话，`javascript:` / `data:` 之类
 * 的值就会进入 href —— 至少是一条现成的钓鱼通道。
 *
 * 本文件锁死前后端共用的唯一白名单入口 `sanitizeHref`。
 */
import { describe, it, expect } from 'vitest';
import { sanitizeHref, isSafeHref, ALLOWED_URL_PROTOCOLS } from '../url-safety.js';

describe('链接协议白名单（Issue #228）', () => {
  describe('绝对 URL', () => {
    it('http / https 放行', () => {
      expect(sanitizeHref('http://example.com/a')).toBe('http://example.com/a');
      expect(sanitizeHref('https://example.com/a?b=1#c')).toBe('https://example.com/a?b=1#c');
      expect(ALLOWED_URL_PROTOCOLS).toEqual(['http:', 'https:']);
    });

    it('协议大小写不敏感', () => {
      expect(sanitizeHref('HTTPS://example.com')).toBe('HTTPS://example.com');
      expect(sanitizeHref('HtTp://example.com')).toBe('HtTp://example.com');
    });

    it('javascript: / data: / vbscript: / file: 一律拒绝', () => {
      expect(sanitizeHref('javascript:alert(1)')).toBeNull();
      expect(sanitizeHref('JavaScript:alert(1)')).toBeNull();
      expect(sanitizeHref('data:text/html,<script>alert(1)</script>')).toBeNull();
      expect(sanitizeHref('vbscript:msgbox(1)')).toBeNull();
      expect(sanitizeHref('file:///etc/passwd')).toBeNull();
      expect(sanitizeHref('blob:https://example.com/uuid')).toBeNull();
    });

    it('控制字符拼接出的协议同样被拒（java\\nscript:）', () => {
      expect(sanitizeHref('java\nscript:alert(1)')).toBeNull();
      expect(sanitizeHref('java\tscript:alert(1)')).toBeNull();
      expect(sanitizeHref('java\rscript:alert(1)')).toBeNull();
      expect(sanitizeHref('\u0000javascript:alert(1)')).toBeNull();
    });
  });

  describe('相对路径', () => {
    it('站内相对路径放行', () => {
      expect(sanitizeHref('/files/homework.pdf')).toBe('/files/homework.pdf');
      expect(sanitizeHref('/api/assignments/a1/files/f1')).toBe('/api/assignments/a1/files/f1');
      expect(sanitizeHref('relative/path.txt')).toBe('relative/path.txt');
    });

    it('协议相对外链（//host）与反斜杠变体被拒', () => {
      expect(sanitizeHref('//evil.example.com/x')).toBeNull();
      expect(sanitizeHref('\\\\evil.example.com\\x')).toBeNull();
    });
  });

  describe('边界输入', () => {
    it('非字符串 / 空串 → 拒绝', () => {
      expect(sanitizeHref(undefined)).toBeNull();
      expect(sanitizeHref(null)).toBeNull();
      expect(sanitizeHref(123)).toBeNull();
      expect(sanitizeHref({})).toBeNull();
      expect(sanitizeHref('')).toBeNull();
      expect(sanitizeHref('   ')).toBeNull();
    });

    it('首尾空白被裁掉', () => {
      expect(sanitizeHref('  https://example.com/a  ')).toBe('https://example.com/a');
    });

    it('isSafeHref 与 sanitizeHref 一致', () => {
      expect(isSafeHref('https://example.com')).toBe(true);
      expect(isSafeHref('javascript:alert(1)')).toBe(false);
      expect(isSafeHref(undefined)).toBe(false);
    });
  });
});
