/**
 * HostModalContainer — Global Responsive Modal Host Layer
 *
 * Listens to active modals managed by HostActionDispatcher:
 * - host:modal:confirm
 * - host:modal:open
 *
 * Renders high-fidelity, accessible Tailwind modals and resolves pending
 * dispatch promises when user interacts with confirmation/action buttons.
 */

import React, { useEffect, useState } from 'react';
import { X, AlertTriangle, AlertCircle, HelpCircle } from 'lucide-react';
import { defaultHostActionDispatcher, type ActiveModalState } from './host-action-dispatcher';
import type { IHostActionDispatcher } from './types';

interface HostModalContainerProps {
  dispatcher?: IHostActionDispatcher;
}

export const HostModalContainer: React.FC<HostModalContainerProps> = ({ dispatcher }) => {
  const activeDispatcher = dispatcher || defaultHostActionDispatcher;
  const [modals, setModals] = useState<ActiveModalState[]>([]);

  useEffect(() => {
    // If the dispatcher has subscribeModals (HostActionDispatcher instance)
    const dispAny = activeDispatcher as any;
    if (typeof dispAny.subscribeModals === 'function') {
      const disposable = dispAny.subscribeModals((list: ActiveModalState[]) => {
        setModals([...list]);
      });
      return () => {
        disposable.dispose();
      };
    }
  }, [activeDispatcher]);

  // Handle Escape key to dismiss the topmost modal
  useEffect(() => {
    if (modals.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const topModal = modals[modals.length - 1];
        const dispAny = activeDispatcher as any;
        if (dispAny.resolveModal) {
          if (topModal.type === 'confirm') {
            dispAny.resolveModal(topModal.id, { confirmed: false });
          } else {
            dispAny.resolveModal(topModal.id, { closed: true });
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modals, activeDispatcher]);

  if (modals.length === 0) {
    return null;
  }

  // Render the topmost modal
  const modal = modals[modals.length - 1];
  const dispAny = activeDispatcher as any;

  const handleConfirm = () => {
    dispAny.resolveModal?.(modal.id, { confirmed: true });
  };

  const handleCancel = () => {
    dispAny.resolveModal?.(modal.id, { confirmed: false });
  };

  const handleClose = () => {
    if (modal.type === 'confirm') {
      dispAny.resolveModal?.(modal.id, { confirmed: false });
    } else {
      dispAny.resolveModal?.(modal.id, { closed: true });
    }
  };

  const handleActionClick = (actionId: string, isClose?: boolean) => {
    dispAny.resolveModal?.(modal.id, { actionId, closed: !!isClose });
  };

  // Determine size class
  const sizeClasses: Record<string, string> = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-xl',
    xl: 'max-w-3xl',
    full: 'max-w-5xl',
  };
  const sizeClass = sizeClasses[modal.size || 'md'] || 'max-w-md';

  // Variant icon & styling for confirm modal
  const renderConfirmIcon = () => {
    switch (modal.variant) {
      case 'danger':
        return (
          <div className="w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0">
            <AlertTriangle size={20} />
          </div>
        );
      case 'warning':
        return (
          <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
            <AlertCircle size={20} />
          </div>
        );
      case 'primary':
      default:
        return (
          <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
            <HelpCircle size={20} />
          </div>
        );
    }
  };

  const getConfirmButtonClasses = () => {
    switch (modal.variant) {
      case 'danger':
        return 'bg-red-600 hover:bg-red-700 text-white shadow-xs focus:ring-red-500';
      case 'warning':
        return 'bg-amber-600 hover:bg-amber-700 text-white shadow-xs focus:ring-amber-500';
      case 'primary':
      default:
        return 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs focus:ring-indigo-500';
    }
  };

  const getActionButtonClasses = (variant?: 'primary' | 'secondary' | 'danger' | 'ghost') => {
    switch (variant) {
      case 'danger':
        return 'bg-red-600 hover:bg-red-700 text-white';
      case 'secondary':
        return 'bg-gray-100 hover:bg-gray-200 text-gray-700';
      case 'ghost':
        return 'hover:bg-gray-100 text-gray-600';
      case 'primary':
      default:
        return 'bg-indigo-600 hover:bg-indigo-700 text-white';
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="host-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs transition-opacity"
      onClick={(e) => {
        if (e.target === e.currentTarget && modal.closableByBackdrop !== false) {
          handleClose();
        }
      }}
    >
      <div
        className={`w-full ${sizeClass} bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col transform transition-all animate-in fade-in zoom-in-95 duration-150`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            {modal.type === 'confirm' && renderConfirmIcon()}
            <h3 id="host-modal-title" className="text-base font-bold text-gray-900 truncate">
              {modal.title}
            </h3>
          </div>
          {modal.showCloseButton !== false && (
            <button
              onClick={handleClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
              aria-label="关闭"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-4 overflow-y-auto max-h-[70vh]">
          {modal.type === 'confirm' ? (
            <p className="text-sm text-gray-600 leading-relaxed">{modal.message}</p>
          ) : (
            modal.content
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-6 py-3.5 bg-gray-50/80 border-t border-gray-100">
          {modal.type === 'confirm' ? (
            <>
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-xs font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl transition-all cursor-pointer shadow-2xs"
              >
                {modal.cancelText || '取消'}
              </button>
              <button
                onClick={handleConfirm}
                className={`px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-offset-2 ${getConfirmButtonClasses()}`}
              >
                {modal.confirmText || '确定'}
              </button>
            </>
          ) : modal.actions && modal.actions.length > 0 ? (
            modal.actions.map((act) => (
              <button
                key={act.actionId}
                onClick={() => handleActionClick(act.actionId, act.isClose)}
                className={`px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${getActionButtonClasses(act.variant)}`}
              >
                {act.label}
              </button>
            ))
          ) : (
            <button
              onClick={handleClose}
              className="px-4 py-2 text-xs font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl transition-all cursor-pointer shadow-2xs"
            >
              关闭
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
