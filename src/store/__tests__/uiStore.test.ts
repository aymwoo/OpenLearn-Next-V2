import { describe, it, expect, beforeEach } from 'vitest';
import { uiStore } from '../uiStore';

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
      isLessonPreviewVisible: false,
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
});
