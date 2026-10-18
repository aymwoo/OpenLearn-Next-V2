import { describe, it, expect } from 'vitest';
import { sanitizePrivateNotes, sanitizeRichTextHtml } from '../html-sanitize';

describe('sanitizeRichTextHtml', () => {
  it('剥离脚本、事件属性与内联危险标签', () => {
    const out = sanitizeRichTextHtml(
      '<img src=x onerror="alert(1)"><script>alert(2)</script><div onclick="x">正文</div><a href="javascript:alert(1)">链接</a>',
    );
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('正文');
  });

  it('保留编辑器会产生的基础格式，并限制 style 白名单', () => {
    const out = sanitizeRichTextHtml(
      '<div><strong>粗体</strong><em>斜体</em><ul><li>条目</li></ul></div>' +
        '<span style="color:red;background-image:url(http://evil/x);position:fixed">高亮</span>',
    );
    expect(out).toContain('<strong>粗体</strong>');
    expect(out).toContain('<em>斜体</em>');
    expect(out).toContain('<li>条目</li>');
    expect(out).toContain('color:red');
    expect(out).not.toContain('background-image');
    expect(out).not.toContain('position');
  });

  it('空值归一为空串', () => {
    expect(sanitizeRichTextHtml('')).toBe('');
    expect(sanitizeRichTextHtml(null)).toBe('');
    expect(sanitizeRichTextHtml(undefined)).toBe('');
  });
});

describe('sanitizePrivateNotes', () => {
  it('保留 {category, html} 存储结构并净化 html', () => {
    const raw = JSON.stringify({
      category: 'SpecialCare',
      html: '<div>需关注</div><img src=x onerror="alert(1)">',
    });
    const out = sanitizePrivateNotes(raw)!;
    const parsed = JSON.parse(out);
    expect(parsed.category).toBe('SpecialCare');
    expect(parsed.html).toContain('需关注');
    expect(parsed.html).not.toContain('<img');
  });

  it('非法分类回落 General', () => {
    const out = sanitizePrivateNotes(JSON.stringify({ category: 'Hacked', html: 'ok' }))!;
    expect(JSON.parse(out).category).toBe('General');
  });

  it('裸 HTML 与纯文本按 HTML 净化', () => {
    expect(sanitizePrivateNotes('<script>alert(1)</script>备注')!).toBe('备注');
    expect(sanitizePrivateNotes('普通文本')!).toBe('普通文本');
  });

  it('null 保持 null，空白归一为空串', () => {
    expect(sanitizePrivateNotes(null)).toBeNull();
    expect(sanitizePrivateNotes(undefined)).toBeNull();
    expect(sanitizePrivateNotes('   ')).toBe('');
  });
});
