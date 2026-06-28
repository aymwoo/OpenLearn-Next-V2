import React from 'react';
import { Bell, CheckCircle2, Clock, PenTool } from 'lucide-react';
import { motion } from 'motion/react';

interface NotificationDetailModalProps {
  notification: any | null;
  onClose: () => void;
  lang: string;
  onOpenWorkspace: (assignment: any) => void;
}

export function NotificationDetailModal({ notification, onClose, lang, onOpenWorkspace }: NotificationDetailModalProps) {
  if (!notification) return null;

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-6 z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white border text-gray-900 border-gray-200 rounded-2xl shadow-2xl w-full max-w-xl flex flex-col overflow-hidden max-h-[85vh] font-sans"
      >
        {/* Modal Header */}
        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/80 shrink-0">
          <div className="flex items-center gap-3">
            <Bell className="text-indigo-600 font-sans shrink-0" size={20} />
            <h2 className="font-bold text-gray-800 text-base font-sans truncate">{notification.title}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 font-bold p-1 hover:bg-gray-200 rounded transition-colors text-lg">&times;</button>
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="p-4 bg-indigo-50/50 rounded-xl border border-indigo-100 text-sm text-gray-700 leading-relaxed font-sans">
            {notification.message}
          </div>

          {notification.assignment && (
            <div className="space-y-4 font-sans">
              <div className="border border-gray-150 rounded-xl p-4 bg-gray-50/50 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold font-sans">
                    {lang === 'zh' ? '关联作业' : 'Associated Assignment'}
                  </span>
                  {notification.assignment.submission_status === 'graded' && (
                    <span className="bg-green-100 border border-green-200 text-green-800 text-xs font-bold px-2.5 py-1 rounded-full shadow-sm font-mono">
                      {lang === 'zh' ? `得分：${notification.assignment.score}%` : `Score: ${notification.assignment.score}%`}
                    </span>
                  )}
                </div>
                <div>
                  <h4 className="font-bold text-base text-indigo-900 font-sans">{notification.assignment.title}</h4>
                  <p className="text-xs text-gray-500 mt-1 font-sans">{notification.assignment.class_name}</p>
                </div>

                {notification.assignment.feedback && (
                  <div className="mt-3 bg-white p-3 rounded-lg border border-gray-150 space-y-1 font-sans">
                    <div className="text-xs font-bold text-green-700 flex items-center justify-between gap-2 font-sans">
                      <div className="flex items-center gap-1">
                        <CheckCircle2 size={14} className="font-sans" />
                        <span>{lang === 'zh' ? '教师评审意见与反馈' : 'Teacher Feedback & Recommendations'}</span>
                      </div>
                      {notification.assignment.graded_at && (
                        <div className="text-[10px] text-gray-400 font-mono flex items-center gap-1 font-normal select-none">
                          <Clock size={11} className="text-neutral-400" />
                          <span>
                            {new Date(notification.assignment.graded_at).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
                              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-gray-600 italic bg-green-50/30 p-2 rounded border border-green-50 mt-1 leading-relaxed whitespace-pre-wrap font-sans">
                      {notification.assignment.feedback}
                    </div>
                  </div>
                )}
              </div>

              {notification.assignment.submission_content && (
                <div className="space-y-1.5 font-sans">
                  <div className="text-xs text-gray-400 font-bold uppercase tracking-wider font-sans">
                    {lang === 'zh' ? '我提交的内容' : 'My Submission Content'}
                  </div>
                  <div className="bg-gray-900 text-gray-100 p-4 rounded-xl border border-gray-800 overflow-x-auto max-h-40 overflow-y-auto text-xs font-mono leading-relaxed whitespace-pre-wrap">
                    {notification.assignment.submission_content}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-gray-100 bg-gray-50/85 flex justify-end gap-2.5 shrink-0 font-sans">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold border border-gray-200 text-gray-700 bg-white rounded-lg hover:bg-gray-100 transition-colors cursor-pointer">
            {lang === 'zh' ? '关闭' : 'Close'}
          </button>
          {notification.assignment && (
            <button type="button" onClick={() => onOpenWorkspace(notification.assignment)} className="px-4 py-2 text-xs font-bold bg-indigo-600 text-white border border-indigo-700 rounded-lg hover:bg-indigo-700 hover:shadow shadow-sm transition-all cursor-pointer flex items-center gap-1.5 font-sans">
              <PenTool size={14} className="font-sans" />
              {lang === 'zh' ? '打开画布 / 查看详情' : 'Open Workspace Canvas'}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
