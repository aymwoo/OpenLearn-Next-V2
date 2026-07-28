import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ClassesView } from '../ClassesView';
import { translations } from '../../../../i18n';
import type { ClassType, StudentType } from '../../../../types/app';

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

function makeStudent(): StudentType {
  return {
    id: 's1',
    class_id: 'c1',
    name: 'Student 1',
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
    lessons: [] as any[],
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
    studentProgressMap: {} as Record<string, any[]>,
    studentActiveTabs: {} as Record<string, any>,
    setStudentActiveTabs: vi.fn(),
    setStudents: vi.fn(),
    fetchClassStudents: vi.fn().mockResolvedValue(undefined),
    fetchStudents: vi.fn().mockResolvedValue(undefined),
    parseCSV: vi.fn(),
    setImportError: vi.fn(),
    setImportSuccess: vi.fn(),
    setShowImportModal: vi.fn(),
    fetchClasses: vi.fn().mockResolvedValue(undefined),
    classSubmissionFilters: {} as Record<string, any>,
    setClassSubmissionFilters: vi.fn(),
    classActiveTabs: {} as Record<string, any>,
    setClassActiveTabs: vi.fn(),
    classProgressMap: {} as Record<string, any>,
    classSchedulesMap: {} as Record<string, any>,
    classDashboardMap: {} as Record<string, any>,
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
    scheduleAttendanceMap: {} as Record<string, any>,
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
  return { ...base, ...overrides } as any;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClassesView', () => {
  it('renders the School Management header with classes & students labels', () => {
    render(<ClassesView {...makeProps()} />);
    expect(screen.getByText('班级管理 & 学生管理')).toBeTruthy();
  });

  it('renders the batch mode toggle button', () => {
    render(<ClassesView {...makeProps()} />);
    expect(screen.getByText('批量管理')).toBeTruthy();
  });
});
