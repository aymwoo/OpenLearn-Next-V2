import { describe, it, expect } from 'vitest';
import { stripReasoningArtifacts, stripModelArtifacts } from '../strip-reasoning.js';

describe('stripReasoningArtifacts', () => {
  it('正确移除成对闭合的 <think>...</think> 块', () => {
    const raw = '<think>先分析输入课题并规划结构</think>\n# 计算机科学导论\n正文内容';
    expect(stripReasoningArtifacts(raw)).toBe('# 计算机科学导论\n正文内容');
  });

  it('正确移除跨多行的思考块并支持标签属性', () => {
    const raw = `<think model="deepseek-r1" timestamp="12345">
分析课程受众：高中生
难点预估：指针与内存管理
规划 4 个课时环节
</think>
## 🎯 教学目标
1. 掌握内存分配`;
    expect(stripReasoningArtifacts(raw)).toBe('## 🎯 教学目标\n1. 掌握内存分配');
  });

  it('支持多种思考标签变体（<thinking>, <reasoning>, <analysis>）', () => {
    expect(stripReasoningArtifacts('<thinking>思考一下</thinking>正文')).toBe('正文');
    expect(stripReasoningArtifacts('<reasoning>推理过程</reasoning>正文')).toBe('正文');
    expect(stripReasoningArtifacts('<analysis>分析结论</analysis>正文')).toBe('正文');
  });

  it('标签大小写不敏感（<THINK>, <Thinking>, <REASONING>）', () => {
    expect(stripReasoningArtifacts('<THINK>大写思考</THINK>正文')).toBe('正文');
    expect(stripReasoningArtifacts('<Thinking>驼峰思考</Thinking>正文')).toBe('正文');
    expect(stripReasoningArtifacts('<REASONING>大写推理</REASONING>正文')).toBe('正文');
  });

  it('正确移除未闭合的截断思考块（输出达到 max_tokens 时）', () => {
    const raw = '正常正文前言。\n<think>模型在此被截断未能输出闭合标签，只有后续无限思考草稿…';
    expect(stripReasoningArtifacts(raw)).toBe('正常正文前言。');
  });

  it('正确移除 markdown 代码围栏中的思考块（```think ... ```）', () => {
    const raw = '```think\n内部思考草稿\n```\n# 正式课程教案';
    expect(stripReasoningArtifacts(raw)).toBe('# 正式课程教案');
  });

  it('正确移除多个分散在不同段落的思考块', () => {
    const raw = '<think>步骤一</think>第一段内容。\n\n<think>步骤二</think>第二段内容。';
    expect(stripReasoningArtifacts(raw)).toBe('第一段内容。\n\n第二段内容。');
  });

  it('普通正常 Markdown 内容不被改动', () => {
    const raw = '# 物理碰撞实验\n\n动量守恒定理与动能守恒应用。';
    expect(stripReasoningArtifacts(raw)).toBe(raw);
  });

  it('当仅包含思考块时，默认返回空字符串（杜绝向外暴露任何思考痕迹）', () => {
    const raw = '<think>只有思考草稿没有实际正文输出</think>';
    expect(stripReasoningArtifacts(raw)).toBe('');
  });

  it('设置 fallbackToRawIfEmpty: true 时，仅含思考块返回去除空白的原文本（向后兼容）', () => {
    const raw = '<think>只有思考草稿没有实际正文输出</think>';
    expect(stripReasoningArtifacts(raw, { fallbackToRawIfEmpty: true })).toBe(raw);
    expect(stripModelArtifacts(raw)).toBe(raw);
  });

  it('非法或空值输入安全处理', () => {
    expect(stripReasoningArtifacts('')).toBe('');
    expect(stripReasoningArtifacts(null as any)).toBe('');
    expect(stripReasoningArtifacts(undefined as any)).toBe('');
  });
});
