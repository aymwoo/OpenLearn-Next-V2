import { describe, it, expect } from 'vitest';
import { extractCourseSummary, stripReasoningArtifacts } from '../courseSummary';

describe('courseSummary utilities', () => {
  describe('stripReasoningArtifacts', () => {
    it('应移除 <think> 和未闭合 <think> 标签', () => {
      expect(stripReasoningArtifacts('<think>推理草稿</think>正文内容')).toBe('正文内容');
      expect(stripReasoningArtifacts('正文内容<think>未闭合草稿')).toBe('正文内容');
    });
  });

  describe('extractCourseSummary', () => {
    it('应完整移除思考块并提取单行纯文本简介', () => {
      const content = `<think>
The user wants me to create a teaching outline in Markdown format for a course topic "test" in Computer Science.
Let me analyze the requirements carefully:
Topic: "test" (计算机科学)...
</think>

# 计算机科学导论

## 🎯 教学目标
1. 掌握**算法与程序**的基本概念
2. 理解计算机系统组成

## 🧭 教学重难点
- 重点：二进制与逻辑门
- 难点：[递归思想](https://example.com)
`;
      const summary = extractCourseSummary(content);
      expect(summary).not.toContain('<think>');
      expect(summary).not.toContain('The user wants me to create');
      expect(summary).not.toContain('#');
      expect(summary).not.toContain('**');
      expect(summary).toContain('计算机科学导论');
      expect(summary).toContain('掌握算法与程序的基本概念');
      expect(summary).toContain('递归思想');
    });

    it('超长文本应按指定 maxLength 截断并附加省略号', () => {
      const longText = '这是一个非常长的课程介绍内容，用于测试课程卡片简介提取函数的截断行为。'.repeat(10);
      const summary = extractCourseSummary(longText, 50);
      expect(summary.length).toBeLessThanOrEqual(53); // 50 + '...'
      expect(summary.endsWith('...')).toBe(true);
    });

    it('空值或纯空白输入安全返回空字符串', () => {
      expect(extractCourseSummary('')).toBe('');
      expect(extractCourseSummary(null)).toBe('');
      expect(extractCourseSummary(undefined)).toBe('');
      expect(extractCourseSummary('   \n\n  ')).toBe('');
    });

    it('仅包含思考块时提取为空字符串', () => {
      const content = '<think>这里只有推理过程，没有实际正文</think>';
      expect(extractCourseSummary(content)).toBe('');
    });
  });
});
