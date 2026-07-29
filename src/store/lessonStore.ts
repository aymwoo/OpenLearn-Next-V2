import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { Lesson, WhiteboardElement, VFSNode } from '../types/app';

export interface LessonState {
  lessons: Lesson[];
  selectedLesson: string | null;
  elements: WhiteboardElement[];
  vfsNodes: VFSNode[];

  setLessons: (lessons: Lesson[] | ((prev: Lesson[]) => Lesson[])) => void;
  setSelectedLesson: (selectedLesson: string | null) => void;
  setElements: (elements: WhiteboardElement[]) => void;
  setVfsNodes: (nodes: VFSNode[]) => void;
}

export const lessonStore = createStore<LessonState>((set) => ({
  lessons: [],
  selectedLesson: null,
  elements: [],
  vfsNodes: [],

  setLessons: (lessons) =>
    set((state) => ({
      lessons:
        typeof lessons === 'function'
          ? (lessons as (prev: Lesson[]) => Lesson[])(state.lessons)
          : lessons,
    })),
  setSelectedLesson: (selectedLesson) => set({ selectedLesson }),
  setElements: (elements) => set({ elements }),
  setVfsNodes: (vfsNodes) => set({ vfsNodes }),
}));

export const useLessonStore = <T>(selector: (state: LessonState) => T) => useStore(lessonStore, selector);
