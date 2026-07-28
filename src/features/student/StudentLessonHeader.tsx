import type { StudentType, Lesson } from '../../types/app';
import { ShieldAlert, ChevronRight } from 'lucide-react';

export interface StudentLessonHeaderProps {
  students: StudentType[];
  activeStudentId: string | null;
  setStudentViewStatus: (status: 'dashboard' | 'lesson' | 'assignment') => void;
  setSelectedLesson: (id: string | null) => void;
  lessons: Lesson[];
  selectedLesson: string | null;
}

export function StudentLessonHeader(props: StudentLessonHeaderProps) {
  const { students, activeStudentId, setStudentViewStatus, setSelectedLesson, lessons, selectedLesson } = props;
  return (
    <div className="flex items-center justify-between">
      {students.find(s => s.id === activeStudentId)?.locked_lesson_id ? (
         <div className="text-indigo-600 font-medium text-sm flex items-center gap-2 px-2">
           <ShieldAlert size={16} /> Restricted Mode
         </div>
      ) : (
        <button 
          onClick={() => { setStudentViewStatus('dashboard'); setSelectedLesson(null); }}
          className="flex items-center gap-2 text-indigo-600 hover:text-indigo-800 transition-colors font-medium text-sm"
        >
          <ChevronRight className="rotate-180" size={16} /> Back to Dashboard
        </button>
      )}
      <h2 className="text-xl font-bold text-gray-800">{lessons.find(l => l.id === selectedLesson)?.title}</h2>
    </div>
  );
}
