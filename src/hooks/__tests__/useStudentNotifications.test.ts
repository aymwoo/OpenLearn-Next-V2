import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStudentNotifications } from '../useStudentNotifications';

const studentDashboardData = {
  assignments: [
    { id: 'a1', title: '函数作业', submission_status: null, created_at: 300 },
    { id: 'a2', title: '几何作业', submission_status: 'graded', score: 92, feedback: '不错', submitted_at: 200 },
  ],
  rollcalls: [
    { id: 'rollcall-el1-1000', lesson_id: 'L1', lesson_title: '第一课', picked_time: 400 },
    { id: 'rollcall-el1-2000', lesson_id: 'L1', lesson_title: '第一课', picked_time: 500 },
  ],
};

describe('useStudentNotifications', () => {
  it('includes assignment notifications', () => {
    const { result } = renderHook(() => useStudentNotifications('student', studentDashboardData, 'zh'));

    expect(result.current.studentNotifications.map((n: any) => n.type)).toEqual(
      expect.arrayContaining(['new_assignment', 'graded']),
    );
  });

  it('keeps roll-call reminders out of the notification-message list', () => {
    // 点名提醒走屏幕级强提示（全屏抽中弹窗 / 仪表盘警报区），
    // 不应再作为一条静默记录堆在通知铃铛里。
    const { result } = renderHook(() => useStudentNotifications('student', studentDashboardData, 'zh'));

    expect(result.current.studentNotifications.some((n: any) => n.type === 'rollcall_picked')).toBe(false);
    expect(result.current.unreadNotifications.some((n: any) => n.type === 'rollcall_picked')).toBe(false);
  });

  it('returns nothing for the teacher role', () => {
    const { result } = renderHook(() => useStudentNotifications('teacher', studentDashboardData, 'zh'));

    expect(result.current.studentNotifications).toEqual([]);
    expect(result.current.unreadNotifications).toEqual([]);
  });
});
