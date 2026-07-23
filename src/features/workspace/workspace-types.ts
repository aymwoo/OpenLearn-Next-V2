/**
 * OpenLearn Classroom Workspace Shell - Data Types (Sprint P1-01)
 * Extensible slot-based layout framework contract.
 */

import React from 'react';

export type WorkspaceSlotType =
  | 'TopBar'
  | 'LeftSidebar'
  | 'MainCanvas'
  | 'RightSidebar'
  | 'BottomPanel'
  | 'StatusBar'
  | 'FloatingArea'
  | 'DialogArea';

export interface WorkspaceSlotProvider {
  readonly id: string;
  readonly slot: WorkspaceSlotType;
  readonly priority?: number;
  readonly render: (props?: Record<string, unknown>) => React.ReactNode;
}

export interface WorkspaceLayoutProps {
  readonly className?: string;
  readonly children?: React.ReactNode;
}
