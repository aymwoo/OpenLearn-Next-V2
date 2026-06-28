import React from "react";
import { QuickActionsMenu } from "../../components/QuickActionsMenu";
import Markdown from "react-markdown";
import { Activity, Clock, BookOpen, Users, BarChart2, ShieldAlert, Check, X, Loader2, Search, Wand2, ChevronDown, ChevronUp, Folder } from "lucide-react";
import type { Lesson, ClassType, StudentType, ScheduleType, ProcessType } from "../../store/appStore";

interface DashboardProps {
  lang: string; t: Record<string,string>;
  lessons: Lesson[]; classes: ClassType[]; students: StudentType[];
  todaySchedules: ScheduleType[];
  approvals: any[]; processes: ProcessType[];
  isApprovalsCollapsed: boolean; setIsApprovalsCollapsed: (v:boolean)=>void;
  isProcessesCollapsed: boolean; setIsProcessesCollapsed: (v:boolean)=>void;
  scoreOverrides: Record<string,number>; setScoreOverrides: (v:Record<string,number>)=>void;
  handleApprove: (id:string,overrides?:any)=>Promise<void>;
  handleReject: (id:string)=>Promise<void>;
  showLogs: boolean; setShowLogs: (v:boolean)=>void;
  processLogsContent: string; showProcessLogs: string|null;
  fetchProcessLogs: (id:string)=>Promise<void>; setShowProcessLogs: (id:string|null)=>void;
  addToast: (title:string,msg:string,type?:string)=>void;
  handleQuickScheduleClass: (classId:string,lessonId:string,date:string)=>Promise<boolean>;
  handleQuickGenerateAssignment: (classId:string,title:string,desc:string)=>Promise<string|null>;
  handleQuickCreateLesson: (title:string,content:string)=>Promise<string>;
}

export function Dashboard(props: DashboardProps) {
  const {lang,t,lessons,classes,students,todaySchedules,approvals,processes,
    isApprovalsCollapsed,setIsApprovalsCollapsed,isProcessesCollapsed,setIsProcessesCollapsed,
    scoreOverrides,setScoreOverrides,handleApprove,handleReject,
    showLogs,setShowLogs,processLogsContent,showProcessLogs,fetchProcessLogs,setShowProcessLogs,
    addToast,handleQuickScheduleClass,handleQuickGenerateAssignment,handleQuickCreateLesson}=props;
              <>
                <div className="flex-1 flex flex-col gap-6 h-full overflow-y-auto pr-2">
                  {/* Today's Timetable Flow Dashboard Banner */}
                  {(() => {
                    const isScheduleUpcoming = (sch: any) => {
                      if (sch.status === 'cancelled' || sch.status === 'holiday') return false;
                      if (!sch.time_slot) return true;
                      try {
                        const parts = sch.time_slot.split('-');
                        if (parts.length < 2) return true;
                        const endTimeStr = parts[1].trim();
                        const [endHour, endMin] = endTimeStr.split(':').map(Number);
                        const now = new Date();
                        const currentHour = now.getHours();
                        const currentMin = now.getMinutes();
                        if (currentHour > endHour) return false;
                        if (currentHour === endHour && currentMin >= endMin) return false;
                        return true;
                      } catch (e) {
                        return true;
                      }
                    };
                    const upcoming = todaySchedules.filter(isScheduleUpcoming);
                    const finishedCount = todaySchedules.length - upcoming.length;
                    const cancelledToday = todaySchedules.filter(s => s.status === 'cancelled' || s.status === 'holiday');
                    
                    const nextClass = upcoming[0];
                    return (
                      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 text-slate-800 shadow-sm flex flex-col md:flex-row justify-between items-stretch gap-6 transition-all duration-300">
                        {/* Left Side: Next Class Prominent Card */}
                        <div className="flex-1 flex flex-col justify-between bg-slate-50/50 rounded-xl p-4.5 border border-slate-200/60 min-h-[160px]">
                          {nextClass ? (
                            <div className="flex-1 flex flex-col justify-between">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="bg-amber-400 text-slate-950 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider animate-pulse shadow-xs">
                                    {lang === 'zh' ? '下一堂面授课' : 'NEXT CLASS'}
                                  </span>
                                  <span className="font-mono text-xs text-indigo-700 font-bold bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100/30">
                                    {nextClass.time_slot}
                                  </span>
                                </div>
                                <h3 className="text-lg md:text-xl font-extrabold tracking-tight mt-3 text-slate-800 line-clamp-2" title={nextClass.lesson_title}>
                                  {nextClass.lesson_title}
                                </h3>
                                <p className="text-xs text-slate-500 mt-2 font-medium">
                                  📍 {nextClass.class_name} {nextClass.classroom && ` | 教室: ${nextClass.classroom}`} {nextClass.teacher_name && ` | 教师: ${nextClass.teacher_name}`}
                                </p>
                              </div>
                              {nextClass.notes && (
                                <div className="mt-3 text-xs italic text-indigo-700 bg-indigo-50/60 p-2 rounded-lg border border-indigo-100/40 truncate" title={nextClass.notes}>
                                  * {nextClass.notes}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="flex-1 flex flex-col justify-center items-center text-center py-6 select-none">
                              <span className="text-3xl animate-bounce">☕</span>
                              <h3 className="text-base font-extrabold text-slate-850 mt-2">
                                {lang === 'zh' ? '今日课程已全部结束' : 'All Classes Finished'}
                              </h3>
                              <p className="text-xs text-slate-455 mt-1 max-w-[280px]">
                                {lang === 'zh' ? '接下来暂无排定课次，您可以休息调整。' : 'No remaining schedules today. Take a rest!'}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Right Side: Todays Schedule Text List */}
                        <div className="w-full md:w-[300px] lg:w-[350px] flex flex-col gap-3">
                          <div className="flex justify-between items-center border-b border-slate-200/80 pb-2">
                            <span className="text-[11px] uppercase font-extrabold tracking-wider text-indigo-600 flex items-center gap-1.5">
                              📅 {lang === 'zh' ? '今日面授排课流' : "TODAY'S SCHEDULES"}
                            </span>
                            <span className="text-[10px] text-slate-500 font-medium">
                              {lang === 'zh' 
                                ? `共 ${todaySchedules.length} 节 | 已下课 ${finishedCount} 节` 
                                : `Total ${todaySchedules.length} | Done ${finishedCount}`}
                            </span>
                          </div>

                          {todaySchedules.length === 0 ? (
                            <div className="flex-1 flex items-center justify-center text-xs font-bold text-slate-450 py-6">
                              ☕ {lang === 'zh' ? '今日暂无排定课次' : 'No schedules configured.'}
                            </div>
                          ) : (
                            <div className="space-y-2 max-h-[150px] overflow-y-auto pr-1">
                              {todaySchedules.map((sch: any) => {
                                const isNext = nextClass && sch.id === nextClass.id;
                                const isFuture = upcoming.some(u => u.id === sch.id) && !isNext;
                                const isCancel = sch.status === 'cancelled' || sch.status === 'holiday';
                                const isFinished = !isNext && !isFuture && !isCancel;

                                return (
                                  <div key={sch.id} className={`flex items-center justify-between text-xs py-1 border-b border-slate-100 last:border-b-0 ${
                                    isFinished ? 'opacity-50' : isCancel ? 'opacity-35 line-through' : ''
                                  }`}>
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="font-mono text-[10px] text-slate-500 shrink-0">{sch.time_slot}</span>
                                      <span className={`font-bold truncate max-w-[120px] lg:max-w-[150px] ${isNext ? 'text-indigo-650' : 'text-slate-700'}`} title={sch.lesson_title}>
                                        {sch.lesson_title}
                                      </span>
                                      <span className="text-[9px] text-slate-455 truncate max-w-[60px] lg:max-w-[80px]">({sch.class_name})</span>
                                    </div>
                                    <div className="shrink-0 ml-2">
                                      {isNext && <span className="bg-amber-400 text-slate-950 font-extrabold text-[8px] px-1.5 py-0.5 rounded uppercase scale-90 inline-block animate-pulse shadow-xs">进行</span>}
                                      {isFinished && <span className="bg-slate-100 text-slate-500 text-[8px] px-1.5 py-0.5 rounded font-bold">已完</span>}
                                      {isFuture && <span className="bg-indigo-50 text-indigo-700 text-[8px] px-1.5 py-0.5 rounded font-medium border border-indigo-100/50">待上</span>}
                                      {isCancel && <span className="bg-rose-50 text-rose-600 text-[8px] px-1.5 py-0.5 rounded font-bold border border-rose-100/50">停课</span>}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Stats Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    {/* Course Stat */}
                    <div className="bg-gradient-to-br from-indigo-50/60 to-indigo-100/10 border border-indigo-100/60 rounded-2xl p-5 shadow-xs flex items-center justify-between hover:shadow-sm hover:-translate-y-0.5 transition-all duration-300">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-bold text-indigo-655 uppercase tracking-wider">
                          {lang === 'zh' ? '课程数量' : 'Total Courses'}
                        </span>
                        <span className="text-3xl font-extrabold text-slate-800 tracking-tight leading-none mt-1">
                          {lessons.length}
                        </span>
                      </div>
                      <div className="p-3 bg-indigo-500/10 text-indigo-600 rounded-xl">
                        <BookOpen size={24} />
                      </div>
                    </div>

                    {/* Class Stat */}
                    <div className="bg-gradient-to-br from-pink-50/60 to-pink-100/10 border border-pink-100/60 rounded-2xl p-5 shadow-xs flex items-center justify-between hover:shadow-sm hover:-translate-y-0.5 transition-all duration-300">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-bold text-pink-600 uppercase tracking-wider">
                          {lang === 'zh' ? '班级数量' : 'Total Classes'}
                        </span>
                        <span className="text-3xl font-extrabold text-slate-800 tracking-tight leading-none mt-1">
                          {classes.length}
                        </span>
                      </div>
                      <div className="p-3 bg-pink-500/10 text-pink-600 rounded-xl">
                        <Folder size={24} />
                      </div>
                    </div>

                    {/* Student Stat */}
                    <div className="bg-gradient-to-br from-emerald-50/60 to-emerald-100/10 border border-emerald-100/60 rounded-2xl p-5 shadow-xs flex items-center justify-between hover:shadow-sm hover:-translate-y-0.5 transition-all duration-300">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-bold text-emerald-650 uppercase tracking-wider">
                          {lang === 'zh' ? '学生数量' : 'Total Students'}
                        </span>
                        <span className="text-3xl font-extrabold text-slate-800 tracking-tight leading-none mt-1">
                          {students.length}
                        </span>
                      </div>
                      <div className="p-3 bg-emerald-500/10 text-emerald-600 rounded-xl">
                        <Users size={24} />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                    {/* Approvals Module */}
                    <div className="bg-white border border-rose-100 rounded-2xl shadow-sm flex flex-col transition-all duration-300">
                      <div 
                        onClick={() => setIsApprovalsCollapsed(!isApprovalsCollapsed)}
                        className="p-4 border-b border-rose-50 flex items-center justify-between cursor-pointer select-none hover:bg-rose-50/20 rounded-t-2xl transition-colors"
                      >
                        <h3 className="font-extrabold text-sm md:text-base text-rose-700 flex items-center gap-2">
                          <ShieldAlert size={18} />
                          {t.approvals}
                          {approvals.length > 0 && (
                            <span className="bg-rose-100 text-rose-700 text-xs px-2 py-0.5 rounded-full font-bold ml-1">
                              {approvals.length}
                            </span>
                          )}
                        </h3>
                        <div className="text-rose-400 hover:text-rose-600 transition-colors">
                          {isApprovalsCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                        </div>
                      </div>
                      
                      {!isApprovalsCollapsed && (
                        <div className="flex-1 overflow-y-auto p-3 max-h-[350px]">
                          {approvals.length === 0 ? (
                            <div className="text-center p-8 text-xs md:text-sm text-slate-400 font-medium">
                              {t.noApprovals}
                            </div>
                          ) : (
                            approvals.map(approval => {
                              let payload: any = {};
                              try { payload = JSON.parse(approval.payload || '{}'); } catch(e) {}
                              const isGrade = approval.command_type === 'ai.apply_grade';
                              const currentScore = scoreOverrides[approval.id] !== undefined ? scoreOverrides[approval.id] : (payload.score || 0);

                              return (
                                <div key={approval.id} className="w-full p-4 rounded-xl text-sm bg-slate-55 border border-slate-100 mb-3 shadow-3xs flex flex-col gap-3 hover:border-rose-150 transition-colors">
                                  <div>
                                    <div className="font-extrabold text-slate-800 mb-1">{approval.command_type === 'ai.apply_grade' ? '🎓 Evaluate Submission' : approval.command_type}</div>
                                    <div className="text-xs text-slate-500 font-mono mb-2 line-clamp-2 bg-white border border-slate-100 p-2 rounded-lg" title={approval.payload}>
                                      {isGrade ? `Feedback: ${payload.feedback}` : approval.payload}
                                    </div>
                                  </div>
                                  {isGrade && (
                                    <div className="bg-white border border-slate-150 p-2 rounded-xl flex items-center justify-between gap-3">
                                      <label className="text-xs font-bold text-slate-700">Modify Score:</label>
                                      <input 
                                        type="number" 
                                        className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                        value={currentScore}
                                        onChange={e => setScoreOverrides(prev => ({ ...prev, [approval.id]: parseInt(e.target.value) || 0 }))}
                                      />
                                    </div>
                                  )}
                                  <div className="flex gap-2 justify-end mt-1">
                                    <button 
                                      onClick={() => handleApprove(approval.id, isGrade && scoreOverrides[approval.id] !== undefined ? { score: scoreOverrides[approval.id] } : undefined)} 
                                      className="p-1.5 px-3.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all animate-none"
                                    >
                                      <Check size={14} /> {t.approve}
                                    </button>
                                    <button 
                                      onClick={() => handleReject(approval.id)} 
                                      className="p-1.5 px-3.5 bg-slate-100 hover:bg-slate-200 text-slate-750 rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-3xs transition-all"
                                    >
                                      <X size={14} /> {t.reject}
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>

                    {/* Process Manager Module */}
                    <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm flex flex-col transition-all duration-300">
                      <div 
                        onClick={() => setIsProcessesCollapsed(!isProcessesCollapsed)}
                        className="p-4 border-b border-slate-100 flex items-center justify-between cursor-pointer select-none hover:bg-slate-50/20 rounded-t-2xl transition-colors"
                      >
                        <h3 className="font-extrabold text-sm md:text-base text-slate-700 flex items-center gap-2">
                          <Activity size={18} className="text-indigo-500" />
                          {t.processes}
                          {processes.length > 0 && (
                            <span className="bg-indigo-50 text-indigo-700 text-xs px-2 py-0.5 rounded-full font-bold ml-1">
                              {processes.length}
                            </span>
                          )}
                        </h3>
                        <div className="text-slate-400 hover:text-slate-650 transition-colors">
                          {isProcessesCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                        </div>
                      </div>
                      
                      {!isProcessesCollapsed && (
                        <div className="flex-1 overflow-y-auto p-3 max-h-[350px]">
                          {processes.length === 0 ? (
                            <div className="text-center p-8 text-xs md:text-sm text-slate-400 font-medium">
                              {t.noProcesses}
                            </div>
                          ) : (
                            processes.map(proc => (
                              <div key={proc.id} className="w-full p-4 rounded-xl text-sm bg-slate-50 border border-slate-100 mb-3 shadow-3xs flex flex-col gap-2.5 hover:border-indigo-150 transition-colors">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="font-extrabold text-slate-800 truncate" title={proc.name}>{proc.name}</span>
                                  <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full font-bold ${proc.status === 'running' ? 'bg-blue-100 text-blue-700' : proc.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : proc.status === 'failed' ? 'bg-rose-100 text-rose-700' : 'bg-slate-200 text-slate-700'}`}>
                                    {proc.status}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center mt-1">
                                  <span className="text-[10px] text-slate-400 font-mono">PID: {proc.pid || 'N/A'}</span>
                                  <button onClick={() => setShowProcessLogs(proc.id)} className="text-xs font-bold text-indigo-650 hover:text-indigo-850 transition-colors">
                                    {t.processLogs}
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <QuickActionsMenu
                  classes={classes}
                  lessons={lessons}
                  lang={lang}
                  onScheduleClass={handleQuickScheduleClass}
                  onGenerateAssignment={handleQuickGenerateAssignment}
                  onCreateLesson={handleQuickCreateLesson}
                />
              </>
}
