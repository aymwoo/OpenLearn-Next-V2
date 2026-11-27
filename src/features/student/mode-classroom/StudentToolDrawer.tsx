import type { ReactNode } from 'react';

/**
 * 学生课堂的次要工具区。
 * 不用模态对话框，主学习区保持可交互；关闭后主内容仍在。
 */
export const STUDENT_TOOL_DRAWER_ID = 'student-tool-drawer-panel';

export function StudentToolDrawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      id={STUDENT_TOOL_DRAWER_ID}
      data-testid="student-tool-drawer"
      data-open={open ? 'true' : 'false'}
      hidden={!open}
      aria-label={title}
      className={
        open
          ? 'flex w-full max-w-sm shrink-0 flex-col min-h-0 border border-theme bg-surface rounded-xl shadow-sm overflow-hidden'
          : ''
      }
    >
      {open ? (
        <>
          <div className="flex items-center justify-between gap-2 border-b border-theme px-3 py-2">
            <h2 className="text-sm font-semibold text-main">{title}</h2>
            <button
              type="button"
              data-testid="student-tool-drawer-close"
              onClick={onClose}
              className="text-xs font-semibold text-muted hover:text-main cursor-pointer px-2 py-1 rounded-md"
            >
              关闭
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
        </>
      ) : null}
    </aside>
  );
}
