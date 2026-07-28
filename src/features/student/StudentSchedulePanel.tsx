import { CalendarIcon, PlayCircle } from 'lucide-react';

export interface StudentSchedulePanelProps {
  schedules: any[];
  setSelectedLesson: (lessonId: string) => void;
  setStudentViewStatus: (status: 'dashboard' | 'lesson' | 'assignment') => void;
}

export function StudentSchedulePanel(props: StudentSchedulePanelProps) {
  const { schedules, setSelectedLesson, setStudentViewStatus } = props;
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col">
      <div className="p-4 border-b border-gray-100 flex items-center gap-2">
         <CalendarIcon size={18} className="text-pink-500" />
         <h3 className="font-semibold text-gray-800">My Schedule</h3>
      </div>
      <div className="p-4 flex-1">
        {schedules.length === 0 ? (
          <div className="text-center p-8 text-gray-400 italic text-sm">No upcoming classes.</div>
        ) : (
          <div className="space-y-3">
            {schedules.map((sch: any) => (
              <div key={sch.id} className="flex flex-col p-3 rounded-lg border border-pink-100 bg-pink-50/30">
                 <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="font-semibold text-gray-800">{sch.lesson_title}</div>
                      <div className="text-xs text-gray-500">{sch.class_name}</div>
                    </div>
                    <div className="bg-pink-100 text-pink-700 px-2 py-1 inline-block rounded text-xs font-bold font-mono tracking-tight">
                       {sch.scheduled_date}
                    </div>
                 </div>
                 <div className="flex justify-between items-end mt-2">
                   {sch.attendance_status ? (
                      <div className="text-xs text-gray-600 font-medium">
                        Attendance: <span className={`uppercase font-bold ${sch.attendance_status === 'present' ? 'text-green-600' : sch.attendance_status === 'late' ? 'text-amber-600' : 'text-red-600'}`}>{sch.attendance_status}</span>
                      </div>
                   ) : (
                      <div className="text-xs text-gray-400 italic">Attendance not yet recorded.</div>
                   )}
                   <button
                     onClick={() => {
                       setSelectedLesson(sch.lesson_id);
                       setStudentViewStatus('lesson');
                     }}
                     className="flex items-center gap-1 bg-pink-500 hover:bg-pink-600 text-white px-3 py-1.5 rounded text-xs font-semibold shadow-sm transition-colors"
                   >
                     <PlayCircle size={14} /> Join Class
                   </button>
                 </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
