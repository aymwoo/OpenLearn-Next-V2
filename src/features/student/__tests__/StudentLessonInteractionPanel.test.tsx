import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Suspense } from 'react';
import { StudentLessonInteractionPanel } from '../StudentLessonInteractionPanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('StudentLessonInteractionPanel', () => {
  it('renders the interactive whiteboard tab label', () => {
    render(
      <Suspense fallback={null}>
        <StudentLessonInteractionPanel
          studentLessonTab="whiteboard"
          setStudentLessonTab={vi.fn()}
          isStudentLessonContentCollapsed={false}
          setIsStudentLessonContentCollapsed={vi.fn()}
          lang="zh"
          studentFullscreenPanel="none"
          setStudentFullscreenPanel={vi.fn()}
          selectedLesson="l1"
          elements={[]}
          activeRole="student"
          activeSegmentId={null}
          setActiveSegmentId={vi.fn()}
          fetchElements={vi.fn()}
          currentVfsParent={null}
          setCurrentVfsParent={vi.fn()}
          vfsNodes={[]}
          studentSelectedCourseware={null}
          setStudentSelectedCourseware={vi.fn()}
          activeStudentId="s1"
          addToast={vi.fn()}
        />
      </Suspense>,
    );
    expect(screen.getByText('Interactive Whiteboard')).toBeTruthy();
  });
});
