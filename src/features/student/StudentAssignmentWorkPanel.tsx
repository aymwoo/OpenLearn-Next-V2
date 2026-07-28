import { X, CheckCircle2 } from 'lucide-react';
import type { StudentType, Lesson } from '../../types/app';
import { CountdownTimer } from '../../components/CountdownTimer';
import { LazyWhiteboard } from '../../components/LazyWhiteboard';

export function StudentAssignmentWorkPanel(props: {
  selectedAssignment: any;
  subAssignmentTab: 'quiz' | 'whiteboard';
  setSubAssignmentTab: (tab: 'quiz' | 'whiteboard') => void;
  quizStudentAnswers: any;
  setQuizStudentAnswers: (updater: (prev: any) => any) => void;
  submitQuizAssignment: (isFinal: boolean) => void;
  elements: any[];
  activeRole: 'student' | 'teacher';
  activeStudentId: string | null;
  fetchElements: (lessonId: string) => void;
}) {
  const {
    selectedAssignment,
    subAssignmentTab,
    setSubAssignmentTab,
    quizStudentAnswers,
    setQuizStudentAnswers,
    submitQuizAssignment,
    elements,
    activeRole,
    activeStudentId,
    fetchElements,
  } = props;
  return (
    <div className="flex-1 relative flex flex-col min-h-0">
      {(() => {
        const isMcqQuiz = selectedAssignment?.content && selectedAssignment.content.startsWith('{"quizType":"mcq_learning_objectives"');
        return (
          <>
            <div className="flex justify-between items-center mb-2">
               <div className="flex items-center gap-3">
                 <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 pointer-events-none">
                   {isMcqQuiz && subAssignmentTab === 'quiz' ? 'Evaluation Sheet' : 'Live Canvas'}
                 </span>
                 {isMcqQuiz && (
                   <div className="flex bg-gray-100 p-0.5 rounded-lg border border-gray-200 text-xs">
                     <button
                       onClick={() => setSubAssignmentTab('quiz')}
                       className={`px-2.5 py-0.5 rounded text-[10px] font-bold transition-all ${subAssignmentTab === 'quiz' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                     >
                       Interactive Test
                     </button>
                     <button
                       onClick={() => setSubAssignmentTab('whiteboard')}
                       className={`px-2.5 py-0.5 rounded text-[10px] font-bold transition-all ${subAssignmentTab === 'whiteboard' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                     >
                       Sketch Whiteboard
                     </button>
                   </div>
                 )}
               </div>
               {selectedAssignment.submission_status && <div className="text-[10px] uppercase font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded">Read Only</div>}
            </div>

            {isMcqQuiz && subAssignmentTab === 'quiz' ? (
              <div className="flex-1 bg-gray-50/50 rounded-xl border border-gray-200 p-6 overflow-y-auto space-y-6">
                {(() => {
                  try {
                    const parsed = JSON.parse(selectedAssignment.content);
                    return (
                      <>
                        {parsed.timeLimit > 0 && (
                          <CountdownTimer
                            assignmentId={selectedAssignment.id}
                            timeLimitMinutes={parsed.timeLimit}
                            onTimeUp={() => submitQuizAssignment(true)}
                            isSubmitted={!!selectedAssignment.submission_status}
                          />
                        )}
                        {parsed.questions.map((q: any, idx: number) => {
                      const selectedOpt = quizStudentAnswers[idx];
                      const isSubmitted = !!selectedAssignment.submission_status;
                      const studentAns = quizStudentAnswers[idx];
                      const isCorrect = studentAns === q.correctAnswer;

                      return (
                        <div key={idx} className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm space-y-3 font-sans">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-6 h-6 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center text-xs font-bold ring-1 ring-indigo-100">
                                {idx + 1}
                              </span>
                              <span className="text-[10px] font-semibold text-teal-700 bg-teal-50 px-2.5 py-0.5 rounded-full border border-teal-100">
                                evaluates: {q.objective}
                              </span>
                            </div>
                            {isSubmitted && (
                              <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${isCorrect ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                {isCorrect ? 'Correct ✓' : `Incorrect (Correct Option: ${q.correctAnswer})`}
                              </span>
                            )}
                          </div>

                          <div className="font-semibold text-gray-800 text-sm">
                            {q.question}
                          </div>

                          <div className="grid grid-cols-2 gap-3 text-xs pt-1">
                            {q.options.map((opt: string, optIdx: number) => {
                              const isSelected = selectedOpt === opt;
                              const isCorrectOpt = opt === q.correctAnswer;
                              let optStyle = "border-gray-200 hover:border-gray-300 bg-white text-gray-700 hover:bg-gray-50/50 cursor-pointer";

                              if (isSubmitted) {
                                if (isSelected) {
                                  optStyle = isCorrectOpt ? "border-green-600 bg-green-50 text-green-900 ring-2 ring-green-100" : "border-red-600 bg-red-50 text-red-900 ring-2 ring-red-100";
                                } else if (isCorrectOpt) {
                                  optStyle = "border-green-400 bg-green-50/20 text-green-900";
                                } else {
                                  optStyle = "border-gray-200 opacity-60 text-gray-400";
                                }
                              } else if (isSelected) {
                                optStyle = "border-indigo-600 bg-indigo-50/30 text-indigo-900 ring-2 ring-indigo-100 font-medium cursor-pointer";
                              }

                              return (
                                <div
                                  key={optIdx}
                                  onClick={() => {
                                    if (!isSubmitted) {
                                      setQuizStudentAnswers(prev => ({ ...prev, [idx]: opt }));
                                    }
                                  }}
                                  className={`p-3 rounded-xl border transition-all duration-150 flex items-center justify-between ${optStyle}`}
                                >
                                  <span>{opt}</span>
                                  {isSelected && (
                                    isSubmitted ? (
                                      isCorrectOpt ? <CheckCircle2 size={14} className="text-green-600 shrink-0" /> : <X size={14} className="text-red-600 shrink-0" />
                                    ) : (
                                      <div className="w-2 h-2 rounded-full bg-indigo-600 shadow-sm shrink-0" />
                                    )
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </>
                    );
                  } catch (e) {
                    return <div className="text-xs text-red-500 font-sans">Error parsing quiz structure.</div>;
                  }
                })()}
              </div>
            ) : (
              <div className={`flex-1 min-h-0 flex flex-col ${selectedAssignment.submission_status ? 'opacity-90 pointer-events-none filter grayscale-[0.2]' : ''}`}>
                <LazyWhiteboard
lessonId={`assignment-${selectedAssignment.id}-student-${activeStudentId}`}
elements={elements}
userRole={activeRole}
enableAutoAI={activeRole === 'student' && !selectedAssignment.submission_status}
onElementAdd={async (type: string, data: any) => {
                  await fetch(`/api/lessons/assignment-${selectedAssignment.id}-student-${activeStudentId}/whiteboard`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type, data })
                  });
                  fetchElements(`assignment-${selectedAssignment.id}-student-${activeStudentId}`);
                }}
onElementUpdate={async (elementId: string, data: any) => {
                  await fetch(`/api/lessons/assignment-${selectedAssignment.id}-student-${activeStudentId}/whiteboard/${elementId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data })
                  });
                  fetchElements(`assignment-${selectedAssignment.id}-student-${activeStudentId}`);
                }}
onElementDelete={async (elementId: string) => {
                  await fetch(`/api/lessons/assignment-${selectedAssignment.id}-student-${activeStudentId}/whiteboard/${elementId}`, {
                    method: 'DELETE'
                  });
                  fetchElements(`assignment-${selectedAssignment.id}-student-${activeStudentId}`);
                }}
onClearBoard={async () => {
                  await fetch(`/api/lessons/assignment-${selectedAssignment.id}-student-${activeStudentId}/whiteboard`, {
                    method: 'DELETE'
                  });
                  fetchElements(`assignment-${selectedAssignment.id}-student-${activeStudentId}`);
                }}
onRefresh={() => fetchElements(`assignment-${selectedAssignment.id}-student-${activeStudentId}`)}
/>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}
