import { describe, it, expect } from 'vitest';
import { appStore } from '../appStore';
import { uiStore } from '../uiStore';

describe('appStore & uiStore Decoupling (Phase C2)', () => {
  it('should update teacherTab across appStore and uiStore synchronously without circular setState', () => {
    appStore.getState().setTeacherTab('classes');

    expect(appStore.getState().teacherTab).toBe('classes');
    expect(uiStore.getState().teacherTab).toBe('classes');

    appStore.getState().setTeacherTab('timetable');
    expect(appStore.getState().teacherTab).toBe('timetable');
    expect(uiStore.getState().teacherTab).toBe('timetable');
  });

  it('should update language across appStore and uiStore synchronously', () => {
    appStore.getState().setLang('en');

    expect(appStore.getState().lang).toBe('en');
    expect(uiStore.getState().lang).toBe('en');

    // restore
    appStore.getState().setLang('zh');
    expect(appStore.getState().lang).toBe('zh');
  });

  it('should update siteInfo synchronously', () => {
    const customInfo = {
      siteName: '自定义开放学习平台',
      slogan: 'AI 驱动教学',
      logoUrl: null,
    };
    appStore.getState().setSiteInfo(customInfo);

    expect(appStore.getState().siteInfo).toEqual(customInfo);
    expect(uiStore.getState().siteInfo).toEqual(customInfo);
  });
});
