import { useEffect, useRef } from 'react';
import type { SessionType } from '../types/app';

export interface UseAppPollingOptions {
  session: SessionType | null;
  showProcessLogs: string | null;
  activeStudentId: string | null;
  currentVfsParent: string | null;
  selectedLesson: string | null;
  selectedAssignment: any | null;
  expandedClassId: string | null;

  fetchLessons: () => Promise<void>;
  fetchPlugins: () => Promise<void>;
  fetchRegisteredCommands: () => Promise<void>;
  fetchEvents: () => Promise<void>;
  fetchApprovals: () => Promise<void>;
  fetchProcesses: () => Promise<void>;
  fetchClasses: () => Promise<void>;
  fetchTodaySchedules: () => Promise<void>;
  fetchStudents: () => Promise<void>;
  fetchLabs: () => Promise<void>;
  fetchVfs: (parent: string | null) => Promise<void>;
  fetchProcessLogs: (id: string) => Promise<void>;
  fetchClassStudents: (classId: string) => Promise<void>;
  fetchElements: (lessonId: string) => Promise<void>;
}

/**
 * Periodically polls the server for platform events, processes, approvals, schedules, and active classroom data.
 */
export function useAppPolling(options: UseAppPollingOptions): void {
  const {
    session,
    showProcessLogs,
    activeStudentId,
    currentVfsParent,
    selectedLesson,
    selectedAssignment,
    expandedClassId,
    fetchLessons,
    fetchPlugins,
    fetchRegisteredCommands,
    fetchEvents,
    fetchApprovals,
    fetchProcesses,
    fetchClasses,
    fetchTodaySchedules,
    fetchStudents,
    fetchLabs,
    fetchVfs,
    fetchProcessLogs,
    fetchClassStudents,
    fetchElements,
  } = options;

  const currentVfsParentRef = useRef<string | null>(currentVfsParent);
  const selectedLessonRef = useRef<string | null>(selectedLesson);
  const selectedAssignmentRef = useRef<any | null>(selectedAssignment);
  const expandedClassIdRef = useRef<string | null>(expandedClassId);

  useEffect(() => {
    currentVfsParentRef.current = currentVfsParent;
  }, [currentVfsParent]);

  useEffect(() => {
    selectedLessonRef.current = selectedLesson;
  }, [selectedLesson]);

  useEffect(() => {
    selectedAssignmentRef.current = selectedAssignment;
  }, [selectedAssignment]);

  useEffect(() => {
    expandedClassIdRef.current = expandedClassId;
  }, [expandedClassId]);

  useEffect(() => {
    if (!session) return;

    const isStudent = session.role === 'student';
    const isTeacher = session.role === 'teacher';
    const isAdmin =
      isTeacher &&
      (session.subRole === 'administrator' || session.username === 'admin' || session.userId === 'usr_admin');

    fetchLessons();
    fetchPlugins();
    fetchRegisteredCommands();
    fetchTodaySchedules().catch(() => {});

    if (isAdmin) {
      fetchEvents();
      fetchApprovals();
      fetchProcesses();
    }

    if (isTeacher) {
      fetchClasses();
      fetchStudents();
      fetchLabs();
      fetchVfs(currentVfsParentRef.current);
    } else if (isStudent && currentVfsParentRef.current) {
      fetchVfs(currentVfsParentRef.current);
    }

    let isFetching = false;
    const intervalId = setInterval(async () => {
      if (isFetching) return;
      isFetching = true;
      try {
        if (isAdmin) {
          await fetchEvents();
          await fetchApprovals();
          await fetchProcesses();
          if (showProcessLogs) {
            await fetchProcessLogs(showProcessLogs);
          }
        }

        await fetchLessons();
        await fetchRegisteredCommands();
        await fetchTodaySchedules().catch(() => {});

        if (isTeacher) {
          await fetchClasses();
          await fetchStudents();
          await fetchLabs();
          await fetchVfs(currentVfsParentRef.current);

          if (expandedClassIdRef.current) {
            await fetchClassStudents(expandedClassIdRef.current);
          }
        }

        if (selectedLessonRef.current) {
          await fetchElements(selectedLessonRef.current);
        }
        if (selectedAssignmentRef.current) {
          const studentId = activeStudentId || selectedAssignmentRef.current.student_id;
          await fetchElements(`assignment-${selectedAssignmentRef.current.id}-student-${studentId}`);
        }
      } finally {
        isFetching = false;
      }
    }, 2000);

    return () => clearInterval(intervalId);
  }, [session, showProcessLogs, activeStudentId]);

  useEffect(() => {
    if (!session) return;
    if (session.role === 'teacher' || currentVfsParent) {
      fetchVfs(currentVfsParent);
    }
  }, [currentVfsParent, session]);

  useEffect(() => {
    if (selectedLesson) {
      fetchElements(selectedLesson);
    }
  }, [selectedLesson]);
}
