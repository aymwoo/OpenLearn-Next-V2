import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FileBadge, X } from 'lucide-react';
import { useAppStore, type Toast } from '../../store/appStore';
import { appStore } from '../../store/appStore';

export function ToastContainer() {
  const toasts = useAppStore((s) => s.toasts);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 min-w-[320px] max-w-sm pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast: Toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 50, x: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            className="pointer-events-auto w-full bg-white ring-1 ring-black/5 shadow-2xl rounded-xl p-4 flex gap-3 border-l-4 border-emerald-500 overflow-hidden"
            id={`toast-${toast.id}`}
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="p-1 rounded-full bg-emerald-50 text-emerald-600">
                  <FileBadge size={16} />
                </span>
                <p className="font-semibold text-gray-900 text-sm font-sans">{toast.title}</p>
              </div>
              <p className="text-xs text-gray-500 mt-2 leading-relaxed font-sans">{toast.message}</p>
            </div>
            <button
              type="button"
              onClick={() => appStore.getState().removeToast(toast.id)}
              className="text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded p-1 h-fit transition-colors shrink-0 cursor-pointer"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
