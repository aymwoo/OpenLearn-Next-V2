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
import { TopPerformersWidget } from '../TopPerformersWidget';

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

// Mock recharts ResponsiveContainer to render children in JSDOM
vi.mock('recharts', async () => {
  const original = await vi.importActual<any>('recharts');
  return {
    ...original,
    ResponsiveContainer: ({ children }: any) => (
      <div className="recharts-responsive-container" style={{ width: 600, height: 250 }}>
        {children}
      </div>
    ),
  };
});

describe('TopPerformersWidget (随堂测验优秀榜组件)', () => {
  const mockLessons = [
    { id: 'les-1', title: 'Newtonian Mechanics', content: '' },
    { id: 'les-2', title: 'Thermodynamics', content: '' },
  ];

  const mockStudents = [
    { id: 'st-1', name: 'Alice Smith', class_id: 'cls-1' },
    { id: 'st-2', name: 'Bob Johnson', class_id: 'cls-1' },
    { id: 'st-3', name: 'Charlie Brown', class_id: 'cls-1' },
    { id: 'st-4', name: 'David Lee', class_id: 'cls-1' },
    { id: 'st-5', name: 'Eva Green', class_id: 'cls-1' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    setSocketInstance(null);
  });

  it('renders widget title, podium cards, and recharts container', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/classroom/sessions/les-1/top-performers')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              lessonId: 'les-1',
              topPerformers: [
                {
                  rank: 1,
                  studentId: 'st-1',
                  studentName: 'Alice Smith',
                  cumulativeScore: 300,
                  totalQuizzesAnswered: 3,
                  correctCount: 3,
                  accuracy: 100,
                  avgTimeSpentMs: 5000,
                  lastSubmittedAt: Date.now(),
                },
                {
                  rank: 2,
                  studentId: 'st-2',
                  studentName: 'Bob Johnson',
                  cumulativeScore: 280,
                  totalQuizzesAnswered: 3,
                  correctCount: 3,
                  accuracy: 95,
                  avgTimeSpentMs: 6500,
                  lastSubmittedAt: Date.now(),
                },
              ],
              summary: {
                totalParticipants: 2,
                totalResponses: 6,
                averageScore: 290,
              },
            }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    render(<TopPerformersWidget lang="zh" lessonId="les-1" lessons={mockLessons} students={mockStudents as any} />);

    // Verify title and structure
    expect(screen.getByText(/随堂测验优秀榜/)).toBeTruthy();
    expect(screen.getByTestId('top-performers-widget')).toBeTruthy();

    // Verify student name and chart after fetch
    await waitFor(() => {
      expect(screen.getByTestId('top-performers-chart')).toBeTruthy();
      expect(screen.getByText('Alice Smith')).toBeTruthy();
      expect(screen.getByText('Bob Johnson')).toBeTruthy();
    });
  });

  it('switches metric display mode between score, accuracy, and count', async () => {
    render(<TopPerformersWidget lang="zh" lessonId="les-1" lessons={mockLessons} students={mockStudents as any} />);

    const accuracyBtn = screen.getByTitle('按正确率排序');
    expect(accuracyBtn).toBeTruthy();

    fireEvent.click(accuracyBtn);
    expect(accuracyBtn.className).toContain('font-bold');

    const countBtn = screen.getByTitle('按答题题次排序');
    fireEvent.click(countBtn);
    expect(countBtn.className).toContain('font-bold');
  });

  it('does NOT render simulate button in production mode by default', () => {
    render(<TopPerformersWidget lang="zh" lessonId="les-1" lessons={mockLessons} students={mockStudents as any} />);
    expect(screen.queryByTitle('模拟学生实时答题')).toBeNull();
  });

  it('triggers simulation API when clicking simulate button if allowSimulation is true', async () => {
    const mockAddToast = vi.fn();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/simulate-quiz-responses')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, count: 5 }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            topPerformers: [],
          }),
      });
    });

    render(
      <TopPerformersWidget
        lang="zh"
        lessonId="les-1"
        lessons={mockLessons}
        students={mockStudents as any}
        addToast={mockAddToast}
        allowSimulation={true}
      />,
    );

    const simBtn = screen.getByTitle('模拟学生实时答题');
    expect(simBtn).toBeTruthy();

    fireEvent.click(simBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/simulate-quiz-responses'), expect.anything());
    });
  });

  it('triggers toast praise for the top performer', async () => {
    const mockAddToast = vi.fn();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/classroom/sessions/les-1/top-performers')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              lessonId: 'les-1',
              topPerformers: [
                {
                  rank: 1,
                  studentId: 'st-1',
                  studentName: 'Alice Smith',
                  cumulativeScore: 300,
                  totalQuizzesAnswered: 3,
                  correctCount: 3,
                  accuracy: 100,
                  avgTimeSpentMs: 5000,
                  lastSubmittedAt: Date.now(),
                },
              ],
              summary: { totalParticipants: 1, totalResponses: 3, averageScore: 300 },
            }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    render(
      <TopPerformersWidget
        lang="zh"
        lessonId="les-1"
        lessons={mockLessons}
        students={mockStudents as any}
        addToast={mockAddToast}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTitle('一键表扬榜首')).toBeTruthy();
    });

    const praiseBtn = screen.getByTitle('一键表扬榜首');
    fireEvent.click(praiseBtn);

    expect(mockAddToast).toHaveBeenCalledWith(
      expect.stringContaining('表扬已送达'),
      expect.stringContaining('荣誉勋章与鼓励'),
      'success',
    );
  });

  it('当本课节无作答数据时诚实展示空态，严禁 fallback 到全局假数据', async () => {
    const fetchSpy = vi.fn().mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            topPerformers: [],
            summary: { totalParticipants: 0, totalResponses: 0, averageScore: 0 },
          }),
      });
    });
    global.fetch = fetchSpy;

    render(
      <TopPerformersWidget
        lang="zh"
        lessonId="les-empty"
        classId="cls-live-1"
        lessons={mockLessons}
        students={mockStudents as any}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('暂无随堂作答数据')).toBeTruthy();
    });

    // 关键断言：请求 URL 必须包含 classId，且绝不能发起 /api/classroom/top-performers 全局假数据拉取
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('classId=cls-live-1'));
    const calledUrls = fetchSpy.mock.calls.map((call) => call[0]);
    expect(calledUrls.some((u: string) => u === '/api/classroom/top-performers?limit=5')).toBe(false);
  });

  it('订阅 App 主 socket：派发 whiteboard-quiz-answered 后榜单实时刷新，且不再新建裸连接（Issue #129）', async () => {
    const socket = createFakeMainSocket();
    setSocketInstance(socket as any);

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/classroom/sessions/les-1/top-performers')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              lessonId: 'les-1',
              topPerformers: [
                {
                  rank: 1,
                  studentId: 'st-1',
                  studentName: 'Alice Smith',
                  cumulativeScore: 300,
                  totalQuizzesAnswered: 3,
                  correctCount: 3,
                  accuracy: 100,
                  avgTimeSpentMs: 5000,
                  lastSubmittedAt: Date.now(),
                },
                {
                  rank: 2,
                  studentId: 'st-2',
                  studentName: 'Bob Johnson',
                  cumulativeScore: 280,
                  totalQuizzesAnswered: 3,
                  correctCount: 3,
                  accuracy: 95,
                  avgTimeSpentMs: 6500,
                  lastSubmittedAt: Date.now(),
                },
              ],
              summary: { totalParticipants: 2, totalResponses: 6, averageScore: 290 },
            }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    render(<TopPerformersWidget lang="zh" lessonId="les-1" lessons={mockLessons} students={mockStudents as any} />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeTruthy();
    });
    // 初始无实时事件：不显示同步徽标
    expect(screen.queryByText('实时作答同步中')).toBeNull();

    await act(async () => {
      socket.fire('whiteboard-quiz-answered', {
        lessonId: 'les-1',
        studentId: 'st-1',
        studentName: 'Alice Smith',
        score: 137,
        isCorrect: true,
        time_spent_ms: 4200,
      });
    });

    // 实时徽标出现，且 Alice 分数 300 + 137 = 437 无需刷新即更新
    await waitFor(() => {
      expect(screen.getByText('实时作答同步中')).toBeTruthy();
    });
    expect((await screen.findAllByText('437')).length).toBeGreaterThan(0);

    // 回归断言：不再自建裸 socket 连接
    expect(ioMock).not.toHaveBeenCalled();
  });
});
