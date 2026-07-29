import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

export interface StudentState {
  studentDashboardData: any;
  notifications: any[];

  setStudentDashboardData: (data: any) => void;
  setNotifications: (notifications: any[]) => void;
}

export const studentStore = createStore<StudentState>((set) => ({
  studentDashboardData: null,
  notifications: [],

  setStudentDashboardData: (studentDashboardData) => set({ studentDashboardData }),
  setNotifications: (notifications) => set({ notifications }),
}));

export const useStudentStore = <T>(selector: (state: StudentState) => T) =>
  useStore(studentStore, selector);
