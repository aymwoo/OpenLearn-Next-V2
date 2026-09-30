import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { PreClassDiagnosticHub } from '../PreClassDiagnosticHub';
import { setSocketInstance } from '../../../services/socket-service';

/**
 * 教师端破冰心情统计的实时更新。
 *
 * 此前 `classroom:icebreaker_updated` 全平台无监听：学生打卡后，教师只能重新加载
 * 页面才看到统计变化。而这个 UI 只存在于教师端（`LiveClassroomView` 仅由
 * `TeacherView` 挂载）—— 学生只打卡、不看统计。
 *
 * 事件 payload 自带 stats，故直接采用而不必重拉诊断接口。
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

const diagnosticResponse = {
  lessonId: 'L1',
  lessonTitle: '第一课',
  prepSummary: {
    totalStudents: 10,
    completedCount: 0,
    pendingCount: 10,
    completionRate: 0,
    averageTimeSpentMins: 0,
  },
  topMistakes: [],
  studentDistribution: { tierA_mastered: 0, tierB_consolidating: 0, tierC_needSupport: 10 },
  icebreakerStats: { fullPower: 1, needCoffee: 0, needHelp: 0 },
};

describe('PreClassDiagnosticHub — 破冰统计实时更新', () => {
  beforeEach(() => {
    handlers.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => diagnosticResponse }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('socket 晚于组件出现时也能收到统计更新', async () => {
    // 组件先渲染（socket 尚未注入）→ 再注入，模拟真实的 effect 执行顺序
    render(<PreClassDiagnosticHub lessonId="L1" classId="C1" />);
    await act(async () => {
      setSocketInstance(fakeSocket as never);
    });

    // 1 人满电 → 3 人满电 / 2 人需咖啡，百分比应随之变化
    fire('classroom:icebreaker_updated', {
      classId: 'C1',
      stats: { fullPower: 3, needCoffee: 2, needHelp: 0 },
    });

    expect(screen.getByText(/⚡ 60%/)).toBeDefined();
    expect(screen.getByText(/☕ 40%/)).toBeDefined();
  });

  it('按 classId 过滤：别的班的统计不会污染本页', async () => {
    await act(async () => {
      setSocketInstance(fakeSocket as never);
    });
    render(<PreClassDiagnosticHub lessonId="L1" classId="C1" />);

    fire('classroom:icebreaker_updated', {
      classId: 'OTHER_CLASS',
      stats: { fullPower: 99, needCoffee: 0, needHelp: 0 },
    });

    // 接口快照是 1 人满电 / 0 需咖啡 → 仍显示 100%，未被 99 覆盖
    expect(await screen.findByText(/⚡ 100%/)).toBeDefined();
  });

  it('缺 stats 的畸形 payload 被忽略', async () => {
    await act(async () => {
      setSocketInstance(fakeSocket as never);
    });
    render(<PreClassDiagnosticHub lessonId="L1" classId="C1" />);

    fire('classroom:icebreaker_updated', { classId: 'C1' });

    expect(await screen.findByText(/⚡ 100%/)).toBeDefined();
  });

  it('卸载时解绑监听', async () => {
    await act(async () => {
      setSocketInstance(fakeSocket as never);
    });
    const { unmount } = render(<PreClassDiagnosticHub lessonId="L1" classId="C1" />);
    expect(handlers.get('classroom:icebreaker_updated')?.length).toBe(1);

    unmount();
    expect(handlers.get('classroom:icebreaker_updated')?.length ?? 0).toBe(0);
  });
});
