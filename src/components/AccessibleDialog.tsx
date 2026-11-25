import React, { useLayoutEffect, useRef } from 'react';
import { X } from 'lucide-react';

export type DialogClosedBy = 'any' | 'closerequest' | 'none';
export type DialogVariant = 'default' | 'danger' | 'warning' | 'success';

export interface AccessibleDialogProps extends Omit<
  React.DialogHTMLAttributes<HTMLDialogElement>,
  'open' | 'onClose' | 'className' | 'children' | 'aria-labelledby' | 'aria-label'
> {
  open: boolean;
  onClose: () => void;
  ariaLabelledBy?: string;
  ariaLabel?: string;
  closedBy?: DialogClosedBy;
  /** 语义变体：供主题按变体定制标题栏、图标与强调色 */
  variant?: DialogVariant;
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
  variant = 'default',
  className = '',
  children,
  ...rest
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

    const handleClose = () => {
      dialog.returnValue = '';
      // `dialog.close()` queues an async `close` event per the HTML spec. If the
      // effect cleanup closed the dialog and a synchronous remount (e.g. React
      // StrictMode) immediately re-opened it via `showModal()`, `dialog.open` is
      // already `true` when that stale event fires — ignore it.
      if (!isCleaningUp && !dialog.open) {
        onCloseRef.current();
      }
    };

    dialog.addEventListener('close', handleClose);

    return () => {
      isCleaningUp = true;
      dialog.removeEventListener('close', handleClose);

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
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current as DialogWithOptionalMethods | null;
    if (!dialog) return;

    const hasNativeModal = typeof dialog.showModal === 'function';

    const handleCancel = (event: Event) => {
      event.preventDefault();
      if (closedBy !== 'none') {
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
    if (!hasNativeModal) {
      dialog.addEventListener('keydown', handleFallbackKeyDown);
    }
    if (needsLightDismissFallback) {
      dialog.addEventListener('pointerdown', handlePointerDown);
      dialog.addEventListener('click', handleBackdropClick);
    }

    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      if (!hasNativeModal) {
        dialog.removeEventListener('keydown', handleFallbackKeyDown);
      }
      if (needsLightDismissFallback) {
        dialog.removeEventListener('pointerdown', handlePointerDown);
        dialog.removeEventListener('click', handleBackdropClick);
      }
    };
  }, [open, closedBy]);

  if (!open) return null;

  const closedByProps: Record<string, string> = closedBy ? { closedby: closedBy } : {};

  return (
    <dialog
      ref={dialogRef}
      {...rest}
      aria-labelledby={ariaLabelledBy}
      aria-label={ariaLabel}
      {...closedByProps}
      data-dialog=""
      data-dialog-variant={variant}
      className={`openlearn-dialog ${className}`.trim()}
    >
      {children}
    </dialog>
  );
}

/* ── Dialog 结构原语 ────────────────────────────────────────────────────
   所有原语输出稳定的 `ol-dialog-*` 类名与 `data-dialog-part` 钩子，
   第三方主题可在 styles.css 中按 `[data-theme='<id>'] .ol-dialog-*` 覆盖。
   具体设计令牌见 src/index.css 的 `--ol-dialog-*`。 */

export interface DialogHeaderProps extends React.HTMLAttributes<HTMLElement> {
  /** plain: 去掉底色与分隔线，用于需要自绘背景的标题栏 */
  tone?: 'surface' | 'plain';
}

export function DialogHeader({ tone = 'surface', className = '', children, ...rest }: DialogHeaderProps) {
  return (
    <header
      data-dialog-part="header"
      data-tone={tone}
      data-variant={tone === 'plain' ? 'plain' : 'default'}
      className={`ol-dialog-header ${className}`.trim()}
      {...rest}
    >
      {children}
    </header>
  );
}

export interface DialogTitleProps {
  id?: string;
  icon?: React.ReactNode;
  iconVariant?: DialogVariant;
  description?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function DialogTitle({
  id,
  icon,
  iconVariant = 'default',
  description,
  className = '',
  children,
}: DialogTitleProps) {
  return (
    <div data-dialog-part="heading" className={`ol-dialog-heading ${className}`.trim()}>
      {icon ? (
        <span className="ol-dialog-icon" data-variant={iconVariant} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0">
        <h2 id={id} data-dialog-part="title" className="ol-dialog-title">
          <span className="ol-dialog-title-text">{children}</span>
        </h2>
        {description ? (
          <p data-dialog-part="description" className="ol-dialog-description">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export interface DialogCloseButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  /** 悬浮在面板右上角（无标题栏的布局使用） */
  floating?: boolean;
  icon?: React.ReactNode;
}

export function DialogCloseButton({
  label,
  floating = false,
  icon,
  className = '',
  type = 'button',
  children,
  ...rest
}: DialogCloseButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      data-dialog-part="close"
      className={`ol-dialog-close ${floating ? 'ol-dialog-close--floating' : ''} ${className}`.trim()}
    >
      {children ?? icon ?? <X size={18} aria-hidden="true" />}
    </button>
  );
}

export function DialogBody({ className = '', children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-dialog-part="body" className={`ol-dialog-body ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

export function DialogFooter({ className = '', children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-dialog-part="footer" className={`ol-dialog-footer ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

export function DialogSection({ className = '', children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-dialog-part="section" className={`ol-dialog-section ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

export interface DialogButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'warning' | 'ghost';
}

export function DialogButton({
  variant = 'secondary',
  className = '',
  type = 'button',
  children,
  ...rest
}: DialogButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      data-dialog-part="action"
      data-variant={variant}
      className={`ol-dialog-btn ${className}`.trim()}
    >
      {children}
    </button>
  );
}
