import React, { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import type { StudentViewProps } from '../features/student/StudentView';
import type { TeacherViewProps } from '../features/teacher/TeacherView';

const StudentView = lazy(() => import('../features/student/StudentView').then((m) => ({ default: m.StudentView })));
const TeacherView = lazy(() => import('../features/teacher/TeacherView').then((m) => ({ default: m.TeacherView })));

export type AppShellProps = StudentViewProps & TeacherViewProps;

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
      {activeRole === 'student' ? <StudentView {...props} /> : <TeacherView {...props} />}
    </Suspense>
  );
}
