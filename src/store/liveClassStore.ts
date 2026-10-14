import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { appStore } from './appStore.js';
import type { LiveClassSlice } from './slices/liveClassSlice.js';

export type LiveClassState = LiveClassSlice;

/**
 * liveClassStore facade:
 * Proxied directly to the unified appStore to eliminate split-brain state inconsistencies.
 */
export const liveClassStore: StoreApi<LiveClassState> = appStore as unknown as StoreApi<LiveClassState>;

export const useLiveClassStore = <T>(selector: (state: LiveClassState) => T) => useStore(liveClassStore, selector);
