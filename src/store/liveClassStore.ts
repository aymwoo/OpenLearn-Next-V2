import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

export interface LiveClassState {
  liveClassSelectedClassId: string | null;
  liveClassIsActive: boolean;
  liveClassFeed: any[];
  liveClassTimeRemaining: number;
  liveClassAcknowledgedMap: Map<string, boolean>;
  liveClassStudentProgress: any[];
  onlineStudentIds: string[];
  activeStudentLessons: Record<string, string>;

  setLiveClassSelectedClassId: (id: string | null) => void;
  setLiveClassIsActive: (isActive: boolean) => void;
  setLiveClassFeed: (feed: any[]) => void;
  appendLiveClassFeed: (entry: any) => void;
  setLiveClassTimeRemaining: (time: number) => void;
  setLiveClassAcknowledgedMap: (map: Map<string, boolean>) => void;
  setLiveClassStudentProgress: (progress: any[]) => void;
  setOnlineStudentIds: (ids: string[]) => void;
  setActiveStudentLessons: (lessons: Record<string, string>) => void;
}

export const liveClassStore = createStore<LiveClassState>((set) => ({
  liveClassSelectedClassId: null,
  liveClassIsActive: false,
  liveClassFeed: [],
  liveClassTimeRemaining: 0,
  liveClassAcknowledgedMap: new Map(),
  liveClassStudentProgress: [],
  onlineStudentIds: [],
  activeStudentLessons: {},

  setLiveClassSelectedClassId: (liveClassSelectedClassId) => set({ liveClassSelectedClassId }),
  setLiveClassIsActive: (liveClassIsActive) => set({ liveClassIsActive }),
  setLiveClassFeed: (liveClassFeed) => set({ liveClassFeed }),
  appendLiveClassFeed: (entry) =>
    set((s) => ({ liveClassFeed: [...s.liveClassFeed.slice(-49), entry] })),
  setLiveClassTimeRemaining: (liveClassTimeRemaining) => set({ liveClassTimeRemaining }),
  setLiveClassAcknowledgedMap: (liveClassAcknowledgedMap) => set({ liveClassAcknowledgedMap }),
  setLiveClassStudentProgress: (liveClassStudentProgress) => set({ liveClassStudentProgress }),
  setOnlineStudentIds: (onlineStudentIds) => set({ onlineStudentIds }),
  setActiveStudentLessons: (activeStudentLessons) => set({ activeStudentLessons }),
}));

export const useLiveClassStore = <T>(selector: (state: LiveClassState) => T) =>
  useStore(liveClassStore, selector);
