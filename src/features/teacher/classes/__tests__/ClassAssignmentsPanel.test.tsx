import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ClassAssignmentsPanel } from '../ClassAssignmentsPanel';
import type { ClassType, StudentType, Lesson } from '../../../../types/app';

function makeClass(overrides: Partial<ClassType> = {}): ClassType {
  return {
    id: 'class-1',
    name: 'Math 101',
    description: '',
    created_at: 0,
    student_count: 2,
    ...overrides,
  };
}

function makeStudent(id: string, name: string): StudentType {
  return {
    id,
    name,
    email: `${id}@example.com`,
    password: '123456',
    private_notes: '',
  } as StudentType;
}

function baseProps(overrides: Record<string, any> = {}) {
  const cls = makeClass();
  return {
    cls,
    lang: 'zh' as const,
    cStudents: [makeStudent('s-1', 'Alice'), makeStudent('s-2', 'Bob')],
    activeSubmissionFilter: 'all',
    classDashboardMap: {
      'class-1': {
        assignments: [
          { id: 'a-1', title: 'Homework 1', description: 'Do it', created_at: 1700000000000 },
        ],
        performance: [],
        recentSubmissions: [],
      },
    },
    assignmentSortOrder: 'dueDate',
    setAssignmentSortOrder: vi.fn(),
    lessons: [] as Lesson[],
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
    setClassSubmissionFilters: vi.fn(),
    setActiveStudentId: vi.fn(),
    setSelectedAssignment: vi.fn(),
    setStudentViewStatus: vi.fn(),
    setActiveRole: vi.fn(),
    isGrading: {} as Record<string, boolean>,
    setIsGrading: vi.fn(),
    fetchClassDashboard: vi.fn(),
    get30DayAverageWarning: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClassAssignmentsPanel', () => {
  it('renders the dashboard header, AI quiz button and assignments header', () => {
    render(<ClassAssignmentsPanel {...baseProps()} />);
    // "Class Dashboard" text (always rendered)
    expect(screen.getByText((c) => (c || '').includes('Class Dashboard'))).toBeTruthy();
    // "Generate AI Quiz" button (always rendered, outside the dashboard-map guard)
    expect(screen.getByText('Generate AI Quiz')).toBeTruthy();
    // "Class Assignments & Quizzes" header (zh: 班级作业与测验) — rendered when dashboard map is truthy
    expect(screen.getByText('班级作业与测验')).toBeTruthy();
  });

  it('renders the download PDF report button when the class dashboard is present', () => {
    render(<ClassAssignmentsPanel {...baseProps()} />);
    // Unambiguous, always present when classDashboardMap[cls.id] is truthy
    expect(screen.getByText('下载班级 PDF 报告')).toBeTruthy();
  });
});
