import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  FillBlankEditor,
  MultipleChoiceEditor,
  ShortAnswerEditor,
  SingleChoiceEditor,
  TrueFalseEditor,
} from '../builtin-question-uis';

afterEach(() => cleanup());

const OPTIONS = ['甲', '乙', '丙', '丁'];

describe('Issue #121 · 内置题型出题编辑器', () => {
  it('单选：勾选某选项即写入 { index }（不是选项文本）', () => {
    const onChange = vi.fn();
    render(<SingleChoiceEditor config={{ options: OPTIONS }} answerKey={{ index: 0 }} lang="zh" onChange={onChange} />);
    // 初始回显：A 被选中
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios[0].checked).toBe(true);

    fireEvent.click(radios[2]);
    expect(onChange).toHaveBeenCalledWith({ config: { options: OPTIONS }, answerKey: { index: 2 } });
  });

  it('多选：勾选产生升序去重的索引数组，全部取消则清空答案', () => {
    const onChange = vi.fn();
    render(
      <MultipleChoiceEditor config={{ options: OPTIONS }} answerKey={{ indexes: [1] }} lang="zh" onChange={onChange} />,
    );
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    fireEvent.click(boxes[3]);
    expect(onChange).toHaveBeenLastCalledWith({ config: { options: OPTIONS }, answerKey: { indexes: [1, 3] } });

    // 取消唯一选中项 → 无正确答案（后端会把它放进人工批改队列）
    fireEvent.click(boxes[1]);
    expect(onChange).toHaveBeenLastCalledWith({ config: { options: OPTIONS }, answerKey: null });
  });

  it('编辑选项文本时保留答案；删除正确选项时清空答案（不猜）', () => {
    const onChange = vi.fn();
    render(<SingleChoiceEditor config={{ options: OPTIONS }} answerKey={{ index: 1 }} lang="zh" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('选项 B 内容'), { target: { value: '乙改' } });
    expect(onChange).toHaveBeenLastCalledWith({
      config: { options: ['甲', '乙改', '丙', '丁'] },
      answerKey: { index: 1 },
    });

    fireEvent.click(screen.getByLabelText('删除选项 B'));
    expect(onChange).toHaveBeenLastCalledWith({
      config: { options: ['甲', '丙', '丁'] },
      answerKey: null,
    });
  });

  it('未选答案时给出「进人工批改」提示', () => {
    render(<SingleChoiceEditor config={{ options: OPTIONS }} answerKey={null} lang="zh" onChange={vi.fn()} />);
    expect(screen.getByText(/未设置正确答案/)).toBeTruthy();
  });

  it('判断：单选正确/错误写入 { value: boolean }', () => {
    const onChange = vi.fn();
    render(<TrueFalseEditor config={{}} answerKey={{ value: true }} lang="zh" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('错误'));
    expect(onChange).toHaveBeenCalledWith({ config: {}, answerKey: { value: false } });
  });

  it('填空：用 | 分隔多个可接受答案，并支持数值空', () => {
    const onChange = vi.fn();
    render(
      <FillBlankEditor
        config={{ blanks: [{ id: 'b1', inputType: 'text' }] }}
        answerKey={null}
        lang="zh"
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('第 1 空的可接受答案'), {
      target: { value: '光合作用 | photosynthesis' },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      config: { blanks: [{ id: 'b1', inputType: 'text' }] },
      answerKey: { blanks: [['光合作用', 'photosynthesis']] },
    });

    fireEvent.change(screen.getByLabelText('作答类型'), { target: { value: 'numeric' } });
    expect(onChange).toHaveBeenLastCalledWith({
      config: { blanks: [{ id: 'b1', inputType: 'numeric' }] },
      answerKey: null,
    });
  });

  it('填空：某个空没填答案时不启用自动判分（answerKey 置空）', () => {
    const onChange = vi.fn();
    render(
      <FillBlankEditor
        config={{ blanks: [{ id: 'b1' }, { id: 'b2' }] }}
        answerKey={{ blanks: [['一'], ['二']] }}
        lang="zh"
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('第 2 空的可接受答案'), { target: { value: '' } });
    expect((onChange.mock.lastCall?.[0] as any).answerKey).toBeNull();
  });

  it('简答：永远不产出标准答案（人工批改）', () => {
    const onChange = vi.fn();
    render(<ShortAnswerEditor config={{}} answerKey={null} lang="zh" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('最多字数'), { target: { value: '500' } });
    expect(onChange).toHaveBeenCalledWith({ config: { maxLength: 500 }, answerKey: null });
    expect(screen.getByText(/不自动判分/)).toBeTruthy();
  });
});
