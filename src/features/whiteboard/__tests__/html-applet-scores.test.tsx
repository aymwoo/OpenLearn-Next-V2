import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { HtmlAppletFrame } from '../components/HtmlAppletFrame';
import { setSocketInstance } from '../../../services/socket-service';

const socketHandlers: Record<string, Set<(...args: any[]) => void>> = {};
const mockSocket = {
  on: vi.fn((event: string, handler: any) => {
    if (!socketHandlers[event]) socketHandlers[event] = new Set();
    socketHandlers[event].add(handler);
  }),
  off: vi.fn((event: string, handler: any) => {
    socketHandlers[event]?.delete(handler);
  }),
  emit: vi.fn(),
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  mockSocket.on.mockClear();
  mockSocket.off.mockClear();
  for (const k of Object.keys(socketHandlers)) {
    socketHandlers[k].clear();
  }
  global.fetch = fetchMock as any;
  fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
  setSocketInstance(mockSocket as any);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const emitSocket = (event: string, ...args: any[]) => {
  for (const h of socketHandlers[event] ?? []) h(...args);
};

describe('HtmlAppletFrame score overlay', () => {
  it('does not render score toggle when there are no attempts', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    render(
      <HtmlAppletFrame
        data={{ title: '课件', coursewareUuid: 'abc-123' }}
        lessonId="lesson-1"
      />,
    );
    // No toggle button when attempts array is empty (showOverlay guard)
    await waitFor(() => {
      expect(screen.queryByTestId('courseware-scores-toggle')).toBeNull();
    });
  });

  it('does not render score toggle when coursewareUuid is missing', async () => {
    render(<HtmlAppletFrame data={{ title: '普通 HTML', code: '<p>x</p>' }} lessonId="lesson-1" />);
    expect(screen.queryByTestId('courseware-scores-toggle')).toBeNull();
  });

  it('fetches attempts on mount, then toggles panel via button', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          attemptId: 'a-1',
          studentId: 's-1',
          studentName: '小明',
          score: 88,
          completion: 1,
          started_at: 1735689600000,
          finished_at: 1735689700000,
          status: 'finished',
        },
        {
          attemptId: 'a-2',
          studentId: 's-2',
          studentName: '小红',
          score: 45,
          completion: 0.6,
          started_at: 1735689600000,
          finished_at: 1735689700000,
          status: 'finished',
        },
      ],
    });

    render(
      <HtmlAppletFrame
        data={{ title: '课件', coursewareUuid: 'abc-123' }}
        lessonId="lesson-1"
      />,
    );

    // 拉取了一次
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/courseware/attempts?coursewareUuid=abc-123');

    // 订阅了 socket
    expect(mockSocket.on).toHaveBeenCalledWith('courseware-attempt-updated', expect.any(Function));

    // 折叠态：toggle 按钮显示「查看成绩 (2)」
    const toggle = await screen.findByTestId('courseware-scores-toggle');
    expect(toggle.textContent).toBe('查看成绩 (2)');
    expect(screen.queryByTestId('courseware-scores-panel')).toBeNull();

    // 点击展开
    fireEvent.click(toggle);
    const panel = await screen.findByTestId('courseware-scores-panel');
    expect(panel).toBeDefined();
    expect(screen.getByTestId('courseware-attempt-row-a-1').textContent).toContain('小明');
    expect(screen.getByTestId('courseware-attempt-row-a-1').textContent).toContain('88');
    expect(screen.getByTestId('courseware-attempt-row-a-2').textContent).toContain('小红');
    expect(screen.getByTestId('courseware-attempt-row-a-2').textContent).toContain('45');
    expect(panel.textContent).toContain('2 人已提交');
    expect(panel.textContent).toContain('均分 66.5');

    // 再次点击收起
    fireEvent.click(toggle);
    expect(screen.queryByTestId('courseware-scores-panel')).toBeNull();
    expect(toggle.textContent).toBe('查看成绩 (2)');
  });

  it('refetches attempts on courseware-attempt-updated socket event', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          attemptId: 'a-1',
          studentId: 's-1',
          studentName: '小明',
          score: 70,
          completion: 1,
          started_at: 1,
          finished_at: 2,
          status: 'finished',
        },
      ],
    });
    render(
      <HtmlAppletFrame
        data={{ title: '课件', coursewareUuid: 'abc-456' }}
        lessonId="lesson-1"
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // 模拟服务端推送
    emitSocket('courseware-attempt-updated', { attemptId: 'a-1', type: 'submit' });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/courseware/attempts?coursewareUuid=abc-456');
  });

  it('unsubscribes on unmount to avoid memory leak', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    const { unmount } = render(
      <HtmlAppletFrame
        data={{ title: '课件', coursewareUuid: 'abc-789' }}
        lessonId="lesson-1"
      />,
    );
    await waitFor(() => {
      expect(mockSocket.on).toHaveBeenCalled();
    });
    unmount();
    expect(mockSocket.off).toHaveBeenCalledWith('courseware-attempt-updated', expect.any(Function));
  });
});