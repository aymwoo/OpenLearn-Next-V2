import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QuizGeneratorModal, type QuizGeneratorModalProps } from '../QuizGeneratorModal';
import type { Lesson } from '../../../types/app';

afterEach(() => cleanup());

function makeProps(overrides: Partial<QuizGeneratorModalProps> = {}): QuizGeneratorModalProps {
  return {
    isQuizGeneratorOpen: true,
    setIsQuizGeneratorOpen: vi.fn(),
    lessons: [] as Lesson[],
    quizGenMode: 'scan_lesson',
    setQuizGenMode: vi.fn(),
    quizGenSelectedLessonId: '',
    setQuizGenSelectedLessonId: vi.fn(),
    quizGenTopic: '',
    setQuizGenTopic: vi.fn(),
    isGeneratingSuggestions: false,
    setIsGeneratingSuggestions: vi.fn(),
    suggestedObjectives: [],
    setSuggestedObjectives: vi.fn(),
    suggestedQuestions: [],
    setSuggestedQuestions: vi.fn(),
    quizGenTimeLimit: 0,
    setQuizGenTimeLimit: vi.fn(),
    savingQuiz: false,
    setSavingQuiz: vi.fn(),
    quizGeneratorClassId: 'c1',
    fetchClassDashboard: vi.fn(),
    ...overrides,
  };
}

describe('QuizGeneratorModal', () => {
  it('renders the quiz generator header when open', () => {
    render(<QuizGeneratorModal {...makeProps({ isQuizGeneratorOpen: true })} />);
    expect(screen.getByText(/AI-Objective Quiz Generator/)).toBeTruthy();
  });

  it('does not render the quiz generator when closed', () => {
    render(<QuizGeneratorModal {...makeProps({ isQuizGeneratorOpen: false })} />);
    expect(screen.queryByText(/AI-Objective Quiz Generator/)).toBeNull();
  });
});
