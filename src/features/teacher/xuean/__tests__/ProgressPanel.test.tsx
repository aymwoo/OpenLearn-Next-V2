import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

/**
 * ProgressPanel：活动展开后应给插件留出教师端实时视图位（`xuean.activity.teacher`）。
 */
const getActivityProgressPanel = vi.hoisted(() => vi.fn());

vi.mock('../../../../services/lessonActivitiesService.js', () => ({
  getActivityProgressPanel,
  verifyActivityProgress: vi.fn(),
  nudgeActivity: vi.fn(),
  syncActivityGrades: vi.fn(),
  syncLessonActivityGrades: vi.fn(),
}));

vi.mock('../../../../context/AppDataContext.js', () => ({
  useOptionalAppData: () => ({ selectedLesson: 'lesson-1', students: [], liveClassSelectedClassId: 'class-1' }),
}));

vi.mock('../../../../plugin-host/extension-point-renderer', () => ({
  ExtensionPointRenderer: (props: { slot: string; slotProps?: { activityType?: string } }) => (
    <div data-testid="progress-panel-slot" data-slot={props.slot} data-activity-type={props.slotProps?.activityType} />
  ),
}));

import { ProgressPanel } from '../ProgressPanel';

describe('ProgressPanel — 插件活动实时视图', () => {
  beforeEach(() => {
    getActivityProgressPanel.mockResolvedValue({
      ok: true,
      data: {
        lessonId: 'lesson-1',
        totalStudents: 2,
        activities: [
          {
            id: 'a1',
            lesson_id: 'lesson-1',
            order_index: 0,
            type: '@acme/lab:experiment',
            title: '虚拟实验',
            students: [],
            summary: { total: 2, done: 1, pending: 1 },
          },
        ],
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('展开活动后渲染 xuean.activity.teacher 槽位', async () => {
    render(<ProgressPanel />);

    const row = await screen.findByText('虚拟实验');
    fireEvent.click(row);

    await waitFor(() => {
      const slot = screen
        .getAllByTestId('progress-panel-slot')
        .find((el) => el.getAttribute('data-slot') === 'xuean.activity.teacher');
      expect(slot).toBeTruthy();
      expect(slot?.getAttribute('data-activity-type')).toBe('@acme/lab:experiment');
    });
  });
});
