import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { Language } from '../i18n';
import type { Toast } from '../types/app';

export interface UIState {
  // Navigation & Role
  lang: Language;
  activeRole: 'teacher' | 'student';
  teacherTab: string;

  // Modal Open States
  profileOpen: boolean;
  isCourseWizardOpen: boolean;
  isImportLessonsOpen: boolean;
  isQuizGeneratorOpen: boolean;
  isLessonPreviewVisible: boolean;
  isSystemResourceLibraryOpen: boolean;
  batchPicker: 'schedule' | 'lock' | 'transfer' | null;
  isExportWeightModalOpen: boolean;

  // Toast & Branding
  toasts: Toast[];
  siteInfo: { siteName: string; slogan: string; logoUrl: string | null };

  // Actions
  setLang: (lang: Language) => void;
  setActiveRole: (role: 'teacher' | 'student') => void;
  setTeacherTab: (tab: string) => void;
  setProfileOpen: (open: boolean) => void;
  setIsCourseWizardOpen: (open: boolean) => void;
  setIsImportLessonsOpen: (open: boolean) => void;
  setIsQuizGeneratorOpen: (open: boolean) => void;
  setIsLessonPreviewVisible: (visible: boolean) => void;
  setIsSystemResourceLibraryOpen: (open: boolean) => void;
  setBatchPicker: (batchPicker: 'schedule' | 'lock' | 'transfer' | null) => void;
  setIsExportWeightModalOpen: (open: boolean) => void;
  addToast: (toast: Toast) => void;
  removeToast: (id: string) => void;
  setSiteInfo: (info: { siteName: string; slogan: string; logoUrl: string | null }) => void;
}

export const uiStore = createStore<UIState>((set) => ({
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

  setLang: (lang) => set({ lang }),
  setActiveRole: (activeRole) => set({ activeRole }),
  setTeacherTab: (teacherTab) => set({ teacherTab }),
  setProfileOpen: (profileOpen) => set({ profileOpen }),
  setIsCourseWizardOpen: (isCourseWizardOpen) => set({ isCourseWizardOpen }),
  setIsImportLessonsOpen: (isImportLessonsOpen) => set({ isImportLessonsOpen }),
  setIsQuizGeneratorOpen: (isQuizGeneratorOpen) => set({ isQuizGeneratorOpen }),
  setIsLessonPreviewVisible: (isLessonPreviewVisible) => set({ isLessonPreviewVisible }),
  setIsSystemResourceLibraryOpen: (isSystemResourceLibraryOpen) => set({ isSystemResourceLibraryOpen }),
  setBatchPicker: (batchPicker) => set({ batchPicker }),
  setIsExportWeightModalOpen: (isExportWeightModalOpen) => set({ isExportWeightModalOpen }),
  addToast: (toast) => set((s) => ({ toasts: [...s.toasts, toast] })),
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setSiteInfo: (siteInfo) => set({ siteInfo }),
}));

export const useUIStore = <T>(selector: (state: UIState) => T) => useStore(uiStore, selector);
