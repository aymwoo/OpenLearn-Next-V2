import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { QuizFullscreenView } from '../fullscreen/QuizFullscreenView';
import type { FullscreenRendererProps } from '../fullscreen/FullscreenRendererRegistry';

const baseProps: FullscreenRendererProps = {
  elementType: 'quiz',
  data: {},
  onClose: () => {},
  containerSize: { width: 800, height: 600 },
  lessonId: 'lesson-test',
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as any;
  fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('QuizFullscreenView', () => {
  it('renders the question and options (with correctIndex highlighted)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    render(
      <QuizFullscreenView
        {...baseProps}
        data={{
          question: '1+1=?',
          options: ['1', '2', '3'],
          correctIndex: 1,
          submissions: {},
        }}
      />,
    );

    const question = await screen.findByTestId('quiz-question');
    expect(question.textContent).toBe('1+1=?');
    expect(screen.getByText('A.')).toBeDefined();
    expect(screen.getByText('2')).toBeDefined();
    // "✓ 正确答案" only on the correct option
    expect(screen.getByText('✓ 正确答案')).toBeDefined();
    // Empty state copy
    expect(screen.getByText('暂无学生提交')).toBeDefined();
  });

  it('renders summary stats and per-student rows for new answer/score/time shape', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 'stu-1', name: '小明' },
        { id: 'stu-2', name: '小红' },
      ],
    });

    render(
      <QuizFullscreenView
        {...baseProps}
        data={{
          question: '首都?',
          options: ['北京', '上海', '广州'],
          correctIndex: 0,
          passScore: 60,
          submissions: {
            'stu-1': { answer: 0, score: 90, time: Date.parse('2025-01-01T10:00:00Z') },
            'stu-2': { answer: 1, score: 30, time: Date.parse('2025-01-01T10:01:00Z') },
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('quiz-stat-submitted').textContent).toBe('2');
    });
    expect(screen.getByTestId('quiz-stat-passed').textContent).toBe('1');
    expect(screen.getByText('50%')).toBeDefined(); // 通过率
    expect(screen.getByText('60.0')).toBeDefined(); // 均分 = (90+30)/2

    // Per-student table
    const row1 = screen.getByTestId('quiz-row-stu-1');
    const row2 = screen.getByTestId('quiz-row-stu-2');
    expect(row1.textContent).toContain('小明');
    expect(row1.textContent).toContain('A');
    expect(row1.textContent).toContain('90');
    expect(row1.textContent).toContain('✓');
    expect(row2.textContent).toContain('小红');
    expect(row2.textContent).toContain('B');
    expect(row2.textContent).toContain('30');
    // stu-2 wrong → no ✓ in answer column
    expect(row2.querySelectorAll('.text-green-600').length).toBeLessThan(2);
  });

  it('handles legacy optionIndex/timestamp shape without crashing', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [{ id: 'stu-1', name: '小刚' }] });
    render(
      <QuizFullscreenView
        {...baseProps}
        data={{
          question: '老数据形状',
          options: ['A', 'B'],
          correctIndex: 0,
          submissions: {
            'stu-1': { optionIndex: 0, timestamp: 1735689600000 },
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('quiz-row-stu-1').textContent).toContain('小刚');
    });
    expect(screen.getByTestId('quiz-row-stu-1').textContent).toContain('A');
    // Without score but correctIndex matches → synthetic 100
    expect(screen.getByTestId('quiz-row-stu-1').textContent).toContain('100');
  });

  it('falls back to studentId when /api/students fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    render(
      <QuizFullscreenView
        {...baseProps}
        data={{
          question: 'Q',
          options: ['a', 'b'],
          correctIndex: 0,
          submissions: { 'unknown-id': { answer: 0, score: 100 } },
        }}
      />,
    );

    await waitFor(() => {
      // studentMap stays empty → display falls back to id
      expect(screen.getByTestId('quiz-row-unknown-id').textContent).toContain('unknown-id');
    });
  });

  it('toggles between 0/empty state and populated state', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });

    // 空提交态
    const empty = render(
      <QuizFullscreenView {...baseProps} data={{ question: 'Q', options: ['a'], submissions: {} }} />,
    );
    expect(screen.getByText('暂无学生提交')).toBeDefined();
    empty.unmount();

    // 有提交态
    render(
      <QuizFullscreenView
        {...baseProps}
        data={{
          question: 'Q',
          options: ['a'],
          correctIndex: 0,
          submissions: { stu1: { answer: 0, score: 80 } },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('quiz-stat-submitted').textContent).toBe('1');
    });
    expect(screen.getByText('100%')).toBeDefined();
  });

  it('uses passScore threshold for score-based pass/fail when correctIndex is missing', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    render(
      <QuizFullscreenView
        {...baseProps}
        data={{
          question: 'Q',
          options: ['a', 'b'],
          passScore: 70,
          submissions: {
            stu1: { answer: 0, score: 80 }, // pass
            stu2: { answer: 0, score: 50 }, // fail
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('quiz-stat-passed').textContent).toBe('1');
    });
  });
});