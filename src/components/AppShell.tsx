import React, { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import type { TeacherViewProps } from '../features/teacher/TeacherView';
import { isStudentWorkspacePreviewEnabled } from './StudentWorkspacePreview';

const StudentView = lazy(() => import('../features/student/StudentView').then((m) => ({ default: m.StudentView })));
const TeacherView = lazy(() => import('../features/teacher/TeacherView').then((m) => ({ default: m.TeacherView })));
// C 组迁移（docs/student-workspace-migration.md）：独立的懒加载块，
// 默认路径不会把它打进学生端 chunk；只有 `?studentShell=workspace` 才解析。
const StudentWorkspacePreview = lazy(() =>
  import('./StudentWorkspacePreview').then((m) => ({ default: m.StudentWorkspacePreview })),
);

export type AppShellProps = {
  /** C1-R3: StudentView 与 TeacherView 均已改经 AppDataContext 取数，此处仅存角色分发所需字段 */
  activeRole: 'teacher' | 'student';
};

export function AppShell(props: AppShellProps) {
  const { activeRole } = props;
  // 显式 URL 开关才走预览壳（默认关闭，学生端现行链路零影响）
  const useWorkspacePreview = activeRole === 'student' && isStudentWorkspacePreviewEnabled();
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex flex-col items-center justify-center min-h-[50vh] text-subtle gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <span className="text-sm font-medium tracking-wide">正在加载工作台...</span>
        </div>
      }
    >
      {activeRole === 'student' ? useWorkspacePreview ? <StudentWorkspacePreview /> : <StudentView /> : <TeacherView />}
    </Suspense>
  );
}
