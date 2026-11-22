// @vitest-environment jsdom
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useSurfaceFullscreen } from '../useSurfaceFullscreen';

let fullscreenElement: Element | null = null;

function Harness() {
  const targetRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const fullscreen = useSurfaceFullscreen(targetRef);
  return (
    <>
      <div ref={targetRef} data-testid="surface-target" />
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          buttonRef.current?.focus();
          fullscreen.toggle();
        }}
      >
        全屏
      </button>
      <span data-testid="fullscreen-state">{fullscreen.isFullscreen ? 'on' : 'off'}</span>
    </>
  );
}

describe('useSurfaceFullscreen', () => {
  beforeEach(() => {
    fullscreenElement = null;
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: vi.fn(async () => {
        fullscreenElement = null;
        document.dispatchEvent(new Event('fullscreenchange'));
      }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen;
    delete (HTMLElement.prototype as { webkitRequestFullscreen?: unknown }).webkitRequestFullscreen;
  });

  it('原生全屏成功，并在 fullscreenchange 退出时同步状态', async () => {
    const request = vi.fn(async () => {
      fullscreenElement = document.querySelector('[data-testid="surface-target"]');
    });
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: request,
    });

    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '全屏' }));

    await waitFor(() => expect(screen.getByTestId('fullscreen-state').textContent).toBe('on'));
    expect(request).toHaveBeenCalled();

    act(() => {
      fullscreenElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    await waitFor(() => expect(screen.getByTestId('fullscreen-state').textContent).toBe('off'));
  });

  it('原生被拒时降级占满视口，Esc 可退出并恢复焦点', async () => {
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error('denied')),
    });

    render(<Harness />);
    const button = screen.getByRole('button', { name: '全屏' });
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByTestId('fullscreen-state').textContent).toBe('on'));

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('fullscreen-state').textContent).toBe('off'));
    expect(document.activeElement).toBe(button);
  });
});
