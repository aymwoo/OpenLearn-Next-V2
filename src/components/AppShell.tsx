import React, { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import type { TeacherViewProps } from '../features/teacher/TeacherView';

const StudentView = lazy(() => import('../features/student/StudentView').then((m) => ({ default: m.StudentView })));
const TeacherView = lazy(() => import('../features/teacher/TeacherView').then((m) => ({ default: m.TeacherView })));

export type AppShellProps = TeacherViewProps & {
  /** C1-R3: StudentView 已改经 AppDataContext 取数，此处仅存角色分发所需字段 */
  activeRole: 'teacher' | 'student';
};

export function AppShell(props: AppShellProps) {
  const { activeRole } = props;
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex flex-col items-center justify-center min-h-[50vh] text-slate-400 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <span className="text-sm font-medium tracking-wide">正在加载工作台...</span>
        </div>
      }
    >
      {activeRole === 'student' ? <StudentView /> : <TeacherView {...props} />}
    </Suspense>
  );
}
