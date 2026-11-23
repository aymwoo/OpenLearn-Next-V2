/**
 * AssessmentActivityCard：启动作答、提交回写进度、未绑定试卷禁用。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AssessmentActivityCard } from '../AssessmentActivityCard';

const startAttempt = vi.hoisted(() => vi.fn());
const attemptResult = vi.hoisted(() => vi.fn());
const postActivityProgress = vi.hoisted(() => vi.fn());

vi.mock('../../../assessment/api', () => {
  class ApiError extends Error {}
  return { ApiError, assessmentApi: { startAttempt, attemptResult } };
});

vi.mock('../../../assessment/student/StudentAssessmentsView', () => ({
  AssessmentRunner: ({ onSubmitted }: { onSubmitted: (result: unknown) => void }) => (
    <button
      type="button"
      data-testid="runner-submit"
      onClick={() =>
        onSubmitted({
          attempt: { id: 'at1', score: 8, maxScore: 10 },
          items: [],
          assignment: {},
          showScore: true,
          showAnalysis: false,
        })
      }
    >
      交卷
    </button>
  ),
}));

vi.mock('../../../../services/lessonActivitiesService.js', () => ({
  postActivityProgress,
}));

const activity = {
  id: 'a1',
  title: '单元测验',
  config_json: JSON.stringify({ assignmentId: 'asg-1', assessmentId: 'asm-1', classId: 'c1' }),
};

describe('AssessmentActivityCard', () => {
  beforeEach(() => {
    startAttempt.mockReset();
    attemptResult.mockReset();
    postActivityProgress.mockReset().mockResolvedValue({ ok: true, data: {} });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('开始作答后渲染 Runner，交卷回写活动进度', async () => {
    startAttempt.mockResolvedValue({
      attempt: { id: 'at1', status: 'in_progress', submittedAt: null },
      answers: { q1: 'A' },
    });
    const onProgressUpdated = vi.fn();

    render(<AssessmentActivityCard activity={activity} onProgressUpdated={onProgressUpdated} />);
    fireEvent.click(screen.getByRole('button', { name: '开始作答' }));

    const submit = await screen.findByTestId('runner-submit');
    fireEvent.click(submit);

    await waitFor(() =>
      expect(postActivityProgress).toHaveBeenCalledWith('a1', { status: 'submitted', progressPercent: 100 }),
    );
    expect(onProgressUpdated).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('得分 8/10')).toBeTruthy();
    expect(startAttempt).toHaveBeenCalledWith('asg-1');
  });

  it('已交卷的 attempt 直接读取结果', async () => {
    startAttempt.mockResolvedValue({
      attempt: { id: 'at2', status: 'submitted', submittedAt: 100 },
      answers: {},
    });
    attemptResult.mockResolvedValue({
      attempt: { id: 'at2', score: 9, maxScore: 10 },
      items: [],
      assignment: {},
      showScore: true,
      showAnalysis: false,
    });

    render(<AssessmentActivityCard activity={activity} />);
    fireEvent.click(screen.getByRole('button', { name: '开始作答' }));

    expect(await screen.findByText('得分 9/10')).toBeTruthy();
    expect(attemptResult).toHaveBeenCalledWith('at2');
  });

  it('未绑定试卷时禁用开始按钮', () => {
    render(<AssessmentActivityCard activity={{ id: 'a2', title: '待绑定', config_json: '{}' }} />);

    const button = screen.getByRole('button', { name: '开始作答' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
