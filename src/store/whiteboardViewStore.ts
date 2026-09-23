import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

/**
 * 白板「远程视图」共享状态。
 *
 * 教师端在互动课堂中最大化某个白板组件时，会通过
 * `whiteboard-update { type: 'fullscreen-change' }` 广播组件 id；
 * 学生端收到后写入本 store，从而进入「同步最大化」视图。
 *
 * 之所以独立于 `InteractiveWhiteboard` 组件生命周期：
 *  - 学生切到「互动课件 / 作业提交」标签页时白板会被卸载，
 *    若状态留在组件内会丢失，切回白板后无法恢复教师的最大化视图；
 *  - 需要由 App 层（`useClassroomSocket`）在收到广播时读取该状态，
 *    强制把学生标签页切回白板。
 */
export interface WhiteboardViewState {
  /** 教师端当前最大化的白板组件 id（null 表示未最大化） */
  remoteFullscreenElementId: string | null;
  setRemoteFullscreenElementId: (elementId: string | null) => void;
  clearRemoteFullscreen: () => void;
}

export const whiteboardViewStore = createStore<WhiteboardViewState>((set) => ({
  remoteFullscreenElementId: null,
  setRemoteFullscreenElementId: (remoteFullscreenElementId) => set({ remoteFullscreenElementId }),
  clearRemoteFullscreen: () => set({ remoteFullscreenElementId: null }),
}));

export const useWhiteboardViewStore = <T>(selector: (state: WhiteboardViewState) => T) =>
  useStore(whiteboardViewStore, selector);

/**
 * 非 React 环境（socket 回调）读取当前远程最大化组件 id。
 */
export const getRemoteFullscreenElementId = () => whiteboardViewStore.getState().remoteFullscreenElementId;
