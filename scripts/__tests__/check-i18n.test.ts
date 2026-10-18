import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  checkI18nSymmetry,
  checkBufferEncoding,
  runI18nAudit,
  extractBaseTranslations,
} from '../check-i18n.mjs';

describe('check-i18n script validation', () => {
  describe('checkI18nSymmetry', () => {
    it('detects missing keys across languages', () => {
      const zh = { title: '标题', onlyZh: '仅中文' };
      const en = { title: 'Title', onlyEn: 'English only' };

      const res = checkI18nSymmetry(zh, en, 'test');
      expect(res.missingInEn).toContain('onlyZh');
      expect(res.missingInZh).toContain('onlyEn');
    });

    it('detects empty strings as invalid entries', () => {
      const zh = { emptyKey: '' };
      const en = { emptyKey: '   ' };

      const res = checkI18nSymmetry(zh, en, 'test');
      expect(res.emptyValues).toContain('zh:emptyKey');
      expect(res.emptyValues).toContain('en:emptyKey');
    });

    it('returns empty missing arrays when dictionaries are perfectly symmetrical', () => {
      const zh = { k1: '一', k2: '二' };
      const en = { k1: 'One', k2: 'Two' };

      const res = checkI18nSymmetry(zh, en, 'test');
      expect(res.missingInEn).toHaveLength(0);
      expect(res.missingInZh).toHaveLength(0);
      expect(res.emptyValues).toHaveLength(0);
    });
  });

  describe('checkBufferEncoding', () => {
    it('identifies clean UTF-8 text with Chinese and English', () => {
      const buf = Buffer.from('你好，世界！Hello World!', 'utf8');
      const res = checkBufferEncoding(buf);
      expect(res.hasReplacementChar).toBe(false);
      expect(res.invalidOffset).toBe(-1);
    });

    it('detects replacement character U+FFFD (EF BF BD)', () => {
      const buf = Buffer.from('Hello \uFFFD world', 'utf8');
      const res = checkBufferEncoding(buf);
      expect(res.hasReplacementChar).toBe(true);
    });

    it('detects invalid non-UTF8 byte sequences', () => {
      // 0xC0 0xAF 是 overlong invalid byte sequence
      const badBuf = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0xc0, 0xaf]);
      const res = checkBufferEncoding(badBuf);
      expect(res.invalidOffset).toBe(5);
    });
  });

  describe('runI18nAudit on current repository', () => {
    it('passes audit cleanly without errors or encoding corruption', () => {
      const repoRoot = path.resolve(__dirname, '../..');
      const res = runI18nAudit(repoRoot);
      expect(res.issues).toEqual([]);
      expect(res.ok).toBe(true);
    });
  });
});
