/**
 * StudentXueanView：插件活动分发、试题活动内嵌作答。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StudentXueanView } from '../StudentXueanView';

const getXuean = vi.hoisted(() => vi.fn());

vi.mock('../../../../services/lessonActivitiesService.js', () => ({
  getXuean,
  postActivityProgress: vi.fn(),
}));

vi.mock('../AssessmentActivityCard', () => ({
  AssessmentActivityCard: ({ activity }: { activity: { title: string } }) => (
    <div data-testid="quiz-card">{activity.title}</div>
  ),
}));

vi.mock('../../../../plugin-host/extension-point-renderer', () => ({
  ExtensionPointRenderer: (props: {
    slot: string;
    slotProps?: { activityType?: string; activity?: { id: string } };
  }) => (
    <div
      data-testid="plugin-activity-slot"
      data-slot={props.slot}
      data-activity-type={props.slotProps?.activityType}
      data-activity-id={props.slotProps?.activity?.id}
    />
  ),
}));

const baseActivity = {
  lesson_id: 'lesson-1',
  order_index: 0,
  required: 1,
  visible: 1,
  config_json: null,
  surface_id: null,
};

describe('StudentXueanView', () => {
  beforeEach(() => {
    getXuean.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('插件活动交给 xuean.activity.student 槽位渲染', async () => {
    getXuean.mockResolvedValue({
      ok: true,
      data: {
        lessonId: 'lesson-1',
        blocks: [],
        activities: [{ ...baseActivity, id: 'a1', type: '@acme/lab:experiment', title: '虚拟实验' }],
        progressByActivity: {},
      },
    });

    render(<StudentXueanView lessonId="lesson-1" lessonTitle="探究课" />);

    expect(await screen.findByText('虚拟实验')).toBeTruthy();
    const slot = screen.getByTestId('plugin-activity-slot');
    expect(slot.getAttribute('data-slot')).toBe('xuean.activity.student');
    expect(slot.getAttribute('data-activity-type')).toBe('@acme/lab:experiment');
    expect(slot.getAttribute('data-activity-id')).toBe('a1');
  });

  it('绑定 assignment 的试题活动渲染内嵌作答卡片', async () => {
    getXuean.mockResolvedValue({
      ok: true,
      data: {
        lessonId: 'lesson-1',
        blocks: [],
        activities: [
          {
            ...baseActivity,
            id: 'a2',
            type: 'quiz',
            title: '单元测验',
            config_json: JSON.stringify({ assignmentId: 'asg-1', assessmentId: 'asm-1', classId: 'c1' }),
          },
        ],
        progressByActivity: {},
      },
    });

    render(<StudentXueanView lessonId="lesson-1" />);

    expect(await screen.findByTestId('quiz-card')).toBeTruthy();
    expect(screen.getByText('单元测验')).toBeTruthy();
  });

  it('未绑定 assignment 的试题活动回退为普通活动卡片', async () => {
    getXuean.mockResolvedValue({
      ok: true,
      data: {
        lessonId: 'lesson-1',
        blocks: [],
        activities: [{ ...baseActivity, id: 'a3', type: 'quiz', title: '待绑定测验', config_json: '{}' }],
        progressByActivity: {},
      },
    });

    render(<StudentXueanView lessonId="lesson-1" />);

    expect(await screen.findByText('待绑定测验')).toBeTruthy();
    expect(screen.queryByTestId('quiz-card')).toBeNull();
  });
});
