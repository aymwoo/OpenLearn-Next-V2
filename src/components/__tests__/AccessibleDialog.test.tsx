import { StrictMode } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import AccessibleDialog, {
  DialogBody,
  DialogButton,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../AccessibleDialog';

describe('AccessibleDialog', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // Clean up any mocked showModal/close methods between tests
    delete (HTMLDialogElement.prototype as unknown as { showModal?: unknown }).showModal;
    delete (HTMLDialogElement.prototype as unknown as { close?: unknown }).close;
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <AccessibleDialog open={false} onClose={vi.fn()} ariaLabel="Hidden dialog">
        <p>Secret body</p>
      </AccessibleDialog>,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders native <dialog> without redundant role or aria-modal attributes', () => {
    render(
      <AccessibleDialog open onClose={vi.fn()} ariaLabelledBy="dlg-title" closedBy="any">
        <h2 id="dlg-title">Dialog Title</h2>
        <button type="button">Action</button>
      </AccessibleDialog>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog.getAttribute('role')).toBeNull();
    expect(dialog.getAttribute('aria-modal')).toBeNull();
    expect(dialog.getAttribute('aria-labelledby')).toBe('dlg-title');
    expect(dialog.getAttribute('closedby')).toBe('any');
  });

  it('calls native showModal() and close() when supported by browser', () => {
    const showModalSpy = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    const closeSpy = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    (HTMLDialogElement.prototype as unknown as { showModal: () => void }).showModal = showModalSpy;
    (HTMLDialogElement.prototype as unknown as { close: () => void }).close = closeSpy;

    const { rerender } = render(
      <AccessibleDialog open onClose={vi.fn()} ariaLabel="Native modal">
        <button type="button">OK</button>
      </AccessibleDialog>,
    );

    expect(showModalSpy).toHaveBeenCalledTimes(1);

    rerender(
      <AccessibleDialog open={false} onClose={vi.fn()} ariaLabel="Native modal">
        <button type="button">OK</button>
      </AccessibleDialog>,
    );

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('supports Escape key dismissal and focus restoration fallback in jsdom', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open';
    document.body.appendChild(trigger);
    trigger.focus();

    const onClose = vi.fn();
    const { rerender } = render(
      <AccessibleDialog open onClose={onClose} ariaLabel="Fallback modal">
        <button type="button">Inner Button</button>
      </AccessibleDialog>,
    );

    const dialog = screen.getByRole('dialog');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Inner Button' }));

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <AccessibleDialog open={false} onClose={onClose} ariaLabel="Fallback modal">
        <button type="button">Inner Button</button>
      </AccessibleDialog>,
    );

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('blocks Escape dismissal when closedBy is none', () => {
    const onClose = vi.fn();
    render(
      <AccessibleDialog open onClose={onClose} ariaLabel="Locked modal" closedBy="none">
        <button type="button">Save</button>
      </AccessibleDialog>,
    );

    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent(dialog, new Event('cancel', { cancelable: true }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('light-dismisses on outside click when closedBy="any" and ignores text-selection drags out', () => {
    const onClose = vi.fn();
    render(
      <AccessibleDialog open onClose={onClose} ariaLabel="Light dismiss modal" closedBy="any">
        <button type="button">Content</button>
      </AccessibleDialog>,
    );

    const dialog = screen.getByRole('dialog') as HTMLDialogElement;
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      left: 100,
      right: 500,
      bottom: 400,
      width: 400,
      height: 300,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    });

    // Click inside dialog bounds should NOT dismiss
    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog, { clientX: 200, clientY: 200 });
    expect(onClose).not.toHaveBeenCalled();

    // Pointer down inside modal, release outside dialog bounds should NOT dismiss
    fireEvent(
      dialog,
      new MouseEvent('pointerdown', {
        bubbles: true,
        clientX: 200,
        clientY: 200,
      }),
    );
    fireEvent.click(dialog, { clientX: 10, clientY: 10 });
    expect(onClose).not.toHaveBeenCalled();

    // Pointer down + click outside dialog bounds SHOULD dismiss
    fireEvent(
      dialog,
      new MouseEvent('pointerdown', {
        bubbles: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    fireEvent.click(dialog, { clientX: 10, clientY: 10 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open under React StrictMode when native close() queues an async close event', async () => {
    const showModalSpy = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    const closeSpy = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      setTimeout(() => {
        this.dispatchEvent(new Event('close'));
      }, 0);
    });
    (HTMLDialogElement.prototype as unknown as { showModal: () => void }).showModal = showModalSpy;
    (HTMLDialogElement.prototype as unknown as { close: () => void }).close = closeSpy;

    const onClose = vi.fn();
    render(
      <StrictMode>
        <AccessibleDialog open onClose={onClose} ariaLabel="StrictMode modal" closedBy="any">
          <button type="button">OK</button>
        </AccessibleDialog>
      </StrictMode>,
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    const dialog = screen.getByRole('dialog');
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close or re-open the modal when closedBy changes while open', async () => {
    const showModalSpy = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    const closeSpy = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      setTimeout(() => {
        this.dispatchEvent(new Event('close'));
      }, 0);
    });
    (HTMLDialogElement.prototype as unknown as { showModal: () => void }).showModal = showModalSpy;
    (HTMLDialogElement.prototype as unknown as { close: () => void }).close = closeSpy;

    const onClose = vi.fn();
    const { rerender } = render(
      <AccessibleDialog open onClose={onClose} ariaLabel="Dynamic closedBy modal" closedBy="any">
        <button type="button">Import</button>
      </AccessibleDialog>,
    );

    expect(showModalSpy).toHaveBeenCalledTimes(1);

    rerender(
      <AccessibleDialog open onClose={onClose} ariaLabel="Dynamic closedBy modal" closedBy="none">
        <button type="button">Import</button>
      </AccessibleDialog>,
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(showModalSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();

    rerender(
      <AccessibleDialog open onClose={onClose} ariaLabel="Dynamic closedBy modal" closedBy="any">
        <button type="button">Import</button>
      </AccessibleDialog>,
    );

    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('AccessibleDialog design-system primitives', () => {
  it('exposes stable theme hooks and data attributes for third-party themes', () => {
    render(
      <AccessibleDialog
        open
        onClose={vi.fn()}
        ariaLabelledBy="theme-dialog-title"
        variant="danger"
        className="max-w-md"
        data-testid="theme-dialog"
      >
        <DialogHeader>
          <DialogTitle id="theme-dialog-title" icon={<span>!</span>} iconVariant="danger" description="Danger zone">
            Delete item
          </DialogTitle>
          <DialogCloseButton label="Close" />
        </DialogHeader>
        <DialogBody>Body content</DialogBody>
        <DialogFooter>
          <DialogButton variant="primary">Confirm</DialogButton>
        </DialogFooter>
      </AccessibleDialog>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('data-testid')).toBe('theme-dialog');
    expect(dialog.getAttribute('data-dialog')).toBe('');
    expect(dialog.getAttribute('data-dialog-variant')).toBe('danger');
    expect(dialog.className).toContain('openlearn-dialog');
    expect(dialog.className).toContain('max-w-md');

    expect(dialog.querySelector('[data-dialog-part="header"]')?.className).toContain('ol-dialog-header');
    expect(dialog.querySelector('[data-dialog-part="title"]')?.className).toContain('ol-dialog-title');
    expect(dialog.querySelector('[data-dialog-part="description"]')?.textContent).toBe('Danger zone');
    expect(dialog.querySelector('[data-dialog-part="close"]')?.className).toContain('ol-dialog-close');
    expect(dialog.querySelector('[data-dialog-part="body"]')?.className).toContain('ol-dialog-body');
    expect(dialog.querySelector('[data-dialog-part="footer"]')?.className).toContain('ol-dialog-footer');

    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm.className).toContain('ol-dialog-btn');
    expect(confirm.getAttribute('data-variant')).toBe('primary');
  });

  it('applies per-instance background color and radius overrides', () => {
    const { container } = render(
      <AccessibleDialog
        open
        onClose={vi.fn()}
        ariaLabel="Custom surface"
        backgroundColor="#fff7ed"
        borderRadius="1.5rem"
        style={{ color: 'rgb(120, 53, 15)' }}
      >
        <DialogBody>Custom surface</DialogBody>
      </AccessibleDialog>,
    );

    const dialog = container.querySelector<HTMLDialogElement>('dialog.openlearn-dialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.style.getPropertyValue('--ol-dialog-bg')).toBe('#fff7ed');
    expect(dialog?.style.getPropertyValue('--ol-dialog-radius')).toBe('1.5rem');
    expect(dialog?.getAttribute('data-dialog-surface')).toBe('custom');
    // 调用方传入的普通内联样式保持不变
    expect(dialog?.style.color).toBe('rgb(120, 53, 15)');
  });

  it('does not mark the surface as custom without an explicit background color', () => {
    const { container } = render(
      <AccessibleDialog open onClose={vi.fn()} ariaLabel="Default surface" borderRadius="0.5rem">
        <DialogBody>Default surface</DialogBody>
      </AccessibleDialog>,
    );

    const dialog = container.querySelector<HTMLDialogElement>('dialog.openlearn-dialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('data-dialog-surface')).toBeNull();
    expect(dialog?.style.getPropertyValue('--ol-dialog-radius')).toBe('0.5rem');
  });
});
