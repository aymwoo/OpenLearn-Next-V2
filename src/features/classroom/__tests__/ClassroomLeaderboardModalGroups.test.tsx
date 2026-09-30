import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import { ClassroomLeaderboardModal } from '../ClassroomLeaderboardModal';
import { setSocketInstance } from '../../../services/socket-service';
import type { StudentProfile } from '../ClassroomAttributionModal';

/**
 * 小组联赛改读 `GET /api/classes/:id/groups`（`class_groups` 表）。
 *
 * 此前按 `students[].groupName` 自行 `useMemo` 分组，而 **`students.group_name`
 * 全仓从未被写入** —— 分组页一直只渲染出一个「未分组」桶。两套数据源互不相通，
 * 这也是 `classroom:groups_changed` 有 producer 却接不上消费端的根因。
 *
 * 组件现有的「不编造」原则必须保留：没有分组数据时展示空态，
 * 而不是回退到另一套（恒空的）数据源或编造队名。
 */

const handlers = new Map<string, Array<(data: unknown) => void>>();

const fakeSocket = {
  on: (evt: string, h: (data: unknown) => void) => handlers.set(evt, [...(handlers.get(evt) ?? []), h]),
  off: (evt: string, h: (data: unknown) => void) =>
    handlers.set(evt, (handlers.get(evt) ?? []).filter((x) => x !== h)),
  emit: vi.fn(),
};

function fireSocket(evt: string, data: unknown) {
  act(() => {
    for (const h of handlers.get(evt) ?? []) h(data);
  });
}

const students: StudentProfile[] = [
  { id: 's1', name: '张明', studentNo: '101', currentPoints: 10 },
  { id: 's2', name: '李华', studentNo: '102', currentPoints: 4 },
  { id: 's3', name: '王超', studentNo: '103', currentPoints: 7 },
];

const groupResponse = [
  { id: 'g1', name: '飞鹰队', name_en: 'Falcons', color: 'bg-indigo-500', memberIds: ['s1', 's2'], leader_id: 's1' },
  { id: 'g2', name: '猛虎队', name_en: 'Tigers', color: 'bg-rose-500', memberIds: ['s3'], leader_id: 's3' },
];

describe('ClassroomLeaderboardModal — 小组联赛改读 class_groups', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    handlers.clear();
    fakeSocket.emit.mockClear();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => groupResponse });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const renderModal = (extra: Record<string, unknown> = {}) =>
    render(
      <ClassroomLeaderboardModal
        isOpen
        onClose={vi.fn()}
        classId="C1"
        lessonId="L1"
        students={students}
        lang="zh"
        {...extra}
      />,
    );

  it('渲染服务端返回的真实分组与成员（而非按 groupName 归并）', async () => {
    renderModal();

    expect(await screen.findByText('飞鹰队')).toBeDefined();
    expect(screen.getByText('猛虎队')).toBeDefined();
    // 两组 → 不应出现「未分组」桶
    expect(screen.queryByText('未分组')).toBeNull();
    // 真实总分 = 组内成员积分之和
    expect(screen.getByText('14')).toBeDefined(); // 10 + 4
    expect(screen.getByText('7')).toBeDefined(); // 王超
  });

  it('请求打在班级分组接口上', async () => {
    renderModal();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/classes/C1/groups');
    });
  });

  it('接口返回空数组 → 展示空态，绝不编造队名', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    renderModal();

    expect(await screen.findByText('本班尚未配置分组方案')).toBeDefined();
    expect(screen.queryByText('飞鹰队')).toBeNull();
  });

  it('接口失败 → 保持空态而不是抛错或回退到另一套数据源', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    renderModal();

    expect(await screen.findByText('本班尚未配置分组方案')).toBeDefined();
  });

  it('已转学的成员（不在花名册）被安全忽略', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'g1', name: '飞鹰队', memberIds: ['s1', 'GONE'] }],
    });
    renderModal();

    expect(await screen.findByText('飞鹰队')).toBeDefined();
    // 仅剩 s1 的 10 分（若把 GONE 算进去会因 undefined 积分得到 NaN）
    expect(screen.getByText('10')).toBeDefined();
  });

  it('groups_changed 事件触发重拉（socket 晚到也能生效）', async () => {
    renderModal();
    await screen.findByText('飞鹰队');

    // 教师改了分组方案
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'g3', name: '新组建队', memberIds: ['s1'] }],
    });

    await act(async () => {
      setSocketInstance(fakeSocket as never);
    });
    await act(async () => {
      fireSocket('classroom:groups_changed', { classId: 'C1', scope: 'default', source: 'teacher' });
    });

    expect(await screen.findByText('新组建队')).toBeDefined();
  });

  it('groups_changed 属于别的班级时被忽略', async () => {
    renderModal();
    await screen.findByText('飞鹰队');
    const before = fetchMock.mock.calls.length;

    await act(async () => {
      setSocketInstance(fakeSocket as never);
    });
    await act(async () => {
      fireSocket('classroom:groups_changed', { classId: 'OTHER' });
    });

    expect(fetchMock.mock.calls.length).toBe(before);
    expect(screen.getByText('飞鹰队')).toBeDefined();
  });

  it('个人榜的小组标签也用同一真源（不再读恒空的 students.groupName）', async () => {
    renderModal();

    await screen.findByText('飞鹰队');
    fireSocket('noop', {}); // 触发一次 act 包裹
    const teamsTab = screen.getByText('个人英雄榜');
    await act(async () => {
      teamsTab.click();
    });

    // 张明属于「飞鹰队」，标签应来自 class_groups 而非恒空的 groupName
    expect(await screen.findAllByText('飞鹰队')).not.toHaveLength(0);
  });
});
