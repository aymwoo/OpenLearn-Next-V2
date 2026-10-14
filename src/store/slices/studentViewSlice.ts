import type { StateCreator } from 'zustand/vanilla';

export interface StudentViewSlice {
  studentDashboardData: any;
  notifications: any[];

  setStudentDashboardData: (data: any) => void;
  setNotifications: (notifications: any[]) => void;
}

export const createStudentViewSlice: StateCreator<StudentViewSlice, [], [], StudentViewSlice> = (set) => ({
  studentDashboardData: null,
  notifications: [],

  setStudentDashboardData: (studentDashboardData) => set({ studentDashboardData }),
  setNotifications: (notifications) => set({ notifications }),
});
