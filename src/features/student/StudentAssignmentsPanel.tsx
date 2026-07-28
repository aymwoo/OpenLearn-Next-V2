import { ClipboardList, Clock, CheckCircle2, PenTool, FileBadge } from 'lucide-react';

export interface StudentAssignmentsPanelProps {
  assignments: any[];
  setSelectedAssignment: (ast: any) => void;
  setStudentViewStatus: (status: 'dashboard' | 'lesson' | 'assignment') => void;
  setQuizStudentAnswers: (answers: any) => void;
  setSubAssignmentTab: (tab: string) => void;
  lang: 'zh' | 'en';
}

export function StudentAssignmentsPanel(props: StudentAssignmentsPanelProps) {
  const { assignments, setSelectedAssignment, setStudentViewStatus, setQuizStudentAnswers, setSubAssignmentTab, lang } = props;
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col">
      <div className="p-4 border-b border-gray-100 flex items-center gap-2">
         <ClipboardList size={18} className="text-indigo-500" />
         <h3 className="font-semibold text-gray-800">My Assignments</h3>
      </div>
      <div className="p-4 flex-1">
        {assignments.length === 0 ? (
          <div className="text-center p-8 text-gray-400 italic text-sm">No assignments given.</div>
        ) : (
          <div className="space-y-3">
            {assignments.map((ast: any) => (
              <div key={ast.id} className="flex flex-col p-3 rounded-lg border border-gray-100 bg-gray-50 hover:bg-gray-100 transition-colors">
                 <div className="flex justify-between items-start mb-1">
                    <div className="font-semibold text-indigo-900">{ast.title}</div>
                    {!ast.submission_status && <span className="bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold">Pending</span>}
                    {ast.submission_status === 'submitted' && <span className="bg-blue-100 text-blue-800 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold">Awaiting Grade</span>}
                    {ast.submission_status === 'graded' && (
                      <div className="flex items-center gap-1.5 shrink-0 relative group/ast-badge">
                        {ast.graded_at && (
                          <div className="text-gray-400 hover:text-indigo-600 transition-colors cursor-help p-0.5">
                            <Clock size={11} />
                            <div className="absolute right-0 bottom-full mb-1.5 hidden group-hover/ast-badge:block bg-gray-900 text-white text-[10px] p-2 rounded-xl shadow-xl z-25 whitespace-nowrap font-sans font-normal normal-case">
                              {lang === 'zh'
                                ? `评审反馈时间: ${new Date(ast.graded_at).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                                : `Feedback Hour: ${new Date(ast.graded_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                              <div className="absolute top-full right-2 -mt-1 border-4 border-transparent border-t-gray-900" />
                            </div>
                          </div>
                        )}
                        <span className="bg-green-100 text-green-800 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold text-center">Score: {ast.score}%</span>
                      </div>
                    )}
                 </div>
                 <div className="text-xs text-gray-500 mb-2">{ast.class_name} &middot; <span className="text-gray-400 italic">{ast.content}</span></div>

                 {ast.submission_status === 'graded' && ast.feedback && (
                   <div className="mt-2 bg-green-50 p-2.5 rounded-lg border border-green-100 flex flex-col gap-1 text-xs text-green-800">
                     <div className="flex items-center justify-between gap-2 border-b border-green-100/50 pb-1 mb-0.5">
                       <div className="flex items-center gap-1 font-semibold">
                         <CheckCircle2 size={13} className="shrink-0 text-green-600" />
                         <span>{lang === 'zh' ? '教师评审意见' : 'Teacher Feedback'}</span>
                       </div>
                       {ast.graded_at && (
                         <div className="flex items-center gap-1 text-[9px] text-green-600 font-mono bg-white/70 px-1.5 py-0.5 rounded border border-green-100/50 relative group/ast-time cursor-help">
                           <Clock size={10} className="inline" />
                           <span>
                             {new Date(ast.graded_at).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })}
                           </span>
                           <div className="absolute right-0 bottom-full mb-1.5 hidden group-hover/ast-time:block bg-gray-900 text-white text-[10px] p-2 rounded-lg shadow-xl z-20 whitespace-nowrap font-sans font-normal text-left">
                             {lang === 'zh'
                               ? `评审反馈于: ${new Date(ast.graded_at).toLocaleString('zh-CN')}`
                               : `Feedback provided on: ${new Date(ast.graded_at).toLocaleString('en-US')}`}
                             <div className="absolute top-full right-3 -mt-1 border-4 border-transparent border-t-gray-900" />
                           </div>
                         </div>
                       )}
                     </div>
                     <span className="leading-snug bg-green-50/20 rounded p-1 text-xs text-gray-700 whitespace-pre-wrap">{ast.feedback}</span>
                   </div>
                 )}

                 {!ast.submission_status && (
                    <div className="mt-2 text-right flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          setSelectedAssignment(ast);
                          setStudentViewStatus('assignment');
                          setQuizStudentAnswers({});
                          setSubAssignmentTab('quiz');
                        }}
                        className="px-3 py-1.5 bg-indigo-100 text-indigo-700 hover:bg-indigo-200 text-xs rounded shadow-sm focus:outline-none transition-colors font-medium flex items-center gap-1.5"
                      >
                        <PenTool size={14} /> Open Canvas
                      </button>
                    </div>
                 )}
                 {ast.submission_status && (
                    <div className="mt-2 text-right">
                      <button
                        onClick={() => {
                          setSelectedAssignment(ast);
                          setStudentViewStatus('assignment');
                          setSubAssignmentTab('quiz');
                          if (ast.submission_content) {
                            try {
                              setQuizStudentAnswers(JSON.parse(ast.submission_content));
                            } catch (e) {
                              setQuizStudentAnswers({});
                            }
                          } else {
                            setQuizStudentAnswers({});
                          }
                        }}
                        className="px-3 py-1.5 bg-gray-100 text-gray-700 hover:bg-gray-200 text-xs rounded shadow-sm focus:outline-none transition-colors font-medium flex items-center gap-1.5 ml-auto"
                      >
                        <FileBadge size={14} /> View Submission
                      </button>
                    </div>
                 )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
