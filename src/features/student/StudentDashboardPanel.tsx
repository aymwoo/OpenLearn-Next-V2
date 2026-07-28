import { StudentDashboardHeader } from './StudentDashboardHeader';
import { StudentRollCallAlarms } from './StudentRollCallAlarms';
import { StudentCourseProgressList } from './StudentCourseProgressList';
import { StudentQuickStats } from './StudentQuickStats';
import { StudentPerformanceCharts } from './StudentPerformanceCharts';
import { StudentSchedulePanel } from './StudentSchedulePanel';
import { StudentAssignmentsPanel } from './StudentAssignmentsPanel';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import type { StudentType } from '../../types/app';

export interface StudentDashboardPanelProps {
  students: StudentType[];
  activeStudentId: string | null;
  studentDashboardData: any;
  readNotifications: Set<string>;
  setReadNotifications: (updater: (prev: Set<string>) => Set<string>) => void;
  addToast: (title: string, description: string, type: string) => void;
  lang: 'zh' | 'en';
  setSelectedLesson: (lessonId: string) => void;
  setStudentViewStatus: (status: 'dashboard' | 'lesson' | 'assignment') => void;
  setSelectedAssignment: (ast: any) => void;
  setQuizStudentAnswers: (answers: any) => void;
  setSubAssignmentTab: (tab: string) => void;
}

export function StudentDashboardPanel(props: StudentDashboardPanelProps) {
  const {
    students,
    activeStudentId,
    studentDashboardData,
    readNotifications,
    setReadNotifications,
    addToast,
    lang,
    setSelectedLesson,
    setStudentViewStatus,
    setSelectedAssignment,
    setQuizStudentAnswers,
    setSubAssignmentTab,
  } = props;

  return (
    <div className="space-y-8">
      {/* Dashboard Header */}
      <StudentDashboardHeader students={students} activeStudentId={activeStudentId} />

      <StudentRollCallAlarms studentDashboardData={studentDashboardData} readNotifications={readNotifications} setReadNotifications={setReadNotifications} activeStudentId={activeStudentId} addToast={addToast} lang={lang} />

      <StudentCourseProgressList progress={studentDashboardData.progress} setSelectedLesson={setSelectedLesson} setStudentViewStatus={setStudentViewStatus} />

      <StudentQuickStats studentDashboardData={studentDashboardData} />

      <StudentPerformanceCharts assignments={studentDashboardData.assignments} lang={lang} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Schedules / Timetable */}
        <StudentSchedulePanel schedules={studentDashboardData.schedules} setSelectedLesson={setSelectedLesson} setStudentViewStatus={setStudentViewStatus} />

        {/* Assignments */}
      <StudentAssignmentsPanel assignments={studentDashboardData.assignments} setSelectedAssignment={setSelectedAssignment} setStudentViewStatus={setStudentViewStatus} setQuizStudentAnswers={setQuizStudentAnswers} setSubAssignmentTab={setSubAssignmentTab} lang={lang} />
        
        {/* Dynamic plugin-registered student dashboard views */}
        <ExtensionPointRenderer slot="student.view" slotProps={{ studentId: activeStudentId }} />
      </div>
    </div>
  );
}
