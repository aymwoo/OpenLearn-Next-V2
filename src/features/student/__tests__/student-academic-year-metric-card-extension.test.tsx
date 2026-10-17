import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { StudentAcademicYearComparison } from '../StudentAcademicYearComparison';
import * as dashboardService from '../../../services/dashboardService';
import { PluginHostProvider } from '../../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../../plugin-host/plugin-host';
import { usePluginHostStore } from '../../../plugin-host/plugin-host-store';

function createLazyComponent(Component: React.ComponentType<any>) {
  const factory = () => Promise.resolve({ default: Component });
  (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
  return factory;
}

const mockComparisonData = {
  studentId: 'stu_202',
  availableYears: ['2024-2025', '2025-2026'],
  selectedYears: ['2024-2025', '2025-2026'],
  metricsByYear: [
    {
      academicYear: '2024-2025',
      hasData: true,
      totalAssignments: 10,
      submittedAssignments: 9,
      onTimeAssignments: 9,
      submissionRate: 90,
      onTimeRate: 90,
      averageScore: 88,
      enrolledCoursesCount: 4,
      completedCoursesCount: 4,
      courseScores: [],
    },
    {
      academicYear: '2025-2026',
      hasData: true,
      totalAssignments: 12,
      submittedAssignments: 12,
      onTimeAssignments: 11,
      submissionRate: 100,
      onTimeRate: 91.7,
      averageScore: 92.5,
      enrolledCoursesCount: 4,
      completedCoursesCount: 3,
      courseScores: [],
    },
  ],
  deltas: [],
};

describe('StudentAcademicYearComparison - student.academic_year.metric_card extension slot', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    usePluginHostStore.setState({
      extensionPoints: new Map(),
      activePlugins: [],
    });
    vi.spyOn(dashboardService, 'getStudentAcademicYearComparison').mockResolvedValue({
      ok: true,
      data: mockComparisonData,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders student.academic_year.metric_card extension inside the metric grid', async () => {
    let capturedProps: any = null;

    const MockCompetencyMetricCard: React.FC<any> = (props) => {
      capturedProps = props;
      return (
        <div data-testid="mock-competency-metric-card" className="bg-surface p-4 border border-theme rounded-xl">
          <span className="text-xs font-medium">素养发展积分</span>
          <div className="font-bold text-main mt-2">185 分 (+25)</div>
        </div>
      );
    };

    usePluginHostStore.getState().registerExtensionPoint('student.academic_year.metric_card', {
      id: 'ext-competency-card',
      label: '核心素养积分卡片',
      pluginId: 'ext_student_competency',
      component: createLazyComponent(MockCompetencyMetricCard),
    });

    const host = new FrontendPluginHost();

    render(
      <PluginHostProvider host={host}>
        <StudentAcademicYearComparison studentId="stu_202" lang="zh" />
      </PluginHostProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mock-competency-metric-card')).toBeTruthy();
    });

    expect(screen.getByText('素养发展积分')).toBeTruthy();
    expect(screen.getByText('185 分 (+25)')).toBeTruthy();

    expect(capturedProps).not.toBeNull();
    expect(capturedProps.studentId).toBe('stu_202');
    expect(capturedProps.lang).toBe('zh');
    expect(capturedProps.selectedYears).toEqual(['2024-2025', '2025-2026']);
    expect(capturedProps.comparisonData?.studentId).toBe('stu_202');
  });
});
