import type { StateCreator } from 'zustand/vanilla';

export interface LiveClassSlice {
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
  /**
   * 结束授课：清空「正在授课」运行时状态。
   * `liveClassTimeRemaining` 是环节时长快照、不会自行归零，归档/结束课堂后必须一并清掉，
   * 否则全局悬浮胶囊会一直判定为「仍在授课」而无法消失。
   */
  endLiveClassSession: () => void;
  setLiveClassFeed: (feed: any[]) => void;
  appendLiveClassFeed: (entry: any) => void;
  setLiveClassTimeRemaining: (time: number) => void;
  setLiveClassAcknowledgedMap: (map: Map<string, boolean>) => void;
  setLiveClassStudentProgress: (progress: any[]) => void;
  setOnlineStudentIds: (ids: string[]) => void;
  setActiveStudentLessons: (lessons: Record<string, string>) => void;
}

export const createLiveClassSlice: StateCreator<LiveClassSlice, [], [], LiveClassSlice> = (set) => ({
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
  endLiveClassSession: () => set({ liveClassIsActive: false, liveClassTimeRemaining: 0 }),
  setLiveClassFeed: (liveClassFeed) => set({ liveClassFeed }),
  appendLiveClassFeed: (entry) => set((s) => ({ liveClassFeed: [...s.liveClassFeed.slice(-49), entry] })),
  setLiveClassTimeRemaining: (liveClassTimeRemaining) => set({ liveClassTimeRemaining }),
  setLiveClassAcknowledgedMap: (liveClassAcknowledgedMap) => set({ liveClassAcknowledgedMap }),
  setLiveClassStudentProgress: (liveClassStudentProgress) => set({ liveClassStudentProgress }),
  setOnlineStudentIds: (onlineStudentIds) => set({ onlineStudentIds }),
  setActiveStudentLessons: (activeStudentLessons) => set({ activeStudentLessons }),
});
