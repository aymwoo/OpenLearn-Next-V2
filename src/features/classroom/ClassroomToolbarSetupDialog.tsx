import React, { useId } from 'react';
import AccessibleDialog, {
  DialogBody,
  DialogButton,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/AccessibleDialog';
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
      className="max-w-4xl"
    >
      <div
        data-testid="classroom-toolbar-setup-dialog"
        className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-1 flex-col overflow-hidden"
      >
        <DialogHeader>
          <DialogTitle
            id={titleId}
            description={
              zh
                ? '默认沿用上一节课的选择。关闭的按钮不会出现在本课的课堂工具与课堂面板中，可随时在「课堂面板 → 控制」里调整。'
                : 'Defaults to the previous lesson’s choices. Disabled buttons stay hidden in this lesson and can be changed later under Class panels → Control.'
            }
          >
            {zh ? '开课前功能设置' : 'Classroom Tools Setup'}
          </DialogTitle>
          <DialogCloseButton label={zh ? '关闭开课前设置' : 'Close setup'} onClick={onDismiss} />
        </DialogHeader>

        <DialogBody>
          <ClassroomToolbarFeatureSettings lang={lang} />
        </DialogBody>

        <DialogFooter className="justify-between">
          <DialogButton variant="secondary" onClick={resetAll}>
            {zh ? '全部恢复显示' : 'Show all'}
          </DialogButton>
          <DialogButton variant="primary" autoFocus onClick={onDismiss}>
            {zh ? '开始上课' : 'Start class'}
          </DialogButton>
        </DialogFooter>
      </div>
    </AccessibleDialog>
  );
}
