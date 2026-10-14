import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { appStore } from './appStore.js';
import type { LessonSlice } from './slices/lessonSlice.js';

export type LessonState = LessonSlice;

/**
 * lessonStore facade:
 * Proxied directly to the unified appStore to eliminate split-brain state inconsistencies.
 */
export const lessonStore: StoreApi<LessonState> = appStore as unknown as StoreApi<LessonState>;

export const useLessonStore = <T>(selector: (state: LessonState) => T) => useStore(lessonStore, selector);
