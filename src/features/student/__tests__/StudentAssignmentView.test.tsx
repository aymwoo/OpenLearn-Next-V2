import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Suspense } from 'react';
import { StudentAssignmentView } from '../StudentAssignmentView';

afterEach(() => {
  cleanup();
});

describe('StudentAssignmentView', () => {
  const allProps = {
    selectedAssignment: { id: 'a1', title: 'HW', content: '# Q', submission_status: null },
    setStudentViewStatus: vi.fn(),
    setSelectedAssignment: vi.fn(),
    quizStudentAnswers: {},
    submitQuizAssignment: vi.fn(),
    subAssignmentTab: 'whiteboard' as const,
    setSubAssignmentTab: vi.fn(),
    setQuizStudentAnswers: vi.fn(),
    elements: [],
    activeRole: 'student' as const,
    activeStudentId: 's1',
    fetchElements: vi.fn(),
  };

  it('renders the assignment header title', () => {
    render(
      <Suspense fallback={null}>
        <StudentAssignmentView {...allProps} />
      </Suspense>
    );
    expect(screen.getByText('Assignment: HW')).toBeTruthy();
  });

  it('renders the question panel "Ready to submit?" prompt', () => {
    render(
      <Suspense fallback={null}>
        <StudentAssignmentView {...allProps} />
      </Suspense>
    );
    expect(screen.getByText('Ready to submit?')).toBeTruthy();
  });
});
