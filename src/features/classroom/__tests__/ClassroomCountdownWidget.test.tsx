import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ClassroomCountdownWidget } from '../ClassroomCountdownWidget';
import { StudentCountdownBanner } from '../../student/StudentCountdownBanner';

describe('Classroom Countdown Timer & Sync (Teacher & Student)', () => {
  let mockSyncChannel: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSyncChannel = {
      broadcastCountdown: vi.fn(),
      broadcastTimerSync: vi.fn(),
      onMessage: vi.fn(() => () => {}),
    };

    global.fetch = vi.fn((url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/classroom/sessions/') && urlStr.includes('/countdown')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              lessonId: 'les-test-101',
              totalDuration: 300,
              timeRemaining: 300,
              isRunning: false,
              isPaused: false,
              label: '随堂测验',
              endsAt: null,
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    }) as any;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders Teacher Countdown Widget with default presets and controls', async () => {
    const onTimeRemainingChange = vi.fn();

    render(
      <ClassroomCountdownWidget
        lessonId="les-test-101"
        lang="zh"
        syncChannel={mockSyncChannel}
        onlineStudentCount={25}
        onTimeRemainingChange={onTimeRemainingChange}
      />,
    );

    // Header and controls
    expect(screen.getByText(/课堂倒计时/)).toBeDefined();
    expect(screen.getByText(/25/)).toBeDefined();
    expect(screen.getByText('05:00')).toBeDefined();

    // Start button
    const startBtn = screen.getByRole('button', { name: /开始/i });
    expect(startBtn).toBeDefined();

    fireEvent.click(startBtn);

    // Expect sync channel broadcast
    await waitFor(() => {
      expect(mockSyncChannel.broadcastCountdown).toHaveBeenCalled();
    });
  });

  it('supports selecting countdown presets (e.g. 3m, 10m)', async () => {
    render(
      <ClassroomCountdownWidget
        lessonId="les-test-101"
        lang="zh"
        syncChannel={mockSyncChannel}
      />,
    );

    const preset3m = screen.getByRole('button', { name: /3m/i });
    fireEvent.click(preset3m);

    await waitFor(() => {
      expect(mockSyncChannel.broadcastCountdown).toHaveBeenCalled();
    });
  });

  it('allows quick extension actions such as +1m and reset', async () => {
    render(
      <ClassroomCountdownWidget
        lessonId="les-test-101"
        lang="zh"
        syncChannel={mockSyncChannel}
      />,
    );

    const addTimeBtn = screen.getByRole('button', { name: '+1m' });
    fireEvent.click(addTimeBtn);

    await waitFor(() => {
      expect(mockSyncChannel.broadcastCountdown).toHaveBeenCalled();
    });
  });

  it('renders student countdown banner when active countdown is broadcast', async () => {
    const { rerender } = render(
      <StudentCountdownBanner
        lessonId="les-test-101"
        lang="zh"
        syncChannel={mockSyncChannel}
      />,
    );

    // Simulate incoming broadcast countdown update
    const activeState = {
      lessonId: 'les-test-101',
      totalDuration: 180,
      timeRemaining: 180,
      isRunning: true,
      isPaused: false,
      label: '随堂限时答题',
      endsAt: Date.now() + 180 * 1000,
    };

    // Trigger local storage / state simulation or direct prop
    window.dispatchEvent(
      new CustomEvent('openlearn:countdown:updated', {
        detail: activeState,
      }),
    );

    rerender(
      <StudentCountdownBanner
        lessonId="les-test-101"
        lang="zh"
        syncChannel={mockSyncChannel}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('随堂限时答题')).toBeDefined();
    });
  });
});
