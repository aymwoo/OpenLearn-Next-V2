import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { LazyCourseware } from '../LazyCourseware';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LazyCourseware', () => {
  it('renders without error and shows placeholder when coursewareId is null', async () => {
    render(<LazyCourseware coursewareId={null} />);

    await waitFor(() => {
      expect(screen.getByText('No Courseware Selected')).toBeTruthy();
    });
  });

  it('renders interactive courseware iframe when coursewareId is provided', async () => {
    render(<LazyCourseware coursewareId="courseware-123" />);

    await waitFor(() => {
      const iframe = screen.getByTitle('Interactive Courseware') as HTMLIFrameElement;
      expect(iframe).toBeTruthy();
      expect(iframe.src).toContain('/api/courseware/courseware-123');
    });
  });

  it('handles onClose callback correctly', async () => {
    const handleClose = vi.fn();
    render(<LazyCourseware coursewareId="courseware-123" onClose={handleClose} />);

    await waitFor(() => {
      expect(screen.getByTitle('Interactive Courseware')).toBeTruthy();
    });

    const closeBtn = screen.getByRole('button', { name: '' });
    // Find the button with close icon (last button in header)
    const buttons = screen.getAllByRole('button');
    const closeButton = buttons[buttons.length - 1];
    closeButton.click();
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
