import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  FillBlankAnswer,
  MultipleChoiceAnswer,
  ShortAnswerAnswer,
  SingleChoiceAnswer,
  TrueFalseAnswer,
} from '../answer-uis';

afterEach(() => cleanup());

const OPTIONS = ['甲', '乙', '丙', '丁'];

describe('Issue #122 · 学生作答控件（产出与后端判分器一致的形状）', () => {
  it('单选：点选产出选项索引（number）', () => {
    const onChange = vi.fn();
    render(<SingleChoiceAnswer config={{ options: OPTIONS }} value={0} onChange={onChange} lang="zh" />);
    fireEvent.click(screen.getByRole('radio', { name: /丙/ }));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('多选：产出升序去重的索引数组', () => {
    const onChange = vi.fn();
    render(<MultipleChoiceAnswer config={{ options: OPTIONS }} value={[0]} onChange={onChange} lang="zh" />);
    fireEvent.click(screen.getByRole('checkbox', { name: /丁/ }));
    expect(onChange).toHaveBeenCalledWith([0, 3]);

    fireEvent.click(screen.getByRole('checkbox', { name: /甲/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('判断：产出 boolean', () => {
    const onChange = vi.fn();
    render(<TrueFalseAnswer config={{}} value={true} onChange={onChange} lang="zh" />);
    fireEvent.click(screen.getByLabelText('错误'));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('填空：按空位顺序产出字符串数组（单空也是数组）', () => {
    const onChange = vi.fn();
    render(
      <FillBlankAnswer
        config={{ blanks: [{ id: 'b1' }, { id: 'b2', inputType: 'numeric' }] }}
        value={['', '']}
        onChange={onChange}
        lang="zh"
      />,
    );
    fireEvent.change(screen.getByLabelText('第 2 空'), { target: { value: '42' } });
    expect(onChange).toHaveBeenCalledWith(['', '42']);
    // numeric 空位用 number 输入框
    expect((screen.getByLabelText('第 2 空') as HTMLInputElement).type).toBe('number');
  });

  it('简答：产出字符串并展示字数上限', () => {
    const onChange = vi.fn();
    render(<ShortAnswerAnswer config={{ maxLength: 120 }} value="初稿" onChange={onChange} lang="zh" />);
    fireEvent.change(screen.getByLabelText('作答内容'), { target: { value: '我的理解' } });
    expect(onChange).toHaveBeenCalledWith('我的理解');
    expect(screen.getByText('2/120')).toBeTruthy();
  });

  it('readOnly 时不触发 onChange（结果页回看用）', () => {
    const onChange = vi.fn();
    render(<SingleChoiceAnswer config={{ options: OPTIONS }} value={1} onChange={onChange} lang="zh" readOnly />);
    const radio = screen.getByRole('radio', { name: /乙/ }) as HTMLInputElement;
    expect(radio.disabled).toBe(true);
    fireEvent.click(radio);
    expect(onChange).not.toHaveBeenCalled();
  });
});
