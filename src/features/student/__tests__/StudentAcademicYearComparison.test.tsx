import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { StudentAcademicYearComparison } from '../StudentAcademicYearComparison';
import * as dashboardService from '../../../services/dashboardService';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mockComparisonData = {
  studentId: 's1',
  availableYears: ['2024-2025', '2025-2026'],
  selectedYears: ['2024-2025', '2025-2026'],
  metricsByYear: [
    {
      academicYear: '2024-2025',
      hasData: true,
      totalAssignments: 4,
      submittedAssignments: 4,
      onTimeAssignments: 4,
      submissionRate: 100,
      onTimeRate: 100,
      averageScore: 88.5,
      enrolledCoursesCount: 2,
      completedCoursesCount: 1,
      courseScores: [
        {
          courseId: 'c1',
          courseTitle: '数学分析',
          averageScore: 90,
          gradedAssignmentCount: 2,
          totalAssignmentCount: 2,
        },
      ],
    },
    {
      academicYear: '2025-2026',
      hasData: false,
      totalAssignments: 0,
      submittedAssignments: 0,
      onTimeAssignments: 0,
      submissionRate: 0,
      onTimeRate: 0,
      averageScore: 0,
      enrolledCoursesCount: 0,
      completedCoursesCount: 0,
      courseScores: [],
    },
  ],
  deltas: [
    {
      fromYear: '2024-2025',
      toYear: '2025-2026',
      submissionRateDelta: { diff: -100, direction: 'down' },
      onTimeRateDelta: { diff: -100, direction: 'down' },
      averageScoreDelta: { diff: -88.5, direction: 'down' },
      enrolledCoursesDelta: { diff: -2, direction: 'down' },
    },
  ],
};

describe('StudentAcademicYearComparison 组件', () => {
  it('正确渲染学年选择器、指标卡片与无数据学年提示', async () => {
    vi.spyOn(dashboardService, 'getStudentAcademicYearComparison').mockResolvedValue({
      ok: true,
      data: mockComparisonData,
    });

    render(<StudentAcademicYearComparison studentId="s1" lang="zh" />);

    // 等待数据加载
    await waitFor(() => {
      expect(screen.getByText('跨学年对比')).toBeTruthy();
    });

    // 年份 Chips
    expect(screen.getByTestId('year-chip-2024-2025')).toBeTruthy();
    expect(screen.getByTestId('year-chip-2025-2026')).toBeTruthy();

    // 核心指标卡片
    expect(screen.getAllByText('作业提交率').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('作业平均分')).toBeTruthy();
    expect(screen.getByText('在读 / 已完成课程')).toBeTruthy();

    // 无数据学年提示条
    expect(screen.getByText('提示：部分选中的历史学年暂无排课或作业提交记录，指标以 0 显示。')).toBeTruthy();

    // 课程成绩列表
    expect(screen.getByText('数学分析')).toBeTruthy();
    expect(screen.getByText('90')).toBeTruthy();
  });

  it('点击学年 Chip 能切换选择并重新触发数据请求', async () => {
    const fetchSpy = vi.spyOn(dashboardService, 'getStudentAcademicYearComparison').mockResolvedValue({
      ok: true,
      data: mockComparisonData,
    });

    render(<StudentAcademicYearComparison studentId="s1" lang="zh" />);

    await waitFor(() => {
      expect(screen.getByText('跨学年对比')).toBeTruthy();
    });

    // 取消选择 2025-2026
    const chip2025 = screen.getByTestId('year-chip-2025-2026');
    fireEvent.click(chip2025);

    expect(fetchSpy).toHaveBeenCalledWith('s1', ['2024-2025']);
  });

  it('加载失败时渲染错误提示与重试按钮', async () => {
    vi.spyOn(dashboardService, 'getStudentAcademicYearComparison').mockResolvedValue({
      ok: false,
      error: 'Permission denied',
    });

    render(<StudentAcademicYearComparison studentId="s1" lang="zh" />);

    await waitFor(() => {
      expect(screen.getByText('无法获取学年对比')).toBeTruthy();
      expect(screen.getByText('Permission denied')).toBeTruthy();
      expect(screen.getByText('重试')).toBeTruthy();
    });
  });
});
