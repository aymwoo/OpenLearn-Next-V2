import { Activity, Loader2, FileText, Download, Wand2, CalendarIcon, Send, Clock, PenTool, ShieldAlert, CheckCircle2 } from 'lucide-react';
import type { ClassType, StudentType, Lesson } from '../../../types/app';

export interface ClassAssignmentsPanelProps {
  cls: ClassType;
  lang: 'zh' | 'en';
  cStudents: StudentType[];
  activeSubmissionFilter: string;
  classDashboardMap: Record<string, any>;
  assignmentSortOrder: string;
  setAssignmentSortOrder: (...args: any[]) => void;
  lessons: Lesson[];
  isGeneratingPDFReport: Record<string, boolean>;
  handleGeneratePDFReport: (...args: any[]) => void;
  setExportClassId: (...args: any[]) => void;
  setExportClassName: (...args: any[]) => void;
  setQuizzesWeight: (...args: any[]) => void;
  setAssignmentsWeight: (...args: any[]) => void;
  setCustomCategoryOverrides: (...args: any[]) => void;
  setIsExportWeightModalOpen: (...args: any[]) => void;
  isGeneratingAssignment: string | null;
  setQuizGeneratorClassId: (...args: any[]) => void;
  setQuizGenMode: (...args: any[]) => void;
  setQuizGenSelectedLessonId: (...args: any[]) => void;
  setQuizGenTopic: (...args: any[]) => void;
  setSuggestedObjectives: (...args: any[]) => void;
  setSuggestedQuestions: (...args: any[]) => void;
  setIsQuizGeneratorOpen: (...args: any[]) => void;
  setClassSubmissionFilters: (...args: any[]) => void;
  setActiveStudentId: (...args: any[]) => void;
  setSelectedAssignment: (...args: any[]) => void;
  setStudentViewStatus: (...args: any[]) => void;
  setActiveRole: (...args: any[]) => void;
  isGrading: Record<string, boolean>;
  setIsGrading: (...args: any[]) => void;
  fetchClassDashboard: (...args: any[]) => void;
  get30DayAverageWarning: (studentId: string, classId: string) => number | null;
}

export function ClassAssignmentsPanel(props: ClassAssignmentsPanelProps) {
  const {
    cls,
    lang,
    cStudents,
    activeSubmissionFilter,
    classDashboardMap,
    assignmentSortOrder,
    setAssignmentSortOrder,
    lessons,
    isGeneratingPDFReport,
    handleGeneratePDFReport,
    setExportClassId,
    setExportClassName,
    setQuizzesWeight,
    setAssignmentsWeight,
    setCustomCategoryOverrides,
    setIsExportWeightModalOpen,
    isGeneratingAssignment,
    setQuizGeneratorClassId,
    setQuizGenMode,
    setQuizGenSelectedLessonId,
    setQuizGenTopic,
    setSuggestedObjectives,
    setSuggestedQuestions,
    setIsQuizGeneratorOpen,
    setClassSubmissionFilters,
    setActiveStudentId,
    setSelectedAssignment,
    setStudentViewStatus,
    setActiveRole,
    isGrading,
    setIsGrading,
    fetchClassDashboard,
    get30DayAverageWarning,
  } = props;

  const recentSubs = classDashboardMap[cls.id]?.recentSubmissions || [];
  const performanceData = classDashboardMap[cls.id]?.performance || [];

  const filteredSubmissions = (() => {
    if (activeSubmissionFilter === 'all') {
      return recentSubs;
    } else if (activeSubmissionFilter === 'submitted') {
      return recentSubs.filter((sub: any) => sub.status === 'submitted');
    } else if (activeSubmissionFilter === 'graded') {
      return recentSubs.filter((sub: any) => sub.status === 'graded');
    } else if (activeSubmissionFilter === 'pending') {
      const pendingGradingSubmissions = recentSubs.filter((sub: any) => sub.status === 'submitted');
      const unsubmittedTasks = performanceData
        .filter((p: any) => !p.submission_status || p.submission_status === null)
        .map((p: any) => ({
          assignment_id: p.assignment_id,
          assignment_title: p.assignment_title,
          student_id: p.student_id,
          student_name: p.student_name,
          content: lang === 'zh' ? '尚未提交此作业' : 'Has not submitted this assignment yet',
          status: 'pending_student',
        }));
      return [...pendingGradingSubmissions, ...unsubmittedTasks];
    }
    return recentSubs;
  })();

  return (
    <div className="mb-4 bg-white p-3 rounded-xl border border-slate-100 shadow-xs">
                                 <div className="flex items-center justify-between mb-3 border-b border-gray-200 pb-2">
                                   <div className="text-xs font-semibold text-gray-700 flex items-center gap-1">
                                     <Activity size={14} className="text-indigo-500" /> Class Dashboard
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {classDashboardMap[cls.id] && (
                                        <>
                                          <button
                                            id={`generate-pdf-btn-${cls.id}`}
                                            disabled={isGeneratingPDFReport[cls.id]}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleGeneratePDFReport(cls.id, cls.name);
                                            }}
                                            className="text-white hover:bg-emerald-750 bg-emerald-600 hover:bg-emerald-700 transition-all font-semibold rounded px-2.5 py-1 text-[10px] items-center flex gap-1.5 shadow-sm cursor-pointer font-sans disabled:opacity-50"
                                          >
                                            {isGeneratingPDFReport[cls.id] ? (
                                              <Loader2 size={10} className="animate-spin" />
                                            ) : (
                                              <FileText size={10} />
                                            )}
                                            <span>{lang === 'zh' ? '下载班级 PDF 报告' : 'Download Class PDF Report'}</span>
                                          </button>
                                          <button
                                            id={`export-grades-btn-${cls.id}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setExportClassId(cls.id);
                                              setExportClassName(cls.name);
                                              setQuizzesWeight(40);
                                              setAssignmentsWeight(60);
                                              setCustomCategoryOverrides({});
                                              setIsExportWeightModalOpen(true);
                                            }}
                                            className="text-slate-700 hover:text-slate-900 border border-gray-300 bg-white hover:bg-gray-100 transition-all font-semibold rounded px-2 py-1 text-[10px] items-center flex gap-1 shadow-sm cursor-pointer font-sans"
                                          >
                                            <Download size={10} /> {lang === 'zh' ? '选项与导出' : 'Export Grades'}
                                          </button>
                                        </>
                                      )}
                                    <button
                                      disabled={isGeneratingAssignment === cls.id}
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                         setQuizGeneratorClassId(cls.id);
                                         setQuizGenMode('scan_lesson');
                                         if (lessons.length > 0) {
                                           setQuizGenSelectedLessonId(lessons[0].id);
                                         } else {
                                           setQuizGenSelectedLessonId('');
                                         }
                                         setQuizGenTopic('');
                                         setSuggestedObjectives([]);
                                         setSuggestedQuestions([]);
                                         setIsQuizGeneratorOpen(true);
                                       }}
                                      className="text-white bg-indigo-500 hover:bg-indigo-600 px-2 py-1 rounded text-[10px] items-center flex gap-1 shadow-sm disabled:opacity-50"
                                    >
                                      {isGeneratingAssignment === cls.id ? <Loader2 size={10} className="animate-spin" /> : <Wand2 size={10} />} Generate AI Quiz
                                    </button>
                                    </div>
                                 </div>
                                 
                                 {classDashboardMap[cls.id] ? (
                                   <div className="space-y-4">
                                     {/* Pending Assignments */}
                                     <div>
                                       <div className="flex items-center justify-between mb-2">
                                          <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                                            {lang === 'zh' ? '班级作业与测验' : 'Class Assignments & Quizzes'}
                                          </div>
                                          <div className="flex items-center gap-1.5 bg-white border border-gray-200 px-2 py-1 rounded-lg shadow-sm">
                                            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                                              {lang === 'zh' ? '排序：' : 'Sort:'}
                                            </span>
                                            <select
                                              value={assignmentSortOrder}
                                              onChange={(e) => setAssignmentSortOrder(e.target.value as any)}
                                              className="bg-transparent border-0 text-[10px] text-gray-750 font-bold focus:outline-none focus:ring-0 p-0 cursor-pointer outline-none font-sans"
                                              id="assignment-sort-select"
                                            >
                                              <option value="dueDate">{lang === 'zh' ? '截止日期' : 'Due Date'}</option>
                                              <option value="status">{lang === 'zh' ? '评分状态' : 'Status (Graded/Pending)'}</option>
                                              <option value="avgScore">{lang === 'zh' ? '平均分' : 'Average Score'}</option>
                                            </select>
                                          </div>
                                        </div>
                                       <div className="grid gap-2 grid-cols-2">
                                         {classDashboardMap[cls.id].assignments && (() => {
                                            const rawAssignments = classDashboardMap[cls.id]?.assignments || [];
                                            const perf = classDashboardMap[cls.id]?.performance || [];
                                            const processed = rawAssignments.map((ast: any) => {
                                              const astPerf = perf.filter((p: any) => p.assignment_id === ast.id);
                                              const totalSt = astPerf.length;
                                              const pendingGradingCount = astPerf.filter((p: any) => p.submission_status === 'submitted').length;
                                              const gradedCount = astPerf.filter((p: any) => p.submission_status === 'graded').length;
                                              let status: 'pending' | 'graded' = 'pending';
                                              let statusLabel = lang === 'zh' ? '未提交' : 'No Submissions';
                                              if (pendingGradingCount > 0) {
                                                status = 'pending';
                                                statusLabel = lang === 'zh' ? '待评分' : 'Pending Grading';
                                              } else if (gradedCount > 0) {
                                                status = 'graded';
                                                statusLabel = lang === 'zh' ? '已评分' : 'Graded';
                                              }
                                              const gradedScores = astPerf.filter((p: any) => p.score !== null && p.score !== undefined).map((p: any) => Number(p.score));
                                              const avgScore = gradedScores.length > 0 ? Math.round(gradedScores.reduce((a: number, b: number) => a + b, 0) / gradedScores.length) : null;
                                              const dueDateTimestamp = ast.created_at + 7 * 24 * 60 * 60 * 1000;
                                              return { ...ast, dueDateTimestamp, status, statusLabel, avgScore, pendingGradingCount, gradedCount };
                                            });
                                            const sorted = processed.sort((a: any, b: any) => {
                                              if (assignmentSortOrder === 'dueDate') {
                                                return a.dueDateTimestamp - b.dueDateTimestamp;
                                              } else if (assignmentSortOrder === 'status') {
                                                if (a.status === b.status) return b.dueDateTimestamp - a.dueDateTimestamp;
                                                return a.status === 'pending' ? -1 : 1;
                                              } else if (assignmentSortOrder === 'avgScore') {
                                                const scoreA = a.avgScore !== null ? a.avgScore : -1;
                                                const scoreB = b.avgScore !== null ? b.avgScore : -1;
                                                return scoreB - scoreA;
                                              }
                                              return 0;
                                            });
                                            return sorted.map((ast: any) => (
  // DUMMY COMMENT TO SILENCE COMPILER BINDING
                                           <div key={ast.id} className="bg-white p-3 rounded-xl border border-gray-150 hover:border-indigo-200 shadow-sm text-xs cursor-pointer hover:shadow transition-all flex flex-col justify-between">
                                              <div className="flex items-start justify-between gap-1.5 mb-1.5">
                                                 <div className="font-semibold text-gray-800 line-clamp-1 flex-1 font-sans" title={ast.title}>{ast.title}</div>
                                                 <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 border uppercase tracking-wider font-sans ${
                                                   ast.status === 'graded' 
                                                     ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                                                     : ast.pendingGradingCount > 0 
                                                       ? 'bg-amber-50 text-amber-700 border-amber-100' 
                                                       : 'bg-gray-50 text-gray-500 border-gray-100'
                                                 }`}>
                                                   {ast.statusLabel}
                                                 </span>
                                               </div>
                                              <div className="text-gray-500 text-[10px] line-clamp-2 leading-normal mb-2.5 font-sans">{ast.description || ast.content}</div>
                                              {/* A button to submit/grade here could be nice, but keeping it simple */}
                                              <div className="flex items-center justify-between border-t border-gray-55 pt-2 mt-auto gap-2">
                                                 <div className="flex items-center gap-1.5 font-sans">
                                                   <span className="text-[10px] text-gray-400 font-medium">
                                                     {lang === 'zh' ? '截止: ' : 'Due: '}
                                                     <span className="text-gray-600 font-semibold">{new Date(ast.dueDateTimestamp).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })}</span>
                                                   </span>
                                                   {ast.avgScore !== null && (
                                                     <span className="inline-flex items-center gap-0.5 bg-indigo-50 text-indigo-700 border border-indigo-100 px-1.5 py-0.5 rounded text-[9px] font-bold">
                                                       {lang === 'zh' ? '均分' : 'Avg'}: {ast.avgScore}%
                                                     </span>
                                                   )}
                                                 </div>
                                                <button 
                                                    onClick={async (e) => {
                                                      e.stopPropagation();
                                                      if (cStudents.length === 0) return alert('No students in class to submit!');
                                                      const s = cStudents[Math.floor(Math.random() * cStudents.length)];
                                                      const subText = window.prompt(`Simulate student '${s.name}' submitting:`);
                                                      if (subText) {
                                                        const res = await fetch(`/api/assignments/${ast.id}/submissions`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ studentId: s.id, content: subText }) });
                                                        if (res.ok) await fetchClassDashboard(cls.id);
                                                      }
                                                    }}
                                                    className="text-[9px] text-indigo-600 border border-indigo-200 hover:border-indigo-300 hover:bg-indigo-50/50 bg-white px-2 py-0.5 rounded font-bold flex items-center gap-1 cursor-pointer transition-all shrink-0 font-sans"
                                                >
                                                  <Send size={8} /> {lang === 'zh' ? '模拟' : 'Simulate'}
                                                </button>
                                              </div>
                                           </div>
                                           ));
                                         })()}
                                         {classDashboardMap[cls.id].assignments.length === 0 && (
                                           <div className="text-xs text-gray-400 italic">No assignments yet.</div>
                                         )}
                                       </div>
                                     </div>

                                     {/* Recent Submissions */}
                                     <div>
                                       <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2 border-b border-gray-100 pb-1.5 pt-1">
                                          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                                            <CalendarIcon size={11} className="text-gray-400" />
                                            {lang === 'zh' ? '近期作业提交' : 'Recent Submissions'}
                                          </div>
                                          
                                          {/* Filter Pill Buttons */}
                                          <div className="flex items-center gap-1 bg-gray-50 p-0.5 rounded-lg border border-gray-200">
                                            {(['all', 'submitted', 'graded', 'pending'] as const).map((filterOpt) => {
                                              const isActive = activeSubmissionFilter === filterOpt;
                                              const optCounts = (() => {
                                                if (filterOpt === 'all') return recentSubs.length;
                                                if (filterOpt === 'submitted') return recentSubs.filter((s: any) => s.status === 'submitted').length;
                                                if (filterOpt === 'graded') return recentSubs.filter((s: any) => s.status === 'graded').length;
                                                if (filterOpt === 'pending') {
                                                  const pGrading = recentSubs.filter((s: any) => s.status === 'submitted').length;
                                                  const pStudent = performanceData.filter((p: any) => !p.submission_status || p.submission_status === null).length;
                                                  return pGrading + pStudent;
                                                }
                                                return 0;
                                              })();

                                              const labelLocal = {
                                                all: lang === 'zh' ? '全部' : 'All',
                                                submitted: lang === 'zh' ? '待评分' : 'Submitted',
                                                graded: lang === 'zh' ? '已完成' : 'Graded',
                                                pending: lang === 'zh' ? '待完成' : 'Pending'
                                              }[filterOpt];

                                              return (
                                                <button
                                                  key={filterOpt}
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setClassSubmissionFilters(prev => ({ ...prev, [cls.id]: filterOpt }));
                                                  }}
                                                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all cursor-pointer flex items-center gap-1 font-sans ${
                                                    isActive 
                                                      ? 'bg-white shadow-sm text-indigo-600 border border-indigo-100' 
                                                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 border border-transparent'
                                                  }`}
                                                >
                                                  <span>{labelLocal}</span>
                                                  <span className={`px-1 py-0.1 ml-0.5 rounded-full text-[8.5px] leading-tight ${
                                                    isActive 
                                                      ? 'bg-indigo-50 text-indigo-600 font-bold' 
                                                      : 'bg-gray-200/60 text-gray-400 font-medium'
                                                  }`}>
                                                    {optCounts}
                                                  </span>
                                                </button>
                                              );
                                            })}
                                          </div></div>
                                       <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-1">
                                         {filteredSubmissions.map((sub: any, idx: number) => (



                                           <div key={sub.status === 'pending_student' ? `${sub.assignment_id}-${sub.student_id}-pending-${idx}` : `${sub.assignment_id}-${sub.student_id}-${idx}`} className="bg-white p-2 border border-gray-150 rounded-lg text-xs flex justify-between items-center group hover:border-gray-300 transition-colors shadow-none mt-0.5">
                                             <div className="flex-1 min-w-0 pr-2">
                                               <div className="font-semibold text-gray-800 truncate flex items-center gap-1.5">
                                                  <span className="max-w-[110px] truncate">{sub.student_name}</span>
                                                  <span className="text-[10px] text-gray-400 font-normal">in</span>
                                                  <span className="truncate text-gray-500 max-w-[130px]" title={sub.assignment_title}>{sub.assignment_title}</span></div>
                                               <div className="text-[10px] text-gray-500 truncate italic mt-0.5">
                                                  {sub.status === 'pending_student' ? (
                                                    <span className="text-amber-500 font-medium flex items-center gap-1">
                                                      <Clock size={10} className="animate-pulse" />
                                                      {sub.content}
                                                    </span>
                                                  ) : (
                                                    `"${sub.content}"`
                                                  )}</div>
                                             </div>
                                             <div className="shrink-0 flex items-center justify-end gap-1.5">
                                                {sub.status !== 'pending_student' && (
                                               <button
                                                 onClick={() => {
                                                   setActiveStudentId(sub.student_id);
                                                   setSelectedAssignment({ 
                                                     id: sub.assignment_id, 
                                                     title: sub.assignment_title, 
                                                     student_id: sub.student_id, 
                                                     student_name: sub.student_name,
                                                     submission_status: sub.status,
                                                     score: sub.score,
                                                     feedback: sub.feedback,
                                                     content: sub.question_content // Optional if available
                                                   });
                                                   setStudentViewStatus('assignment');
                                                   setActiveRole('student');
                                                 }}
                                                 className="text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded-md text-[9px] flex items-center gap-1 shadow-none font-bold border border-indigo-100 hover:border-indigo-200 transition-all cursor-pointer"
                                               >
                                                 <PenTool size={9} /> Live Canvas
                                               </button>
                                               )}
                                                {sub.status === 'graded' ? (
                                                 <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${sub.score >= 85 
                                                      ? 'bg-green-100 text-green-700 border border-green-200' 
                                                      : sub.score >= 70 
                                                      ? 'bg-indigo-100 text-indigo-700 border border-indigo-200' 
                                                      : 'bg-yellow-105 text-yellow-700 border border-yellow-250'}`}>
                                                   {sub.score}%
                                                 </span>
                                               ) : (
                                                <button 
                                                  disabled={isGrading[`${sub.assignment_id}-${sub.student_id}`]}
                                                  onClick={async () => {
                                                    setIsGrading(p => ({...p, [`${sub.assignment_id}-${sub.student_id}`]: true}));
                                                    try {
                                                      const res = await fetch(`/api/assignments/${sub.assignment_id}/submissions/${sub.student_id}/grade`, { method: 'POST' });
                                                      if (res.ok) await fetchClassDashboard(cls.id);
                                                    } finally {
                                                      setIsGrading(p => ({...p, [`${sub.assignment_id}-${sub.student_id}`]: false}));
                                                    }
                                                  }}
                                                  className="text-white bg-green-500 hover:bg-green-600 px-2 py-1 rounded-md text-[9px] flex items-center gap-1 shadow-sm font-bold border border-green-600 hover:border-green-700 hover:-translate-y-0.1 transition-all disabled:opacity-50 cursor-pointer"
                                                >
                                                  {isGrading[`${sub.assignment_id}-${sub.student_id}`] ? <Loader2 size={10} className="animate-spin" /> : <Wand2 size={10} />} {lang === 'zh' ? '评分' : 'Grade'}
                                                </button>
                                               )}
                                             </div>
                                           </div>
                                         ))}
                                         {filteredSubmissions.length === 0 && (
                                           <div className="text-xs text-gray-400 italic p-4 text-center bg-gray-50 border border-dashed border-gray-200 rounded-lg select-none">
                                              {lang === 'zh' ? '该筛选下暂无可展示的作业项目。' : 'No submissions under this filter.'}
                                            </div>
                                         )}
                                       </div>
                                     </div>

                                     {/* Heatmap */}
                                     {classDashboardMap[cls.id].assignments.length > 0 && cStudents.length > 0 && (
                                       <div>
                                         <div className="text-[10px] font-medium text-gray-500 mb-1 uppercase tracking-wider">Class Performance Heatmap</div>
                                         <div className="overflow-x-auto border border-gray-200 rounded">
                                           <table className="w-full text-xs text-left bg-white">
                                             <thead className="bg-gray-50 sticky top-0">
                                               <tr>
                                                 <th className="p-2 border-b border-r border-gray-200 font-medium whitespace-nowrap text-gray-600">Student</th>
                                                 {classDashboardMap[cls.id].assignments.map((a: any) => (
                                                   <th key={a.id} className="p-2 border-b border-r border-gray-200 font-medium truncate max-w-[80px]" title={a.title}>
                                                     {a.title}
                                                   </th>
                                                 ))}
                                               </tr>
                                             </thead>
                                             <tbody>
                                               {cStudents.map(st => (
                                                 <tr key={st.id} className="border-b border-gray-100 last:border-b-0">
                                                   <td className="p-2 border-r border-gray-100 font-medium text-gray-700 whitespace-nowrap truncate max-w-[160px]">
                                                     <div className="flex items-center gap-1.5">
                                                       <span className="truncate" title={st.name}>{st.name}</span>
                                                       {(() => {
                                                         const avg30 = get30DayAverageWarning(st.id, cls.id);
                                                         if (avg30 !== null) {
                                                           return (
                                                             <span 
                                                               className="inline-flex items-center gap-0.5 bg-red-50 text-red-700 border border-red-200 px-1 py-0.5 rounded text-[9px] font-bold animate-pulse"
                                                               title={lang === 'zh' ? `30天平均成绩已降至60%以下 (${avg30}%)` : `30-day average has dropped below 60% (${avg30}%)`}
                                                             >
                                                               <ShieldAlert size={10} className="text-red-500" />
                                                               {avg30}%
                                                             </span>
                                                           );
                                                         }
                                                         return null;
                                                       })()}
                                                     </div>
                                                   </td>
                                                   {classDashboardMap[cls.id].assignments.map((a: any) => {
                                                      const perf = classDashboardMap[cls.id].performance.find((p: any) => p.assignment_id === a.id && p.student_id === st.id);
                                                      let bgClass = "bg-gray-50";
                                                      let text = "-";
                                                      if (perf && perf.score !== null) {
                                                        text = perf.score.toString();
                                                        if (perf.score >= 90) bgClass = "bg-green-100 text-green-800 font-medium";
                                                        else if (perf.score >= 70) bgClass = "bg-green-50 text-green-700";
                                                        else if (perf.score >= 50) bgClass = "bg-yellow-50 text-yellow-700";
                                                        else bgClass = "bg-red-50 text-red-700";
                                                      } else if (perf && perf.submission_status === 'submitted') {
                                                        text = "Wait";
                                                        bgClass = "bg-blue-50 text-blue-500 text-[9px]";
                                                      }
                                                      return (
                                                        <td key={a.id} className={`p-2 border-r border-gray-100 text-center relative group/cell ${bgClass}`}>
                                                          {(() => {
                                                            const hasGradedAt = perf && perf.graded_at;
                                                            const formattedGradedTime = hasGradedAt 
                                                              ? new Date(perf.graded_at).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
                                                                  month: 'short',
                                                                  day: 'numeric',
                                                                  hour: '2-digit',
                                                                  minute: '2-digit'
                                                                })
                                                              : '';
                                                            return (
                                                              <>
                                                                <div className="flex items-center justify-center gap-0.5 select-none font-sans">
                                                                  <span>{text}</span>
                                                                  {perf && perf.score !== null && (
                                                                    <span className="w-1 h-1 rounded-full bg-emerald-500 shrink-0 inline-block animate-pulse" />
                                                                  )}
                                                                </div>
                                                                {perf && perf.score !== null && (
                                                                  <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 hidden group-hover/cell:block bg-gray-900 border border-gray-800 text-white text-[10px] p-2.5 rounded-xl shadow-2xl z-30 w-44 pointer-events-none text-left leading-normal font-sans font-normal normal-case">
                                                                    <div className="font-bold text-[11px] mb-1 text-emerald-400 flex items-center gap-1">
                                                                      <CheckCircle2 size={11} className="shrink-0" />
                                                                      {lang === 'zh' ? '已完成评分' : 'Graded & Evaluated'}
                                                                    </div>
                                                                    {formattedGradedTime && (
                                                                      <div className="text-gray-300 flex items-center gap-1 font-semibold text-[9px] mb-1">
                                                                        <Clock size={10} className="shrink-0 text-indigo-400" />
                                                                        <span>{lang === 'zh' ? `时间: ${formattedGradedTime}` : `Graded: ${formattedGradedTime}`}</span>
                                                                      </div>
                                                                    )}
                                                                    {perf.feedback && (
                                                                      <div className="text-gray-200 mt-1 pt-1 border-t border-gray-800 line-clamp-3 text-[9px] italic">
                                                                        "{perf.feedback}"
                                                                      </div>
                                                                    )}
                                                                    <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900" />
                                                                  </div>
                                                                )}
                                                              </>
                                                            );
                                                          })()}
                                                        </td>
                                                      );
                                                   })}
                                                 </tr>
                                               ))}
                                             </tbody>
                                           </table>
                                         </div>
                                       </div>
                                     )}
                                   </div>
                                 ) : (
                                   <div className="flex justify-center p-4 text-gray-400"><Loader2 size={16} className="animate-spin" /></div>
                                 )}
    </div>
  );
}
