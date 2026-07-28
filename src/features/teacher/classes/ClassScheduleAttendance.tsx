import { CalendarIcon, ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react';
import type { ClassType, StudentType, Lesson } from '../../../types/app';

export interface ClassScheduleAttendanceProps {
  cls: ClassType;
  lang: 'zh' | 'en';
  cStudents: StudentType[];
  newScheduleDate: string;
  setNewScheduleDate: (v: string) => void;
  newScheduleLessonId: string;
  setNewScheduleLessonId: (v: string) => void;
  lessons: Lesson[];
  fetchClassSchedules: (classId: string) => void;
  classSchedulesMap: Record<string, any>;
  expandedScheduleId: string | null;
  setExpandedScheduleId: (id: string | null) => void;
  fetchScheduleAttendance: (scheduleId: string) => void;
  scheduleAttendanceMap: Record<string, any>;
  get30DayAverageWarning: (studentId: string, classId: string) => number | null;
}

export function ClassScheduleAttendance(props: ClassScheduleAttendanceProps) {
  const {
    cls,
    lang,
    cStudents,
    newScheduleDate,
    setNewScheduleDate,
    newScheduleLessonId,
    setNewScheduleLessonId,
    lessons,
    fetchClassSchedules,
    classSchedulesMap,
    expandedScheduleId,
    setExpandedScheduleId,
    fetchScheduleAttendance,
    scheduleAttendanceMap,
    get30DayAverageWarning,
  } = props;

  return (
    <div className="mb-4 bg-white p-3 rounded-xl border border-slate-100 shadow-xs">
      <div className="flex items-center justify-between mb-3 border-b border-gray-200 pb-2">
        <div className="text-xs font-semibold text-gray-700 flex items-center gap-1">
          <CalendarIcon size={14} className="text-pink-500" /> Schedule & Attendance
        </div>
      </div>

      <div className="mb-3 flex gap-2 items-center">
        <input title="Schedule Date" type="date" className="border border-slate-200 hover:border-slate-300 rounded-lg text-xs p-1.5 flex-1 bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500 text-gray-750 transition-all font-sans" value={newScheduleDate} onChange={e => setNewScheduleDate(e.target.value)} onClick={e => e.stopPropagation()} />
        <select title="Schedule Lesson" className="border border-slate-200 hover:border-slate-300 rounded-lg text-xs p-1.5 flex-1 bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500 text-gray-750 transition-all font-sans cursor-pointer" value={newScheduleLessonId} onChange={e => setNewScheduleLessonId(e.target.value)} onClick={e => e.stopPropagation()}>
          <option value="">Select Lesson...</option>
          {lessons.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
        </select>
        <button
          className="bg-pink-500 hover:bg-pink-600 text-white p-1 px-2 rounded text-xs disabled:opacity-50 flex items-center gap-1"
          disabled={!newScheduleDate || !newScheduleLessonId}
          onClick={async (e) => {
            e.stopPropagation();
            const res = await fetch(`/api/classes/${cls.id}/schedules`, {
              method: 'POST', headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ lessonId: newScheduleLessonId, scheduledDate: newScheduleDate })
            });
            if (res.ok) {
              setNewScheduleDate(''); setNewScheduleLessonId('');
              await fetchClassSchedules(cls.id);
            }
          }}
        >
          Schedule
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {((classSchedulesMap[cls.id] || [])).length === 0 ? (
          <div className="text-xs text-gray-400 italic">No schedules yet.</div>
        ) : (
          classSchedulesMap[cls.id].map(sch => {
            const isExp = expandedScheduleId === sch.id;
            const att = scheduleAttendanceMap[sch.id] || [];
            return (
              <div key={sch.id} className="bg-white border border-slate-100/90 rounded-xl shadow-xs hover:shadow-sm transition-all overflow-hidden mb-2">
                <div
                  className="p-2 flex justify-between items-center cursor-pointer hover:bg-gray-50"
                  onClick={() => {
                    if (isExp) setExpandedScheduleId(null);
                    else { setExpandedScheduleId(sch.id); fetchScheduleAttendance(sch.id); }
                  }}
                >
                  <div className="flex items-center gap-2 text-xs">
                    {isExp ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                    <div className="flex flex-col">
                      <span className="font-semibold text-gray-800">{sch.lesson_title}</span>
                      <span className="text-[10px] text-gray-500 flex items-center gap-1"><CalendarIcon size={10} /> {sch.scheduled_date}</span>
                    </div>
                  </div>
                </div>
                {isExp && (
                  <div className="border-t border-gray-100 p-2 bg-gray-50/50">
                    <div className="text-[10px] font-medium text-gray-500 mb-2 uppercase tracking-wider">Attendance Check-in</div>
                    <div className="grid gap-1">
                      {cStudents.map(st => {
                        const aRec = att.find(a => a.student_id === st.id);
                        return (
                          <div key={st.id} className="flex items-center justify-between text-xs bg-white p-1 rounded border border-gray-200">
                            <div className="flex items-center gap-1.5 truncate max-w-[150px]">
                               <span className="font-medium text-gray-700 truncate" title={st.name}>{st.name}</span>
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
                            <div className="flex gap-1 shrink-0">
                              {['present', 'late', 'absent'].map(status => (
                                <button
                                  key={status}
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const res = await fetch(`/api/schedules/${sch.id}/attendance`, {
                                      method: 'POST', headers: {'Content-Type': 'application/json'},
                                      body: JSON.stringify({ studentId: st.id, status })
                                    });
                                    if (res.ok) fetchScheduleAttendance(sch.id);
                                  }}
                                  className={`px-1.5 py-0.5 rounded text-[10px] capitalize border transition-all cursor-pointer ${
                                    aRec?.status === status
                                      ? (status === 'present' ? 'bg-green-50 border-green-200 text-green-700 font-medium' : status === 'late' ? 'bg-yellow-50 border-yellow-200 text-yellow-700 font-medium' : 'bg-red-50 border-red-200 text-red-700 font-medium')
                                      : 'bg-slate-50 border-slate-100/70 text-slate-400 hover:bg-slate-100'
                                  }`}
                                >
                                  {status}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                      {cStudents.length === 0 && <div className="text-[10px] italic text-gray-400">No students to check in.</div>}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
