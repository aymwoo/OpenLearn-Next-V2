import React, { useEffect } from 'react';
import { AlertTriangle, Trash2, X, Loader2 } from 'lucide-react';

export interface ClassroomSessionDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  sessionTitle: string;
  className?: string;
  stageLabel?: string;
  isDeleting?: boolean;
  lang?: string;
}

export function ClassroomSessionDeleteModal({
  isOpen,
  onClose,
  onConfirm,
  sessionTitle,
  className,
  stageLabel,
  isDeleting = false,
  lang = 'zh',
}: ClassroomSessionDeleteModalProps) {
  useEffect(() => {
    if (!isOpen || isDeleting) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDeleting, onClose]);

  if (!isOpen) return null;
  const zh = lang === 'zh';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-session-modal-title"
      onClick={() => {
        if (!isDeleting) onClose();
      }}
    >
      <div
        className="w-full max-w-md bg-surface border border-theme rounded-2xl shadow-2xl p-6 relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={isDeleting}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-muted hover:text-main hover:bg-surface-secondary transition-colors"
          aria-label={zh ? '关闭' : 'Close'}
        >
          <X size={18} />
        </button>

        <div className="flex items-start gap-3.5 mb-4">
          <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center shrink-0 border border-rose-500/20">
            <AlertTriangle size={20} />
          </div>
          <div className="min-w-0 pr-6">
            <h3 id="delete-session-modal-title" className="text-base font-bold text-main">
              {zh ? '删除课堂会话' : 'Delete Classroom Session'}
            </h3>
            <p className="text-xs text-muted mt-0.5">
              {zh ? '此操作将彻底删除会话记录，且不可撤销' : 'This action is irreversible and cannot be undone'}
            </p>
          </div>
        </div>

        <div className="bg-surface-secondary border border-theme rounded-xl p-3.5 mb-4 text-xs space-y-1.5">
          <div className="flex justify-between">
            <span className="text-muted">{zh ? '关联课节：' : 'Course:'}</span>
            <span className="font-semibold text-main truncate max-w-[220px]">{sessionTitle}</span>
          </div>
          {className && (
            <div className="flex justify-between">
              <span className="text-muted">{zh ? '授课班级：' : 'Class:'}</span>
              <span className="font-medium text-main">{className}</span>
            </div>
          )}
          {stageLabel && (
            <div className="flex justify-between">
              <span className="text-muted">{zh ? '当前状态：' : 'Stage:'}</span>
              <span className="font-medium text-main">{stageLabel}</span>
            </div>
          )}
        </div>

        <div className="text-xs text-rose-600/90 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-xl p-3 mb-5 leading-relaxed">
          {zh
            ? '⚠️ 提示：删除会话将一并清理本次课堂关联的随堂测试、即时投票、抢答、结课通票提交及互动动态流数据。'
            : '⚠️ Notice: Deleting this session will cascade clean all quick polls, buzzers, exit ticket submissions, and interaction feeds associated with it.'}
        </div>

        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2 rounded-xl border border-theme text-xs font-semibold text-muted hover:text-main hover:bg-surface-secondary transition-colors cursor-pointer disabled:opacity-50"
          >
            {zh ? '取消' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={isDeleting}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-sm transition-all cursor-pointer disabled:opacity-50"
          >
            {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            <span>{isDeleting ? (zh ? '删除中...' : 'Deleting...') : zh ? '确认删除' : 'Delete'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
