import type { StudentType } from '../../types/app';

export interface StudentDashboardHeaderProps {
  students: StudentType[];
  activeStudentId: string | null;
}

export function StudentDashboardHeader(props: StudentDashboardHeaderProps) {
  const { students, activeStudentId } = props;
  return (
    <div className="flex items-center gap-4 border-b border-gray-200 pb-4">
      <div className="h-16 w-16 bg-indigo-600 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-lg">
        {students.find(s => s.id === activeStudentId)?.name.charAt(0).toUpperCase()}
      </div>
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Welcome, {students.find(s => s.id === activeStudentId)?.name}</h2>
        <p className="text-gray-500">Here is your learning summary.</p>
      </div>
    </div>
  );
}
