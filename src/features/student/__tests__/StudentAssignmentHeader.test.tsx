import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StudentAssignmentHeader } from '../StudentAssignmentHeader';

afterEach(() => {
  cleanup();
});

describe('StudentAssignmentHeader', () => {
  it('renders the assignment title and back button', () => {
    const setStudentViewStatus = () => {};
    const setSelectedAssignment = () => {};
    render(
      <StudentAssignmentHeader
        setStudentViewStatus={setStudentViewStatus}
        setSelectedAssignment={setSelectedAssignment}
        selectedAssignment={{ title: 'HW' }}
      />
    );
    expect(screen.getByText('Assignment: HW')).toBeTruthy();
    expect(screen.getByText('Back to Dashboard')).toBeTruthy();
  });
});
