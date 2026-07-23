/**
 * OpenLearn Classroom Workspace Shell - Workspace Layout Component (Sprint P1-01)
 * Slot-based classroom workspace grid layout rendering official default providers and plugin slots.
 */

import React from 'react';
import { WorkspaceSlotType, WorkspaceLayoutProps } from './workspace-types.js';
import { useWorkspaceSlot } from './workspace-context.js';

const SlotRenderer: React.FC<{ slot: WorkspaceSlotType; className?: string }> = ({
  slot,
  className,
}) => {
  const providers = useWorkspaceSlot(slot);

  if (providers.length === 0) {
    return null;
  }

  return (
    <div className={`workspace-slot workspace-slot-${slot.toLowerCase()} ${className ?? ''}`}>
      {providers.map((provider) => (
        <React.Fragment key={provider.id}>
          {provider.render()}
        </React.Fragment>
      ))}
    </div>
  );
};

export const WorkspaceLayout: React.FC<WorkspaceLayoutProps> = ({ className, children }) => {
  return (
    <div className={`workspace-shell flex flex-col h-screen w-screen overflow-hidden bg-slate-900 text-slate-100 ${className ?? ''}`}>
      {/* 1. TopBar Slot */}
      <SlotRenderer slot="TopBar" className="w-full flex-none z-30" />

      {/* 2. Middle Row: LeftSidebar, MainCanvas, RightSidebar */}
      <div className="flex flex-1 overflow-hidden relative">
        <SlotRenderer slot="LeftSidebar" className="flex-none z-20" />
        <main className="flex-1 relative overflow-hidden flex flex-col">
          <SlotRenderer slot="MainCanvas" className="flex-1 w-full h-full relative" />
          {children}
          {/* 5. BottomPanel Slot */}
          <SlotRenderer slot="BottomPanel" className="flex-none z-20" />
        </main>
        <SlotRenderer slot="RightSidebar" className="flex-none z-20" />
      </div>

      {/* 6. StatusBar Slot */}
      <SlotRenderer slot="StatusBar" className="w-full flex-none z-30" />

      {/* 7. FloatingArea Slot (Absolute overlay) */}
      <SlotRenderer slot="FloatingArea" className="absolute inset-0 pointer-events-none z-40" />

      {/* 8. DialogArea Slot (Modal overlay) */}
      <SlotRenderer slot="DialogArea" className="absolute inset-0 pointer-events-none z-50" />
    </div>
  );
};
