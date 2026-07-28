import { BookOpen, PlayCircle } from 'lucide-react';

export interface StudentCourseProgressListProps {
  progress: any[];
  setSelectedLesson: (lessonId: string) => void;
  setStudentViewStatus: (status: 'dashboard' | 'lesson' | 'assignment') => void;
}

export function StudentCourseProgressList(props: StudentCourseProgressListProps) {
  const { progress, setSelectedLesson, setStudentViewStatus } = props;
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col">
      <div className="p-4 border-b border-gray-100 flex items-center gap-2">
         <BookOpen size={18} className="text-teal-500" />
         <h3 className="font-semibold text-gray-800">My Independent Courses</h3>
      </div>
      <div className="p-4">
        {progress && progress.length === 0 ? (
          <div className="text-center p-8 text-gray-400 italic text-sm">No courses assigned yet.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {progress?.map((p: any) => (
              <div key={p.lesson_id} className="flex flex-col p-4 rounded-xl border border-gray-100 bg-gray-50 hover:border-teal-200 hover:shadow-sm transition-all focus:outline-none">
                 <div className="flex justify-between items-start mb-3">
                    <div className="font-semibold text-gray-800 text-lg">{p.lesson_title}</div>
                    {p.completed === 1 && <span className="bg-green-100 text-green-800 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold">Completed</span>}
                 </div>
                 <div className="flex items-center gap-3 mb-4">
                    <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden shrink-0">
                      <div className={`h-full ${p.progress_percent === 100 ? 'bg-green-500' : 'bg-teal-500'}`} style={{ width: `${p.progress_percent}%` }}></div>
                    </div>
                    <span className="text-xs text-gray-500 font-medium shrink-0">{p.progress_percent}%</span>
                 </div>
                 <button
                   onClick={() => {
                     setSelectedLesson(p.lesson_id);
                     setStudentViewStatus('lesson');
                   }}
                 className="w-full flex justify-center items-center gap-2 bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-sm transition-colors mt-auto"
                 >
                   {p.progress_percent === 0 ? <><PlayCircle size={16} /> Start Learning</> : <><PlayCircle size={16} /> Continue</>}
                 </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
