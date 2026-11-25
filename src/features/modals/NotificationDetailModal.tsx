import React from 'react';
import { Bell, CheckCircle2, Clock, PenTool } from 'lucide-react';
import AccessibleDialog, {
  DialogBody,
  DialogButton,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/AccessibleDialog';

interface NotificationDetailModalProps {
  notification: any | null;
  onClose: () => void;
  lang: string;
  onOpenWorkspace: (assignment: any) => void;
}

export function NotificationDetailModal({
  notification,
  onClose,
  lang,
  onOpenWorkspace,
}: NotificationDetailModalProps) {
  if (!notification) return null;

  return (
    <AccessibleDialog
      open={Boolean(notification)}
      onClose={onClose}
      ariaLabelledBy="notification-detail-dialog-title"
      closedBy="any"
      className="max-w-xl overflow-hidden max-h-[85vh] font-sans"
    >
      <DialogHeader>
        <DialogTitle id="notification-detail-dialog-title" icon={<Bell size={18} />} className="font-sans">
          {notification.title}
        </DialogTitle>
        <DialogCloseButton
          label={lang === 'zh' ? '关闭弹窗' : 'Close dialog'}
          onClick={onClose}
          className="font-bold"
        />
      </DialogHeader>

      <DialogBody className="space-y-4">
        <div className="rounded-xl border border-primary-theme/30 bg-primary-theme-light p-4 text-sm text-main leading-relaxed font-sans">
          {notification.message}
        </div>

        {notification.assignment && (
          <div className="space-y-4 font-sans">
            <div className="space-y-3 rounded-xl border border-theme bg-surface-secondary p-4">
              <div className="flex justify-between items-center">
                <span className="text-xs text-subtle uppercase tracking-wider font-semibold font-sans">
                  {lang === 'zh' ? '关联作业' : 'Associated Assignment'}
                </span>
                {notification.assignment.submission_status === 'graded' && (
                  <span className="rounded-full border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-xs font-bold text-green-700 shadow-sm font-mono dark:text-green-400">
                    {lang === 'zh'
                      ? `得分：${notification.assignment.score}%`
                      : `Score: ${notification.assignment.score}%`}
                  </span>
                )}
              </div>
              <div>
                <h4 className="text-base font-bold text-primary-ink font-sans">{notification.assignment.title}</h4>
                <p className="mt-1 text-xs text-muted font-sans">{notification.assignment.class_name}</p>
              </div>

              {notification.assignment.feedback && (
                <div className="mt-3 space-y-1 rounded-lg border border-theme bg-surface p-3 font-sans">
                  <div className="flex items-center justify-between gap-2 text-xs font-bold text-green-700 font-sans dark:text-green-400">
                    <div className="flex items-center gap-1">
                      <CheckCircle2 size={14} className="font-sans" />
                      <span>{lang === 'zh' ? '教师评审意见与反馈' : 'Teacher Feedback & Recommendations'}</span>
                    </div>
                    {notification.assignment.graded_at && (
                      <div className="flex items-center gap-1 text-xs font-mono font-normal text-subtle select-none">
                        <Clock size={11} className="text-subtle" />
                        <span>
                          {new Date(notification.assignment.graded_at).toLocaleString(
                            lang === 'zh' ? 'zh-CN' : 'en-US',
                            {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            },
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="mt-1 rounded border border-green-500/20 bg-green-500/10 p-2 text-xs text-muted italic leading-relaxed whitespace-pre-wrap font-sans">
                    {notification.assignment.feedback}
                  </div>
                </div>
              )}
            </div>

            {notification.assignment.submission_content && (
              <div className="space-y-1.5 font-sans">
                <div className="text-xs font-bold text-subtle uppercase tracking-wider font-sans">
                  {lang === 'zh' ? '我提交的内容' : 'My Submission Content'}
                </div>
                <div className="max-h-40 overflow-x-auto overflow-y-auto rounded-xl border border-gray-800 bg-gray-900 p-4 text-xs font-mono text-gray-100 leading-relaxed whitespace-pre-wrap">
                  {notification.assignment.submission_content}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogBody>

      <DialogFooter>
        <DialogButton variant="secondary" onClick={onClose} className="font-sans">
          {lang === 'zh' ? '关闭' : 'Close'}
        </DialogButton>
        {notification.assignment && (
          <DialogButton
            variant="primary"
            onClick={() => onOpenWorkspace(notification.assignment)}
            className="font-sans"
          >
            <PenTool size={14} className="font-sans" />
            {lang === 'zh' ? '打开画布 / 查看详情' : 'Open Workspace Canvas'}
          </DialogButton>
        )}
      </DialogFooter>
    </AccessibleDialog>
  );
}
