import type { StateCreator } from 'zustand/vanilla';
import type { SessionType } from '../../types/app';

export interface SessionSlice {
  session: SessionType | null;
  sessionLoading: boolean;
  dbConnected: boolean;

  setSession: (session: SessionType | null) => void;
  setSessionLoading: (loading: boolean) => void;
  setDbConnected: (connected: boolean) => void;
}

export const createSessionSlice: StateCreator<SessionSlice, [], [], SessionSlice> = (set) => ({
  session: null,
  sessionLoading: true,
  dbConnected: false,

  setSession: (session) => set({ session }),
  setSessionLoading: (sessionLoading) => set({ sessionLoading }),
  setDbConnected: (dbConnected) => set({ dbConnected }),
});
