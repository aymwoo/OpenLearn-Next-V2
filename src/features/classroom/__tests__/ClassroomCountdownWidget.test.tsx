import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ClassroomCountdownWidget } from '../ClassroomCountdownWidget';
import { StudentCountdownBanner } from '../../student/StudentCountdownBanner';

describe('Classroom Countdown Timer & Sync (Teacher & Student)', () => {
  let mockSyncChannel: any;

  beforeEach(() => {
    localStorage.clear();
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
    render(<ClassroomCountdownWidget lessonId="les-test-101" lang="zh" syncChannel={mockSyncChannel} />);

    const preset3m = screen.getByRole('button', { name: /3m/i });
    fireEvent.click(preset3m);

    await waitFor(() => {
      expect(mockSyncChannel.broadcastCountdown).toHaveBeenCalled();
    });
  });

  it('allows quick extension actions such as +1m and reset', async () => {
    render(<ClassroomCountdownWidget lessonId="les-test-101" lang="zh" syncChannel={mockSyncChannel} />);

    const addTimeBtn = screen.getByRole('button', { name: '+1m' });
    fireEvent.click(addTimeBtn);

    await waitFor(() => {
      expect(mockSyncChannel.broadcastCountdown).toHaveBeenCalled();
    });
  });

  it('renders student countdown banner when active countdown is broadcast', async () => {
    const { rerender } = render(
      <StudentCountdownBanner lessonId="les-test-101" lang="zh" syncChannel={mockSyncChannel} />,
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

    rerender(<StudentCountdownBanner lessonId="les-test-101" lang="zh" syncChannel={mockSyncChannel} />);

    await waitFor(() => {
      expect(screen.getByText('随堂限时答题')).toBeDefined();
    });
  });

  it('关闭倒计时后教师端回到开始前的就绪态，学生端横幅同步消失', async () => {
    render(
      <>
        <ClassroomCountdownWidget
          variant="header"
          lessonId="les-test-101"
          lang="zh"
          syncChannel={mockSyncChannel}
          onlineStudentCount={30}
        />
        <StudentCountdownBanner lessonId="les-test-101" lang="zh" syncChannel={mockSyncChannel} />
      </>,
    );

    const studentBanner = () => document.getElementById('student-classroom-countdown-banner');

    fireEvent.click(screen.getByRole('button', { name: '开始倒计时' }));
    await waitFor(() => {
      expect(studentBanner()).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: '关闭倒计时' }));

    await waitFor(() => {
      expect(studentBanner()).toBeNull();
    });
    // 教师端回到开始之前的展示态：剩余时间等于总时长、无运行态，关闭按钮随之隐藏
    expect(screen.getByText('05:00')).toBeDefined();
    expect(screen.queryByRole('button', { name: '关闭倒计时' })).toBeNull();
    expect(mockSyncChannel.broadcastCountdown).toHaveBeenLastCalledWith(
      expect.objectContaining({ dismissed: true, isRunning: false, isPaused: false, endsAt: null }),
    );
  });

  it('暂停后关闭同样回到就绪态，重新开始后学生端横幅恢复', async () => {
    render(
      <>
        <ClassroomCountdownWidget lessonId="les-test-101" lang="zh" syncChannel={mockSyncChannel} />
        <StudentCountdownBanner lessonId="les-test-101" lang="zh" syncChannel={mockSyncChannel} />
      </>,
    );

    const studentBanner = () => document.getElementById('student-classroom-countdown-banner');

    fireEvent.click(screen.getByRole('button', { name: /开始倒计时/ }));
    await waitFor(() => expect(studentBanner()).not.toBeNull());

    // 暂停后关闭：学生端先看到「老师已暂停」，关闭后横幅消失
    fireEvent.click(screen.getByRole('button', { name: /暂停计时/ }));
    await waitFor(() => expect(screen.getByText(/老师已暂停计时/)).toBeDefined());

    fireEvent.click(document.getElementById('classroom-countdown-card-close-btn') as HTMLElement);
    await waitFor(() => expect(studentBanner()).toBeNull());
    expect(screen.queryByText(/老师已暂停计时/)).toBeNull();

    // 关闭后重新开始：dismissed 被清除，学生端横幅重新出现
    fireEvent.click(screen.getByRole('button', { name: /开始倒计时/ }));
    await waitFor(() => expect(studentBanner()).not.toBeNull());
    expect(mockSyncChannel.broadcastCountdown).toHaveBeenLastCalledWith(
      expect.objectContaining({ dismissed: false, isRunning: true }),
    );
  });

  it('大屏投影内的关闭按钮会退出投影并同步隐藏学生端横幅', async () => {
    render(
      <>
        <ClassroomCountdownWidget
          variant="header"
          lessonId="les-test-101"
          lang="zh"
          syncChannel={mockSyncChannel}
          onlineStudentCount={30}
        />
        <StudentCountdownBanner lessonId="les-test-101" lang="zh" syncChannel={mockSyncChannel} />
      </>,
    );

    const studentBanner = () => document.getElementById('student-classroom-countdown-banner');

    fireEvent.click(screen.getByRole('button', { name: '开始倒计时' }));
    await waitFor(() => expect(studentBanner()).not.toBeNull());

    // 打开设置浮层 → 进入大屏投影
    fireEvent.click(screen.getByTitle(/倒计时设置与大屏投放/));
    fireEvent.click(screen.getByTitle(/大屏全屏投放/));
    expect(document.getElementById('classroom-countdown-projector-modal')).not.toBeNull();

    fireEvent.click(document.getElementById('classroom-countdown-projector-close-btn') as HTMLElement);

    await waitFor(() => {
      expect(document.getElementById('classroom-countdown-projector-modal')).toBeNull();
      expect(studentBanner()).toBeNull();
    });
    expect(screen.queryByRole('button', { name: '关闭倒计时' })).toBeNull();
  });

  it('renders topbar variant header pill and toggles settings popover', async () => {
    render(
      <ClassroomCountdownWidget
        variant="header"
        lessonId="les-test-101"
        lang="zh"
        syncChannel={mockSyncChannel}
        onlineStudentCount={30}
      />,
    );

    // Header pill elements
    expect(screen.getByText('05:00')).toBeDefined();
    const plusOneBtn = screen.getByRole('button', { name: '+1m' });
    expect(plusOneBtn).toBeDefined();

    fireEvent.click(plusOneBtn);
    await waitFor(() => {
      expect(mockSyncChannel.broadcastCountdown).toHaveBeenCalled();
    });

    // Toggle settings popover
    const toggleBtn = screen.getByTitle(/倒计时设置/);
    fireEvent.click(toggleBtn);

    expect(screen.getByText('课堂倒计时设置')).toBeDefined();
    expect(screen.getByText('快捷预设')).toBeDefined();

    // 浮层通过 portal 挂到 body 且使用 fixed 定位：不参与父级布局（不撑高顶栏）、不被 overflow 裁剪
    const popover = document.getElementById('classroom-countdown-header-popover');
    expect(popover).not.toBeNull();
    expect(popover?.parentElement).toBe(document.body);
    expect(popover?.className).toContain('fixed');
    expect(popover?.className).toContain('z-[9999]');
  });
});
