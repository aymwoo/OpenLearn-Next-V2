import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { appStore } from './appStore.js';
import type { StudentViewSlice } from './slices/studentViewSlice.js';

export type StudentState = StudentViewSlice;

/**
 * studentStore facade:
 * Proxied directly to the unified appStore to eliminate split-brain state inconsistencies.
 */
export const studentStore: StoreApi<StudentState> = appStore as unknown as StoreApi<StudentState>;

export const useStudentStore = <T>(selector: (state: StudentState) => T) => useStore(studentStore, selector);
