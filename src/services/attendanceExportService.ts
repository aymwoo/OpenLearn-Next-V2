import type { ClassType, StudentType, ScheduleType, AttendanceType } from '../types/app';
import { escapeCSV } from './gradeReportService';

export interface AttendanceRowData {
  className: string;
  scheduleId: string;
  scheduledDate: string;
  lessonTitle: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  status: string;
  checkInTime: string;
}

export function formatAttendanceStatus(status: string | undefined | null, lang: 'zh' | 'en' = 'en'): string {
  const normalized = (status || '').toLowerCase().trim();
  if (normalized === 'present') {
    return lang === 'zh' ? '出勤' : 'Present';
  }
  if (normalized === 'late') {
    return lang === 'zh' ? '迟到' : 'Late';
  }
  if (normalized === 'absent') {
    return lang === 'zh' ? '缺勤' : 'Absent';
  }
  return lang === 'zh' ? '未记录' : 'Unrecorded';
}

export function formatRecordedAt(recordedAt: number | undefined | null, lang: 'zh' | 'en' = 'en'): string {
  if (!recordedAt || recordedAt <= 0) {
    return lang === 'zh' ? '未记录' : 'N/A';
  }
  try {
    const d = new Date(recordedAt);
    if (isNaN(d.getTime())) return lang === 'zh' ? '未记录' : 'N/A';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return lang === 'zh' ? '未记录' : 'N/A';
  }
}

export function triggerDownloadCSV(filename: string, csvContent: string): void {
  const blob = new Blob(['\ufeff' + csvContent], {
    type: 'text/csv;charset=utf-8;',
  });
  if (typeof window !== 'undefined') {
    const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : '';
    const link = document.createElement('a');
    if (url) {
      link.setAttribute('href', url);
    } else {
      link.setAttribute('href', 'data:text/csv;charset=utf-8,\ufeff' + encodeURIComponent(csvContent));
    }
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (url && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * Builds attendance rows for a given schedule, matching students with records in scheduleAttendanceMap.
 */
export function buildScheduleAttendanceRows(options: {
  className: string;
  schedule: {
    id: string;
    scheduled_date?: string;
    lesson_title?: string;
  };
  students: StudentType[];
  attendanceRecords: AttendanceType[];
  lang?: 'zh' | 'en';
}): AttendanceRowData[] {
  const { className, schedule, students, attendanceRecords, lang = 'en' } = options;
  const attList = attendanceRecords || [];
  const rows: AttendanceRowData[] = [];

  // Track students seen to also include any in attendanceRecords that might not be in students list
  const seenStudentIds = new Set<string>();

  students.forEach((st) => {
    seenStudentIds.add(st.id);
    const rec = attList.find((a) => a.student_id === st.id);
    rows.push({
      className,
      scheduleId: schedule.id,
      scheduledDate: schedule.scheduled_date || '-',
      lessonTitle: schedule.lesson_title || 'Untitled Lesson',
      studentId: st.id,
      studentName: st.name || st.id,
      studentEmail: st.email || '',
      status: formatAttendanceStatus(rec?.status, lang),
      checkInTime: formatRecordedAt(rec?.recorded_at, lang),
    });
  });

  // Handle any orphan attendance records not found in students roster
  attList.forEach((rec) => {
    if (!seenStudentIds.has(rec.student_id)) {
      seenStudentIds.add(rec.student_id);
      rows.push({
        className,
        scheduleId: schedule.id,
        scheduledDate: schedule.scheduled_date || '-',
        lessonTitle: schedule.lesson_title || 'Untitled Lesson',
        studentId: rec.student_id,
        studentName: rec.student_name || rec.student_id,
        studentEmail: '',
        status: formatAttendanceStatus(rec.status, lang),
        checkInTime: formatRecordedAt(rec.recorded_at, lang),
      });
    }
  });

  return rows;
}

/**
 * Generates and downloads a CSV report for an individual scheduled class.
 */
export function exportSingleScheduleAttendanceCSV(options: {
  className: string;
  schedule: ScheduleType | { id: string; scheduled_date?: string; lesson_title?: string };
  students: StudentType[];
  attendanceRecords: AttendanceType[];
  lang?: 'zh' | 'en';
}): void {
  const { className, schedule, students, attendanceRecords, lang = 'en' } = options;
  const rows = buildScheduleAttendanceRows({
    className,
    schedule,
    students,
    attendanceRecords,
    lang,
  });

  const headers =
    lang === 'zh'
      ? ['班级名称', '排课日期', '课程主题', '学生姓名', '学生邮箱', '出勤状态', '签到时间', '学生ID', '排课ID']
      : [
          'Class Name',
          'Scheduled Date',
          'Lesson Title',
          'Student Name',
          'Student Email',
          'Attendance Status',
          'Check-in Time',
          'Student ID',
          'Schedule ID',
        ];

  const csvRows: string[][] = [headers];
  rows.forEach((r) => {
    csvRows.push([
      r.className,
      r.scheduledDate,
      r.lessonTitle,
      r.studentName,
      r.studentEmail,
      r.status,
      r.checkInTime,
      r.studentId,
      r.scheduleId,
    ]);
  });

  const csvContent = csvRows.map((r) => r.map(escapeCSV).join(',')).join('\n');
  const cleanClass = className.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_');
  const cleanLesson = (schedule.lesson_title || 'schedule').replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_');
  const dateStr = schedule.scheduled_date || new Date().toISOString().split('T')[0];
  const filename = `${cleanClass}_${cleanLesson}_${dateStr}_attendance.csv`;

  triggerDownloadCSV(filename, csvContent);
}

/**
 * Ensures attendance records for the given schedule IDs are loaded.
 * If not already in scheduleAttendanceMap, fetches them via the API or fetcher.
 */
export async function ensureAttendanceLoaded(
  scheduleIds: string[],
  scheduleAttendanceMap: Record<string, AttendanceType[]>,
  fetchAttendanceFn?: (scheduleId: string) => Promise<void> | void,
): Promise<Record<string, AttendanceType[]>> {
  const resultMap: Record<string, AttendanceType[]> = { ...scheduleAttendanceMap };

  const missingIds = scheduleIds.filter((id) => !resultMap[id]);
  if (missingIds.length === 0) {
    return resultMap;
  }

  await Promise.all(
    missingIds.map(async (schId) => {
      try {
        if (fetchAttendanceFn) {
          await fetchAttendanceFn(schId);
        } else {
          const res = await fetch(`/api/schedules/${schId}/attendance`);
          if (res.ok) {
            const data = await res.json();
            resultMap[schId] = data;
          }
        }
      } catch (err) {
        console.warn(`Failed to fetch attendance for schedule ${schId}:`, err);
      }
    }),
  );

  return resultMap;
}

/**
 * Generates and downloads a CSV report of individual student attendance records
 * for all scheduled classes in a specific class.
 */
export async function exportClassAllSchedulesAttendanceCSV(options: {
  classInfo: ClassType;
  schedules: (ScheduleType | any)[];
  students: StudentType[];
  scheduleAttendanceMap: Record<string, AttendanceType[]>;
  lang?: 'zh' | 'en';
  fetchScheduleAttendance?: (scheduleId: string) => Promise<void> | void;
}): Promise<void> {
  const { classInfo, schedules, students, scheduleAttendanceMap, lang = 'en', fetchScheduleAttendance } = options;

  if (!schedules || schedules.length === 0) {
    const msg =
      lang === 'zh'
        ? `班级 "${classInfo.name}" 暂无排课记录。`
        : `No scheduled classes available for "${classInfo.name}".`;
    alert(msg);
    return;
  }

  // Ensure all schedule attendance is loaded
  const scheduleIds = schedules.map((s) => s.id);
  const loadedAttendanceMap = await ensureAttendanceLoaded(
    scheduleIds,
    scheduleAttendanceMap,
    fetchScheduleAttendance,
  );

  const headers =
    lang === 'zh'
      ? ['班级名称', '排课日期', '课程主题', '学生姓名', '学生邮箱', '出勤状态', '签到时间', '学生ID', '排课ID']
      : [
          'Class Name',
          'Scheduled Date',
          'Lesson Title',
          'Student Name',
          'Student Email',
          'Attendance Status',
          'Check-in Time',
          'Student ID',
          'Schedule ID',
        ];

  const csvRows: string[][] = [headers];

  // Sort schedules chronologically by scheduled_date
  const sortedSchedules = [...schedules].sort((a, b) => (a.scheduled_date || '').localeCompare(b.scheduled_date || ''));

  sortedSchedules.forEach((sch) => {
    const attList = loadedAttendanceMap[sch.id] || scheduleAttendanceMap[sch.id] || [];
    const rows = buildScheduleAttendanceRows({
      className: classInfo.name,
      schedule: sch,
      students,
      attendanceRecords: attList,
      lang,
    });
    rows.forEach((r) => {
      csvRows.push([
        r.className,
        r.scheduledDate,
        r.lessonTitle,
        r.studentName,
        r.studentEmail,
        r.status,
        r.checkInTime,
        r.studentId,
        r.scheduleId,
      ]);
    });
  });

  const csvContent = csvRows.map((r) => r.map(escapeCSV).join(',')).join('\n');
  const cleanClass = classInfo.name.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_');
  const today = new Date().toISOString().split('T')[0];
  const filename = `${cleanClass}_attendance_report_${today}.csv`;

  triggerDownloadCSV(filename, csvContent);
}

/**
 * Generates and downloads a consolidated CSV report of individual student attendance records
 * across all scheduled classes in all classes.
 */
export async function exportAllClassesAttendanceCSV(options: {
  classes: ClassType[];
  classSchedulesMap: Record<string, (ScheduleType | any)[]>;
  classStudentsMap: Record<string, StudentType[]>;
  scheduleAttendanceMap: Record<string, AttendanceType[]>;
  lang?: 'zh' | 'en';
  fetchScheduleAttendance?: (scheduleId: string) => Promise<void> | void;
}): Promise<void> {
  const { classes, classSchedulesMap, classStudentsMap, scheduleAttendanceMap, lang = 'en', fetchScheduleAttendance } =
    options;

  // Gather all schedule IDs across all classes
  const allScheduleIds: string[] = [];
  classes.forEach((c) => {
    const schs = classSchedulesMap[c.id] || [];
    schs.forEach((s) => allScheduleIds.push(s.id));
  });

  if (allScheduleIds.length === 0) {
    const msg =
      lang === 'zh'
        ? '未找到任何排课记录，暂无可导出的考勤数据。'
        : 'No scheduled classes found. No attendance data to export.';
    alert(msg);
    return;
  }

  // Ensure attendance records are loaded
  const loadedAttendanceMap = await ensureAttendanceLoaded(
    allScheduleIds,
    scheduleAttendanceMap,
    fetchScheduleAttendance,
  );

  const headers =
    lang === 'zh'
      ? ['班级名称', '排课日期', '课程主题', '学生姓名', '学生邮箱', '出勤状态', '签到时间', '学生ID', '排课ID']
      : [
          'Class Name',
          'Scheduled Date',
          'Lesson Title',
          'Student Name',
          'Student Email',
          'Attendance Status',
          'Check-in Time',
          'Student ID',
          'Schedule ID',
        ];

  const csvRows: string[][] = [headers];

  classes.forEach((cls) => {
    const schedules = classSchedulesMap[cls.id] || [];
    const students = classStudentsMap[cls.id] || [];
    const sortedSchedules = [...schedules].sort((a, b) =>
      (a.scheduled_date || '').localeCompare(b.scheduled_date || ''),
    );

    sortedSchedules.forEach((sch) => {
      const attList = loadedAttendanceMap[sch.id] || scheduleAttendanceMap[sch.id] || [];
      const rows = buildScheduleAttendanceRows({
        className: cls.name,
        schedule: sch,
        students,
        attendanceRecords: attList,
        lang,
      });
      rows.forEach((r) => {
        csvRows.push([
          r.className,
          r.scheduledDate,
          r.lessonTitle,
          r.studentName,
          r.studentEmail,
          r.status,
          r.checkInTime,
          r.studentId,
          r.scheduleId,
        ]);
      });
    });
  });

  const csvContent = csvRows.map((r) => r.map(escapeCSV).join(',')).join('\n');
  const today = new Date().toISOString().split('T')[0];
  const filename = `All_Classes_Attendance_Report_${today}.csv`;

  triggerDownloadCSV(filename, csvContent);
}
