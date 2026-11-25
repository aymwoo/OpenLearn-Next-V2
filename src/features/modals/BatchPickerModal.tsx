import { Dispatch, SetStateAction } from 'react';
import AccessibleDialog, {
  DialogBody,
  DialogButton,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/AccessibleDialog';

type Lang = 'zh' | 'en';
type BatchPickerMode = null | 'schedule' | 'lockedLesson' | 'transfer';

export interface BatchPickerModalProps {
  batchPicker: BatchPickerMode;
  setBatchPicker: Dispatch<SetStateAction<BatchPickerMode>>;
  batchPickerLesson: string;
  setBatchPickerLesson: Dispatch<SetStateAction<string>>;
  batchPickerDate: string;
  setBatchPickerDate: Dispatch<SetStateAction<string>>;
  batchPickerTargetClass: string;
  setBatchPickerTargetClass: Dispatch<SetStateAction<string>>;
  lessons: any[];
  classes: any[];
  expandedClassId: string | null;
  confirmBatchPicker: () => void | Promise<void>;
  lang: Lang;
}

export function BatchPickerModal({
  batchPicker,
  setBatchPicker,
  batchPickerLesson,
  setBatchPickerLesson,
  batchPickerDate,
  setBatchPickerDate,
  batchPickerTargetClass,
  setBatchPickerTargetClass,
  lessons,
  classes,
  expandedClassId,
  confirmBatchPicker,
  lang,
}: BatchPickerModalProps) {
  if (!batchPicker) return null;

  return (
    <AccessibleDialog
      open={Boolean(batchPicker)}
      onClose={() => setBatchPicker(null)}
      ariaLabelledBy="batch-picker-dialog-title"
      closedBy="any"
      className="max-w-md overflow-hidden"
    >
      <DialogHeader>
        <DialogTitle id="batch-picker-dialog-title">
          {batchPicker === 'schedule'
            ? lang === 'zh'
              ? '批量排课'
              : 'Batch Schedule'
            : batchPicker === 'lockedLesson'
              ? lang === 'zh'
                ? '批量设置锁定课程'
                : 'Batch Lock Lesson'
              : lang === 'zh'
                ? '批量转班'
                : 'Batch Transfer'}
        </DialogTitle>
        <DialogCloseButton label={lang === 'zh' ? '关闭弹窗' : 'Close dialog'} onClick={() => setBatchPicker(null)} />
      </DialogHeader>
      <DialogBody className="space-y-4">
        {(batchPicker === 'schedule' || batchPicker === 'lockedLesson') && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted">{lang === 'zh' ? '选择课程' : 'Select Lesson'}</label>
            <select
              value={batchPickerLesson}
              onChange={(e) => setBatchPickerLesson(e.target.value)}
              className="w-full rounded-lg border border-theme bg-surface px-3 py-2 text-sm text-main focus:ring-2 focus:ring-primary-theme focus:outline-none"
            >
              <option value="">{lang === 'zh' ? '— 请选择 —' : '— Select —'}</option>
              {lessons.map((l: any) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </div>
        )}
        {batchPicker === 'schedule' && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted">{lang === 'zh' ? '上课日期' : 'Schedule Date'}</label>
            <input
              type="date"
              value={batchPickerDate}
              onChange={(e) => setBatchPickerDate(e.target.value)}
              className="w-full rounded-lg border border-theme bg-surface px-3 py-2 text-sm text-main focus:ring-2 focus:ring-primary-theme focus:outline-none"
            />
          </div>
        )}
        {batchPicker === 'transfer' && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted">
              {lang === 'zh' ? '选择目标班级' : 'Select Target Class'}
            </label>
            <select
              value={batchPickerTargetClass}
              onChange={(e) => setBatchPickerTargetClass(e.target.value)}
              className="w-full rounded-lg border border-theme bg-surface px-3 py-2 text-sm text-main focus:ring-2 focus:ring-primary-theme focus:outline-none"
            >
              <option value="">{lang === 'zh' ? '— 请选择 —' : '— Select —'}</option>
              {classes
                .filter((c: any) => c.id !== expandedClassId)
                .map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogButton variant="secondary" onClick={() => setBatchPicker(null)}>
          {lang === 'zh' ? '取消' : 'Cancel'}
        </DialogButton>
        <DialogButton variant="primary" onClick={confirmBatchPicker}>
          {lang === 'zh' ? '确认' : 'Confirm'}
        </DialogButton>
      </DialogFooter>
    </AccessibleDialog>
  );
}
