/**
 * 大屏展台 · 数据真实性防回归
 *
 * 背景：审计发现展台存在多处写死的假数据（60 FPS 五边形 SVG、量规均分 95.3、
 * 已同步 32 台、投票选项兜底 A/B/C/D）。大屏是投给全班看的，编造的数字会
 * 直接误导所有学生和教师。本文件锁定「没有真实数据就不编」。
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';

import { StageDisplayView } from '../stage-display/StageDisplayView';
import { StageAttendanceCard, StageCoursewareCard, StageFeedCard } from '../stage-display/StageRealDataCards';
import { weightedRubricAverage } from '../peer-review/PeerReviewShowcaseModal';
import { summarizeWorkContent } from '../hooks/usePeerReviewData';
import { setSocketInstance } from '../../../services/socket-service';

type Handler = (...args: any[]) => void;
function createFakeSocket() {
  const handlers = new Map<string, Handler[]>();
  return {
    connected: true,
    on: vi.fn(function (this: any, e: string, h: Handler) {
      const l = handlers.get(e) ?? [];
      l.push(h);
      handlers.set(e, l);
      return this;
    }),
    off: vi.fn((e: string, h: Handler) =>
      handlers.set(
        e,
        (handlers.get(e) ?? []).filter((x) => x !== h),
      ),
    ),
    emit: vi.fn(),
    fire: (e: string, p?: any) => {
      for (const h of [...(handlers.get(e) ?? [])]) h(p);
    },
  };
}

let fakeSocket: ReturnType<typeof createFakeSocket>;
let stageData: any;

const realFrame = () => ({
  stage: 'IN_CLASS_TEACHING',
  checkinCode: '4821',
  activePoll: { id: 'p1', title: '真题', options: ['A', 'B'], totalVotes: 20, distribution: { A: 12, B: 8 } },
  activeBuzzer: null,
  pacing: { TOO_FAST: 2, CONFUSED: 1, CLEAR: 9 },
  classId: 'c1',
  sessionId: 's1',
  attendance: { online: 30, onlineInClass: 28, expected: 32, attended: 25 },
  feed: [{ id: 'f1', type: 'quiz_answered', message: '提交了随堂测', actorName: '小明', at: Date.now() }],
  courseware: { attempts: 40, participants: 25, completed: 18, avgCompletion: 73 },
  exitTicketSubmitted: 0,
});

beforeEach(() => {
  stageData = realFrame();
  fakeSocket = createFakeSocket();
  setSocketInstance(fakeSocket as any);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('/api/classroom/stage/')) return { ok: true, json: async () => stageData } as any;
      if (u.includes('/api/auth/session'))
        return { ok: true, json: async () => ({ session: { name: '李老师' } }) } as any;
      return { ok: true, json: async () => [] } as any;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setSocketInstance(null as any);
});

describe('真实数据卡片', () => {
  it('出勤卡展示真实数字与比率', () => {
    render(<StageAttendanceCard attendance={{ online: 30, onlineInClass: 28, expected: 32, attended: 25 }} />);
    expect(screen.getByTestId('stage-attendance-online').textContent).toContain('28');
    // 实到率 25/32 ≈ 78%
    expect(screen.getByText('78%')).toBeDefined();
  });

  it('【关键】无班级名单时不显示 0%，改为明确说明', () => {
    render(<StageAttendanceCard attendance={{ online: 5, onlineInClass: 5, expected: 0, attended: 0 }} />);
    // 0% 会被误读成「无人到课」
    expect(screen.queryByText('0%')).toBeNull();
    expect(screen.getByText(/未绑定班级名单/)).toBeDefined();
  });

  it('课件卡展示真实参与数据', () => {
    render(<StageCoursewareCard stats={{ attempts: 40, participants: 25, completed: 18, avgCompletion: 73 }} />);
    expect(screen.getByText('25')).toBeDefined();
    expect(screen.getByText('18')).toBeDefined();
    expect(screen.getByText('73%')).toBeDefined();
  });

  it('【关键】无课件数据时说明原因，不显示 0 值假指标', () => {
    render(<StageCoursewareCard stats={{ attempts: 0, participants: 0, completed: 0, avgCompletion: 0 }} />);
    expect(screen.getByText(/还没有学生打开互动课件/)).toBeDefined();
  });

  it('动态流展示真实事件', () => {
    render(
      <StageFeedCard
        feed={[{ id: 'f1', type: 'quiz_answered', message: '提交了随堂测', actorName: '小明', at: Date.now() }]}
      />,
    );
    expect(screen.getByText('小明')).toBeDefined();
    expect(screen.getByText(/提交了随堂测/)).toBeDefined();
  });

  it('【关键】无动态时说明而非空白', () => {
    render(<StageFeedCard feed={[]} />);
    expect(screen.getByText(/课堂动态会在学生答题/)).toBeDefined();
  });
});

describe('weightedRubricAverage · 清除写死均分', () => {
  it('无维度数据时返回 null（UI 显示 —，不再是 95.3）', () => {
    expect(weightedRubricAverage([])).toBeNull();
    expect(weightedRubricAverage(undefined)).toBeNull();
  });

  it('按权重计算真实均分', () => {
    const dims = [
      { id: 'a', name: '内容', score: 90, weight: 60 },
      { id: 'b', name: '表达', score: 70, weight: 40 },
    ] as any;
    expect(weightedRubricAverage(dims)).toBe(82);
  });

  it('维度缺少权重或得分时不算（不臆造）', () => {
    expect(weightedRubricAverage([{ id: 'a', name: 'X', score: 90 }] as any)).toBeNull();
    expect(weightedRubricAverage([{ id: 'a', name: 'X', weight: 50 }] as any)).toBeNull();
  });
});

describe('summarizeWorkContent · 作品预览用真实作答', () => {
  it('提取代码内容（替换原写死五边形 SVG 的数据源）', () => {
    const r = summarizeWorkContent([
      { eventType: 'submit', payload: { code: 'function f() {\n  return 1;\n}', score: 90 } },
    ]);
    expect(r.kind).toBe('code');
    expect(r.lines[0].text).toContain('function f()');
  });

  it('提取结构化答案', () => {
    const r = summarizeWorkContent([{ eventType: 'submit', payload: { q1: 'A', q2: 'B', q3: 'C', q4: 'D' } }]);
    expect(r.kind).toBe('structured');
    expect(r.lines.length).toBe(4);
  });

  it('提取纯文本作答', () => {
    const r = summarizeWorkContent([{ eventType: 'submit', payload: { content: '我认为力的作用是相互的' } }]);
    expect(r.kind).toBe('text');
    expect(r.lines[0].text).toContain('相互');
  });

  it('无内容时返回 empty（UI 明确说明，不画假图形）', () => {
    expect(summarizeWorkContent([]).kind).toBe('empty');
    expect(summarizeWorkContent([{ eventType: 'x', payload: {} }]).kind).toBe('empty');
  });
});

describe('StageDisplayView · 端到端真实性', () => {
  it('渲染真实出勤 / 课件 / 动态数据', async () => {
    render(<StageDisplayView lessonId="les_1" lessonTitle="力学" lang="zh" />);
    await waitFor(() => expect(screen.getByTestId('stage-connection-badge')).toBeTruthy());

    expect(screen.getByTestId('stage-attendance-online').textContent).toContain('28');
    // 实到 25（出勤卡）与课件参与人数 25 会同时出现，用 testid 精确锚定出勤卡
    expect(screen.getByText('已到课')).toBeDefined();
    expect(screen.getByText(/参与人数/)).toBeDefined();
    expect(screen.getByText(/提交了随堂测/)).toBeDefined();
  });

  it('【关键】投票只渲染接口返回的真实选项，不兜底 A/B/C/D', async () => {
    render(<StageDisplayView lessonId="les_1" lessonTitle="力学" lang="zh" />);
    await waitFor(() => expect(screen.getByTestId('stage-connection-badge')).toBeTruthy());

    expect(screen.getByText('真题')).toBeDefined();
    // 真实选项是 A、B
    expect(screen.getAllByText('选项 A').length).toBeGreaterThan(0);
    expect(screen.getAllByText('选项 B').length).toBeGreaterThan(0);
    // 不得出现 C、D
    expect(screen.queryByText('选项 C')).toBeNull();
    expect(screen.queryByText('选项 D')).toBeNull();
  });

  it('【关键】投票 options 缺失时不画假选项条', async () => {
    stageData = { ...realFrame(), activePoll: { id: 'p1', title: '无选项数据', totalVotes: 0, distribution: {} } };
    render(<StageDisplayView lessonId="les_1" lessonTitle="力学" lang="zh" />);
    await waitFor(() => expect(screen.getByTestId('stage-connection-badge')).toBeTruthy());

    expect(screen.queryByText('选项 A')).toBeNull();
    expect(screen.queryByText('选项 B')).toBeNull();
  });

  it('无互动进行时展示明确的等待态（而不是空白或假内容）', async () => {
    stageData = {
      ...realFrame(),
      activePoll: null,
      activeBuzzer: null,
      feed: [],
    };
    render(<StageDisplayView lessonId="les_1" lessonTitle="力学" lang="zh" />);
    await waitFor(() => expect(screen.getByTestId('stage-connection-badge')).toBeTruthy());

    expect(screen.getByText('等待课堂互动')).toBeDefined();
  });
});
