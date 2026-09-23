import { useState, useRef, useEffect } from 'react';

export function useQuizGenerator() {
  const [isQuizGeneratorOpen, setIsQuizGeneratorOpen] = useState(false);
  const [quizGeneratorClassId, setQuizGeneratorClassId] = useState<string | null>(null);
  const [quizGenMode, setQuizGenMode] = useState<'scan_lesson' | 'topic'>('scan_lesson');
  const [quizGenSelectedLessonId, setQuizGenSelectedLessonId] = useState<string>('');
  const [quizGenTopic, setQuizGenTopic] = useState('');
  const [isGeneratingSuggestions, setIsGeneratingSuggestions] = useState(false);
  const [suggestedObjectives, setSuggestedObjectives] = useState<string[]>([]);
  const [suggestedQuestions, setSuggestedQuestions] = useState<any[]>([]);
  const [savingQuiz, setSavingQuiz] = useState(false);
  const [quizStudentAnswers, setQuizStudentAnswers] = useState<Record<number, string>>({});
  const [quizGenTimeLimit, setQuizGenTimeLimit] = useState<number>(10);
  const [subAssignmentTab, setSubAssignmentTab] = useState<'quiz' | 'whiteboard'>('quiz');

  const quizStudentAnswersRef = useRef<Record<number, string>>(quizStudentAnswers);
  useEffect(() => {
    quizStudentAnswersRef.current = quizStudentAnswers;
  }, [quizStudentAnswers]);

  return {
    isQuizGeneratorOpen,
    setIsQuizGeneratorOpen,
    quizGeneratorClassId,
    setQuizGeneratorClassId,
    quizGenMode,
    setQuizGenMode,
    quizGenSelectedLessonId,
    setQuizGenSelectedLessonId,
    quizGenTopic,
    setQuizGenTopic,
    isGeneratingSuggestions,
    setIsGeneratingSuggestions,
    suggestedObjectives,
    setSuggestedObjectives,
    suggestedQuestions,
    setSuggestedQuestions,
    savingQuiz,
    setSavingQuiz,
    quizStudentAnswers,
    setQuizStudentAnswers,
    quizGenTimeLimit,
    setQuizGenTimeLimit,
    quizStudentAnswersRef,
    subAssignmentTab,
    setSubAssignmentTab,
  };
}
