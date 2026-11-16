import { describe, expect, it } from 'vitest';
import { EXTERNAL_LINK_PLACEHOLDER, neutralizeExternalLinks, sanitizeUgcText, stripUgcHtml } from '../ugc-sanitize.js';

describe('ugc-sanitize', () => {
  it('去掉 HTML 与脚本', () => {
    expect(stripUgcHtml('<b>你好</b><script>alert(1)</script>')).toBe('你好');
  });

  it('隐藏 http(s) 外链与危险协议，保留站内相对路径', () => {
    expect(neutralizeExternalLinks('看 https://evil.example/x 再回 /lessons/1')).toBe(
      `看 ${EXTERNAL_LINK_PLACEHOLDER} 再回 /lessons/1`,
    );
    expect(neutralizeExternalLinks('javascript:alert(1)')).toBe(EXTERNAL_LINK_PLACEHOLDER);
  });

  it('写入时同时去标签、隐藏外链并截断', () => {
    const text = sanitizeUgcText('<b>看</b> https://phish.test 以及 /pack');
    expect(text).toContain(EXTERNAL_LINK_PLACEHOLDER);
    expect(text).toContain('/pack');
    expect(text).not.toContain('<a');
    expect(sanitizeUgcText('a'.repeat(10), 4)).toBe('aaaa');
  });
});
