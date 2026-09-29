/**
 * 大屏展台 · 状态变化提示（纯函数 diff）
 *
 * 这是「课程状态改变时给出相应提示」的核心：投影上无人操作，
 * 提示漏了教师就不知道投票结束了 / 环节推进了。
 */
import { describe, it, expect } from 'vitest';
import { diffStageNotices, connectionNotice, stageLabel, type StageDisplayData } from '../stage-display/stage-notices';

function frame(over: Partial<StageDisplayData> = {}): StageDisplayData {
  return {
    stage: 'IN_CLASS_TEACHING',
    checkinCode: null,
    activePoll: null,
    activeBuzzer: null,
    pacing: { TOO_FAST: 0, CONFUSED: 0, CLEAR: 0 },
    ...over,
  };
}

const poll = (id: string, totalVotes = 0) => ({ id, title: '快问快答', options: ['A', 'B'], totalVotes });
const buzzer = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: '抢答',
  status,
  ...extra,
});

describe('diffStageNotices · 环节推进', () => {
  it('首帧不产生提示（首次加载不是"变化"）', () => {
    const notices = diffStageNotices(null, frame(), { lang: 'zh' });
    expect(notices).toHaveLength(0);
  });

  it('显式 isFirstFrame 时也不提示', () => {
    const notices = diffStageNotices(frame(), frame({ stage: 'WRAP_UP_EXIT_TICKET' }), { isFirstFrame: true });
    expect(notices).toHaveLength(0);
  });

  it('阶段推进到结课通票：accent 提示 + 提醒学生填通票', () => {
    const notices = diffStageNotices(frame(), frame({ stage: 'WRAP_UP_EXIT_TICKET' }), { lang: 'zh' });
    expect(notices).toHaveLength(1);
    expect(notices[0].tone).toBe('accent');
    expect(notices[0].title).toContain('结课通票');
    expect(notices[0].detail).toContain('60 秒结课通票');
    expect(notices[0].dedupeKey).toBe('stage:WRAP_UP_EXIT_TICKET');
  });

  it('阶段推进到归档：warning 提示', () => {
    const notices = diffStageNotices(frame(), frame({ stage: 'ARCHIVED_REPORT' }), { lang: 'zh' });
    expect(notices).toHaveLength(1);
    expect(notices[0].tone).toBe('warning');
  });

  it('阶段未变则不提示', () => {
    expect(diffStageNotices(frame(), frame({ stage: 'IN_CLASS_TEACHING' }))).toHaveLength(0);
  });
});

describe('diffStageNotices · 极速投票', () => {
  it('投票开始：提示并带出题目', () => {
    const notices = diffStageNotices(frame(), frame({ activePoll: poll('p1') }), { lang: 'zh' });
    expect(notices).toHaveLength(1);
    expect(notices[0].dedupeKey).toBe('poll-start:p1');
    expect(notices[0].detail).toBe('快问快答');
  });

  it('投票结束（消失）：提示并带出作答人数', () => {
    const notices = diffStageNotices(frame({ activePoll: poll('p1', 23) }), frame(), { lang: 'zh' });
    expect(notices).toHaveLength(1);
    expect(notices[0].dedupeKey).toBe('poll-end:p1');
    expect(notices[0].detail).toContain('23 人作答');
  });

  it('同一投票仍在进行（只是票数变了）不提示', () => {
    const notices = diffStageNotices(frame({ activePoll: poll('p1', 5) }), frame({ activePoll: poll('p1', 9) }), {
      lang: 'zh',
    });
    expect(notices).toHaveLength(0);
  });

  it('换了一道新题：提示开始', () => {
    const notices = diffStageNotices(frame({ activePoll: poll('p1') }), frame({ activePoll: poll('p2') }), {
      lang: 'zh',
    });
    expect(notices).toHaveLength(1);
    expect(notices[0].dedupeKey).toBe('poll-start:p2');
  });
});

describe('diffStageNotices · 抢答器', () => {
  it('抢答开始：提示', () => {
    const notices = diffStageNotices(frame(), frame({ activeBuzzer: buzzer('b1', 'READY') }), { lang: 'zh' });
    expect(notices).toHaveLength(1);
    expect(notices[0].dedupeKey).toBe('buzz-start:b1');
  });

  it('产生赢家：success 提示，带姓名与毫秒数', () => {
    const notices = diffStageNotices(
      frame({ activeBuzzer: buzzer('b1', 'READY') }),
      frame({ activeBuzzer: buzzer('b1', 'LOCKED', { winnerName: '小明', responseTimeMs: 812 }) }),
      { lang: 'zh' },
    );
    expect(notices).toHaveLength(1);
    expect(notices[0].tone).toBe('success');
    expect(notices[0].dedupeKey).toBe('buzz-winner:b1');
    expect(notices[0].detail).toContain('小明');
    expect(notices[0].detail).toContain('812');
  });

  it('抢答重置（LOCKED → READY）：提示可开始新一轮', () => {
    const notices = diffStageNotices(
      frame({ activeBuzzer: buzzer('b1', 'LOCKED', { winnerName: '小明' }) }),
      frame({ activeBuzzer: buzzer('b1', 'READY') }),
      { lang: 'zh' },
    );
    expect(notices).toHaveLength(1);
    expect(notices[0].dedupeKey).toBe('buzz-reset:b1');
  });

  it('已 LOCKED 又 LOCKED：不重复提示赢家', () => {
    const locked = buzzer('b1', 'LOCKED', { winnerName: '小明' });
    expect(diffStageNotices(frame({ activeBuzzer: locked }), frame({ activeBuzzer: locked }))).toHaveLength(0);
  });
});

describe('diffStageNotices · 组合场景', () => {
  it('阶段推进 + 新投票同时发生：两条提示都出', () => {
    const notices = diffStageNotices(frame(), frame({ stage: 'WRAP_UP_EXIT_TICKET', activePoll: poll('p1') }), {
      lang: 'zh',
    });
    expect(notices).toHaveLength(2);
    expect(notices.map((n) => n.dedupeKey)).toEqual(
      expect.arrayContaining(['stage:WRAP_UP_EXIT_TICKET', 'poll-start:p1']),
    );
  });

  it('每条提示都有唯一 id（React key 可用）', () => {
    const notices = diffStageNotices(frame(), frame({ stage: 'WRAP_UP_EXIT_TICKET', activePoll: poll('p1') }), {
      lang: 'zh',
    });
    expect(new Set(notices.map((n) => n.id)).size).toBe(notices.length);
  });
});

describe('connectionNotice', () => {
  it('连接断开：warning 提示，说明已降级轮询', () => {
    const n = connectionNotice('reconnecting', 'live', 'zh');
    expect(n?.tone).toBe('warning');
    expect(n?.title).toContain('重连');
    expect(n?.detail).toContain('轮询');
  });

  it('重连成功：success 提示', () => {
    const n = connectionNotice('live', 'reconnecting', 'zh');
    expect(n?.tone).toBe('success');
  });

  it('健康度未变化：不提示（避免刷屏）', () => {
    expect(connectionNotice('live', 'live', 'zh')).toBeNull();
    expect(connectionNotice('polling', 'polling', 'zh')).toBeNull();
  });
});

describe('stageLabel', () => {
  it('中英文均能解析，未知值原样返回', () => {
    expect(stageLabel('WRAP_UP_EXIT_TICKET', 'zh')).toContain('结课通票');
    expect(stageLabel('WRAP_UP_EXIT_TICKET', 'en')).toBe('Wrap-Up & Exit Ticket');
    expect(stageLabel('UNKNOWN_STAGE', 'zh')).toBe('UNKNOWN_STAGE');
  });
});
