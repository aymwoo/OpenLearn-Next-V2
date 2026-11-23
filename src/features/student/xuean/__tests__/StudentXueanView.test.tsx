/**
 * StudentXueanView：插件活动分发、试题活动内嵌作答。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
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

  it('学案首页块渲染简介与背景图', async () => {
    getXuean.mockResolvedValue({
      ok: true,
      data: {
        lessonId: 'lesson-1',
        blocks: [
          {
            id: 'b1',
            lesson_id: 'lesson-1',
            block_type: 'xuean_home',
            order_index: 0,
            content_json: JSON.stringify({ intro: '欢迎来到本课', backgroundImage: '/api/files/cover-1' }),
            surface_id: null,
          },
        ],
        activities: [],
        progressByActivity: {},
      },
    });

    render(<StudentXueanView lessonId="lesson-1" />);

    expect(await screen.findByText('欢迎来到本课')).toBeTruthy();
    const hero = screen.getByText('欢迎来到本课').parentElement as HTMLElement;
    expect(hero.style.backgroundImage).toContain('/api/files/cover-1');
  });

  it('顶部活动导航列出全部活动并可切换中间内容', async () => {
    getXuean.mockResolvedValue({
      ok: true,
      data: {
        lessonId: 'lesson-1',
        blocks: [],
        activities: [
          { ...baseActivity, id: 'a1', type: 'reading', title: '活动一', order_index: 0 },
          { ...baseActivity, id: 'a2', type: 'reading', title: '活动二', order_index: 1 },
        ],
        progressByActivity: {},
      },
    });

    render(<StudentXueanView lessonId="lesson-1" />);

    expect(await screen.findByRole('tab', { name: /1\. 活动一/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /2\. 活动二/ })).toBeTruthy();
    expect(screen.getByLabelText('活动 1：活动一')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /2\. 活动二/ }));

    expect(await screen.findByLabelText('活动 2：活动二')).toBeTruthy();
    expect(screen.queryByLabelText('活动 1：活动一')).toBeNull();
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
    // 学案活动不再提供手动「开始 / 提交」，提交由活动内部功能完成。
    expect(screen.queryByRole('button', { name: '开始' })).toBeNull();
    expect(screen.queryByRole('button', { name: '提交' })).toBeNull();
    expect(screen.queryByRole('button', { name: '重新提交' })).toBeNull();
  });
});
