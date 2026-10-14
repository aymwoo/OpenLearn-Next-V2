import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { appStore } from './appStore.js';
import type { ClassSlice } from './slices/classSlice.js';

export type ClassState = ClassSlice;

/**
 * classStore facade:
 * Proxied directly to the unified appStore to eliminate split-brain state inconsistencies.
 */
export const classStore: StoreApi<ClassState> = appStore as unknown as StoreApi<ClassState>;

export const useClassStore = <T>(selector: (state: ClassState) => T) => useStore(classStore, selector);
