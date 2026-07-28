import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { StudentType, Lesson } from '../../../types/app';
import { StudentLessonContentPanel } from '../StudentLessonContentPanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('StudentLessonContentPanel', () => {
  it('renders the lesson content and learning progress sections', () => {
    const students = [{ id: 's1', locked_lesson_id: null }] as unknown as StudentType[];
    const lessons = [{ id: 'l1', content: '# Hi' }] as unknown as Lesson[];
    render(
      <StudentLessonContentPanel
        students={students}
        activeStudentId="s1"
        studentFullscreenPanel="none"
        setStudentFullscreenPanel={vi.fn()}
        timelineSegments={[]}
        lang="zh"
        activeSegmentId={null}
        setActiveSegmentId={vi.fn()}
        localProgressPercent={0}
        setLocalProgressPercent={vi.fn()}
        updateStudentProgress={vi.fn()}
        selectedLesson="l1"
        lessons={lessons}
      />,
    );
    expect(screen.getByText(/Lesson Content/)).toBeTruthy();
    expect(screen.getByText(/自主学习进度反馈/)).toBeTruthy();
  });
});
