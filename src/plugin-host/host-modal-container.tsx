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
import { AlertTriangle, AlertCircle, HelpCircle } from 'lucide-react';
import AccessibleDialog, {
  DialogBody,
  DialogButton,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogVariant,
} from '../components/AccessibleDialog';
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

  const dialogVariant: DialogVariant =
    modal.variant === 'danger' ? 'danger' : modal.variant === 'warning' ? 'warning' : 'default';

  // Variant icon for confirm modal
  const renderConfirmIcon = () => {
    switch (modal.variant) {
      case 'danger':
        return <AlertTriangle size={20} />;
      case 'warning':
        return <AlertCircle size={20} />;
      case 'primary':
      default:
        return <HelpCircle size={20} />;
    }
  };

  return (
    <AccessibleDialog
      open
      onClose={handleClose}
      ariaLabelledBy="host-modal-title"
      closedBy={modal.closableByBackdrop === false ? 'closerequest' : 'any'}
      variant={dialogVariant}
      className={`w-full ${sizeClass}`}
    >
      {/* Header */}
      <DialogHeader>
        <DialogTitle
          id="host-modal-title"
          icon={modal.type === 'confirm' ? renderConfirmIcon() : undefined}
          iconVariant={dialogVariant}
        >
          {modal.title}
        </DialogTitle>
        {modal.showCloseButton !== false && <DialogCloseButton label="关闭" onClick={handleClose} />}
      </DialogHeader>

      {/* Body */}
      <DialogBody className="max-h-[70vh]">
        {modal.type === 'confirm' ? (
          <p className="text-sm leading-relaxed text-muted">{modal.message}</p>
        ) : (
          modal.content
        )}
      </DialogBody>

      {/* Footer */}
      <DialogFooter>
        {modal.type === 'confirm' ? (
          <>
            <DialogButton variant="secondary" onClick={handleCancel}>
              {modal.cancelText || '取消'}
            </DialogButton>
            <DialogButton
              variant={dialogVariant === 'danger' ? 'danger' : dialogVariant === 'warning' ? 'warning' : 'primary'}
              onClick={handleConfirm}
            >
              {modal.confirmText || '确定'}
            </DialogButton>
          </>
        ) : modal.actions && modal.actions.length > 0 ? (
          modal.actions.map((act) => (
            <DialogButton
              key={act.actionId}
              variant={act.variant || 'primary'}
              onClick={() => handleActionClick(act.actionId, act.isClose)}
            >
              {act.label}
            </DialogButton>
          ))
        ) : (
          <DialogButton variant="secondary" onClick={handleClose}>
            关闭
          </DialogButton>
        )}
      </DialogFooter>
    </AccessibleDialog>
  );
};
