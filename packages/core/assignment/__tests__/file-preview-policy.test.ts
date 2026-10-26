/**
 * 作业附件预览策略单测。
 *
 * 盯住三条不变量：
 * 1. 扩展名解析（大小写、无扩展名、路径分隔符）；
 * 2. **可执行内容永远不被 inline**（text/html / image/svg+xml 之类）；
 * 3. 扩展插槽的扩展名匹配（带不带前导点、大小写）。
 */
import { describe, it, expect } from 'vitest';
import {
  extensionOf,
  isInlineSafeContentType,
  matchesDeclaredExtension,
  resolveContentType,
  resolvePreviewStrategy,
} from '../file-preview-policy.js';

describe('作业附件预览策略', () => {
  describe('extensionOf', () => {
    it('取小写扩展名（含前导点）', () => {
      expect(extensionOf('方案.PDF')).toBe('.pdf');
      expect(extensionOf('a.tar.gz')).toBe('.gz');
    });

    it('无扩展名 / 隐藏文件 / 路径分隔符都安全', () => {
      expect(extensionOf('README')).toBe('');
      expect(extensionOf('.gitignore')).toBe('');
      expect(extensionOf('dir/sub/file.txt')).toBe('.txt');
      expect(extensionOf('')).toBe('');
    });
  });

  describe('resolvePreviewStrategy', () => {
    it('PDF → pdf 形态，可内联', () => {
      const strategy = resolvePreviewStrategy({ name: '报告.pdf' });
      expect(strategy.kind).toBe('pdf');
      expect(strategy.contentType).toBe('application/pdf');
      expect(strategy.inlineSafe).toBe(true);
    });

    it('位图 → image 形态，可内联', () => {
      const strategy = resolvePreviewStrategy({ name: '照片.png' });
      expect(strategy.kind).toBe('image');
      expect(strategy.contentType).toBe('image/png');
      expect(strategy.inlineSafe).toBe(true);
    });

    it('SVG → image 形态但**不可内联**（顶层文档里 SVG 是可执行的）', () => {
      const strategy = resolvePreviewStrategy({ name: '图.svg' });
      expect(strategy.kind).toBe('image');
      expect(strategy.contentType).toBe('image/svg+xml');
      expect(strategy.inlineSafe).toBe(false);
    });

    it('文本/代码 → text 形态，一律按 text/plain 渲染', () => {
      for (const name of ['笔记.md', '数据.csv', '脚本.py', '页面.html']) {
        const strategy = resolvePreviewStrategy({ name });
        expect(strategy.kind, name).toBe('text');
        expect(strategy.contentType, name).toBe('text/plain');
        expect(strategy.asText, name).toBe(true);
      }
    });

    it('宿主不内置解析的格式 → unsupported', () => {
      for (const name of ['方案.docx', '演示.pptx', '包.zip']) {
        expect(resolvePreviewStrategy({ name }).kind, name).toBe('unsupported');
      }
    });

    it('客户端自报的 mime 不参与判定（不可信）', () => {
      // 声称自己是 application/pdf 的 .txt，仍按文本预览
      const strategy = resolvePreviewStrategy({ name: 'evil.txt', mime: 'application/pdf' });
      expect(strategy.kind).toBe('text');
      expect(strategy.contentType).toBe('text/plain');
    });
  });

  describe('resolveContentType（服务端据此设置响应头）', () => {
    it('按扩展名推导，未知扩展名不猜', () => {
      expect(resolveContentType('a.pdf')).toBe('application/pdf');
      expect(resolveContentType('a.html')).toBe('text/plain');
      expect(resolveContentType('a.zip')).toBe('application/zip');
      expect(resolveContentType('a.unknown')).toBe('application/octet-stream');
    });
  });

  describe('isInlineSafeContentType', () => {
    it('可执行文档一律不可内联', () => {
      expect(isInlineSafeContentType('text/html')).toBe(false);
      expect(isInlineSafeContentType('image/svg+xml')).toBe(false);
      expect(isInlineSafeContentType('application/xhtml+xml')).toBe(false);
      expect(isInlineSafeContentType('text/javascript')).toBe(false);
    });

    it('PDF / 纯文本 / 常见位图可内联', () => {
      expect(isInlineSafeContentType('application/pdf')).toBe(true);
      expect(isInlineSafeContentType('text/plain')).toBe(true);
      expect(isInlineSafeContentType('image/png')).toBe(true);
    });
  });

  describe('matchesDeclaredExtension（扩展插槽匹配）', () => {
    it('带不带前导点、大小写都能匹配上', () => {
      expect(matchesDeclaredExtension(['.docx'], '.docx')).toBe(true);
      expect(matchesDeclaredExtension(['docx'], '.docx')).toBe(true);
      expect(matchesDeclaredExtension(['DOCX'], '.docx')).toBe(true);
      expect(matchesDeclaredExtension(['.docx', '.pptx'], '.pptx')).toBe(true);
    });

    it('不匹配 / 非法输入一律 false', () => {
      expect(matchesDeclaredExtension(['.pdf'], '.docx')).toBe(false);
      expect(matchesDeclaredExtension(undefined, '.docx')).toBe(false);
      expect(matchesDeclaredExtension([123 as unknown as string], '.docx')).toBe(false);
      expect(matchesDeclaredExtension(['.docx'], '')).toBe(false);
    });

    it("'*' 通配：兜底型预览器对所有类型都匹配", () => {
      expect(matchesDeclaredExtension(['*'], '.docx')).toBe(true);
      expect(matchesDeclaredExtension(['*'], '.png')).toBe(true);
    });
  });
});
