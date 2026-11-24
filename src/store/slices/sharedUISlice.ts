import type { StateCreator } from 'zustand/vanilla';
import { uiStore } from '../uiStore.js';
import type { Language } from '../../i18n';
import type { Toast } from '../../types/app';

export interface SharedUISlice {
  lang: Language;
  teacherTab: string;
  /** 当前在「课程管理」页内展开的课程 id；null 表示显示课程列表。 */
  courseEditingLessonId: string | null;
  toasts: Toast[];
  siteInfo: { siteName: string; slogan: string; logoUrl: string | null };

  setLang: (lang: Language) => void;
  setTeacherTab: (tab: string) => void;
  setCourseEditingLessonId: (lessonId: string | null) => void;
  addToast: (toast: Toast) => void;
  removeToast: (id: string) => void;
  setSiteInfo: (info: { siteName: string; slogan: string; logoUrl: string | null }) => void;
}

export const createSharedUISlice: StateCreator<SharedUISlice, [], [], SharedUISlice> = (set) => ({
  lang: uiStore.getState().lang,
  teacherTab: uiStore.getState().teacherTab,
  courseEditingLessonId: null,
  toasts: uiStore.getState().toasts,
  siteInfo: uiStore.getState().siteInfo,

  setLang: (lang) => {
    uiStore.getState().setLang(lang);
    set({ lang });
  },
  setTeacherTab: (teacherTab) => {
    uiStore.getState().setTeacherTab(teacherTab);
    // 离开「课程管理」时清空页内编辑态：下次从导航进入应看到课程列表，
    // 而不是自动打开上一次编辑的课程。
    set((state) => ({
      teacherTab,
      ...(state.teacherTab === 'courses' && teacherTab !== 'courses' ? { courseEditingLessonId: null } : {}),
    }));
  },
  setCourseEditingLessonId: (courseEditingLessonId) => set({ courseEditingLessonId }),
  addToast: (toast) => {
    uiStore.getState().addToast(toast);
    set({ toasts: uiStore.getState().toasts });
  },
  removeToast: (id) => {
    uiStore.getState().removeToast(id);
    set({ toasts: uiStore.getState().toasts });
  },
  setSiteInfo: (siteInfo) => {
    uiStore.getState().setSiteInfo(siteInfo);
    set({ siteInfo });
  },
});
