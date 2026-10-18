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
    }
    // 学生无 VFS 访问权限（SEC-AUTH），不再发起请求

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

        // v0.6.1 审计 C-2 修复：此前课节白板与作业白板在同一 tick 内先后写入
        // **同一个** elements store（useLessonCrud 单 ref 去重在两房间 payload
        // 间永远失效）→ 学生端画布每 2s 在两个房间之间翻转。语义上作业激活
        // 即接管学生画布（教师最大化打断才清空作业，见 useClassroomSocket），
        // 故二者互斥：有进行中作业只拉作业房间，否则拉课节房间。
        if (selectedAssignmentRef.current) {
          const studentId = activeStudentId || selectedAssignmentRef.current.student_id;
          await fetchElements(`assignment-${selectedAssignmentRef.current.id}-student-${studentId}`);
        } else if (selectedLessonRef.current) {
          await fetchElements(selectedLessonRef.current);
        }
      } finally {
        isFetching = false;
      }
    }, 2000);

    return () => clearInterval(intervalId);
  }, [session, showProcessLogs, activeStudentId]);

  useEffect(() => {
    if (!session) return;
    // VFS 仅教师/管理员可读（SEC-AUTH）；学生不再发起请求
    if (session.role === 'teacher') {
      fetchVfs(currentVfsParent);
    }
  }, [currentVfsParent, session]);

  useEffect(() => {
    if (selectedLesson) {
      fetchElements(selectedLesson);
    }
  }, [selectedLesson]);
}
