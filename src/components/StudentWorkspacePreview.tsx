/**
 * Student Workspace（C 组迁移）— 并行预览挂载点
 *
 * ## 这个文件存在的目的
 *
 * `src/features/student-workspace` 那套"第二套学生端壳"从未接入过任何生产链路，
 * 因此**从来没在真实浏览器里渲染过**。迁移立项的第一步不是替换学生端，而是先让它
 * **能被打开、能被测**，否则后面每移一个面板都在盲改。
 *
 * 所以这里只做一件事：在显式开启开关时，用真实的会话数据把壳挂起来。
 *
 * ## 为什么不会影响现有学生端
 *
 * 1. **默认关闭**：只有 URL 带 `?studentShell=workspace` 时才渲染（`isStudentWorkspacePreviewEnabled`）；
 * 2. **独立懒加载**：`AppShell` 里对这个组件用 `lazy()`，默认路径不会把它打进学生端 chunk；
 * 3. **不共享状态**：它自己建 `StudentWorkspaceContext` / `WorkspaceSlotRegistry`，
 *    不碰 `AppDataContext` 里的课堂状态，也不发 socket 事件 —— 学生端现行链路完全不受影响。
 *
 * ## 尚不支持的部分（迁移清单，见 docs/student-workspace-migration.md）
 *
 * 当前 C 组壳只有**布局底座**：`student-default-widgets.tsx` 里 9 个 wrapper 中
 * 3 个是明确占位（资源/公告/通知），其余是薄包装。25 个真实面板（课堂跟随、环节门禁、
 * 答题、作业、进度、成绩、点名、破冰、成长档案…）都还在 `src/features/student` 里。
 * 因此这个预览**故意不声称等价**，只用于打通通路与验证渲染。
 */
import React, { Suspense, lazy } from 'react';
import { Loader2 } from 'lucide-react';
import { useOptionalAppData } from '../context/AppDataContext';

const StudentWorkspace = lazy(() =>
  import('../features/student-workspace/student-workspace').then((m) => ({ default: m.StudentWorkspace })),
);

/** URL 开关：`?studentShell=workspace` */
export const STUDENT_WORKSPACE_PREVIEW_QUERY = 'studentShell';
export const STUDENT_WORKSPACE_PREVIEW_VALUE = 'workspace';

/**
 * 是否启用 Student Workspace 预览壳。
 *
 * 只认显式 URL 参数 —— 不做 localStorage 记忆、不做环境变量默认开启，
 * 避免"某次误开之后所有学生都进了半成品壳"。
 */
export function isStudentWorkspacePreviewEnabled(search?: string): boolean {
  try {
    const qs = search ?? (typeof window !== 'undefined' ? window.location.search : '');
    const params = new URLSearchParams(qs);
    return params.get(STUDENT_WORKSPACE_PREVIEW_QUERY) === STUDENT_WORKSPACE_PREVIEW_VALUE;
  } catch {
    return false;
  }
}

export function StudentWorkspacePreview(): React.ReactElement {
  const appData = useOptionalAppData();
  const session = appData?.session ?? null;
  const studentId = appData?.activeStudentId || session?.studentId || session?.userId || '';

  // 没有学生身份就没法建壳（StudentWorkspaceContext 需要 student 对象）——
  // 宁可什么都不渲染，也不要造一个假身份去跑。
  if (!session || !studentId) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-sm text-subtle">
        <span>学生身份未就绪，无法打开 Student Workspace 预览。</span>
      </div>
    );
  }

  const lang = appData?.lang === 'en' ? 'en' : 'zh';

  return (
    <div data-testid="student-workspace-preview" className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 py-1.5 text-xs font-semibold bg-amber-50 text-amber-800 border-b border-amber-200">
        Student Workspace 预览壳（C 组迁移中，功能不等价于现有学生端）
      </div>
      <Suspense
        fallback={
          <div className="flex-1 flex items-center justify-center gap-2 text-subtle">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">正在加载预览壳…</span>
          </div>
        }
      >
        <StudentWorkspace
          student={{ id: studentId, name: session.name ?? '' }}
          lessonId={appData?.selectedLesson ?? undefined}
          lang={lang}
        />
      </Suspense>
    </div>
  );
}

export default StudentWorkspacePreview;
