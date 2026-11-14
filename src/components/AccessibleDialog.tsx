import React, { useLayoutEffect, useRef } from 'react';

export type DialogClosedBy = 'any' | 'closerequest' | 'none';

export interface AccessibleDialogProps {
  open: boolean;
  onClose: () => void;
  ariaLabelledBy?: string;
  ariaLabel?: string;
  closedBy?: DialogClosedBy;
  className?: string;
  children: React.ReactNode;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type DialogWithOptionalMethods = HTMLDialogElement & {
  showModal?: () => void;
  close?: () => void;
};

function isOutsideDialogBounds(dialog: HTMLDialogElement, clientX: number, clientY: number): boolean {
  const rect = dialog.getBoundingClientRect();
  const isInside =
    rect.top <= clientY &&
    clientY <= rect.top + rect.height &&
    rect.left <= clientX &&
    clientX <= rect.left + rect.width;
  return !isInside;
}

/**
 * Shared accessible modal wrapper backed by native `<dialog>` + `showModal()`.
 * Falls back cleanly in jsdom test environments where top-layer dialog APIs are absent.
 */
export default function AccessibleDialog({
  open,
  onClose,
  ariaLabelledBy,
  ariaLabel,
  closedBy = 'closerequest',
  className = '',
  children,
}: AccessibleDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current as DialogWithOptionalMethods | null;
    if (!dialog) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const hasNativeModal = typeof dialog.showModal === 'function';

    if (hasNativeModal) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      dialog.setAttribute('open', '');
      if (!dialog.contains(document.activeElement)) {
        const initialFocus =
          dialog.querySelector<HTMLElement>('[autofocus]') ?? dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
        initialFocus?.focus();
      }
    }

    let isCleaningUp = false;

    const handleCancel = (event: Event) => {
      event.preventDefault();
      if (closedBy !== 'none') {
        onCloseRef.current();
      }
    };

    const handleClose = () => {
      dialog.returnValue = '';
      if (!isCleaningUp) {
        onCloseRef.current();
      }
    };

    const handleFallbackKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closedBy !== 'none') {
        event.preventDefault();
        onCloseRef.current();
      }
    };

    let sawPointerDown = false;
    let pointerDownOutside = false;
    const needsLightDismissFallback = closedBy === 'any' && !('closedBy' in HTMLDialogElement.prototype);

    const handlePointerDown = (event: PointerEvent) => {
      sawPointerDown = true;
      pointerDownOutside = event.target === dialog && isOutsideDialogBounds(dialog, event.clientX, event.clientY);
    };

    const handleBackdropClick = (event: MouseEvent) => {
      if (event.target !== dialog) {
        sawPointerDown = false;
        pointerDownOutside = false;
        return;
      }

      const clickOutside = isOutsideDialogBounds(dialog, event.clientX, event.clientY);
      const shouldDismiss = sawPointerDown ? pointerDownOutside && clickOutside : clickOutside;
      sawPointerDown = false;
      pointerDownOutside = false;

      if (shouldDismiss) {
        onCloseRef.current();
      }
    };

    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('close', handleClose);
    if (!hasNativeModal) {
      dialog.addEventListener('keydown', handleFallbackKeyDown);
    }
    if (needsLightDismissFallback) {
      dialog.addEventListener('pointerdown', handlePointerDown);
      dialog.addEventListener('click', handleBackdropClick);
    }

    return () => {
      isCleaningUp = true;
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('close', handleClose);
      if (!hasNativeModal) {
        dialog.removeEventListener('keydown', handleFallbackKeyDown);
      }
      if (needsLightDismissFallback) {
        dialog.removeEventListener('pointerdown', handlePointerDown);
        dialog.removeEventListener('click', handleBackdropClick);
      }

      if (hasNativeModal) {
        if (dialog.open && typeof dialog.close === 'function') {
          dialog.close();
        }
      } else {
        dialog.removeAttribute('open');
        if (previouslyFocused && previouslyFocused.isConnected) {
          previouslyFocused.focus();
        }
      }
    };
  }, [open, closedBy]);

  if (!open) return null;

  const closedByProps: Record<string, string> = closedBy ? { closedby: closedBy } : {};

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={ariaLabelledBy}
      aria-label={ariaLabel}
      {...closedByProps}
      className={`openlearn-dialog ${className}`.trim()}
    >
      {children}
    </dialog>
  );
}
