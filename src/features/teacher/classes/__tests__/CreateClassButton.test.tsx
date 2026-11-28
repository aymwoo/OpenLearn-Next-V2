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
    expect(screen.getByRole('button', { name: '创建班级' })).toBeTruthy();
  });

  it('renders the en label', () => {
    render(<CreateClassButton lang="en" fetchClasses={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Create Class' })).toBeTruthy();
  });

  it('opens a dialog, submits the name, then refreshes classes', async () => {
    const fetchClasses = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    render(<CreateClassButton lang="en" fetchClasses={fetchClasses} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Class' }));

    const input = screen.getByLabelText('Class name');
    fireEvent.change(input, { target: { value: 'Math 101' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(fetchClasses).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/classes',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Math 101' }) }),
    );
  });

  it('does nothing when the dialog is cancelled', async () => {
    const fetchClasses = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<CreateClassButton lang="en" fetchClasses={fetchClasses} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Class' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fetchClasses).not.toHaveBeenCalled();
  });

  it('shows a validation error and skips the request when the name is empty', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<CreateClassButton lang="en" fetchClasses={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Class' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Please enter a class name'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
