import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionSlice } from '../useSessionSlice';
import { useSessionBootstrap } from '../useSessionBootstrap';
import { appStore } from '../../store/appStore';
import { uiStore } from '../../store/uiStore';

// Mock sessionService
vi.mock('../../services/sessionService.js', () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({ ok: false }),
  fetchDbStatus: vi.fn().mockResolvedValue({ ok: true, data: { status: 'normal' } }),
  fetchSiteSettings: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  postLogout: vi.fn().mockResolvedValue({ ok: true }),
}));

describe('Teacher Tab Hash Routing & Login Persistence (Issue #88)', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    delete (window as any).location;
    (window as any).location = {
      pathname: '/',
      search: '',
      hash: '',
    };
    appStore.getState().setTeacherTab('live_class');
    uiStore.getState().setTeacherTab('live_class');
  });

  afterEach(() => {
    (window as any).location = originalLocation;
    vi.restoreAllMocks();
  });

  describe('useSessionSlice Hash-based Routing', () => {
    it('preserves existing hash on mount without overwriting it with default live_class', async () => {
      // Simulate user opening new tab directly at #/courses
      (window as any).location.hash = '#/courses';
      appStore.getState().setTeacherTab('live_class');

      const { result } = renderHook(() =>
        useSessionSlice({
          lang: 'zh',
          addToast: vi.fn(),
          fetchStudents: vi.fn().mockResolvedValue(undefined),
        }),
      );

      // The location.hash must NOT have been overwritten with '#/live_class'
      expect((window as any).location.hash).toBe('#/courses');

      // The hook should sync teacherTab to 'courses'
      expect(result.current.teacherTab).toBe('courses');
      expect(appStore.getState().teacherTab).toBe('courses');
    });

    it('preserves plugin tab hash on mount', async () => {
      const pluginTab = 'openlearn-courseware-hub/courseware-hub-teacher-tab';
      (window as any).location.hash = `#/${pluginTab}`;
      appStore.getState().setTeacherTab('live_class');

      const { result } = renderHook(() =>
        useSessionSlice({
          lang: 'zh',
          addToast: vi.fn(),
          fetchStudents: vi.fn().mockResolvedValue(undefined),
        }),
      );

      expect((window as any).location.hash).toBe(`#/${pluginTab}`);
      expect(result.current.teacherTab).toBe(pluginTab);
    });

    it('defaults to #/live_class when mounting without a hash', async () => {
      (window as any).location.hash = '';
      appStore.getState().setTeacherTab('live_class');

      renderHook(() =>
        useSessionSlice({
          lang: 'zh',
          addToast: vi.fn(),
          fetchStudents: vi.fn().mockResolvedValue(undefined),
        }),
      );

      expect((window as any).location.hash).toBe('#/live_class');
    });

    it('reflects teacherTab changes in window.location.hash', async () => {
      (window as any).location.hash = '';
      const { result } = renderHook(() =>
        useSessionSlice({
          lang: 'zh',
          addToast: vi.fn(),
          fetchStudents: vi.fn().mockResolvedValue(undefined),
        }),
      );

      act(() => {
        result.current.setTeacherTab('timetable');
      });

      expect((window as any).location.hash).toBe('#/timetable');
    });

    it('syncs teacherTab on hashchange event (e.g. browser back/forward)', async () => {
      (window as any).location.hash = '#/courses';
      const { result } = renderHook(() =>
        useSessionSlice({
          lang: 'zh',
          addToast: vi.fn(),
          fetchStudents: vi.fn().mockResolvedValue(undefined),
        }),
      );

      expect(result.current.teacherTab).toBe('courses');

      // Simulate browser navigation to #/classes
      act(() => {
        (window as any).location.hash = '#/classes';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });

      expect(result.current.teacherTab).toBe('classes');
      expect(appStore.getState().teacherTab).toBe('classes');
    });
  });

  describe('useSessionBootstrap handleLoginSuccess', () => {
    it('preserves current URL tab on teacher login if hash is present', () => {
      (window as any).location.hash = '#/computer_labs';
      const { result } = renderHook(() =>
        useSessionBootstrap({
          fetchStudents: vi.fn().mockResolvedValue(undefined),
        }),
      );

      act(() => {
        result.current.handleLoginSuccess({
          username: 'teacher',
          role: 'teacher',
          name: 'Teacher Lee',
        });
      });

      expect(appStore.getState().teacherTab).toBe('computer_labs');
    });

    it('falls back to live_class on teacher login if hash is empty', () => {
      (window as any).location.hash = '';
      const { result } = renderHook(() =>
        useSessionBootstrap({
          fetchStudents: vi.fn().mockResolvedValue(undefined),
        }),
      );

      act(() => {
        result.current.handleLoginSuccess({
          username: 'teacher',
          role: 'teacher',
          name: 'Teacher Lee',
        });
      });

      expect(appStore.getState().teacherTab).toBe('live_class');
    });
  });
});
