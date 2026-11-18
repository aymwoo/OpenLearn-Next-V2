import React from 'react';
import { AlertCircle, ArrowDown } from 'lucide-react';

export function LiveClassroomSwitchLessonModal({
  lang,
  lessons,
  selectedLesson,
  pendingLessonId,
  setPendingLessonId,
  setSelectedLesson,
  fetchElements,
  addToast,
  onClose,
}: {
  lang: string;
  lessons: { id: string; title: string }[];
  selectedLesson: string | null;
  pendingLessonId: string | null;
  setPendingLessonId: (id: string | null) => void;
  setSelectedLesson: (id: string) => void;
  fetchElements: (lessonId: string) => void;
  addToast?: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onClose: () => void;
}) {
  return (
    <div
      id="live-classroom-switch-lesson-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150 select-none"
    >
      <div className="bg-surface border border-theme rounded-2xl shadow-2xl max-w-md w-full p-5 flex flex-col gap-4 text-main">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/25 flex items-center justify-center shrink-0">
            <AlertCircle size={22} />
          </div>
          <div>
            <h3 className="text-sm font-extrabold text-main">
              {lang === 'zh' ? '确认切换上课课程？' : 'Confirm Lesson Switch?'}
            </h3>
            <p className="text-xs text-muted mt-0.5">
              {lang === 'zh' ? '当前课堂将立即切换至新课程' : 'Current live session will switch to new lesson'}
            </p>
          </div>
        </div>

        <div className="p-3 bg-surface-secondary/70 border border-theme/60 rounded-xl flex flex-col gap-2 text-xs">
          <div className="flex items-center justify-between text-muted">
            <span>{lang === 'zh' ? '当前课程' : 'Current Lesson'}:</span>
            <span className="font-semibold text-main truncate max-w-[240px]">
              {lessons.find((l) => l.id === selectedLesson)?.title || (lang === 'zh' ? '未选择' : 'None')}
            </span>
          </div>
          <div className="flex items-center justify-center text-muted">
            <ArrowDown size={14} className="text-primary-ink animate-bounce" />
          </div>
          <div className="flex items-center justify-between text-primary-ink font-bold">
            <span>{lang === 'zh' ? '目标新课程' : 'New Lesson'}:</span>
            <span className="truncate max-w-[240px]">{lessons.find((l) => l.id === pendingLessonId)?.title}</span>
          </div>
        </div>

        <p className="text-xs text-muted leading-relaxed">
          {lang === 'zh'
            ? '切换后，课堂白板、教学环节步骤与已连接的学生端屏幕将同步切换至新课程。是否确认切换？'
            : 'Switching lessons will update the whiteboard, lesson segments, and sync the screen for all connected students. Continue?'}
        </p>

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-theme/60">
          <button
            type="button"
            id="live-classroom-switch-lesson-cancel-btn"
            onClick={() => {
              setPendingLessonId(selectedLesson);
              onClose();
            }}
            className="px-3.5 py-1.5 rounded-xl border border-theme hover:bg-surface-secondary text-xs font-semibold text-main transition-colors cursor-pointer"
          >
            {lang === 'zh' ? '取消' : 'Cancel'}
          </button>
          <button
            type="button"
            id="live-classroom-switch-lesson-confirm-btn"
            onClick={() => {
              if (pendingLessonId) {
                setSelectedLesson(pendingLessonId);
                fetchElements(pendingLessonId);
                addToast?.(
                  lang === 'zh' ? '课程已切换' : 'Lesson Switched',
                  lang === 'zh'
                    ? `已切换到课程《${lessons.find((l) => l.id === pendingLessonId)?.title}》`
                    : 'Switched successfully',
                  'success',
                );
              }
              onClose();
            }}
            className="px-4 py-1.5 rounded-xl bg-primary-solid hover:opacity-90 text-white text-xs font-bold transition-all shadow-sm cursor-pointer"
          >
            {lang === 'zh' ? '确认切换' : 'Confirm Switch'}
          </button>
        </div>
      </div>
    </div>
  );
}
