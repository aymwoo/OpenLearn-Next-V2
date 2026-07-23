/**
 * OpenLearn Workspace Layout Manager - Region Contracts (Sprint P1-05)
 */

export type WorkspaceRegionType =
  | 'TopBar'
  | 'LeftSidebar'
  | 'CenterWorkspace'
  | 'RightSidebar'
  | 'BottomPanel'
  | 'StatusBar'
  | 'FloatingArea'
  | 'DialogArea';

export interface RegionState {
  visible: boolean;
  collapsed: boolean;
  size: number; // Width or Height in px or percentage
  pinned: boolean;
  fullscreen: boolean;
  activeTab?: string;
}

export const DEFAULT_REGION_STATES: Record<WorkspaceRegionType, RegionState> = {
  TopBar: { visible: true, collapsed: false, size: 60, pinned: true, fullscreen: false },
  LeftSidebar: { visible: true, collapsed: false, size: 300, pinned: true, fullscreen: false },
  CenterWorkspace: { visible: true, collapsed: false, size: 0, pinned: true, fullscreen: false },
  RightSidebar: { visible: true, collapsed: false, size: 320, pinned: true, fullscreen: false },
  BottomPanel: { visible: true, collapsed: false, size: 200, pinned: true, fullscreen: false },
  StatusBar: { visible: true, collapsed: false, size: 30, pinned: true, fullscreen: false },
  FloatingArea: { visible: true, collapsed: false, size: 0, pinned: false, fullscreen: false },
  DialogArea: { visible: true, collapsed: false, size: 0, pinned: false, fullscreen: false },
};
