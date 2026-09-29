/**
 * 大屏展台 · 独立窗口打开与连接保持
 *
 * 覆盖用户诉求的两点：
 *  1. 「打开大屏展台」新开一个窗口（而不是覆盖授课界面）
 *  2. 新窗口**保持连接**（Socket 主导 + 断连可见 + 低频轮询兜底）
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

import { useStageDisplayFeed } from '../stage-display/useStageDisplayFeed';
import { useStageDisplayWindow } from '../stage-display/useStageDisplayWindow';
import { setSocketInstance } from '../../../services/socket-service';

// ── 可控的 Socket 替身 ──────────────────────────────────────────────
type Handler = (...args: any[]) => void;
function createFakeSocket() {
  const handlers = new Map<string, Handler[]>();
  return {
    connected: true,
    on: vi.fn(function (this: any, evt: string, h: Handler) {
      const list = handlers.get(evt) ?? [];
      list.push(h);
      handlers.set(evt, list);
      return this;
    }),
    off: vi.fn((evt: string, h: Handler) => {
      const list = handlers.get(evt) ?? [];
      handlers.set(
        evt,
        list.filter((x) => x !== h),
      );
    }),
    emit: vi.fn(),
    // 测试用：手动触发
    fire: (evt: string, payload?: any) => {
      for (const h of handlers.get(evt) ?? []) h(payload);
    },
    count: (evt: string) => (handlers.get(evt) ?? []).length,
  };
}
let fakeSocket: ReturnType<typeof createFakeSocket>;

// ── 可控的 fetch ────────────────────────────────────────────────────
let stageResponses: any[] = [];
let stageCallCount = 0;
let fetchShouldFail = false;

beforeEach(() => {
  stageResponses = [];
  stageCallCount = 0;
  fetchShouldFail = false;

  fakeSocket = createFakeSocket();
  setSocketInstance(fakeSocket as any);

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/classroom/stage/')) {
        stageCallCount += 1;
        if (fetchShouldFail) return { ok: false, status: 500, json: async () => ({}) } as any;
        const next = stageResponses.shift() ?? {
          stage: 'IN_CLASS_TEACHING',
          checkinCode: null,
          activePoll: null,
          activeBuzzer: null,
          pacing: { TOO_FAST: 0, CONFUSED: 0, CLEAR: 0 },
        };
        return { ok: true, json: async () => next } as any;
      }
      return { ok: true, json: async () => ({}) } as any;
    }),
  );
  // jsdom 没有 window.open
  vi.stubGlobal('open', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setSocketInstance(null as any);
});

// ────────────────────────────────────────────────────────────────────
function FeedProbe({ lessonId }: { lessonId: string | null }) {
  const { data, health, lastSyncedAt } = useStageDisplayFeed(lessonId);
  return (
    <div>
      <span data-testid="health">{health}</span>
      <span data-testid="stage">{String(data.stage)}</span>
      <span data-testid="poll">{data.activePoll?.id ?? 'none'}</span>
      <span data-testid="calls">{stageCallCount}</span>
      <span data-testid="synced">{lastSyncedAt === null ? 'never' : 'yes'}</span>
    </div>
  );
}

describe('useStageDisplayFeed · 保持连接', () => {
  it('挂载即连上并完成首次同步（health=live）', async () => {
    render(<FeedProbe lessonId="les_1" />);

    await waitFor(() => expect(screen.getByTestId('health').textContent).toBe('live'));
    expect(screen.getByTestId('synced').textContent).toBe('yes');
    expect(stageCallCount).toBe(1);
  });

  it('课堂事件驱动即时刷新，而不是等轮询', async () => {
    render(<FeedProbe lessonId="les_1" />);
    await waitFor(() => expect(screen.getByTestId('health').textContent).toBe('live'));
    expect(stageCallCount).toBe(1);

    // 教师发起投票 → 服务端 emit classroom:quick_poll_started
    stageResponses.push({
      stage: 'IN_CLASS_TEACHING',
      checkinCode: null,
      activePoll: { id: 'poll_1', title: 'T' },
      activeBuzzer: null,
      pacing: { TOO_FAST: 0, CONFUSED: 0, CLEAR: 0 },
    });
    await act(async () => {
      fakeSocket.fire('classroom:quick_poll_started', { lessonId: 'les_1' });
      await new Promise((r) => setTimeout(r, 200));
    });

    await waitFor(() => expect(screen.getByTestId('poll').textContent).toBe('poll_1'));
    expect(stageCallCount).toBe(2);
  });

  it('忽略其它课节的事件', async () => {
    render(<FeedProbe lessonId="les_1" />);
    await waitFor(() => expect(stageCallCount).toBe(1));

    stageResponses.push({
      stage: 'IN_CLASS_TEACHING',
      checkinCode: null,
      activePoll: { id: 'other' },
      activeBuzzer: null,
      pacing: { TOO_FAST: 0, CONFUSED: 0, CLEAR: 0 },
    });
    await act(async () => {
      fakeSocket.fire('classroom:quick_poll_started', { lessonId: 'les_DIFFERENT' });
      await new Promise((r) => setTimeout(r, 200));
    });

    expect(screen.getByTestId('poll').textContent).toBe('none');
    expect(stageCallCount).toBe(1);
  });

  it('密集事件被合并成一次刷新（不会打出一串请求）', async () => {
    render(<FeedProbe lessonId="les_1" />);
    await waitFor(() => expect(stageCallCount).toBe(1));

    await act(async () => {
      fakeSocket.fire('classroom:pacing_updated', { lessonId: 'les_1' });
      fakeSocket.fire('classroom:feed_appended', { lessonId: 'les_1' });
      fakeSocket.fire('classroom:quick_poll_updated', { lessonId: 'les_1' });
      fakeSocket.fire('classroom:countdown_updated', { lessonId: 'les_1' });
      await new Promise((r) => setTimeout(r, 200));
    });

    // 4 个事件 → 只应触发 1 次拉取
    expect(stageCallCount).toBe(2);
  });

  it('断连 → health 变为 reconnecting，重连后恢复 live 并补一次同步', async () => {
    render(<FeedProbe lessonId="les_1" />);
    await waitFor(() => expect(screen.getByTestId('health').textContent).toBe('live'));

    await act(async () => {
      fakeSocket.fire('disconnect');
    });
    expect(screen.getByTestId('health').textContent).toBe('reconnecting');

    await act(async () => {
      fakeSocket.fire('connect');
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByTestId('health').textContent).toBe('live');
    // 重连后必须补一次全量同步，否则断连期间的事件就永久丢了
    expect(stageCallCount).toBeGreaterThanOrEqual(2);
  });

  it('拉取失败不清空已有数据（保留上一帧好数据）', async () => {
    render(<FeedProbe lessonId="les_1" />);
    await waitFor(() => expect(stageCallCount).toBe(1));

    fetchShouldFail = true;
    await act(async () => {
      fakeSocket.fire('classroom:buzzer_ready', { lessonId: 'les_1' });
      await new Promise((r) => setTimeout(r, 200));
    });

    // 数据没被清空，health 暴露异常
    expect(screen.getByTestId('stage').textContent).toBe('IN_CLASS_TEACHING');
    expect(screen.getByTestId('health').textContent).toBe('reconnecting');
  });

  it('无 socket 实例时退化为纯轮询，功能不缺失', async () => {
    setSocketInstance(null as any);
    render(<FeedProbe lessonId="les_1" />);
    await waitFor(() => expect(stageCallCount).toBe(1));
    expect(screen.getByTestId('health').textContent).toBe('polling');
  });

  it('lessonId 为空时不发请求', async () => {
    render(<FeedProbe lessonId={null} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(stageCallCount).toBe(0);
  });

  it('卸载时清理所有 socket 监听（不泄漏）', async () => {
    const { unmount } = render(<FeedProbe lessonId="les_1" />);
    await waitFor(() => expect(stageCallCount).toBe(1));
    expect(fakeSocket.count('classroom:quick_poll_started')).toBe(1);

    unmount();
    expect(fakeSocket.count('classroom:quick_poll_started')).toBe(0);
    expect(fakeSocket.count('connect')).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────
function WindowProbe({ onReady }: { onReady?: (api: ReturnType<typeof useStageDisplayWindow>) => void }) {
  const api = useStageDisplayWindow();
  onReady?.(api);
  return (
    <div>
      <button
        data-testid="open"
        onClick={() => api.openStageWindow({ lessonId: 'les_1', lessonTitle: '力学', lang: 'zh' })}
      >
        打开大屏展台
      </button>
      <span data-testid="fallback">{String(api.fallbackOpen)}</span>
      <span data-testid="blocked">{String(api.blocked)}</span>
    </div>
  );
}

describe('useStageDisplayWindow · 新开窗口', () => {
  it('点击后调用 window.open，且 URL 带 mode=stage_display 与 lessonId', async () => {
    const openMock = vi.fn().mockReturnValue({ focus: vi.fn(), closed: false });
    (window as any).open = openMock;

    render(<WindowProbe />);
    fireEvent.click(screen.getByTestId('open'));

    expect(openMock).toHaveBeenCalledTimes(1);
    const url = String(openMock.mock.calls[0][0]);
    expect(url).toContain('mode=stage_display');
    expect(url).toContain('lessonId=les_1');
    expect(url).toContain('title=%E5%8A%9B%E5%AD%A6');
  });

  it('窗口已开着时复用并聚焦，不再开第二个', () => {
    const focus = vi.fn();
    const openMock = vi.fn().mockReturnValue({ focus, closed: false });
    (window as any).open = openMock;

    render(<WindowProbe />);
    fireEvent.click(screen.getByTestId('open'));
    fireEvent.click(screen.getByTestId('open'));
    fireEvent.click(screen.getByTestId('open'));

    expect(openMock).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(3);
  });

  it('弹窗被拦截：降级为同页模态框并提示教师', () => {
    (window as any).open = vi.fn().mockReturnValue(null);

    render(<WindowProbe />);
    fireEvent.click(screen.getByTestId('open'));

    expect(screen.getByTestId('fallback').textContent).toBe('true');
    expect(screen.getByTestId('blocked').textContent).toBe('true');
  });

  it('window.open 抛异常时同样降级（不崩）', () => {
    (window as any).open = vi.fn(() => {
      throw new Error('blocked by policy');
    });

    render(<WindowProbe />);
    expect(() => fireEvent.click(screen.getByTestId('open'))).not.toThrow();
    expect(screen.getByTestId('fallback').textContent).toBe('true');
  });

  it('教师手动关掉标签页后，再次点击能重新打开新窗口', () => {
    const openMock = vi
      .fn()
      .mockReturnValueOnce({ focus: vi.fn(), closed: true })
      .mockReturnValueOnce({ focus: vi.fn(), closed: false });
    (window as any).open = openMock;

    render(<WindowProbe />);
    fireEvent.click(screen.getByTestId('open'));
    fireEvent.click(screen.getByTestId('open'));

    expect(openMock).toHaveBeenCalledTimes(2);
  });
});
