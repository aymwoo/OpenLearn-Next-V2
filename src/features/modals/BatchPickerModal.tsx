import { Dispatch, SetStateAction } from 'react';
import AccessibleDialog from '../../components/AccessibleDialog';

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
      className="bg-white border text-gray-900 border-gray-200 rounded-2xl shadow-2xl max-w-md overflow-hidden"
    >
      <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/80">
        <h2 id="batch-picker-dialog-title" className="font-bold text-gray-800 text-base">
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
        </h2>
        <button
          type="button"
          onClick={() => setBatchPicker(null)}
          aria-label={lang === 'zh' ? '关闭弹窗' : 'Close dialog'}
          className="text-gray-400 hover:text-gray-600 text-lg font-bold p-1 hover:bg-gray-200 rounded cursor-pointer"
        >
          &times;
        </button>
      </div>
      <div className="p-5 space-y-4">
        {(batchPicker === 'schedule' || batchPicker === 'lockedLesson') && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-600">
              {lang === 'zh' ? '选择课程' : 'Select Lesson'}
            </label>
            <select
              value={batchPickerLesson}
              onChange={(e) => setBatchPickerLesson(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
            <label className="text-xs font-semibold text-gray-600">
              {lang === 'zh' ? '上课日期' : 'Schedule Date'}
            </label>
            <input
              type="date"
              value={batchPickerDate}
              onChange={(e) => setBatchPickerDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        )}
        {batchPicker === 'transfer' && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-600">
              {lang === 'zh' ? '选择目标班级' : 'Select Target Class'}
            </label>
            <select
              value={batchPickerTargetClass}
              onChange={(e) => setBatchPickerTargetClass(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
      </div>
      <div className="p-4 border-t border-gray-100 flex justify-end gap-2">
        <button
          onClick={() => setBatchPicker(null)}
          className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 cursor-pointer"
        >
          {lang === 'zh' ? '取消' : 'Cancel'}
        </button>
        <button
          onClick={confirmBatchPicker}
          className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer"
        >
          {lang === 'zh' ? '确认' : 'Confirm'}
        </button>
      </div>
    </AccessibleDialog>
  );
}
