/**
 * StudentXueanView：插件活动分发、试题活动内嵌作答。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { StudentXueanView } from '../StudentXueanView';
import { PluginHostProvider } from '../../../../plugin-host/plugin-host-context';
import type { FrontendPluginHost } from '../../../../plugin-host/plugin-host';

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
    slotProps?: {
      activityType?: string;
      activity?: { id: string };
      progress?: { status: string } | null;
      studentId?: string | null;
      classId?: string | null;
    };
  }) => (
    <div
      data-testid="plugin-activity-slot"
      data-slot={props.slot}
      data-activity-type={props.slotProps?.activityType}
      data-activity-id={props.slotProps?.activity?.id}
      data-progress-status={props.slotProps?.progress?.status ?? 'none'}
      data-student-id={props.slotProps?.studentId ?? 'none'}
      data-class-id={props.slotProps?.classId ?? 'none'}
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

    // 插件活动同样要有学生附加区（与内置活动保持一致）——附加区只在确有插件贡献时渲染
    const host = {
      getExtensions: (slot: string) =>
        slot === 'xuean.activity.student.addon'
          ? [{ id: 'ext-addon', pluginId: 'acme', slotProps: {}, component: () => null }]
          : [],
    } as unknown as FrontendPluginHost;
    render(
      <PluginHostProvider host={host}>
        <StudentXueanView lessonId="lesson-1" lessonTitle="探究课" />
      </PluginHostProvider>,
    );

    expect(await screen.findByLabelText('活动 1：虚拟实验')).toBeTruthy();
    const slots = screen.getAllByTestId('plugin-activity-slot');
    const slot = slots.find((el) => el.getAttribute('data-slot') === 'xuean.activity.student')!;
    expect(slot.getAttribute('data-activity-type')).toBe('@acme/lab:experiment');
    expect(slot.getAttribute('data-activity-id')).toBe('a1');
    expect(slots.some((el) => el.getAttribute('data-slot') === 'xuean.activity.student.addon')).toBe(true);
  });

  it('插件活动主槽收到进度与学生身份上下文', async () => {
    getXuean.mockResolvedValue({
      ok: true,
      data: {
        lessonId: 'lesson-1',
        blocks: [],
        activities: [{ ...baseActivity, id: 'a1', type: '@acme/lab:experiment', title: '虚拟实验' }],
        progressByActivity: {
          a1: {
            id: 'p1',
            activity_id: 'a1',
            student_id: 'stu-7',
            status: 'in_progress',
            progress_percent: 40,
          },
        },
      },
    });

    render(
      <PluginHostProvider host={{ getExtensions: () => [] } as unknown as FrontendPluginHost}>
        <StudentXueanView lessonId="lesson-1" classId="cls-9" studentId="stu-7" />
      </PluginHostProvider>,
    );

    expect(await screen.findByLabelText('活动 1：虚拟实验')).toBeTruthy();
    const slot = screen
      .getAllByTestId('plugin-activity-slot')
      .find((el) => el.getAttribute('data-slot') === 'xuean.activity.student')!;
    // 插件主视图此前拿不到进度/学生/班级，只能自己再请求一次接口
    expect(slot.getAttribute('data-progress-status')).toBe('in_progress');
    expect(slot.getAttribute('data-student-id')).toBe('stu-7');
    expect(slot.getAttribute('data-class-id')).toBe('cls-9');
  });

  it('没有插件贡献附加区时不再输出空的 addon 分隔块', async () => {
    getXuean.mockResolvedValue({
      ok: true,
      data: {
        lessonId: 'lesson-1',
        blocks: [],
        activities: [{ ...baseActivity, id: 'a1', type: 'reading', title: '预习导读' }],
        progressByActivity: {},
      },
    });

    render(<StudentXueanView lessonId="lesson-1" />);

    expect(await screen.findByLabelText('活动 1：预习导读')).toBeTruthy();
    const slots = screen.getAllByTestId('plugin-activity-slot');
    expect(slots.some((el) => el.getAttribute('data-slot') === 'xuean.activity.student.addon')).toBe(false);
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
    expect(screen.getByLabelText('活动 1：单元测验')).toBeTruthy();
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

    expect(await screen.findByLabelText('活动 1：待绑定测验')).toBeTruthy();
    expect(screen.queryByTestId('quiz-card')).toBeNull();
    // 学案活动不再提供手动「开始 / 提交」，提交由活动内部功能完成。
    expect(screen.queryByRole('button', { name: '开始' })).toBeNull();
    expect(screen.queryByRole('button', { name: '提交' })).toBeNull();
    expect(screen.queryByRole('button', { name: '重新提交' })).toBeNull();
  });

  it('导读栏展示学习目标 / 重难点条目与只读活动进度', async () => {
    getXuean.mockResolvedValue({
      ok: true,
      data: {
        lessonId: 'lesson-1',
        blocks: [
          {
            id: 'b1',
            lesson_id: 'lesson-1',
            block_type: 'learning_goals',
            order_index: 0,
            content_json: JSON.stringify({ goals: ['掌握分数的意义', '会用分数表示部分与整体'] }),
            surface_id: null,
          },
          {
            id: 'b2',
            lesson_id: 'lesson-1',
            block_type: 'key_points',
            order_index: 1,
            content_json: JSON.stringify(['真分数与假分数的区别']),
            surface_id: null,
          },
        ],
        activities: [
          { ...baseActivity, id: 'a1', type: 'reading', title: '预习导读', order_index: 0 },
          { ...baseActivity, id: 'a2', type: 'reading', title: '学案研读', order_index: 1 },
        ],
        progressByActivity: {
          a1: {
            activity_id: 'a1',
            student_id: 's1',
            status: 'submitted',
            progress_percent: 100,
            verified: 1,
            score: null,
          },
        },
      },
    });

    render(<StudentXueanView lessonId="lesson-1" lessonTitle="预习导读" />);

    const rail = await screen.findByRole('complementary', { name: '学案导读' });
    expect(within(rail).getByText('学习目标')).toBeTruthy();
    expect(within(rail).getByText('掌握分数的意义')).toBeTruthy();
    expect(within(rail).getByText('真分数与假分数的区别')).toBeTruthy();
    // 活动进度只读展示，与状态文案一致
    expect(within(rail).getByText('已提交')).toBeTruthy();
    expect(within(rail).queryByRole('button')).toBeNull();
    // 顶部细进度条已换成圆环，但进度语义仍可被读屏获取
    expect(screen.getByRole('progressbar', { name: '学案活动完成进度' }).getAttribute('aria-valuenow')).toBe('1');
  });

  it('阅读活动没有材料时给出空态引导而不是一行灰字', async () => {
    getXuean.mockResolvedValue({
      ok: true,
      data: {
        lessonId: 'lesson-1',
        blocks: [],
        activities: [{ ...baseActivity, id: 'a1', type: 'reading', title: '预习导读', config_json: null }],
        progressByActivity: {},
      },
    });

    render(<StudentXueanView lessonId="lesson-1" />);

    expect(await screen.findByText('本环节还没有阅读材料')).toBeTruthy();
    expect(screen.getByRole('button', { name: '标记为已读' })).toBeTruthy();
  });
});
