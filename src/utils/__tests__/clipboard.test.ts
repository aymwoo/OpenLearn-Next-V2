import { describe, it, expect, afterEach, vi } from 'vitest';
import { copyToClipboard } from '../clipboard';

describe('copyToClipboard', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const originalExecCommand = document.execCommand;

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    }
    document.execCommand = originalExecCommand;
    vi.restoreAllMocks();
  });

  it('uses navigator.clipboard.writeText when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const ok = await copyToClipboard('hello-lan');
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello-lan');
  });

  it('falls back to document.execCommand when navigator.clipboard is undefined (plain HTTP LAN)', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;

    const ok = await copyToClipboard('passcode-1234');
    expect(ok).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });
});
