import type { StateCreator } from 'zustand/vanilla';
import { uiStore } from '../uiStore.js';
import type { Language } from '../../i18n';
import type { Toast } from '../../types/app';

export interface SharedUISlice {
  lang: Language;
  teacherTab: string;
  toasts: Toast[];
  siteInfo: { siteName: string; slogan: string; logoUrl: string | null };

  setLang: (lang: Language) => void;
  setTeacherTab: (tab: string) => void;
  addToast: (toast: Toast) => void;
  removeToast: (id: string) => void;
  setSiteInfo: (info: { siteName: string; slogan: string; logoUrl: string | null }) => void;
}

export const createSharedUISlice: StateCreator<SharedUISlice, [], [], SharedUISlice> = (set) => ({
  lang: uiStore.getState().lang,
  teacherTab: uiStore.getState().teacherTab,
  toasts: uiStore.getState().toasts,
  siteInfo: uiStore.getState().siteInfo,

  setLang: (lang) => {
    uiStore.getState().setLang(lang);
    set({ lang });
  },
  setTeacherTab: (teacherTab) => {
    uiStore.getState().setTeacherTab(teacherTab);
    set({ teacherTab });
  },
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
