import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { useSessionSlice } from '../useSessionSlice';
import { appStore } from '../../store/appStore';
import { uiStore } from '../../store/uiStore';
import * as sessionService from '../../services/sessionService.js';

vi.mock('../../services/sessionService.js', () => ({
  fetchAuthSession: vi.fn(),
  fetchDbStatus: vi.fn().mockResolvedValue({ ok: true, status: 200, data: { status: 'normal' } }),
  fetchSiteSettings: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  postLogout: vi.fn().mockResolvedValue(undefined),
  saveOnboardingStatus: vi.fn(),
}));

describe('useSessionSlice onboarding tour lifecycle (#530)', () => {
  beforeEach(() => {
    localStorage.clear();
    appStore.getState().setSession(null);
    appStore.getState().setTeacherTab('live_class');
    uiStore.getState().setTeacherTab('live_class');
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    appStore.getState().setSession(null);
    vi.restoreAllMocks();
  });

  it('blocks tour while mustChangePassword is true, opens once password is changed, and stays dismissed across reload for that account', async () => {
    vi.mocked(sessionService.fetchAuthSession).mockResolvedValue({
      ok: true,
      data: {
        session: {
          role: 'teacher',
          subRole: 'administrator',
          userId: 'admin-a',
          username: 'admin',
          name: '管理员A',
          mustChangePassword: true,
          tourStatus: 'pending',
        },
      },
    });
    vi.mocked(sessionService.saveOnboardingStatus).mockResolvedValue({
      ok: true,
      status: 200,
      data: { success: true, tourStatus: 'skipped' },
    });

    const addToast = vi.fn();
    const { result, unmount } = renderHook(() =>
      useSessionSlice({ lang: 'zh', addToast, fetchStudents: vi.fn().mockResolvedValue(undefined) }),
    );

    // Wait for initial session check to finish
    await waitFor(() => {
      expect(appStore.getState().session?.userId).toBe('admin-a');
    });
    // Mandatory password gate is active -> optional tour MUST NOT auto-open
    expect(result.current.isTourOpen).toBe(false);

    // Complete mandatory password change
    act(() => {
      appStore.getState().setSession({
        ...appStore.getState().session!,
        mustChangePassword: false,
      });
    });

    await waitFor(() => {
      expect(result.current.isTourOpen).toBe(true);
    });

    // User clicks Skip
    await act(async () => {
      await result.current.dismissTour('skipped');
    });

    expect(result.current.isTourOpen).toBe(false);
    expect(sessionService.saveOnboardingStatus).toHaveBeenCalledWith('skipped');
    expect(localStorage.getItem('edu_os_tour_status:admin-a')).toBe('skipped');
    expect(localStorage.getItem('edu_os_tour_completed')).toBeNull();
    expect(addToast).not.toHaveBeenCalled();

    // Simulate page refresh / re-login where server returns tourStatus: 'skipped' (even if localStorage were cleared)
    unmount();
    localStorage.clear();
    appStore.getState().setSession(null);
    vi.mocked(sessionService.fetchAuthSession).mockResolvedValue({
      ok: true,
      data: {
        session: {
          role: 'teacher',
          subRole: 'administrator',
          userId: 'admin-a',
          username: 'admin',
          name: '管理员A',
          tourStatus: 'skipped',
        },
      },
    });

    const refreshed = renderHook(() =>
      useSessionSlice({ lang: 'zh', addToast, fetchStudents: vi.fn().mockResolvedValue(undefined) }),
    );
    await waitFor(() => {
      expect(appStore.getState().session?.tourStatus).toBe('skipped');
    });
    expect(refreshed.result.current.isTourOpen).toBe(false);
  });

  it('isolates tour status between different accounts on the same browser and honors legacy E2E key', async () => {
    localStorage.setItem('edu_os_tour_status:admin-a', 'completed');
    vi.mocked(sessionService.fetchAuthSession).mockResolvedValue({
      ok: true,
      data: {
        session: {
          role: 'teacher',
          subRole: 'administrator',
          userId: 'admin-b',
          username: 'admin_b',
          name: '管理员B',
          tourStatus: 'pending',
        },
      },
    });

    const { result, unmount } = renderHook(() =>
      useSessionSlice({ lang: 'zh', addToast: vi.fn(), fetchStudents: vi.fn().mockResolvedValue(undefined) }),
    );

    await waitFor(() => {
      expect(result.current.isTourOpen).toBe(true);
    });
    unmount();

    // Legacy E2E flag skips auto-open
    localStorage.clear();
    localStorage.setItem('edu_os_tour_completed', 'true');
    appStore.getState().setSession(null);
    const e2eHook = renderHook(() =>
      useSessionSlice({ lang: 'zh', addToast: vi.fn(), fetchStudents: vi.fn().mockResolvedValue(undefined) }),
    );
    await waitFor(() => {
      expect(appStore.getState().session?.userId).toBe('admin-b');
    });
    expect(e2eHook.result.current.isTourOpen).toBe(false);
  });

  it('shows warning toast and suppresses current-session re-popup when persistence fails', async () => {
    vi.mocked(sessionService.fetchAuthSession).mockResolvedValue({
      ok: true,
      data: {
        session: {
          role: 'teacher',
          subRole: 'administrator',
          userId: 'admin-fail',
          username: 'admin_fail',
          name: '失败测试管理员',
          tourStatus: 'pending',
        },
      },
    });
    vi.mocked(sessionService.saveOnboardingStatus).mockResolvedValue({
      ok: false,
      status: 500,
      data: { error: 'DB locked' },
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const addToast = vi.fn();
    const { result } = renderHook(() =>
      useSessionSlice({ lang: 'zh', addToast, fetchStudents: vi.fn().mockResolvedValue(undefined) }),
    );

    await waitFor(() => {
      expect(result.current.isTourOpen).toBe(true);
    });

    await act(async () => {
      await result.current.dismissTour('skipped');
    });

    expect(result.current.isTourOpen).toBe(false);
    expect(addToast).toHaveBeenCalledWith(expect.stringContaining('未能保存到服务器'), 'warning');

    // Even if session object reference changes (e.g. avatar update), tour does NOT pop back up
    act(() => {
      appStore.getState().setSession({
        ...appStore.getState().session!,
        name: '已更新名称',
      });
    });
    expect(result.current.isTourOpen).toBe(false);
  });
});
