import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AiPromptTemplatePicker, renderPromptTemplate } from '../AiPromptTemplatePicker';
import { usePluginHostStore } from '../../../plugin-host/plugin-host-store';

/**
 * ai.prompt.template 消费端（提示词模板选择器）回归测试。
 * v0.6.0 审计遗留：该槽位此前无任何消费方。
 */

const TEMPLATE_NO_PARAMS = {
  id: 'tpl-1',
  slotProps: {
    title: '图尔敏论证',
    description: '按图尔敏模型分析一段论证',
    prompt: '请用图尔敏模型分析以下文本：',
  },
};

const TEMPLATE_WITH_PARAMS = {
  id: 'tpl-2',
  slotProps: {
    title: '出题助手',
    prompt: '请为 {{grade}} 年级出一道关于 {{topic}} 的选择题。',
    parameters: [
      { name: 'grade', label: '年级', default: '高一' },
      { name: 'topic', label: '知识点' },
    ],
  },
};

describe('renderPromptTemplate', () => {
  it('{{占位}} 按填参替换，缺省回退 default，双端无值保留占位', () => {
    const params = [{ name: 'grade', default: '高一' }, { name: 'topic' }];
    expect(renderPromptTemplate('为 {{grade}} 出 {{topic}} 与 {{extra}} 题', params, {})).toBe(
      '为 高一 出 {{topic}} 与 {{extra}} 题',
    );
    expect(renderPromptTemplate('为 {{ grade }} 出题', params, { grade: '高二' })).toBe('为 高二 出题');
  });
});

describe('AiPromptTemplatePicker', () => {
  beforeEach(() => {
    usePluginHostStore.setState({ extensionPoints: new Map() });
  });
  afterEach(() => cleanup());

  it('无模板注册时零渲染', () => {
    const { container } = render(<AiPromptTemplatePicker setInput={() => {}} />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('选择无参数模板后直接把 prompt 插入输入框', () => {
    usePluginHostStore.getState().registerExtensionPoint('ai.prompt.template', TEMPLATE_NO_PARAMS as any);
    const setInput = vi.fn() as any;
    render(<AiPromptTemplatePicker setInput={setInput} currentInput="" />);

    fireEvent.click(screen.getByTitle('插件提示词模板'));
    fireEvent.click(screen.getByText('图尔敏论证'));
    expect(setInput).toHaveBeenCalledWith('请用图尔敏模型分析以下文本：');
    // 插入后面板收起
    expect(screen.queryByText('图尔敏论证')).toBeNull();
  });

  it('带参数模板先填参（预填 default），渲染后插入', () => {
    usePluginHostStore.getState().registerExtensionPoint('ai.prompt.template', TEMPLATE_WITH_PARAMS as any);
    const setInput = vi.fn() as any;
    render(<AiPromptTemplatePicker setInput={setInput} currentInput="" />);

    fireEvent.click(screen.getByTitle('插件提示词模板'));
    fireEvent.click(screen.getByText('出题助手'));

    // grade 预填 default '高一'；topic 留空
    const gradeInput = screen.getByPlaceholderText('高一') as HTMLInputElement;
    expect(gradeInput.value).toBe('高一');
    const topicInput = screen.getByPlaceholderText('topic');
    fireEvent.change(topicInput, { target: { value: '区间贪心' } });

    fireEvent.click(screen.getByText('插入到输入框'));
    expect(setInput).toHaveBeenCalledWith('请为 高一 年级出一道关于 区间贪心 的选择题。');
  });

  it('输入框已有内容时追加而非覆盖', () => {
    usePluginHostStore.getState().registerExtensionPoint('ai.prompt.template', TEMPLATE_NO_PARAMS as any);
    const setInput = vi.fn() as any;
    render(<AiPromptTemplatePicker setInput={setInput} currentInput="已有问题" />);

    fireEvent.click(screen.getByTitle('插件提示词模板'));
    fireEvent.click(screen.getByText('图尔敏论证'));
    expect(setInput).toHaveBeenCalledWith('已有问题\n\n请用图尔敏模型分析以下文本：');
  });
});
