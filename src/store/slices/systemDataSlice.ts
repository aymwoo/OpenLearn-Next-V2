import type { StateCreator } from 'zustand/vanilla';
import type { AIProvider, PluginType, ProcessType, ScheduleType } from '../../types/app';

export interface SystemDataSlice {
  aiProviders: AIProvider[];
  plugins: PluginType[];
  registeredCommands: any[];
  events: any[];
  approvals: any[];
  processes: ProcessType[];
  todaySchedules: ScheduleType[];
  computerLabs: any[];

  setAiProviders: (providers: AIProvider[]) => void;
  setPlugins: (plugins: PluginType[]) => void;
  setRegisteredCommands: (cmds: any[]) => void;
  setEvents: (events: any[]) => void;
  setApprovals: (approvals: any[]) => void;
  setProcesses: (processes: ProcessType[]) => void;
  setTodaySchedules: (schedules: ScheduleType[]) => void;
  setComputerLabs: (labs: any[]) => void;
}

export const createSystemDataSlice: StateCreator<SystemDataSlice, [], [], SystemDataSlice> = (set) => ({
  aiProviders: [],
  plugins: [],
  registeredCommands: [],
  events: [],
  approvals: [],
  processes: [],
  todaySchedules: [],
  computerLabs: [],

  setAiProviders: (aiProviders) => set({ aiProviders }),
  setPlugins: (plugins) => set({ plugins }),
  setRegisteredCommands: (registeredCommands) => set({ registeredCommands }),
  setEvents: (events) => set({ events }),
  setApprovals: (approvals) => set({ approvals }),
  setProcesses: (processes) => set({ processes }),
  setTodaySchedules: (todaySchedules) => set({ todaySchedules }),
  setComputerLabs: (computerLabs) => set({ computerLabs }),
});
