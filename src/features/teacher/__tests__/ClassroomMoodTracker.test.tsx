import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

/**
 * Issue #129：本组件不再自建 socket 连接，改为订阅 App 主 socket。
 * - `ioMock` 断言不再调用裸 `io()`（回归「新建裸连接」问题）；
 * - 通过真实 socket-service 注入假主 socket，模拟服务端派发事件。
 */
const { ioMock } = vi.hoisted(() => ({ ioMock: vi.fn() }));
vi.mock('socket.io-client', () => ({ io: ioMock }));

import { setSocketInstance } from '../../../services/socket-service';
import { ClassroomMoodTracker } from '../ClassroomMoodTracker';

type FakeSocketHandler = (...args: any[]) => void;

/** 最小主 socket 桩：记录监听器，支持手动派发事件。 */
function createFakeMainSocket() {
  const listeners = new Map<string, Set<FakeSocketHandler>>();
  const socket = {
    id: 'main-socket',
    connected: true,
    on: (event: string, handler: FakeSocketHandler) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
      return socket;
    },
    off: (event: string, handler: FakeSocketHandler) => {
      listeners.get(event)?.delete(handler);
      return socket;
    },
    emit: vi.fn(),
    fire: (event: string, payload: unknown) => {
      listeners.get(event)?.forEach((handler) => handler(payload));
    },
  };
  return socket;
}

// Mock recharts ResponsiveContainer to render children with dimensions in JSDOM
vi.mock('recharts', async () => {
  const original = await vi.importActual<any>('recharts');
  return {
    ...original,
    ResponsiveContainer: ({ children }: any) => (
      <div className="recharts-responsive-container" style={{ width: 800, height: 300 }}>
        {children}
      </div>
    ),
  };
});

describe('ClassroomMoodTracker (实时课堂情绪与专注度追踪器)', () => {
  const mockLessons = [
    { id: 'les-1', title: 'Newtonian Mechanics', content: '' },
    { id: 'les-2', title: 'Thermodynamics', content: '' },
  ];

  const mockSchedules = [
    {
      id: 'sch-1',
      lesson_id: 'les-1',
      class_id: 'cls-1',
      scheduled_date: '2026-09-22',
      time_slot: '09:00 - 09:45',
      status: 'scheduled',
      lesson_title: 'Newtonian Mechanics',
      class_name: 'Grade 9 Class 1',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    setSocketInstance(null);
  });

  it('renders mood tracker header, metric cards, and chart containers', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/classroom/sessions/les-1/mood-tracker')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              metrics: {
                currentEngagement: 85,
                moodStatus: 'OPTIMAL',
                moodLabel: '课堂节奏良好 · 专注度高',
                moodEmoji: '🌟',
                totalInteractions: 30,
                interactionFrequencyPerMin: '4.5',
                pulseDistribution: {
                  clearCount: 22,
                  confusedCount: 5,
                  tooFastCount: 3,
                  total: 30,
                  clearPercent: 73,
                  confusedPercent: 17,
                  tooFastPercent: 10,
                },
              },
              timeline: [
                {
                  time: '10:00',
                  timestamp: Date.now() - 60000,
                  engagement: 82,
                  energy: 70,
                  interactions: 3,
                  clear: 2,
                  confused: 1,
                  tooFast: 0,
                },
                {
                  time: '10:01',
                  timestamp: Date.now(),
                  engagement: 88,
                  energy: 85,
                  interactions: 5,
                  clear: 4,
                  confused: 1,
                  tooFast: 0,
                },
              ],
            }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    render(
      <ClassroomMoodTracker
        lang="zh"
        lessons={mockLessons as any}
        schedules={mockSchedules as any}
        addToast={vi.fn()}
      />,
    );

    // Verify title and badges
    expect(screen.getByText('实时课堂专注度与情绪晴雨表')).toBeDefined();
    expect(screen.getByText('综合专注指数')).toBeDefined();
    expect(screen.getByText('互动触发频度')).toBeDefined();
    expect(screen.getByText('听懂顺畅率')).toBeDefined();
    expect(screen.getByText('疑问/过快预警')).toBeDefined();

    // Verify Recharts section headers
    expect(screen.getByText('课堂专注度与能量动态走势')).toBeDefined();
    expect(screen.getByText('学生脉搏反馈占比')).toBeDefined();

    // Verify AI recommendation section
    expect(screen.getByText('AI 教学节奏诊断建议:')).toBeDefined();
  });

  it('triggers instant pulse check and informs teacher', async () => {
    const addToast = vi.fn();
    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/api/classroom/sessions/les-1/pulse-check') && opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            metrics: {
              currentEngagement: 80,
              moodStatus: 'OPTIMAL',
              moodLabel: '课堂节奏良好',
              moodEmoji: '🌟',
              totalInteractions: 10,
              interactionFrequencyPerMin: '2.0',
              pulseDistribution: {
                clearCount: 8,
                confusedCount: 1,
                tooFastCount: 1,
                total: 10,
                clearPercent: 80,
                confusedPercent: 10,
                tooFastPercent: 10,
              },
            },
            timeline: [],
          }),
      });
    });

    render(
      <ClassroomMoodTracker
        lang="zh"
        lessons={mockLessons as any}
        schedules={mockSchedules as any}
        addToast={addToast}
      />,
    );

    const pulseBtn = screen.getByText('发起30s即时脉搏检');
    fireEvent.click(pulseBtn);

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        '脉搏检测已下发',
        expect.stringContaining('已向全体听课学生弹出'),
        'success',
      );
    });
  });

  it('toggles simulation mode and changes time window', async () => {
    render(
      <ClassroomMoodTracker
        lang="zh"
        lessons={mockLessons as any}
        schedules={mockSchedules as any}
        addToast={vi.fn()}
      />,
    );

    const simBtn = screen.getByText('模拟数据流');
    fireEvent.click(simBtn);
    expect(screen.getByText('实时模拟中')).toBeDefined();

    // Switch time window to 30m
    const btn30m = screen.getByText('30m');
    fireEvent.click(btn30m);
    expect(btn30m.className).toContain('bg-white');
  });

  it('订阅 App 主 socket：派发本课节的 pacing_updated 后实时刷新，且不再新建裸连接（Issue #129）', async () => {
    const socket = createFakeMainSocket();
    setSocketInstance(socket as any);

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/mood-tracker')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              metrics: {
                currentEngagement: 70,
                moodStatus: 'OPTIMAL',
                moodLabel: '课堂节奏良好',
                moodEmoji: '🌟',
                totalInteractions: 5,
                interactionFrequencyPerMin: '1.0',
                pulseDistribution: {
                  clearCount: 5,
                  confusedCount: 0,
                  tooFastCount: 0,
                  total: 5,
                  clearPercent: 100,
                  confusedPercent: 0,
                  tooFastPercent: 0,
                },
              },
              timeline: [],
            }),
        });
      }
      return Promise.resolve({ ok: false });
    });
    global.fetch = fetchMock;

    render(
      <ClassroomMoodTracker
        lang="zh"
        lessons={mockLessons as any}
        schedules={mockSchedules as any}
        addToast={vi.fn()}
      />,
    );

    // 初次拉取（默认选中课节 les-1）
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/mood-tracker'));
    });

    // 非本课节的事件应被忽略
    await act(async () => {
      socket.fire('classroom:pacing_updated', { lessonId: 'les-2' });
    });
    expect(screen.queryByText('收到学生节奏脉搏反馈')).toBeNull();

    // 本课节事件：实时追加动态流水，并触发数据刷新
    const callsBefore = fetchMock.mock.calls.length;
    await act(async () => {
      socket.fire('classroom:pacing_updated', { lessonId: 'les-1' });
    });
    await waitFor(() => {
      expect(screen.getByText('收到学生节奏脉搏反馈')).toBeTruthy();
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);

    // 回归断言：不再自建裸 socket 连接
    expect(ioMock).not.toHaveBeenCalled();
  });
});
