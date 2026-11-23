/**
 * useAppComposer.onViewCourse：只选课，不切换系统导航 tab。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useAppComposer } from '../useAppComposer';
import { appStore } from '../../store/appStore';

function makeSlice(groups: string[]) {
  const base = Object.fromEntries(groups.map((group) => [group, {}])) as Record<string, unknown>;
  return new Proxy(base, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in target) return target[prop];
      return vi.fn();
    },
  });
}

vi.mock('../useGlobalErrorCapture', () => ({ useGlobalErrorCapture: vi.fn() }));
vi.mock('../useToast', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../../plugin-host/plugin-host-context', () => ({ usePluginHost: () => ({}) }));
vi.mock('../../features/activity-ecosystem/registerTeacherExtension.js', () => ({
  registerTeacherActivityCenter: vi.fn(),
}));

vi.mock('../useSessionSlice', () => ({
  useSessionSlice: () => makeSlice(['studentViewStateData', 'sessionBootstrapData']),
}));

vi.mock('../useLessonsSlice', () => ({
  useLessonsSlice: () =>
    makeSlice([
      'systemData',
      'resourceLibraryData',
      'lessonCrudData',
      'classOpsData',
      'labAndScheduleData',
      'pluginManagementData',
      'quizGenerator',
      'courseWizard',
      'classBatch',
      'lessonTimelineData',
      'gradeExport',
      'lessonFilteringData',
    ]),
}));

vi.mock('../useClassroomSlice', () => ({
  useClassroomSlice: () =>
    makeSlice(['studentOpsData', 'classroomLiveData', 'agentChatData', 'studentNotificationsHook']),
}));

describe('useAppComposer.onViewCourse', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('只调用 setSelectedLesson，不切换 teacherTab', () => {
    const original = appStore.getState();
    const setSelectedLesson = vi.fn();
    const setTeacherTab = vi.fn();
    appStore.setState({ setSelectedLesson, setTeacherTab });

    try {
      const { result } = renderHook(() => useAppComposer());
      act(() => result.current.appData.onViewCourse('lesson-1'));

      expect(setSelectedLesson).toHaveBeenCalledWith('lesson-1');
      expect(setTeacherTab).not.toHaveBeenCalled();
    } finally {
      appStore.setState(original);
    }
  });
});
