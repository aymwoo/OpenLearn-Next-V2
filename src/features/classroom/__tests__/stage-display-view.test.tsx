/**
 * 大屏展台独立窗口 · 端到端
 *
 * 串起整条链路：Socket 事件 → 拉取最新数据 → 状态变化 diff → 提示浮层出现。
 * 这正是「当课程状态改变的时候给出相应的提示」的验收点。
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';

import { StageDisplayView } from '../stage-display/StageDisplayView';
import { setSocketInstance } from '../../../services/socket-service';

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
      handlers.set(
        evt,
        (handlers.get(evt) ?? []).filter((x) => x !== h),
      );
    }),
    emit: vi.fn(),
    fire: (evt: string, payload?: any) => {
      for (const h of [...(handlers.get(evt) ?? [])]) h(payload);
    },
  };
}

let fakeSocket: ReturnType<typeof createFakeSocket>;
let current: any;
let failNext = false;

const base = () => ({
  stage: 'IN_CLASS_TEACHING',
  checkinCode: null,
  activePoll: null,
  activeBuzzer: null,
  pacing: { TOO_FAST: 0, CONFUSED: 0, CLEAR: 0 },
});

beforeEach(() => {
  current = base();
  failNext = false;
  fakeSocket = createFakeSocket();
  setSocketInstance(fakeSocket as any);

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/classroom/stage/')) {
        if (failNext) {
          failNext = false;
          return { ok: false, status: 500, json: async () => ({}) } as any;
        }
        return { ok: true, json: async () => current } as any;
      }
      return { ok: true, json: async () => ({}) } as any;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setSocketInstance(null as any);
});

/** 推一帧新数据并发出对应事件 */
async function pushFrame(overrides: any, event = 'classroom:stage_changed') {
  current = { ...base(), ...overrides };
  await act(async () => {
    fakeSocket.fire(event, { lessonId: 'les_1' });
    await new Promise((r) => setTimeout(r, 200));
  });
}

describe('StageDisplayView · 端到端', () => {
  it('首帧只同步不出提示（首次加载不是"变化"）', async () => {
    render(<StageDisplayView lessonId="les_1" lessonTitle="力学" lang="zh" />);

    await waitFor(() => expect(screen.getByTestId('stage-connection-badge')).toBeTruthy());
    expect(screen.getByTestId('stage-connection-badge').getAttribute('data-health')).toBe('live');
    expect(screen.queryByTestId('stage-notice')).toBeNull();
  });

  it('环节推进 → 弹出提示', async () => {
    render(<StageDisplayView lessonId="les_1" lessonTitle="力学" lang="zh" />);
    await waitFor(() => expect(screen.getByTestId('stage-connection-badge')).toBeTruthy());

    await pushFrame({ stage: 'WRAP_UP_EXIT_TICKET' });

    const notice = await screen.findByTestId('stage-notice');
    expect(notice.textContent).toContain('结课通票');
    // 顶栏阶段标签也同步更新
    expect(screen.getByText('总结提升 · 结课通票')).toBeTruthy();
  });

  it('投票开始 → 弹出提示，且展台出现投票卡片', async () => {
    render(<StageDisplayView lessonId="les_1" lessonTitle="力学" lang="zh" />);
    await waitFor(() => expect(screen.getByTestId('stage-connection-badge')).toBeTruthy());

    await pushFrame(
      {
        activePoll: {
          id: 'p1',
          title: '光速是多少',
          options: ['A', 'B'],
          totalVotes: 12,
          distribution: { A: 7, B: 5 },
        },
      },
      'classroom:quick_poll_started',
    );

    const notice = await screen.findByTestId('stage-notice');
    expect(notice.textContent).toContain('极速投票已开始');
    expect(notice.textContent).toContain('光速是多少');
    // 提示与展台卡片都会出现标题（预期行为：提示负责告知，卡片负责展示）
    expect(screen.getAllByText('光速是多少').length).toBeGreaterThanOrEqual(2);
  });

  it('抢答产生赢家 → 成功提示 + 展台展示赢家与毫秒数', async () => {
    render(<StageDisplayView lessonId="les_1" lessonTitle="力学" lang="zh" />);
    await waitFor(() => expect(screen.getByTestId('stage-connection-badge')).toBeTruthy());

    await pushFrame({ activeBuzzer: { id: 'b1', title: '抢答', status: 'READY' } }, 'classroom:buzzer_ready');
    await waitFor(() => expect(screen.getByText(/全班抢答中/)).toBeTruthy());

    await pushFrame(
      { activeBuzzer: { id: 'b1', title: '抢答', status: 'LOCKED', winnerName: '小明', responseTimeMs: 736 } },
      'classroom:buzzer_winner',
    );

    await waitFor(() => expect(screen.getByText(/抢答已产生赢家/)).toBeTruthy());
    expect(screen.getByText('小明')).toBeTruthy();
    // 毫秒数同时出现在提示与展台卡片（预期）
    expect(screen.getAllByText(/736 毫秒/).length).toBeGreaterThanOrEqual(2);
  });

  it('断连 → 提示教师，且连接徽标转为 reconnecting；重连后恢复', async () => {
    render(<StageDisplayView lessonId="les_1" lessonTitle="力学" lang="zh" />);
    await waitFor(() => expect(screen.getByTestId('stage-connection-badge').getAttribute('data-health')).toBe('live'));

    await act(async () => {
      fakeSocket.fire('disconnect');
    });

    await waitFor(() =>
      expect(screen.getByTestId('stage-connection-badge').getAttribute('data-health')).toBe('reconnecting'),
    );
    expect((await screen.findAllByTestId('stage-notice')).some((n) => n.textContent?.includes('重连'))).toBe(true);

    await act(async () => {
      fakeSocket.fire('connect');
      await new Promise((r) => setTimeout(r, 50));
    });
    await waitFor(() => expect(screen.getByTestId('stage-connection-badge').getAttribute('data-health')).toBe('live'));
  });

  it('独立窗口不提供关闭按钮（关掉标签页即关闭）', async () => {
    const { container } = render(<StageDisplayView lessonId="les_1" lessonTitle="力学" lang="zh" />);
    await waitFor(() => expect(screen.getByTestId('stage-connection-badge')).toBeTruthy());
    expect(container.querySelector('#stage-close-button')).toBeNull();
    // 全屏与互评入口仍在
    expect(container.querySelector('#stage-fullscreen-toggle')).toBeTruthy();
    expect(container.querySelector('#stage-peer-review-toggle')).toBeTruthy();
  });

  it('未选课节时给出明确的等待态，而不是白屏', () => {
    render(<StageDisplayView lessonId={null} lang="zh" />);
    expect(screen.getByText('大屏展台 · 等待课节')).toBeTruthy();
  });

  it('提示可被手动关闭', async () => {
    render(<StageDisplayView lessonId="les_1" lessonTitle="力学" lang="zh" />);
    await waitFor(() => expect(screen.getByTestId('stage-connection-badge')).toBeTruthy());

    await pushFrame({ stage: 'WRAP_UP_EXIT_TICKET' });
    await screen.findByTestId('stage-notice');

    const closeBtn = screen.getByLabelText('关闭提示');
    await act(async () => {
      closeBtn.click();
    });
    await waitFor(() => expect(screen.queryByTestId('stage-notice')).toBeNull());
  });
});
