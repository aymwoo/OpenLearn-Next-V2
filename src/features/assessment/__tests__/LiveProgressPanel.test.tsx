/**
 * LiveProgressPanel：教师实时作答看板的快照渲染与筛选。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const getAssignmentProgress = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  assessmentApi: { getAssignmentProgress },
  ApiError: class ApiError extends Error {},
}));

vi.mock('../../../services/socket-service', () => ({
  onSocketInstance: () => () => {},
}));

import { LiveProgressPanel } from '../LiveProgressPanel';
import type { AssessmentAssignment } from '../api';

const now = Date.now();

const assignment: AssessmentAssignment & { className: string } = {
  id: 'asg-live',
  assessmentId: 'asm-live',
  classId: 'c1',
  lessonId: null,
  scheduleId: null,
  opensAt: null,
  closesAt: null,
  durationSec: null,
  status: 'open',
  scoreReleased: false,
  academicYear: null,
  createdAt: now,
  className: '高一（1）班',
};

const snapshot = {
  assignmentId: 'asg-live',
  title: '随堂小测',
  kind: 'quiz',
  itemCount: 2,
  totalStudents: 3,
  submittedCount: 1,
  inProgressCount: 1,
  notStartedCount: 1,
  avgScore: 8,
  updatedAt: now,
  students: [
    {
      studentId: 's1',
      name: '张三',
      studentNumber: 'S-01',
      status: 'in_progress',
      score: null,
      proctor: {},
      proctorCounts: { blur: 1, switchTab: 0, fullscreenExit: 0, total: 1 },
      submittedAt: null,
      startedAt: now - 60_000,
      deadlineAt: null,
      answeredCount: 1,
      itemCount: 2,
      progressPercent: 50,
      lastActivityAt: now - 5_000,
    },
    {
      studentId: 's2',
      name: '李四',
      studentNumber: 'S-02',
      status: 'submitted',
      score: 8,
      proctor: {},
      proctorCounts: { blur: 0, switchTab: 0, fullscreenExit: 0, total: 0 },
      submittedAt: now - 30_000,
      startedAt: now - 120_000,
      deadlineAt: null,
      answeredCount: 2,
      itemCount: 2,
      progressPercent: 100,
      lastActivityAt: now - 30_000,
    },
    {
      studentId: 's3',
      name: '王五',
      studentNumber: 'S-03',
      status: 'not_started',
      score: null,
      proctor: null,
      proctorCounts: { blur: 0, switchTab: 0, fullscreenExit: 0, total: 0 },
      submittedAt: null,
      startedAt: null,
      deadlineAt: null,
      answeredCount: 0,
      itemCount: 2,
      progressPercent: 0,
      lastActivityAt: null,
    },
  ],
};

describe('LiveProgressPanel', () => {
  beforeEach(() => {
    getAssignmentProgress.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('渲染实时汇总与逐生答题进度', async () => {
    getAssignmentProgress.mockResolvedValue(snapshot);

    render(<LiveProgressPanel assignment={assignment} lang="zh" onBack={vi.fn()} />);

    expect(await screen.findByText('张三')).toBeTruthy();
    expect(screen.getByText('李四')).toBeTruthy();
    expect(screen.getByText('王五')).toBeTruthy();
    expect(screen.getByText('高一（1）班', { exact: false })).toBeTruthy();

    // 已答 1/2
    expect(screen.getByText('1/2')).toBeTruthy();
    const bar = screen.getByLabelText('张三 已答 1 / 2 题') as HTMLProgressElement;
    expect(bar.value).toBe(1);
    expect(bar.max).toBe(2);

    // 监考异常计数（按 title 描述定位，避免与汇总数字混淆）
    expect(screen.getByTitle(/失焦 1/).textContent).toContain('1');

    await waitFor(() => expect(getAssignmentProgress).toHaveBeenCalledWith('asg-live'));
  });

  it('按状态筛选学生', async () => {
    getAssignmentProgress.mockResolvedValue(snapshot);

    render(<LiveProgressPanel assignment={assignment} lang="zh" onBack={vi.fn()} />);

    await screen.findByText('张三');
    fireEvent.click(screen.getByRole('button', { name: '作答中 1' }));

    expect(screen.getByText('张三')).toBeTruthy();
    expect(screen.queryByText('李四')).toBeNull();
    expect(screen.queryByText('王五')).toBeNull();
  });

  it('拉取失败时显示错误提示', async () => {
    getAssignmentProgress.mockRejectedValue(new Error('网络异常'));

    render(<LiveProgressPanel assignment={assignment} lang="zh" onBack={vi.fn()} />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('网络异常')).toBeTruthy();
  });
});
