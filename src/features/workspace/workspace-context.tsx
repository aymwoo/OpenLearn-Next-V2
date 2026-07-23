/**
 * OpenLearn Classroom Workspace Shell - React Context & Provider (Sprint P1-01)
 */

import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';
import { WorkspaceSlotType, WorkspaceSlotProvider } from './workspace-types.js';
import { WorkspaceSlotRegistry } from './workspace-slot-registry.js';

interface IWorkspaceContext {
  readonly registry: WorkspaceSlotRegistry;
  registerSlotProvider: (provider: WorkspaceSlotProvider) => void;
  unregisterSlotProvider: (providerId: string) => void;
  getSlotProviders: (slot: WorkspaceSlotType) => ReadonlyArray<WorkspaceSlotProvider>;
}

const WorkspaceContext = createContext<IWorkspaceContext | null>(null);

export interface WorkspaceProviderProps {
  readonly registry?: WorkspaceSlotRegistry;
  readonly children: React.ReactNode;
}

export const WorkspaceProvider: React.FC<WorkspaceProviderProps> = ({
  registry: externalRegistry,
  children,
}) => {
  const [internalRegistry] = useState(() => externalRegistry ?? new WorkspaceSlotRegistry());
  const [, setRevision] = useState(0);

  const forceUpdate = useCallback(() => {
    setRevision((prev) => prev + 1);
  }, []);

  const registerSlotProvider = useCallback(
    (provider: WorkspaceSlotProvider) => {
      internalRegistry.register(provider);
      forceUpdate();
    },
    [internalRegistry, forceUpdate]
  );

  const unregisterSlotProvider = useCallback(
    (providerId: string) => {
      const removed = internalRegistry.unregister(providerId);
      if (removed) {
        forceUpdate();
      }
    },
    [internalRegistry, forceUpdate]
  );

  const getSlotProviders = useCallback(
    (slot: WorkspaceSlotType) => {
      return internalRegistry.getProviders(slot);
    },
    [internalRegistry]
  );

  const value = useMemo(
    () => ({
      registry: internalRegistry,
      registerSlotProvider,
      unregisterSlotProvider,
      getSlotProviders,
    }),
    [internalRegistry, registerSlotProvider, unregisterSlotProvider, getSlotProviders]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};

export const useWorkspace = (): IWorkspaceContext => {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return ctx;
};

export const useWorkspaceSlot = (slot: WorkspaceSlotType): ReadonlyArray<WorkspaceSlotProvider> => {
  const { getSlotProviders } = useWorkspace();
  return getSlotProviders(slot);
};
