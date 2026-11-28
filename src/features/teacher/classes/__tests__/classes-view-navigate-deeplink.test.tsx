import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { ClassesView } from '../ClassesView';
import { AppDataProvider, type AppDataValue } from '../../../../context/AppDataContext';
import { FrontendPluginHost } from '../../../../plugin-host/plugin-host';
import { PluginHostProvider } from '../../../../plugin-host/plugin-host-context';
import { translations } from '../../../../i18n';
import type { ClassType, StudentType } from '../../../../types/app';
import type { HostNavigateResult } from '../../../../plugin-host/types';

const t = translations.zh;

function makeClass(overrides: Partial<ClassType> = {}): ClassType {
  return {
    id: 'c1',
    name: 'Class 1',
    description: '',
    created_at: 0,
    student_count: 0,
    course_count: 0,
    assignment_count: 0,
    ...overrides,
  };
}

function makeStudent(id = 's1'): StudentType {
  return {
    id,
    name: `Student ${id}`,
    email: '',
    created_at: 0,
  } as StudentType;
}

function makeProps(overrides: Record<string, unknown> = {}) {
  const base = {
    t,
    lang: 'zh' as 'zh' | 'en',
    classes: [makeClass()] as ClassType[],
    students: [] as StudentType[],
    lessons: [] as unknown[],
    batchMode: false,
    selectedClassIds: new Set<string>(),
    setSelectedClassIds: vi.fn(),
    setSelectedStudentIds: vi.fn(),
    setBatchMode: vi.fn(),
    expandedClassId: null,
    setExpandedClassId: vi.fn(),
    exportTooltipOpen: false,
    setExportTooltipOpen: vi.fn(),
    exportDropdownOpen: false,
    setExportDropdownOpen: vi.fn(),
    isExportingAllCombined: false,
    loadingExportClassId: null,
    classStudentsMap: { c1: [makeStudent()] } as Record<string, StudentType[]>,
    setClassStudentsMap: vi.fn(),
    expandedStudentId: null,
    setExpandedStudentId: vi.fn(),
    selectedStudentIds: new Set<string>(),
    rosterViewMode: 'grid' as const,
    setRosterViewMode: vi.fn(),
    rosterSearchQuery: '',
    setRosterSearchQuery: vi.fn(),
    rosterTagFilter: 'all' as const,
    setRosterTagFilter: vi.fn(),
    toggleSelectAllStudents: vi.fn(),
    handleBatchDeleteStudents: vi.fn(),
    handleBatchResetPassword: vi.fn(),
    handleBatchTransferStudents: vi.fn(),
    handleBatchSetLockedLesson: vi.fn(),
    toggleStudentSelection: vi.fn(),
    get30DayAverageWarning: vi.fn().mockReturnValue(null),
    studentProgressMap: {} as Record<string, unknown[]>,
    studentActiveTabs: {} as Record<string, string>,
    setStudentActiveTabs: vi.fn(),
    setStudents: vi.fn(),
    fetchClassStudents: vi.fn().mockResolvedValue(undefined),
    fetchStudents: vi.fn().mockResolvedValue(undefined),
    parseCSV: vi.fn(),
    setImportError: vi.fn(),
    setImportSuccess: vi.fn(),
    setShowImportModal: vi.fn(),
    fetchClasses: vi.fn().mockResolvedValue(undefined),
    classSubmissionFilters: {} as Record<string, string>,
    setClassSubmissionFilters: vi.fn(),
    classActiveTabs: {} as Record<string, string>,
    setClassActiveTabs: vi.fn(),
    classProgressMap: {} as Record<string, unknown>,
    classSchedulesMap: {} as Record<string, unknown>,
    classDashboardMap: {} as Record<string, unknown>,
    assignmentSortOrder: 'dueDate' as const,
    setAssignmentSortOrder: vi.fn(),
    isGeneratingPDFReport: {} as Record<string, boolean>,
    handleGeneratePDFReport: vi.fn(),
    setExportClassId: vi.fn(),
    setExportClassName: vi.fn(),
    setQuizzesWeight: vi.fn(),
    setAssignmentsWeight: vi.fn(),
    setCustomCategoryOverrides: vi.fn(),
    setIsExportWeightModalOpen: vi.fn(),
    isGeneratingAssignment: null,
    setQuizGeneratorClassId: vi.fn(),
    setQuizGenMode: vi.fn(),
    setQuizGenSelectedLessonId: vi.fn(),
    setQuizGenTopic: vi.fn(),
    setSuggestedObjectives: vi.fn(),
    setSuggestedQuestions: vi.fn(),
    setIsQuizGeneratorOpen: vi.fn(),
    setActiveStudentId: vi.fn(),
    setSelectedAssignment: vi.fn(),
    setStudentViewStatus: vi.fn(),
    setActiveRole: vi.fn(),
    isGrading: {} as Record<string, boolean>,
    setIsGrading: vi.fn(),
    fetchClassDashboard: vi.fn().mockResolvedValue(undefined),
    newScheduleDate: '',
    setNewScheduleDate: vi.fn(),
    newScheduleLessonId: '',
    setNewScheduleLessonId: vi.fn(),
    expandedScheduleId: null,
    setExpandedScheduleId: vi.fn(),
    fetchScheduleAttendance: vi.fn().mockResolvedValue(undefined),
    scheduleAttendanceMap: {} as Record<string, unknown>,
    toggleSelectAllClasses: vi.fn(),
    handleBatchDeleteClasses: vi.fn(),
    handleBatchExportClasses: vi.fn(),
    handleBatchSetPasscode: vi.fn(),
    handleBatchScheduleClasses: vi.fn(),
    handleExportAllClassesCombined: vi.fn(),
    triggerExportForClass: vi.fn(),
    fetchClassProgress: vi.fn().mockResolvedValue(undefined),
    fetchClassSchedules: vi.fn().mockResolvedValue(undefined),
    fetchStudentProgress: vi.fn().mockResolvedValue(undefined),
    toggleClassSelection: vi.fn(),
  };
  return { ...base, ...overrides } as typeof base;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClassesView host:navigate classes 域深链（Issue IKYP37）', () => {
  function renderView(propsOverrides: Record<string, unknown> = {}) {
    const props = makeProps(propsOverrides);
    const host = new FrontendPluginHost();
    const utils = render(
      <PluginHostProvider host={host}>
        <AppDataProvider value={props as unknown as AppDataValue}>
          <ClassesView />
        </AppDataProvider>
      </PluginHostProvider>,
    );
    return { props, host, rerender: utils.rerender };
  }

  it('全链定位：班级展开 + 详情 Tab + 学生行 + 学生子 Tab 逐项应用', async () => {
    const { props, host } = renderView();
    const dispatcher = host.getDispatcher();

    const result = (await dispatcher.dispatch({
      type: 'host:navigate',
      payload: {
        tab: 'classes',
        subTab: 'assignments',
        params: { classId: 'c1', studentId: 's1', studentSubTab: 'notes' },
      },
    })) as HostNavigateResult;

    expect(result.navigated).toBe(true);
    expect(result.located).toEqual({
      classId: true,
      subTab: true,
      studentId: true,
      studentSubTab: true,
    });
    expect(props.setExpandedClassId).toHaveBeenCalledWith('c1');
    expect(props.setExpandedStudentId).toHaveBeenCalledWith('s1');
    const classTabUpdater = props.setClassActiveTabs.mock.calls[0][0] as (
      prev: Record<string, string>,
    ) => Record<string, string>;
    expect(classTabUpdater({})).toEqual({ c1: 'assignments' });
    const studentTabUpdater = props.setStudentActiveTabs.mock.calls[0][0] as (
      prev: Record<string, string>,
    ) => Record<string, string>;
    expect(studentTabUpdater({})).toEqual({ s1: 'notes' });
  });

  it('班级不存在：诚实返回 class-not-found，不展开任何内容', async () => {
    const { props, host } = renderView();
    const dispatcher = host.getDispatcher();

    const result = (await dispatcher.dispatch({
      type: 'host:navigate',
      payload: { tab: 'classes', params: { classId: 'cX' } },
    })) as HostNavigateResult;

    expect(result.navigated).toBe(true);
    expect(result.reason).toBe('class-not-found');
    expect(result.located).toEqual({ classId: false });
    expect(props.setExpandedClassId).not.toHaveBeenCalled();
  });

  it('学生不属于已加载花名册：班级展开但学生定位诚实失败', async () => {
    const { props, host } = renderView({
      classStudentsMap: { c1: [makeStudent('s1')] },
    });
    const dispatcher = host.getDispatcher();

    const result = (await dispatcher.dispatch({
      type: 'host:navigate',
      payload: { tab: 'classes', params: { classId: 'c1', studentId: 'sX' } },
    })) as HostNavigateResult;

    expect(props.setExpandedClassId).toHaveBeenCalledWith('c1');
    expect(result.reason).toBe('student-not-found');
    expect(result.located).toEqual({ classId: true, studentId: false });
    expect(props.setExpandedStudentId).not.toHaveBeenCalled();
  });

  it('花名册未加载时放行学生定位（展开后宿主拉取花名册）', async () => {
    const { props, host } = renderView({ classStudentsMap: {} });
    const dispatcher = host.getDispatcher();

    const result = (await dispatcher.dispatch({
      type: 'host:navigate',
      payload: { tab: 'classes', params: { classId: 'c1', studentId: 's9' } },
    })) as HostNavigateResult;

    expect(props.setExpandedStudentId).toHaveBeenCalledWith('s9');
    expect(result.located).toEqual({ classId: true, studentId: true });
  });

  it('非 classes tab 不冒领导航：定位器不触发任何状态写入', async () => {
    const { props, host } = renderView();
    const dispatcher = host.getDispatcher();

    const result = (await dispatcher.dispatch({
      type: 'host:navigate',
      payload: { tab: 'timetable' },
    })) as HostNavigateResult;

    expect(result).toEqual({ navigated: true });
    expect(props.setExpandedClassId).not.toHaveBeenCalled();
    expect(props.setClassActiveTabs).not.toHaveBeenCalled();
    expect(props.setExpandedStudentId).not.toHaveBeenCalled();
    expect(props.setStudentActiveTabs).not.toHaveBeenCalled();
  });

  it('非法 tab 经权威处理器镜像内置诚实语义', async () => {
    const { host } = renderView();
    const dispatcher = host.getDispatcher();

    const result = (await dispatcher.dispatch({
      type: 'host:navigate',
      payload: { tab: '' },
    })) as HostNavigateResult;

    expect(result).toEqual({ navigated: false, reason: 'tab-missing' });
  });

  it('handler 只注册一次（重渲染不产生重复触发）', async () => {
    const { props, host, rerender } = renderView();
    const dispatcher = host.getDispatcher();

    rerender(
      <PluginHostProvider host={host}>
        <AppDataProvider value={props as unknown as AppDataValue}>
          <ClassesView />
        </AppDataProvider>
      </PluginHostProvider>,
    );
    await waitFor(() => {
      void dispatcher.dispatch({
        type: 'host:navigate',
        payload: { tab: 'classes', params: { classId: 'c1' } },
      });
    });

    // 若 Set 累加，setExpandedClassId 会被旧闭包 + 新闭包各调一次
    await waitFor(() => {
      expect(props.setExpandedClassId).toHaveBeenCalledTimes(1);
    });
  });
});
