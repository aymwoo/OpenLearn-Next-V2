import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { RollCallWrapper } from '../widgets/RollCallWrapper';
import { frontendEventBus } from '../../../services/event-bus';

describe('RollCallWrapper Tiered Picker & Evaluation', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/classes/')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 's1',
                name: '张明',
                student_number: '101',
                tier: 'basic',
                term_picked_count: 0,
                lesson_picked_count: 0,
              },
              {
                id: 's2',
                name: '李华',
                student_number: '102',
                tier: 'intermediate',
                term_picked_count: 1,
                lesson_picked_count: 0,
              },
              {
                id: 's3',
                name: '王超',
                student_number: '103',
                tier: 'advanced',
                term_picked_count: 2,
                lesson_picked_count: 0,
              },
            ]),
        });
      }
      if (url.includes('/api/rollcalls/evaluate')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    global.fetch = fetchMock as any;
    window.fetch = fetchMock as any;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders with candidate list and supports mode switching to tiered', async () => {
    render(
      <RollCallWrapper
        elementId="el-rc-1"
        data={{}}
        classId="class-1"
        lessonId="lesson-1"
        onPointerDown={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText(/随机点名助手/)).toBeDefined();
    expect(screen.getAllByText('全员公平').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('分层抽问')).toBeDefined();

    // Switch to tiered mode
    fireEvent.click(screen.getByText('分层抽问'));
    expect(screen.getByText('基础')).toBeDefined();
    expect(screen.getByText('进阶')).toBeDefined();
    expect(screen.getByText('拔高')).toBeDefined();
  });

  it('displays selected student and evaluation buttons when student is picked', async () => {
    const onUpdateMock = vi.fn();
    render(
      <RollCallWrapper
        elementId="el-rc-1"
        data={{
          selectedStudent: {
            id: 's2',
            name: '李华',
            student_number: '102',
            tier: 'intermediate',
            lesson_picked_count: 1,
            total_reward_coins: 10,
          },
        }}
        classId="class-1"
        lessonId="lesson-1"
        onElementUpdate={onUpdateMock}
        onPointerDown={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    // Selected student is visible
    expect(screen.getByText('李华')).toBeDefined();
    expect(screen.getByText(/抽中的幸运答题者/)).toBeDefined();

    // Evaluation options are visible
    expect(screen.getByText('卓越表现')).toBeDefined();
    expect(screen.getByText('良好完成')).toBeDefined();
    expect(screen.getByText('值得鼓励')).toBeDefined();

    // Click '卓越表现'
    const excellentBtn = screen.getByText('卓越表现');
    fireEvent.click(excellentBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/rollcalls/evaluate',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    // Verify submitted rating feedback
    await waitFor(() => {
      expect(screen.getByText(/已评定: 🌟 卓越表现/)).toBeDefined();
      expect(screen.getByText(/\+10 金币/)).toBeDefined();
    });
  });

  it('publishes event on frontendEventBus when rating is evaluated', async () => {
    const publishedEvents: any[] = [];
    const unsub = frontendEventBus.subscribe('rollcall.evaluated', (e) => {
      publishedEvents.push(e);
    });

    render(
      <RollCallWrapper
        elementId="el-rc-1"
        data={{
          selectedStudent: { id: 's3', name: '王超', student_number: '103' },
        }}
        onPointerDown={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('良好完成'));

    await waitFor(() => {
      expect(publishedEvents.length).toBeGreaterThanOrEqual(1);
      expect(publishedEvents[0].payload.rating).toBe('good');
      expect(publishedEvents[0].payload.rewardCoins).toBe(5);
    });

    unsub();
  });

  describe('student-side sync with the teacher', () => {
    const picked = (id: string, name: string, pickedTime: string) => ({
      selectedStudent: { id, name, student_number: id, lesson_picked_count: 1 },
      pickedTime,
      status: 'picked',
    });

    it('follows the teacher when the picked student changes on a read-only (student) board', () => {
      const { rerender } = render(
        <RollCallWrapper
          elementId="el-rc-1"
          data={picked('s1', '张明', '2026-01-02T03:04:05.000Z')}
          classId="class-1"
          lessonId="lesson-1"
          onPointerDown={vi.fn()}
          onDelete={vi.fn()}
          readOnly
        />,
      );

      expect(screen.getByText('张明')).toBeDefined();

      // 教师端抽中另一位学生并广播刷新 → 学生端收到新的图元数据
      rerender(
        <RollCallWrapper
          elementId="el-rc-1"
          data={picked('s3', '王超', '2026-01-02T03:09:11.000Z')}
          classId="class-1"
          lessonId="lesson-1"
          onPointerDown={vi.fn()}
          onDelete={vi.fn()}
          readOnly
        />,
      );

      expect(screen.queryByText('张明')).toBeNull();
      expect(screen.getByText('王超')).toBeDefined();
    });

    it('picks up a later teacher evaluation without a local click', () => {
      const base = picked('s1', '张明', '2026-01-02T03:04:05.000Z');
      const { rerender } = render(
        <RollCallWrapper
          elementId="el-rc-1"
          data={base}
          classId="class-1"
          lessonId="lesson-1"
          onPointerDown={vi.fn()}
          onDelete={vi.fn()}
          readOnly
        />,
      );

      rerender(
        <RollCallWrapper
          elementId="el-rc-1"
          data={{ ...base, evaluation: { rating: 'good', score: 5, rewardCoins: 5, submitted: true } }}
          classId="class-1"
          lessonId="lesson-1"
          onPointerDown={vi.fn()}
          onDelete={vi.fn()}
          readOnly
        />,
      );

      expect(screen.getByText(/已评定: 👍 良好完成/)).toBeDefined();
    });

    it('keeps the local optimistic pick when the teacher has not persisted it yet', async () => {
      // 教师端点击后先播滚轮动画，此时 data 尚未回写；不能被「旧 data」打回未抽中状态
      render(
        <RollCallWrapper
          elementId="el-rc-1"
          data={{}}
          classId="class-1"
          lessonId="lesson-1"
          onElementUpdate={vi.fn()}
          onPointerDown={vi.fn()}
          onDelete={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByText('开始随机点名'));
      expect(screen.getByText('加权滚轮运转中...')).toBeDefined();

      // 16 次滚动动画结束后落定，且不会被 data 回写打回未抽中状态
      await waitFor(
        () => {
          expect(screen.getByText('抽取下一位学生')).toBeDefined();
        },
        { timeout: 3000 },
      );
    });
  });
});
