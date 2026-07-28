import { Wand2, CheckCircle2 } from 'lucide-react';
import Markdown from 'react-markdown';
import type { StudentType, Lesson } from '../../types/app';

export function StudentAssignmentQuestionPanel(props: {
  selectedAssignment: any;
  quizStudentAnswers: any;
  submitQuizAssignment: (isFinal: boolean) => void;
}) {
  const { selectedAssignment, quizStudentAnswers, submitQuizAssignment } = props;
  return (
    <div className="w-1/3 border-r border-gray-100 pr-4 overflow-y-auto hidden md:block">
      <div className="flex justify-between items-center mb-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          {selectedAssignment?.content && selectedAssignment.content.startsWith('{"quizType":"mcq_learning_objectives"') ? 'Assessment' : 'Question'}
        </div>
      </div>
      {selectedAssignment?.content && selectedAssignment.content.startsWith('{"quizType":"mcq_learning_objectives"') ? (
        <div className="space-y-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-teal-700 bg-teal-50 border border-teal-100 p-2.5 rounded-lg flex items-center gap-1.5 font-sans">
            <Wand2 size={12} className="text-teal-600 animate-pulse" /> AI Interactive Evaluation
          </div>
          <p className="text-xs text-gray-500 leading-relaxed font-sans">
            This assessment was automatically mapped to the core learning objectives of your lesson by our tutoring assistant compiler.
          </p>
          {(() => {
            try {
              const parsed = JSON.parse(selectedAssignment.content);
              return (
                <div className="space-y-2 font-sans">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Lesson Learning Objectives:</div>
                  <ul className="space-y-1.5">
                    {(parsed.learningObjectives || []).map((obj: string, i: number) => (
                      <li key={i} className="text-xs text-gray-755 flex items-start gap-1.5 font-medium leading-normal">
                        <span className="text-indigo-500 shrink-0 select-none">🎯</span>
                        <span>{obj}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            } catch (e) {
              return null;
            }
          })()}
        </div>
      ) : (
        <div className="prose prose-sm prose-indigo max-w-none mb-6">
          <Markdown>{selectedAssignment.content || ''}</Markdown>
        </div>
      )}

      {!selectedAssignment.submission_status && (
         <div className="mt-8 border-t border-gray-100 pt-6">
           <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Ready to submit?</div>
           <p className="text-xs text-gray-500 mb-4">
             {selectedAssignment?.content && selectedAssignment.content.startsWith('{"quizType":"mcq_learning_objectives"')
               ? "Please answer all the interactive questions on the evaluation sheet, then click Submit."
               : "You can use the whiteboard to draw or answer, then click submit when finished."}
           </p>
           <button
             onClick={async () => {
               const isMcq = selectedAssignment?.content && selectedAssignment.content.startsWith('{"quizType":"mcq_learning_objectives"');
               const contentToSubmit = isMcq ? JSON.stringify(quizStudentAnswers) : "Submitted via Whiteboard";
               if (isMcq) {
                 try {
                   const parsed = JSON.parse(selectedAssignment.content);
                   const answeredCount = Object.keys(quizStudentAnswers).length;
                   if (answeredCount < parsed.questions.length) {
                     if (!window.confirm(`You have only answered ${answeredCount}/${parsed.questions.length} questions. Are you sure you want to submit your answers?`)) {
                       return;
                     }
                   }
                 } catch (e) {}
               }
               await submitQuizAssignment(false);
             }}
             className="w-full py-2 bg-indigo-600 text-white rounded-lg shadow font-medium hover:bg-indigo-700 transition"
           >
             Submit
           </button>
         </div>
      )}
      {selectedAssignment.submission_status === 'graded' && selectedAssignment.feedback && (
        <div className="mt-6 bg-green-50 p-4 rounded-xl border border-green-100">
          <div className="font-semibold text-green-800 text-sm mb-1 flex items-center gap-1"><CheckCircle2 size={16}/> Grade: {selectedAssignment.score}%</div>
          <div className="text-xs text-green-700 whitespace-pre-wrap leading-relaxed font-sans">{selectedAssignment.feedback}</div>
        </div>
      )}
    </div>
  );
}
