import type { StudentType } from '../../types/app';

export interface StudentDashboardHeaderProps {
  students: StudentType[];
  activeStudentId: string | null;
  /** Gitee Issue IKW5KV：教师收敛提示文案时不渲染副标题。 */
  hideGuidance?: boolean;
}

export function StudentDashboardHeader(props: StudentDashboardHeaderProps) {
  const { students, activeStudentId, hideGuidance = false } = props;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 pb-3 sm:gap-4 sm:pb-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xl font-bold text-white shadow-lg sm:h-16 sm:w-16 sm:text-2xl">
        {students
          .find((s) => s.id === activeStudentId)
          ?.name.charAt(0)
          .toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-bold text-gray-800 sm:text-2xl">
          Welcome, {students.find((s) => s.id === activeStudentId)?.name}
        </h2>
        {!hideGuidance && <p className="text-xs text-gray-500 sm:text-base">Here is your learning summary.</p>}
      </div>
    </div>
  );
}
