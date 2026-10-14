import type { StateCreator } from 'zustand/vanilla';
import type { ClassType, StudentType, ScheduleType } from '../../types/app';
import { getClasses, getStudents } from '../../services/rosterService.js';
import { listFromEnvelope } from '../../utils/listEnvelope.js';

export interface ClassSlice {
  classes: ClassType[];
  students: StudentType[];
  classStudentsMap: Record<string, StudentType[]>;
  classDashboardMap: Record<string, any>;
  studentProgressMap: Record<string, any[]>;
  classSchedulesMap: Record<string, ScheduleType[]>;
  scheduleAttendanceMap: Record<string, any[]>;
  assignmentSubmissionsMap: Record<string, any[]>;
  classAssignmentsMap: Record<string, any[]>;
  classProgressMap: Record<string, any>;
  classSeats: { lab_id: string | null; seats: any[] };

  setClasses: (classes: ClassType[]) => void;
  setStudents: (students: StudentType[]) => void;
  setClassStudents: (classId: string, students: StudentType[]) => void;
  setClassDashboard: (classId: string, dashboard: any) => void;
  setStudentProgress: (studentId: string, progress: any[]) => void;
  setClassSchedules: (classId: string, schedules: ScheduleType[]) => void;
  setScheduleAttendance: (scheduleId: string, attendance: any[]) => void;
  setAssignmentSubmissions: (assignmentId: string, submissions: any[]) => void;
  setClassAssignments: (classId: string, assignments: any[]) => void;
  setClassProgress: (classId: string, progress: any) => void;
  setClassSeats: (seats: { lab_id: string | null; seats: any[] }) => void;
  loadClasses: () => Promise<void>;
  loadStudents: () => Promise<void>;
}

export const createClassSlice: StateCreator<ClassSlice, [], [], ClassSlice> = (set) => ({
  classes: [],
  students: [],
  classStudentsMap: {},
  classDashboardMap: {},
  studentProgressMap: {},
  classSchedulesMap: {},
  scheduleAttendanceMap: {},
  assignmentSubmissionsMap: {},
  classAssignmentsMap: {},
  classProgressMap: {},
  classSeats: { lab_id: null, seats: [] },

  setClasses: (classes) => set({ classes }),
  setStudents: (students) => set({ students }),
  setClassStudents: (classId, students) =>
    set((s) => ({ classStudentsMap: { ...s.classStudentsMap, [classId]: students } })),
  setClassDashboard: (classId, dashboard) =>
    set((s) => ({ classDashboardMap: { ...s.classDashboardMap, [classId]: dashboard } })),
  setStudentProgress: (studentId, progress) =>
    set((s) => ({ studentProgressMap: { ...s.studentProgressMap, [studentId]: progress } })),
  setClassSchedules: (classId, schedules) =>
    set((s) => ({ classSchedulesMap: { ...s.classSchedulesMap, [classId]: schedules } })),
  setScheduleAttendance: (scheduleId, attendance) =>
    set((s) => ({ scheduleAttendanceMap: { ...s.scheduleAttendanceMap, [scheduleId]: attendance } })),
  setAssignmentSubmissions: (assignmentId, submissions) =>
    set((s) => ({ assignmentSubmissionsMap: { ...s.assignmentSubmissionsMap, [assignmentId]: submissions } })),
  setClassAssignments: (classId, assignments) =>
    set((s) => ({ classAssignmentsMap: { ...s.classAssignmentsMap, [classId]: assignments } })),
  setClassProgress: (classId, progress) =>
    set((s) => ({ classProgressMap: { ...s.classProgressMap, [classId]: progress } })),
  setClassSeats: (classSeats) => set({ classSeats }),

  loadClasses: async () => {
    try {
      const { ok, data } = await getClasses();
      if (ok) {
        set({ classes: listFromEnvelope<ClassType>(data) });
      }
    } catch (e) {
      console.warn('Failed to fetch classes', e);
    }
  },

  loadStudents: async () => {
    try {
      const { ok, data } = await getStudents();
      if (ok) {
        set({ students: listFromEnvelope<StudentType>(data) });
      }
    } catch (e) {
      console.warn('Failed to fetch students', e);
    }
  },
});
