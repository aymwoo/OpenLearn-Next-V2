import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import AccessibleDialog from '../AccessibleDialog';

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
});
