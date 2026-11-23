import React, { useId } from 'react';
import AccessibleDialog from '../../components/AccessibleDialog';
import { ClassroomToolbarFeatureSettings } from './ClassroomToolbarFeatureSettings';
import { useClassroomToolbarVisibility } from './classroomToolbarVisibility';

/**
 * 白板课进入授课视图前的功能开关设置。
 * 默认展示上一次保存的选择（同一浏览器），教师确认后关闭。
 */
export function ClassroomToolbarSetupDialog({
  open,
  lang = 'zh',
  onDismiss,
}: {
  open: boolean;
  lang?: 'zh' | 'en';
  onDismiss: () => void;
}) {
  const titleId = useId();
  const { resetAll } = useClassroomToolbarVisibility();
  const zh = lang === 'zh';

  return (
    <AccessibleDialog
      open={open}
      onClose={onDismiss}
      ariaLabelledBy={titleId}
      closedBy="closerequest"
      className="text-main"
    >
      <div
        data-testid="classroom-toolbar-setup-dialog"
        className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col overflow-hidden rounded-2xl border border-theme bg-surface shadow-xl"
        style={{ width: 'calc(100% - 2rem)', maxWidth: '56rem' }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-theme px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-bold text-main">
              {zh ? '开课前功能设置' : 'Classroom Tools Setup'}
            </h2>
            <p className="mt-1 text-xs text-muted leading-relaxed">
              {zh
                ? '默认沿用上一节课的选择。关闭的按钮不会出现在本课的课堂工具与课堂面板中，可随时在「课堂面板 → 控制」里调整。'
                : 'Defaults to the previous lesson’s choices. Disabled buttons stay hidden in this lesson and can be changed later under Class panels → Control.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={zh ? '关闭开课前设置' : 'Close setup'}
            className="w-7 h-7 shrink-0 rounded-lg text-muted hover:text-main hover:bg-surface-secondary cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          <ClassroomToolbarFeatureSettings lang={lang} />
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-theme px-5 py-3">
          <button
            type="button"
            onClick={resetAll}
            className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg border border-theme bg-surface hover:bg-surface-secondary text-main cursor-pointer"
          >
            {zh ? '全部恢复显示' : 'Show all'}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onDismiss}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-primary-theme text-white hover:opacity-90 cursor-pointer"
          >
            {zh ? '开始上课' : 'Start class'}
          </button>
        </div>
      </div>
    </AccessibleDialog>
  );
}
