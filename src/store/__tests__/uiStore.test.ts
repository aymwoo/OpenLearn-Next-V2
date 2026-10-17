import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { uiStore, getInitialTeacherTab } from '../uiStore';

describe('uiStore', () => {
  beforeEach(() => {
    uiStore.setState({
      lang: 'zh',
      activeRole: 'teacher',
      teacherTab: 'courses',
      profileOpen: false,
      isCourseWizardOpen: false,
      isImportLessonsOpen: false,
      isQuizGeneratorOpen: false,
      isSystemResourceLibraryOpen: false,
      batchPicker: null,
      isExportWeightModalOpen: false,
      toasts: [],
      siteInfo: { siteName: '', slogan: '', logoUrl: null },
    });
  });

  it('updates language correctly', () => {
    expect(uiStore.getState().lang).toBe('zh');
    uiStore.getState().setLang('en');
    expect(uiStore.getState().lang).toBe('en');
  });

  it('updates activeRole and teacherTab', () => {
    uiStore.getState().setActiveRole('student');
    expect(uiStore.getState().activeRole).toBe('student');

    uiStore.getState().setTeacherTab('classes');
    expect(uiStore.getState().teacherTab).toBe('classes');
  });

  it('manages modal open states correctly', () => {
    uiStore.getState().setIsCourseWizardOpen(true);
    expect(uiStore.getState().isCourseWizardOpen).toBe(true);

    uiStore.getState().setBatchPicker('schedule');
    expect(uiStore.getState().batchPicker).toBe('schedule');
  });

  it('manages toasts correctly', () => {
    const toast = { id: 't1', title: 'Notification', type: 'info' as const, message: 'Test toast' };
    uiStore.getState().addToast(toast);
    expect(uiStore.getState().toasts).toHaveLength(1);
    expect(uiStore.getState().toasts[0].message).toBe('Test toast');

    uiStore.getState().removeToast('t1');
    expect(uiStore.getState().toasts).toHaveLength(0);
  });

  describe('getInitialTeacherTab', () => {
    const originalLocation = window.location;

    afterEach(() => {
      (window as any).location = originalLocation;
    });

    it('defaults to live_class when hash is empty or missing', () => {
      delete (window as any).location;
      (window as any).location = { hash: '' };
      expect(getInitialTeacherTab()).toBe('live_class');

      (window as any).location = { hash: '#/' };
      expect(getInitialTeacherTab()).toBe('live_class');
    });

    it('parses valid built-in tab from location.hash', () => {
      delete (window as any).location;
      (window as any).location = { hash: '#/courses' };
      expect(getInitialTeacherTab()).toBe('courses');

      (window as any).location = { hash: '#/computer_labs' };
      expect(getInitialTeacherTab()).toBe('computer_labs');
    });

    it('parses plugin tab from location.hash', () => {
      delete (window as any).location;
      (window as any).location = { hash: '#/openlearn-courseware-hub/courseware-hub-teacher-tab' };
      expect(getInitialTeacherTab()).toBe('openlearn-courseware-hub/courseware-hub-teacher-tab');
    });
  });
});
