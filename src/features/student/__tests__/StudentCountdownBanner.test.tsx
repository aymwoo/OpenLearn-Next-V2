import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { StudentCountdownBanner } from '../StudentCountdownBanner';
import { setSocketInstance } from '../../../services/socket-service';

/**
 * 学生端倒计时横幅的两处修复：
 *
 * 1. 直接订阅服务端唯一权威广播 `classroom:countdown_updated`。此前本组件的三个
 *    数据源分别只覆盖「同机 BroadcastChannel / 同文档 window 事件 / 挂载那一瞬的
 *    GET」，而教师端大屏（`useStageDisplayFeed`）监听了这个 socket 事件 —— 于是
 *    **教师中途启动的倒计时，远程学生永远看不到**。
 *    事件投递到常驻课堂广播房间（覆盖全平台客户端），故必须按 lessonId 过滤。
 *
 * 2. `hasFinishedAlerted` 复位。此前它一旦置 true 就再无复位路径：第二次倒计时
 *    结束不再响提示音，且横幅永久停在「时间已截止」。
 */

const handlers = new Map<string, Array<(data: unknown) => void>>();

const fakeSocket = {
  on: (evt: string, h: (data: unknown) => void) => handlers.set(evt, [...(handlers.get(evt) ?? []), h]),
  off: (evt: string, h: (data: unknown) => void) =>
    handlers.set(evt, (handlers.get(evt) ?? []).filter((x) => x !== h)),
  emit: vi.fn(),
};

function fire(evt: string, data: unknown) {
  act(() => {
    for (const h of handlers.get(evt) ?? []) h(data);
  });
}

const countdown = (over: Record<string, unknown> = {}) => ({
  lessonId: 'L1',
  totalDuration: 300,
  timeRemaining: 120,
  isRunning: true,
  isPaused: false,
  label: '课堂限时任务',
  endsAt: Date.now() + 120_000,
  updatedAt: Date.now(),
  ...over,
});

describe('StudentCountdownBanner — 服务端权威事件 + 提示音复位', () => {
  beforeEach(() => {
    handlers.clear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('socket 晚于组件出现（子 effect 先于父 effect）时也能收到倒计时', async () => {
    // 先渲染（此刻 socket 还没注入），再注入 —— 模拟真实的 React effect 执行顺序
    render(<StudentCountdownBanner lessonId="L1" lang="zh" />);
    expect(screen.queryByText('课堂限时任务')).toBeNull();

    await act(async () => {
      setSocketInstance(fakeSocket as never);
    });

    fire('classroom:countdown_updated', countdown());
    expect(screen.getByText('课堂限时任务')).toBeDefined();
  });

  it('按 lessonId 过滤：其它课节的倒计时不会污染本课节横幅', async () => {
    await act(async () => {
      setSocketInstance(fakeSocket as never);
    });
    render(<StudentCountdownBanner lessonId="L1" lang="zh" />);

    fire('classroom:countdown_updated', countdown({ lessonId: 'OTHER', label: '别的课节' }));
    expect(screen.queryByText('别的课节')).toBeNull();

    fire('classroom:countdown_updated', countdown({ label: '本课节任务' }));
    expect(screen.getByText('本课节任务')).toBeDefined();
  });

  it('新一轮倒计时会复位「已响过结束提示音」的标记，横幅不再卡在已截止', async () => {
    await act(async () => {
      setSocketInstance(fakeSocket as never);
    });
    render(<StudentCountdownBanner lessonId="L1" lang="zh" />);

    // 第一轮：1 秒后结束。推进本地墙钟 → tick effect 触发提示音并置标记
    fire('classroom:countdown_updated', countdown({ timeRemaining: 1, endsAt: Date.now() + 1_000 }));
    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    expect(screen.getByText(/时间已截止/)).toBeDefined();

    // 第二轮：新的 endsAt → 标记复位，横幅恢复运行态
    // （此前 hasFinishedAlerted 永不复位，横幅会永久停在「时间已截止」）
    fire('classroom:countdown_updated', countdown({ timeRemaining: 60, endsAt: Date.now() + 60_000 }));

    // 注意：不能用 waitFor —— 假定时器下它会挂起；fire() 已包在 act 里，DOM 同步更新
    expect(screen.queryByText(/时间已截止/)).toBeNull();
    expect(screen.getByText('课堂限时任务')).toBeDefined();
  });
});

