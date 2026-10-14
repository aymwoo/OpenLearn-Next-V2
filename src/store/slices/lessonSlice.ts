import type { StateCreator } from 'zustand/vanilla';
import type { Lesson, WhiteboardElement, VFSNode } from '../../types/app';
import { getLessons } from '../../services/lessonService.js';
import { listFromEnvelope } from '../../utils/listEnvelope.js';

export interface LessonSlice {
  lessons: Lesson[];
  selectedLesson: string | null;
  elements: WhiteboardElement[];
  vfsNodes: VFSNode[];

  setLessons: (lessons: Lesson[] | ((prev: Lesson[]) => Lesson[])) => void;
  setSelectedLesson: (selectedLesson: string | null) => void;
  setElements: (elements: WhiteboardElement[]) => void;
  setVfsNodes: (nodes: VFSNode[]) => void;
  loadLessons: () => Promise<void>;
}

export const createLessonSlice: StateCreator<LessonSlice, [], [], LessonSlice> = (set) => ({
  lessons: [],
  selectedLesson: null,
  elements: [],
  vfsNodes: [],

  setLessons: (lessons) =>
    set((state) => ({
      lessons: typeof lessons === 'function' ? (lessons as (prev: Lesson[]) => Lesson[])(state.lessons) : lessons,
    })),
  setSelectedLesson: (selectedLesson) => set({ selectedLesson }),
  setElements: (elements) => set({ elements }),
  setVfsNodes: (vfsNodes) => set({ vfsNodes }),

  loadLessons: async () => {
    try {
      const { ok, data } = await getLessons();
      if (ok) {
        const lessons = listFromEnvelope<Lesson>(data);
        set((state) => ({
          lessons,
          selectedLesson: state.selectedLesson ?? (lessons.length > 0 ? lessons[0].id : state.selectedLesson),
        }));
      }
    } catch (e) {
      console.warn('Failed to fetch lessons', e);
    }
  },
});
