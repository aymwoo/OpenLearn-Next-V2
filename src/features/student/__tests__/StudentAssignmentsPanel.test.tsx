import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StudentAssignmentsPanel } from '../StudentAssignmentsPanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('StudentAssignmentsPanel', () => {
  it('renders the assignments card with an open-canvas action', () => {
    render(
      <StudentAssignmentsPanel
        assignments={[{ id: 'a1', title: 'HW', class_name: 'C', content: 'x', submission_status: null }]}
        setSelectedAssignment={vi.fn()}
        setStudentViewStatus={vi.fn()}
        setQuizStudentAnswers={vi.fn()}
        setSubAssignmentTab={vi.fn()}
        lang="zh"
      />
    );
    expect(screen.getByText('My Assignments')).toBeTruthy();
    expect(screen.getByText('Open Canvas')).toBeTruthy();
  });
});
