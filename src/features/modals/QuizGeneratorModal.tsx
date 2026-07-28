import { Dispatch, SetStateAction } from 'react';
import { motion } from 'motion/react';
import { Wand2, Loader2, CheckCircle2 } from 'lucide-react';
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
    <>
      {isQuizGeneratorOpen && (

        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-6 z-50 overflow-y-auto text-gray-850">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white border text-gray-900 border-gray-200 rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden max-h-[90vh]"
          >
            {/* Modal Header */}
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/80 shrink-0">
              <div className="flex items-center gap-3">
                <Wand2 className="text-indigo-600 animate-pulse" size={20} />
                <h2 className="font-bold text-gray-800 text-lg">AI-Objective Quiz Generator</h2>
              </div>
              <button
                onClick={() => setIsQuizGeneratorOpen(false)}
                className="text-gray-400 hover:text-gray-600 font-bold p-1 hover:bg-gray-200 rounded transition-colors"
              >
                &times;
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Step 1: Mode Configuration */}
              {suggestedQuestions.length === 0 && (
                <div className="space-y-4">
                  <div className="bg-indigo-50/80 p-4 rounded-xl border border-indigo-100 text-xs text-indigo-800 leading-relaxed font-sans">
                    Choose a lesson to scan. Our advanced AI model will run a deep semantic scan across the entire lesson curriculum content, discover your core learning objectives, and construct interactive multiple-choice questions aligning precisely with each of them.
                  </div>

                  <div className="font-sans">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      Scan Core Selection Mode
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => setQuizGenMode('scan_lesson')}
                        className={`p-3 rounded-lg border text-left flex flex-col transition-all ${quizGenMode === 'scan_lesson' ? 'border-indigo-600 bg-indigo-50/40 ring-2 ring-indigo-100' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        <span className="font-semibold text-sm text-indigo-900">Curriculum Lesson Scanning</span>
                        <span className="text-[10px] text-gray-500 mt-1">Examines real Markdown content inside virtual lesson modules.</span>
                      </button>
                      <button
                        onClick={() => setQuizGenMode('topic')}
                        className={`p-3 rounded-lg border text-left flex flex-col transition-all ${quizGenMode === 'topic' ? 'border-indigo-600 bg-indigo-50/40 ring-2 ring-indigo-100' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        <span className="font-semibold text-sm text-indigo-900">Custom Keyword / Topic</span>
                        <span className="text-[10px] text-gray-500 mt-1">Provide a custom prompt keyword or objective manually.</span>
                      </button>
                    </div>
                  </div>

                  {quizGenMode === 'scan_lesson' ? (
                    <div className="font-sans">
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        Select Lesson to Scan
                      </label>
                      {lessons.length === 0 ? (
                        <div className="text-gray-500 text-xs py-3 border rounded border-dashed text-center">
                          No lessons available. Please create a lesson first.
                        </div>
                      ) : (
                        <select
                          value={quizGenSelectedLessonId}
                          onChange={(e) => setQuizGenSelectedLessonId(e.target.value)}
                          className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-800 focus:border-indigo-500 focus:outline-none shadow-sm"
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
                      <label className="block text-xs font-semibold text-gray-505 uppercase tracking-wider mb-2">
                        Custom Topic Prompt
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Introduction to React state, Cloud SQL setup..."
                        value={quizGenTopic}
                        onChange={(e) => setQuizGenTopic(e.target.value)}
                        className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none shadow-sm text-gray-800"
                      />
                    </div>
                  )}

                  <div className="pt-4 flex justify-end font-sans">
                    <button
                      disabled={isGeneratingSuggestions || (quizGenMode === 'scan_lesson' && !quizGenSelectedLessonId) || (quizGenMode === 'topic' && !quizGenTopic.trim())}
                      onClick={async () => {
                        setIsGeneratingSuggestions(true);
                        try {
                          if (quizGenMode === 'scan_lesson') {
                            const res = await fetch(`/api/classes/${quizGeneratorClassId}/assignments/suggest`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ lessonId: quizGenSelectedLessonId })
                            });
                            if (res.ok) {
                              const data = await res.json();
                              setSuggestedObjectives(data.learningObjectives || []);
                              setSuggestedQuestions((data.questions || []).map((q: any) => ({ ...q, selected: true })));
                            } else {
                              alert('Error generating suggestions. Please make sure the selected lesson has content.');
                            }
                          } else {
                            const res = await fetch(`/api/classes/${quizGeneratorClassId}/assignments/generate`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ topic: quizGenTopic })
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
                      className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-medium text-xs shadow transition flex items-center gap-2"
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
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Display and Approve Suggestions */}
              {suggestedQuestions.length > 0 && (
                <div className="space-y-6">
                  {/* Learning Objectives Found */}
                  <div className="font-sans">
                    <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                      Identified Core Objectives
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {suggestedObjectives.map((obj, i) => (
                        <span key={i} className="px-2.5 py-1 bg-teal-50 text-teal-800 border border-teal-200 rounded-full text-xs font-semibold">
                          🎯 {obj}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* MCQ Questions Display */}
                  <div className="space-y-4 font-sans">
                    <div className="text-xs font-bold text-gray-500 uppercase tracking-wider font-semibold">
                      Suggested MCQ Questions
                    </div>
                    <div className="space-y-3">
                      {suggestedQuestions.map((q, idx) => (
                        <div key={idx} className="p-4 rounded-xl border border-gray-150 bg-gray-50/50 hover:bg-gray-50 transition space-y-3 text-gray-800 text-gray-850">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-indigo-150 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">
                                {idx + 1}
                              </span>
                              <span className="text-[10px] font-semibold text-teal-700 bg-teal-50 px-2.5 py-0.5 rounded border border-teal-100">
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
                              className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                            />
                          </div>

                          <p className="font-semibold text-gray-800 text-sm leading-relaxed">{q.question}</p>

                          <div className="grid grid-cols-2 gap-2 text-xs">
                            {q.options.map((opt: string, optIdx: number) => {
                              const isCorrect = opt === q.correctAnswer;
                              return (
                                <div key={optIdx} className={`p-2 rounded border flex items-center justify-between ${isCorrect ? 'bg-green-50 border-green-200 text-green-955 font-semibold' : 'bg-white border-gray-100 text-gray-700'}`}>
                                  <span>{opt}</span>
                                  {isCorrect && <CheckCircle2 size={12} className="text-green-600 shrink-0" />}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-gray-100 flex justify-between items-center font-sans">
                    <button
                      onClick={() => {
                        setSuggestedObjectives([]);
                        setSuggestedQuestions([]);
                      }}
                      className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-semibold transition"
                    >
                      Back / Scan New
                    </button>

                    <div className="flex items-center gap-2 border border-indigo-150 bg-indigo-50/50 px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-900">
                      <span>⏱️ Quiz Time Limit:</span>
                      <select
                        value={quizGenTimeLimit}
                        onChange={(e) => setQuizGenTimeLimit(Number(e.target.value))}
                        className="bg-transparent text-xs text-indigo-950 font-bold focus:outline-none cursor-pointer"
                      >
                        <option className="text-gray-800" value={0}>No Limit</option>
                        <option className="text-gray-800" value={1}>1 Min</option>
                        <option className="text-gray-800" value={2}>2 Mins</option>
                        <option className="text-gray-800" value={5}>5 Mins</option>
                        <option className="text-gray-800" value={10}>10 Mins</option>
                        <option className="text-gray-800" value={15}>15 Mins</option>
                        <option className="text-gray-800" value={20}>20 Mins</option>
                        <option className="text-gray-800" value={30}>30 Mins</option>
                        <option className="text-gray-800" value={45}>45 Mins</option>
                        <option className="text-gray-800" value={60}>60 Mins</option>
                      </select>
                    </div>

                    <button
                      disabled={savingQuiz || suggestedQuestions.filter(q => q.selected).length === 0}
                      onClick={async () => {
                        setSavingQuiz(true);
                        try {
                          const activeLesson = lessons.find(l => l.id === quizGenSelectedLessonId);
                          const lessonTitle = activeLesson ? activeLesson.title : (quizGenTopic || 'Custom Objective');
                          const res = await fetch(`/api/classes/${quizGeneratorClassId}/assignments/create-suggested-quiz`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              title: `MCQ Evaluation: ${lessonTitle}`,
                              description: `Automatic evaluation based on core learning objectives.`,
                              questions: suggestedQuestions.filter(q => q.selected).map(({ selected, ...rest }) => rest),
                              learningObjectives: suggestedObjectives,
                              timeLimit: quizGenTimeLimit
                            })
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
                      className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-xs shadow hover:shadow-md transition flex items-center gap-2"
                    >
                      {savingQuiz ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                      <span>Create Assessment Quiz</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </>
  );
}
