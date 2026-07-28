import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Suspense } from 'react';
import type { StudentType, Lesson } from '../../../types/app';
import { StudentLessonView } from '../StudentLessonView';
import type { StudentLessonViewProps } from '../StudentLessonView';

const allProps: StudentLessonViewProps = {
  students: [{ id: 's1', name: 'Alice', locked_lesson_id: null }] as unknown as StudentType[],
  activeStudentId: 's1',
  setStudentViewStatus: vi.fn(),
  setSelectedLesson: vi.fn(),
  lessons: [{ id: 'l1', title: 'Math', content: '# Hi' }] as unknown as Lesson[],
  selectedLesson: 'l1',
  studentFullscreenPanel: 'none',
  setStudentFullscreenPanel: vi.fn(),
  timelineSegments: [],
  lang: 'zh',
  activeSegmentId: null,
  setActiveSegmentId: vi.fn(),
  localProgressPercent: 0,
  setLocalProgressPercent: vi.fn(),
  updateStudentProgress: vi.fn(),
  isStudentLessonContentCollapsed: false,
  setIsStudentLessonContentCollapsed: vi.fn(),
  studentLessonTab: 'whiteboard',
  setStudentLessonTab: vi.fn(),
  elements: [],
  activeRole: 'student',
  fetchElements: vi.fn(),
  currentVfsParent: null,
  setCurrentVfsParent: vi.fn(),
  vfsNodes: [],
  studentSelectedCourseware: null,
  setStudentSelectedCourseware: vi.fn(),
  addToast: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('StudentLessonView', () => {
  it('renders the back-to-dashboard control from StudentLessonHeader', () => {
    render(
      <Suspense fallback={null}>
        <StudentLessonView {...allProps} />
      </Suspense>,
    );
    expect(screen.getByText('Back to Dashboard')).toBeTruthy();
  });

  it('renders the interactive whiteboard tab label from StudentLessonInteractionPanel', () => {
    render(
      <Suspense fallback={null}>
        <StudentLessonView {...allProps} />
      </Suspense>,
    );
    expect(screen.getByText('Interactive Whiteboard')).toBeTruthy();
  });
});
