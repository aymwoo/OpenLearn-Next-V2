import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { Language } from '../i18n';

export type Lesson = { id: string; title: string; content: string; timeline?: string; created_at?: number; enrollment_count?: number };
export type WhiteboardElement = { id: string; type: string; data: string };
export type ClassType = { id: string; name: string; description: string; class_passcode?: string | null; created_at: number };
export type StudentType = { id: string; name: string; email: string; password?: string; locked_lesson_id?: string | null; private_notes?: string | null; created_at: number };

export interface SessionType {
  role: 'teacher' | 'student';
  userId?: string;
  username?: string;
  subRole?: 'administrator' | 'teacher';
  name: string;
  studentId?: string;
  email?: string;
}

export interface AppState {
  lang: Language;
  session: SessionType | null;
  lessons: Lesson[];
  selectedLesson: string | null;
  elements: WhiteboardElement[];
  classes: ClassType[];
  students: StudentType[];
  liveClassSelectedClassId: string | null;
  liveClassIsActive: boolean;
  
  // Actions
  setLang: (lang: Language) => void;
  setSession: (session: SessionType | null) => void;
  setLessons: (lessons: Lesson[]) => void;
  setSelectedLesson: (selectedLesson: string | null) => void;
  setElements: (elements: WhiteboardElement[]) => void;
  setClasses: (classes: ClassType[]) => void;
  setStudents: (students: StudentType[]) => void;
  setLiveClassSelectedClassId: (id: string | null) => void;
  setLiveClassIsActive: (isActive: boolean) => void;
}

// Create vanilla store for Cross-MFE sharing
export const appStore = createStore<AppState>((set) => ({
  lang: 'zh',
  session: null,
  lessons: [],
  selectedLesson: null,
  elements: [],
  classes: [],
  students: [],
  liveClassSelectedClassId: null,
  liveClassIsActive: false,

  setLang: (lang) => set({ lang }),
  setSession: (session) => set({ session }),
  setLessons: (lessons) => set({ lessons }),
  setSelectedLesson: (selectedLesson) => set({ selectedLesson }),
  setElements: (elements) => set({ elements }),
  setClasses: (classes) => set({ classes }),
  setStudents: (students) => set({ students }),
  setLiveClassSelectedClassId: (liveClassSelectedClassId) => set({ liveClassSelectedClassId }),
  setLiveClassIsActive: (liveClassIsActive) => set({ liveClassIsActive }),
}));

// Create React-bound hook for Host Shell
export const useAppStore = <T>(selector: (state: AppState) => T) => useStore(appStore, selector);
