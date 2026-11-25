import { Dispatch, SetStateAction } from 'react';
import { Wand2, Loader2, CheckCircle2 } from 'lucide-react';
import AccessibleDialog, {
  DialogBody,
  DialogButton,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/AccessibleDialog';
import type { Lesson } from '../../types/app';

export interface QuizGeneratorModalProps {
  isQuizGeneratorOpen: boolean;
  setIsQuizGeneratorOpen: (v: boolean) => void;
  lessons: Lesson[];
  quizGenMode: 'scan_lesson' | 'topic';
  setQuizGenMode: Dispatch<SetStateAction<'scan_lesson' | 'topic'>>;
  quizGenSelectedLessonId: string;
  setQuizGenSelectedLessonId: Dispatch<SetStateAction<string>>;
  quizGenTopic: string;
  setQuizGenTopic: Dispatch<SetStateAction<string>>;
  isGeneratingSuggestions: boolean;
  setIsGeneratingSuggestions: Dispatch<SetStateAction<boolean>>;
  suggestedObjectives: string[];
  setSuggestedObjectives: Dispatch<SetStateAction<string[]>>;
  suggestedQuestions: any[];
  setSuggestedQuestions: Dispatch<SetStateAction<any[]>>;
  quizGenTimeLimit: number;
  setQuizGenTimeLimit: Dispatch<SetStateAction<number>>;
  savingQuiz: boolean;
  setSavingQuiz: Dispatch<SetStateAction<boolean>>;
  quizGeneratorClassId: string | null;
  fetchClassDashboard: (classId: string) => void;
}

export function QuizGeneratorModal(props: QuizGeneratorModalProps) {
  const {
    isQuizGeneratorOpen,
    setIsQuizGeneratorOpen,
    lessons,
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
    quizGenTimeLimit,
    setQuizGenTimeLimit,
    savingQuiz,
    setSavingQuiz,
    quizGeneratorClassId,
    fetchClassDashboard,
  } = props;

  return (
    <AccessibleDialog
      open={isQuizGeneratorOpen}
      onClose={() => setIsQuizGeneratorOpen(false)}
      ariaLabelledBy="quiz-generator-dialog-title"
      closedBy="closerequest"
      className="max-w-3xl max-h-[90vh]"
    >
      <DialogHeader>
        <DialogTitle id="quiz-generator-dialog-title" icon={<Wand2 size={18} className="animate-pulse" />}>
          AI-Objective Quiz Generator
        </DialogTitle>
        <DialogCloseButton label="Close quiz generator" onClick={() => setIsQuizGeneratorOpen(false)} />
      </DialogHeader>

      <DialogBody className="space-y-6">
        {/* Step 1: Mode Configuration */}
        {suggestedQuestions.length === 0 && (
          <div className="space-y-4">
            <div className="bg-primary-theme-light p-4 rounded-xl border border-primary-theme/30 text-xs text-primary-ink leading-relaxed font-sans">
              Choose a lesson to scan. Our advanced AI model will run a deep semantic scan across the entire lesson
              curriculum content, discover your core learning objectives, and construct interactive multiple-choice
              questions aligning precisely with each of them.
            </div>

            <div className="font-sans">
              <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                Scan Core Selection Mode
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setQuizGenMode('scan_lesson')}
                  className={`p-3 rounded-lg border text-left flex flex-col transition-all ${quizGenMode === 'scan_lesson' ? 'border-primary-theme bg-primary-theme-light ring-2 ring-primary-theme/30' : 'border-theme hover:border-primary-theme/50'}`}
                >
                  <span className="font-semibold text-sm text-primary-ink">Curriculum Lesson Scanning</span>
                  <span className="text-xs text-muted mt-1">
                    Examines real Markdown content inside virtual lesson modules.
                  </span>
                </button>
                <button
                  onClick={() => setQuizGenMode('topic')}
                  className={`p-3 rounded-lg border text-left flex flex-col transition-all ${quizGenMode === 'topic' ? 'border-primary-theme bg-primary-theme-light ring-2 ring-primary-theme/30' : 'border-theme hover:border-primary-theme/50'}`}
                >
                  <span className="font-semibold text-sm text-primary-ink">Custom Keyword / Topic</span>
                  <span className="text-xs text-muted mt-1">
                    Provide a custom prompt keyword or objective manually.
                  </span>
                </button>
              </div>
            </div>

            {quizGenMode === 'scan_lesson' ? (
              <div className="font-sans">
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Select Lesson to Scan
                </label>
                {lessons.length === 0 ? (
                  <div className="text-muted text-xs py-3 border border-theme rounded border-dashed text-center">
                    No lessons available. Please create a lesson first.
                  </div>
                ) : (
                  <select
                    value={quizGenSelectedLessonId}
                    onChange={(e) => setQuizGenSelectedLessonId(e.target.value)}
                    className="w-full p-2.5 bg-surface border border-theme rounded-lg text-sm text-main focus:border-primary-theme focus:outline-none shadow-sm"
                  >
                    <option value="">-- Choose a lesson --</option>
                    {lessons.map((lesson) => (
                      <option key={lesson.id} value={lesson.id}>
                        {lesson.title}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : (
              <div className="font-sans">
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Custom Topic Prompt
                </label>
                <input
                  type="text"
                  placeholder="e.g. Introduction to React state, Cloud SQL setup..."
                  value={quizGenTopic}
                  onChange={(e) => setQuizGenTopic(e.target.value)}
                  className="w-full p-2.5 bg-surface border border-theme rounded-lg text-sm focus:border-primary-theme focus:outline-none shadow-sm text-main"
                />
              </div>
            )}
          </div>
        )}

        {/* Step 2: Display and Approve Suggestions */}
        {suggestedQuestions.length > 0 && (
          <div className="space-y-6">
            {/* Learning Objectives Found */}
            <div className="font-sans">
              <div className="text-xs font-bold text-muted uppercase tracking-wider mb-2">
                Identified Core Objectives
              </div>
              <div className="flex flex-wrap gap-2">
                {suggestedObjectives.map((obj, i) => (
                  <span
                    key={i}
                    className="px-2.5 py-1 bg-teal-500/10 text-teal-700 dark:text-teal-400 border border-teal-500/20 rounded-full text-xs font-semibold"
                  >
                    🎯 {obj}
                  </span>
                ))}
              </div>
            </div>

            {/* MCQ Questions Display */}
            <div className="space-y-4 font-sans">
              <div className="text-xs font-bold text-muted uppercase tracking-wider font-semibold">
                Suggested MCQ Questions
              </div>
              <div className="space-y-3">
                {suggestedQuestions.map((q, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-xl border border-theme bg-surface-secondary/50 hover:bg-surface-secondary transition space-y-3 text-main"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-primary-theme-light text-primary-ink flex items-center justify-center text-xs font-bold shrink-0">
                          {idx + 1}
                        </span>
                        <span className="text-xs font-semibold text-teal-700 dark:text-teal-400 bg-teal-500/10 px-2.5 py-0.5 rounded border border-teal-500/20">
                          objective: {q.objective}
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        checked={!!q.selected}
                        onChange={(e) => {
                          const copy = [...suggestedQuestions];
                          copy[idx].selected = e.target.checked;
                          setSuggestedQuestions(copy);
                        }}
                        className="w-4 h-4 text-primary-ink border-theme rounded focus:ring-primary-theme"
                      />
                    </div>

                    <p className="font-semibold text-main text-sm leading-relaxed">{q.question}</p>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {q.options.map((opt: string, optIdx: number) => {
                        const isCorrect = opt === q.correctAnswer;
                        return (
                          <div
                            key={optIdx}
                            className={`p-2 rounded border flex items-center justify-between ${isCorrect ? 'bg-green-500/10 border-green-500/20 text-green-700 dark:text-green-400 font-semibold' : 'bg-surface border-theme text-main'}`}
                          >
                            <span>{opt}</span>
                            {isCorrect && (
                              <CheckCircle2 size={12} className="text-green-600 dark:text-green-400 shrink-0" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </DialogBody>

      {suggestedQuestions.length === 0 ? (
        <DialogFooter>
          <DialogButton
            variant="primary"
            disabled={
              isGeneratingSuggestions ||
              (quizGenMode === 'scan_lesson' && !quizGenSelectedLessonId) ||
              (quizGenMode === 'topic' && !quizGenTopic.trim())
            }
            onClick={async () => {
              setIsGeneratingSuggestions(true);
              try {
                if (quizGenMode === 'scan_lesson') {
                  const res = await fetch('/api/learning-surface-assignments/suggest', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      classId: quizGeneratorClassId,
                      lessonId: quizGenSelectedLessonId,
                    }),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    setSuggestedObjectives(data.learningObjectives || []);
                    setSuggestedQuestions((data.questions || []).map((q: any) => ({ ...q, selected: true })));
                  } else {
                    alert('Error generating suggestions. Please make sure the selected lesson has content.');
                  }
                } else {
                  const res = await fetch('/api/learning-surface-assignments/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ classId: quizGeneratorClassId, topic: quizGenTopic }),
                  });
                  if (res.ok) {
                    await fetchClassDashboard(quizGeneratorClassId!);
                    setIsQuizGeneratorOpen(false);
                  } else {
                    alert('Error generating topic quiz.');
                  }
                }
              } catch (err: any) {
                console.error(err);
                alert(err.message);
              } finally {
                setIsGeneratingSuggestions(false);
              }
            }}
            className="flex items-center gap-2"
          >
            {isGeneratingSuggestions ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>AI Scanning Content...</span>
              </>
            ) : (
              <>
                <Wand2 size={16} />
                <span>Generate Key MCQ Quiz</span>
              </>
            )}
          </DialogButton>
        </DialogFooter>
      ) : (
        <DialogFooter className="justify-between">
          <DialogButton
            variant="secondary"
            onClick={() => {
              setSuggestedObjectives([]);
              setSuggestedQuestions([]);
            }}
          >
            Back / Scan New
          </DialogButton>

          <div className="flex items-center gap-2 border border-primary-theme/30 bg-primary-theme-light/50 px-3 py-1.5 rounded-lg text-xs font-semibold text-primary-ink">
            <span>⏱️ Quiz Time Limit:</span>
            <select
              value={quizGenTimeLimit}
              onChange={(e) => setQuizGenTimeLimit(Number(e.target.value))}
              className="bg-transparent text-xs text-main font-bold focus:outline-none cursor-pointer"
            >
              <option className="text-main" value={0}>
                No Limit
              </option>
              <option className="text-main" value={1}>
                1 Min
              </option>
              <option className="text-main" value={2}>
                2 Mins
              </option>
              <option className="text-main" value={5}>
                5 Mins
              </option>
              <option className="text-main" value={10}>
                10 Mins
              </option>
              <option className="text-main" value={15}>
                15 Mins
              </option>
              <option className="text-main" value={20}>
                20 Mins
              </option>
              <option className="text-main" value={30}>
                30 Mins
              </option>
              <option className="text-main" value={45}>
                45 Mins
              </option>
              <option className="text-main" value={60}>
                60 Mins
              </option>
            </select>
          </div>

          <DialogButton
            variant="primary"
            disabled={savingQuiz || suggestedQuestions.filter((q) => q.selected).length === 0}
            onClick={async () => {
              setSavingQuiz(true);
              try {
                const activeLesson = lessons.find((l) => l.id === quizGenSelectedLessonId);
                const lessonTitle = activeLesson ? activeLesson.title : quizGenTopic || 'Custom Objective';
                const res = await fetch('/api/learning-surface-assignments/create-suggested-quiz', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    classId: quizGeneratorClassId,
                    title: `MCQ Evaluation: ${lessonTitle}`,
                    description: `Automatic evaluation based on core learning objectives.`,
                    questions: suggestedQuestions.filter((q) => q.selected).map(({ selected, ...rest }) => rest),
                    learningObjectives: suggestedObjectives,
                    timeLimit: quizGenTimeLimit,
                  }),
                });
                if (res.ok) {
                  await fetchClassDashboard(quizGeneratorClassId!);
                  setIsQuizGeneratorOpen(false);
                } else {
                  alert('Failed to save suggested quiz.');
                }
              } catch (err: any) {
                console.error(err);
                alert(err.message);
              } finally {
                setSavingQuiz(false);
              }
            }}
            className="flex items-center gap-2"
          >
            {savingQuiz ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            <span>Create Assessment Quiz</span>
          </DialogButton>
        </DialogFooter>
      )}
    </AccessibleDialog>
  );
}
