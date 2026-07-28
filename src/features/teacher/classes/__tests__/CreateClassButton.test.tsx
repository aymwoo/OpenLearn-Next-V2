import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CreateClassButton } from '../CreateClassButton';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
afterEach(() => {
  cleanup();
});

describe('CreateClassButton', () => {
  it('renders the zh label', () => {
    render(<CreateClassButton lang="zh" fetchClasses={vi.fn()} />);
    expect(screen.getByText('创建班级')).toBeTruthy();
  });

  it('renders the en label', () => {
    render(<CreateClassButton lang="en" fetchClasses={vi.fn()} />);
    expect(screen.getByText('Create Class')).toBeTruthy();
  });

  it('prompts for a name, POSTs it, then refreshes classes', async () => {
    const fetchClasses = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'prompt').mockReturnValue('Math 101');

    render(<CreateClassButton lang="en" fetchClasses={fetchClasses} />);
    fireEvent.click(screen.getByText('Create Class'));

    await waitFor(() => expect(fetchClasses).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/classes',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Math 101' }) })
    );
  });

  it('does nothing when the prompt is cancelled', async () => {
    const fetchClasses = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'prompt').mockReturnValue(null);

    render(<CreateClassButton lang="en" fetchClasses={fetchClasses} />);
    fireEvent.click(screen.getByText('Create Class'));

    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fetchClasses).not.toHaveBeenCalled();
  });
});
