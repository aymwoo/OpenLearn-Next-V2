import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatAttendanceStatus,
  formatRecordedAt,
  buildScheduleAttendanceRows,
  exportSingleScheduleAttendanceCSV,
  exportClassAllSchedulesAttendanceCSV,
  exportAllClassesAttendanceCSV,
  ensureAttendanceLoaded,
} from '../attendanceExportService';
import type { ClassType, StudentType, AttendanceType, ScheduleType } from '../../types/app';

describe('attendanceExportService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('formatAttendanceStatus', () => {
    it('formats attendance statuses in English', () => {
      expect(formatAttendanceStatus('present', 'en')).toBe('Present');
      expect(formatAttendanceStatus('PRESENT', 'en')).toBe('Present');
      expect(formatAttendanceStatus('late', 'en')).toBe('Late');
      expect(formatAttendanceStatus('absent', 'en')).toBe('Absent');
      expect(formatAttendanceStatus(null, 'en')).toBe('Unrecorded');
      expect(formatAttendanceStatus(undefined, 'en')).toBe('Unrecorded');
      expect(formatAttendanceStatus('', 'en')).toBe('Unrecorded');
    });

    it('formats attendance statuses in Chinese', () => {
      expect(formatAttendanceStatus('present', 'zh')).toBe('出勤');
      expect(formatAttendanceStatus('late', 'zh')).toBe('迟到');
      expect(formatAttendanceStatus('absent', 'zh')).toBe('缺勤');
      expect(formatAttendanceStatus(null, 'zh')).toBe('未记录');
    });
  });

  describe('formatRecordedAt', () => {
    it('formats valid epoch timestamp into readable datetime', () => {
      const timestamp = new Date('2026-03-15T09:30:00Z').getTime();
      const formatted = formatRecordedAt(timestamp, 'en');
      expect(formatted).toMatch(/2026-03-15 \d{2}:30:00/);
    });

    it('handles null and invalid timestamps gracefully', () => {
      expect(formatRecordedAt(null, 'en')).toBe('N/A');
      expect(formatRecordedAt(undefined, 'zh')).toBe('未记录');
      expect(formatRecordedAt(0, 'en')).toBe('N/A');
      expect(formatRecordedAt(-100, 'zh')).toBe('未记录');
    });
  });

  describe('buildScheduleAttendanceRows', () => {
    const mockStudents: StudentType[] = [
      { id: 'st-1', name: 'Alice Smith', email: 'alice@school.edu', student_number: 'S001', created_at: Date.now() },
      { id: 'st-2', name: 'Bob Jones', email: 'bob@school.edu', student_number: 'S002', created_at: Date.now() },
    ];

    const mockSchedule = {
      id: 'sch-101',
      scheduled_date: '2026-04-01',
      lesson_title: 'Intro to Chemistry',
    };

    const mockAttendance: AttendanceType[] = [
      {
        schedule_id: 'sch-101',
        student_id: 'st-1',
        student_name: 'Alice Smith',
        status: 'present',
        recorded_at: 1775000000000,
      },
    ];

    it('constructs attendance rows including absent/unrecorded students from roster', () => {
      const rows = buildScheduleAttendanceRows({
        className: 'Grade 10 Chem',
        schedule: mockSchedule,
        students: mockStudents,
        attendanceRecords: mockAttendance,
        lang: 'en',
      });

      expect(rows).toHaveLength(2);
      expect(rows[0].studentName).toBe('Alice Smith');
      expect(rows[0].status).toBe('Present');
      expect(rows[0].scheduleId).toBe('sch-101');
      expect(rows[0].lessonTitle).toBe('Intro to Chemistry');

      // Bob has no record yet -> status Unrecorded
      expect(rows[1].studentName).toBe('Bob Jones');
      expect(rows[1].status).toBe('Unrecorded');
      expect(rows[1].checkInTime).toBe('N/A');
    });

    it('handles student records not in the original students list (orphan attendance records)', () => {
      const extraAttendance: AttendanceType[] = [
        ...mockAttendance,
        {
          schedule_id: 'sch-101',
          student_id: 'st-orphan',
          student_name: 'Charlie Guest',
          status: 'late',
          recorded_at: 1775000500000,
        },
      ];

      const rows = buildScheduleAttendanceRows({
        className: 'Grade 10 Chem',
        schedule: mockSchedule,
        students: mockStudents,
        attendanceRecords: extraAttendance,
        lang: 'en',
      });

      expect(rows).toHaveLength(3);
      const orphanRow = rows.find((r) => r.studentId === 'st-orphan');
      expect(orphanRow).toBeDefined();
      expect(orphanRow?.studentName).toBe('Charlie Guest');
      expect(orphanRow?.status).toBe('Late');
    });
  });

  describe('ensureAttendanceLoaded', () => {
    it('uses existing records in scheduleAttendanceMap when present', async () => {
      const existingMap: Record<string, AttendanceType[]> = {
        'sch-1': [
          {
            schedule_id: 'sch-1',
            student_id: 'st-1',
            student_name: 'Alice',
            status: 'present',
            recorded_at: 12345,
          },
        ],
      };

      const fn = vi.fn();
      const result = await ensureAttendanceLoaded(['sch-1'], existingMap, fn);

      expect(fn).not.toHaveBeenCalled();
      expect(result['sch-1']).toHaveLength(1);
    });

    it('invokes fetchAttendanceFn for missing schedule IDs', async () => {
      const existingMap: Record<string, AttendanceType[]> = {};
      const fn = vi.fn().mockImplementation(async (id: string) => {
        existingMap[id] = [];
      });

      await ensureAttendanceLoaded(['sch-2', 'sch-3'], existingMap, fn);

      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenCalledWith('sch-2');
      expect(fn).toHaveBeenCalledWith('sch-3');
    });
  });

  describe('export functions triggering download', () => {
    let appendedLink: any = null;

    beforeEach(() => {
      appendedLink = null;
      vi.spyOn(document, 'createElement').mockImplementation((_tag: string) => {
        const el: any = {
          setAttribute: vi.fn((key, val) => {
            el[key] = val;
          }),
          click: vi.fn(),
          style: {},
        };
        return el;
      });

      vi.spyOn(document.body, 'appendChild').mockImplementation((el: any) => {
        appendedLink = el;
        return el;
      });
      vi.spyOn(document.body, 'removeChild').mockImplementation((el: any) => el);
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    });

    it('exportSingleScheduleAttendanceCSV builds CSV and clicks link', () => {
      exportSingleScheduleAttendanceCSV({
        className: 'Biology 101',
        schedule: { id: 'sch-1', lesson_title: 'Cell Division', scheduled_date: '2026-05-10' },
        students: [
          { id: 'st-1', name: 'Diana', email: 'diana@test.com', student_number: 'S1', created_at: Date.now() },
        ],
        attendanceRecords: [
          {
            schedule_id: 'sch-1',
            student_id: 'st-1',
            student_name: 'Diana',
            status: 'present',
            recorded_at: 1775000000000,
          },
        ],
        lang: 'en',
      });

      expect(appendedLink).not.toBeNull();
      expect(appendedLink.download).toContain('Biology_101');
      expect(appendedLink.download).toContain('Cell_Division');
      expect(appendedLink.download).toContain('.csv');
      expect(appendedLink.click).toHaveBeenCalled();
    });

    it('exportClassAllSchedulesAttendanceCSV exports all scheduled classes for a class', async () => {
      const mockClass: ClassType = {
        id: 'c1',
        name: 'Physics 201',
        description: 'Physics grade 11',
        created_at: Date.now(),
      };
      const mockSchedules = [
        { id: 'sch-1', lesson_title: 'Kinematics', scheduled_date: '2026-05-01' },
        { id: 'sch-2', lesson_title: 'Dynamics', scheduled_date: '2026-05-08' },
      ];
      const mockStudents: StudentType[] = [
        { id: 'st-1', name: 'Ethan', email: 'ethan@test.com', student_number: 'S2', created_at: Date.now() },
      ];

      await exportClassAllSchedulesAttendanceCSV({
        classInfo: mockClass,
        schedules: mockSchedules,
        students: mockStudents,
        scheduleAttendanceMap: {
          'sch-1': [
            {
              schedule_id: 'sch-1',
              student_id: 'st-1',
              student_name: 'Ethan',
              status: 'present',
              recorded_at: 1775000000000,
            },
          ],
          'sch-2': [
            {
              schedule_id: 'sch-2',
              student_id: 'st-1',
              student_name: 'Ethan',
              status: 'late',
              recorded_at: 1775100000000,
            },
          ],
        },
        lang: 'zh',
      });

      expect(appendedLink).not.toBeNull();
      expect(appendedLink.download).toContain('Physics_201_attendance_report');
      expect(appendedLink.click).toHaveBeenCalled();
    });

    it('exportAllClassesAttendanceCSV exports consolidated attendance for all classes', async () => {
      const classes: ClassType[] = [
        { id: 'c1', name: 'Art 101', description: 'Visual arts', created_at: Date.now() },
      ];
      const classSchedulesMap: Record<string, ScheduleType[]> = {
        c1: [{ id: 'sch-art', lesson_title: 'Color Theory', scheduled_date: '2026-06-01' } as any],
      };
      const classStudentsMap: Record<string, StudentType[]> = {
        c1: [{ id: 'st-fiona', name: 'Fiona', email: 'fiona@test.com', student_number: 'S3', created_at: Date.now() }],
      };

      await exportAllClassesAttendanceCSV({
        classes,
        classSchedulesMap,
        classStudentsMap,
        scheduleAttendanceMap: {
          'sch-art': [
            {
              schedule_id: 'sch-art',
              student_id: 'st-fiona',
              student_name: 'Fiona',
              status: 'present',
              recorded_at: 1775200000000,
            },
          ],
        },
        lang: 'en',
      });

      expect(appendedLink).not.toBeNull();
      expect(appendedLink.download).toContain('All_Classes_Attendance_Report');
      expect(appendedLink.click).toHaveBeenCalled();
    });
  });
});
