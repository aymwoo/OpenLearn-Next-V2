import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StudentAssignmentQuestionPanel } from '../StudentAssignmentQuestionPanel';

afterEach(() => {
  cleanup();
});

describe('StudentAssignmentQuestionPanel', () => {
  it('renders the submit prompt and Submit button for an unsubmitted assignment', () => {
    const submitQuizAssignment = () => {};
    render(
      <StudentAssignmentQuestionPanel
        selectedAssignment={{ content: '# Q', submission_status: null }}
        quizStudentAnswers={{}}
        submitQuizAssignment={submitQuizAssignment}
      />
    );
    expect(screen.getByText('Ready to submit?')).toBeTruthy();
    expect(screen.getByText('Submit')).toBeTruthy();
  });
});
