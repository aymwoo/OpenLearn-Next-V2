import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { StudentType, Lesson } from '../../../types/app';
import { PluginHostProvider } from '../../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../../plugin-host/plugin-host';
import { StudentView } from '../StudentView';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const baseProps = {
  students: [{ id: 's1', name: 'Alice' }] as unknown as StudentType[],
  activeStudentId: 's1' as string | null,
  studentViewStatus: 'dashboard' as const,
  studentDashboardData: {
    progress: [],
    assignments: [
      { id: 'a1', title: 'HW', class_name: 'C', content: 'x', submission_status: null },
    ],
    schedules: [],
    rollcalls: [],
    classes: [],
  },
  readNotifications: new Set<string>(),
  setReadNotifications: vi.fn(),
  addToast: vi.fn(),
  lang: 'zh' as const,
  setSelectedLesson: vi.fn(),
  setStudentViewStatus: vi.fn(),
  setSelectedAssignment: vi.fn(),
  setQuizStudentAnswers: vi.fn(),
  setSubAssignmentTab: vi.fn(),
  lessons: [{ id: 'l1', title: 'Lesson 1' }] as unknown as Lesson[],
  selectedLesson: 'l1' as string | null,
  studentFullscreenPanel: 'none' as const,
  setStudentFullscreenPanel: vi.fn(),
  timelineSegments: [],
  activeSegmentId: null as string | null,
  setActiveSegmentId: vi.fn(),
  localProgressPercent: 0,
  setLocalProgressPercent: vi.fn(),
  updateStudentProgress: vi.fn(),
  isStudentLessonContentCollapsed: false,
  setIsStudentLessonContentCollapsed: vi.fn(),
  studentLessonTab: 'whiteboard' as const,
  setStudentLessonTab: vi.fn(),
  elements: [],
  activeRole: 'student' as const,
  fetchElements: vi.fn(),
  currentVfsParent: null as string | null,
  setCurrentVfsParent: vi.fn(),
  vfsNodes: [],
  studentSelectedCourseware: null as string | null,
  setStudentSelectedCourseware: vi.fn(),
  selectedAssignment: null as any,
  quizStudentAnswers: {},
  submitQuizAssignment: vi.fn(),
  subAssignmentTab: 'quiz' as const,
};

const renderView = (props = {}) =>
  render(
    <PluginHostProvider host={new FrontendPluginHost()}>
      <StudentView {...baseProps} {...props} />
    </PluginHostProvider>,
  );

describe('StudentView', () => {
  it('renders "No Student Selected" when activeStudentId is null', () => {
    renderView({ activeStudentId: null });
    expect(screen.getByText('No Student Selected')).toBeTruthy();
  });

  it('renders the loading spinner when activeStudentId is set but studentDashboardData is null', () => {
    const { container } = renderView({ studentDashboardData: null });
    expect(container.querySelector('.animate-spin')).toBeTruthy();
    expect(screen.queryByText('No Student Selected')).toBeNull();
  });

  it('renders StudentLessonView when studentViewStatus is "lesson"', () => {
    renderView({ studentViewStatus: 'lesson' });
    expect(screen.getByText('Back to Dashboard')).toBeTruthy();
  });

  it('renders StudentAssignmentView when studentViewStatus is "assignment" and selectedAssignment is set', () => {
    renderView({
      studentViewStatus: 'assignment',
      selectedAssignment: { title: 'Test Assignment' },
    });
    expect(screen.getByText('Assignment: Test Assignment')).toBeTruthy();
  });

  it('renders StudentDashboardPanel (default else) when studentViewStatus is "dashboard"', () => {
    renderView({ studentViewStatus: 'dashboard' });
    expect(screen.getByText('Welcome, Alice')).toBeTruthy();
  });
});
