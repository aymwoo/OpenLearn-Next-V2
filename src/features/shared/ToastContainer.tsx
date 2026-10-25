import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FileBadge, AlertCircle, AlertTriangle, Info, CheckCircle2, X, Copy, Check } from 'lucide-react';
import { useUIStore, uiStore } from '../../store/uiStore';
import type { Toast } from '../../types/app';
import { copyToClipboard } from '../../utils/clipboard';

export function ToastContainer() {
  const toasts = useUIStore((s) => s.toasts);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyToast = async (e: React.MouseEvent, toast: Toast) => {
    e.stopPropagation();
    const text = `[${toast.title}] ${toast.message}`;
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedId(toast.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const getToastStyle = (type: Toast['type']) => {
    switch (type) {
      case 'error':
        return {
          border: 'border-l-4 border-rose-500',
          iconBg: 'bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400',
          icon: <AlertCircle size={16} />,
        };
      case 'warning':
        return {
          border: 'border-l-4 border-amber-500',
          iconBg: 'bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400',
          icon: <AlertTriangle size={16} />,
        };
      case 'info':
        return {
          border: 'border-l-4 border-blue-500',
          iconBg: 'bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400',
          icon: <Info size={16} />,
        };
      case 'success':
      default:
        return {
          border: 'border-l-4 border-emerald-500',
          iconBg: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400',
          icon: <CheckCircle2 size={16} />,
        };
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 min-w-[320px] max-w-sm pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast: Toast) => {
          const style = getToastStyle(toast.type);
          const isCopied = copiedId === toast.id;

          return (
            <motion.div
              key={toast.id}
              // 不做透明度淡入/淡出（只保留位移与缩放）。
              //
              // 为什么：淡入期间整块 toast 的不透明度 < 1，文字与背景同比例被稀释，
              // WCAG 对比度随之下滑。实测（axe + 采样）：入场动画经过 opacity 0.26 /
              // 0.4 / 0.55 时，message 文字的实际对比度跌到 4.5:1 以下 —— 也就是说
              // 「刚弹出来的那 0.3 秒」里，次要说明文字是不可读的。
              // 保留位移+缩放既有入场手感，又保证文字全程以完整不透明度渲染。
              initial={{ y: 50, x: 50, scale: 0.9 }}
              animate={{ y: 0, x: 0, scale: 1 }}
              exit={{ scale: 0.85, transition: { duration: 0.2 } }}
              transition={{ type: 'spring', stiffness: 300, damping: 24 }}
              className={`pointer-events-auto w-full bg-white dark:bg-slate-900 ring-1 ring-black/5 shadow-2xl rounded-xl p-4 flex gap-3 ${style.border} overflow-hidden text-gray-900 dark:text-gray-100`}
              id={`toast-${toast.id}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`p-1 rounded-full shrink-0 ${style.iconBg}`}>{style.icon}</span>
                    <p className="font-semibold text-sm font-sans truncate">{toast.title}</p>
                  </div>

                  {/* One-click copy button for error and warning toasts */}
                  {(toast.type === 'error' || toast.type === 'warning') && (
                    <button
                      type="button"
                      onClick={(e) => handleCopyToast(e, toast)}
                      className={`text-xs font-bold px-1.5 py-0.5 rounded transition-all flex items-center gap-1 cursor-pointer shrink-0 ${
                        isCopied
                          ? 'bg-emerald-600 text-white'
                          : 'bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-600 dark:text-gray-300'
                      }`}
                      title="复制错误内容"
                    >
                      {isCopied ? <Check size={11} /> : <Copy size={11} />}
                      <span>{isCopied ? '已复制' : '复制'}</span>
                    </button>
                  )}
                </div>

                {/* 颜色基线：浅色 text-gray-600（#4b5563 / 白底 7.56:1）、
                    深色 text-gray-300（#d1d5db / slate-900 12.1:1）——
                    两者都远高于 WCAG AA 的 4.5:1，原先的 gray-500/gray-400
                    在各自的实际背景上只有 4.83:1 / 7.03:1，余量太薄。 */}
                <p className="text-xs text-gray-600 dark:text-gray-300 mt-2 leading-relaxed font-sans break-words">
                  {toast.message}
                </p>

                {toast.action && (
                  <div className="mt-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        toast.action?.onClick();
                        uiStore.getState().removeToast(toast.id);
                      }}
                      className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-xs transition-colors cursor-pointer flex items-center gap-1"
                    >
                      <span>{toast.action.label}</span>
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => uiStore.getState().removeToast(toast.id)}
                aria-label="关闭提示"
                className="text-subtle hover:text-main hover:bg-gray-50 dark:hover:bg-slate-800 rounded p-1 h-fit transition-colors shrink-0 cursor-pointer"
              >
                <X size={14} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
