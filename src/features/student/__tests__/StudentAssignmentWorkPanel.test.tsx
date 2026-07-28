import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Suspense } from 'react';
import { StudentAssignmentWorkPanel } from '../StudentAssignmentWorkPanel';

afterEach(() => {
  cleanup();
});

describe('StudentAssignmentWorkPanel', () => {
  it('renders the whiteboard tab label when in whiteboard mode', () => {
    render(
      <Suspense fallback={null}>
        <StudentAssignmentWorkPanel
          selectedAssignment={{ content: '{"quizType":"mcq_learning_objectives","timeLimit":0,"questions":[]}', submission_status: null, id: 'a1' }}
          subAssignmentTab="whiteboard"
          setSubAssignmentTab={() => {}}
          quizStudentAnswers={{}}
          setQuizStudentAnswers={() => {}}
          submitQuizAssignment={() => {}}
          elements={[]}
          activeRole="student"
          activeStudentId="s1"
          fetchElements={() => {}}
        />
      </Suspense>
    );
    expect(screen.getByText('Sketch Whiteboard')).toBeTruthy();
  });
});
