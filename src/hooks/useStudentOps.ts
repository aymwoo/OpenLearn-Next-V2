/**
 * useStudentOps — 学生数据操作（看板/进度/作业提交）（C1-R2d）。
 *
 * 原 App.tsx 内联 state / effect / 函数迁入。selectedAssignment 由本 hook
 * 持有并向上冒泡；setStudentViewStatus 由 useStudentViewState 提供后注入。
 */
import { useEffect, useState } from 'react';
import { appStore, useAppStore } from '../store/appStore';
import { getStudentDashboard } from '../services/dashboardService.js';
import { getStudentProgress } from '../services/progressService.js';
import { postStudentProgress } from '../services/progressService.js';
import { postAssignmentSubmission } from '../services/assignmentService.js';
import type { StudentProgressType, StudentType } from '../types/app';

export function useStudentOps(deps: {
  activeStudentId: string | null;
  activeRole: 'teacher' | 'student';
  selectedLesson: string | null;
  students: Array<{ id: string; locked_lesson_id?: string | null }>;
  quizStudentAnswersRef: React.MutableRefObject<unknown>;
  setStudentViewStatus: (
    next:
      | 'dashboard'
      | 'lesson'
      | 'assignment'
      | ((prev: 'dashboard' | 'lesson' | 'assignment') => 'dashboard' | 'lesson' | 'assignment'),
  ) => void;
}) {
  const { activeStudentId, activeRole, selectedLesson, students, quizStudentAnswersRef, setStudentViewStatus } = deps;
  const session = useAppStore((s) => s.session);
  const setSelectedLesson = useAppStore((s) => s.setSelectedLesson);

  const [studentDashboardData, setStudentDashboardData] = useState<any>(null);
  const [studentProgressMap, setStudentProgressMap] = useState<Record<string, StudentProgressType[]>>({});
  const [selectedAssignment, setSelectedAssignment] = useState<any | null>(null);

  const fetchStudentDashboard = async (id: string) => {
    try {
      const { ok, data } = await getStudentDashboard(id);
      if (ok) {
        setStudentDashboardData(data);
        if (data.profile) {
          const studentProfile = data.profile as StudentType;
          const currentStudents = appStore.getState().students;
          const idx = currentStudents.findIndex((s) => s.id === data.profile.id);
          const existing = idx >= 0 ? currentStudents[idx] : null;
          const hasChanged =
            !existing ||
            existing.locked_lesson_id !== studentProfile.locked_lesson_id ||
            existing.lock_mode !== studentProfile.lock_mode ||
            JSON.stringify(existing.lock_target) !== JSON.stringify(studentProfile.lock_target) ||
            existing.name !== studentProfile.name;

          if (hasChanged) {
            if (idx >= 0) {
              const next = [...currentStudents];
              next[idx] = { ...next[idx], ...studentProfile };
              appStore.getState().setStudents(next);
            } else {
              appStore.getState().setStudents([studentProfile]);
            }
          }
        }
        if (data.profile && data.profile.locked_lesson_id) {
          setSelectedLesson(data.profile.locked_lesson_id);
          setStudentViewStatus('lesson');
        }
      }
    } catch (e) {}
  };

  const submitQuizAssignment = async (isTimeLimitExpired = false) => {
    if (!selectedAssignment) return;
    if (!activeStudentId) return;
    const isMcq =
      selectedAssignment?.content && selectedAssignment.content.startsWith('{"quizType":"mcq_learning_objectives"');
    const contentToSubmit = isMcq ? JSON.stringify(quizStudentAnswersRef.current) : 'Submitted via Whiteboard';

    try {
      const { ok } = await postAssignmentSubmission(selectedAssignment.id, {
        studentId: activeStudentId,
        content: contentToSubmit,
      });
      if (ok) {
        if (isTimeLimitExpired) {
          alert('Time is up! Your assessment was successfully submitted automatically.');
        }
        await fetchStudentDashboard(activeStudentId);
        setStudentViewStatus('dashboard');
        setSelectedAssignment(null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // 学生登录/切换学生后拉取看板，并跟随锁定课节
  useEffect(() => {
    if (!session) return;
    if (activeRole === 'student' && activeStudentId) {
      fetchStudentDashboard(activeStudentId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, activeRole, activeStudentId]);

  const updateStudentProgress = async (progressVal: number) => {
    if (activeRole === 'student' && activeStudentId && selectedLesson) {
      try {
        await postStudentProgress(activeStudentId, {
          lessonId: selectedLesson,
          completed: progressVal === 100,
          progressPercent: progressVal,
        });
      } catch (e) {
        console.error('Failed to update student progress:', e);
      }
    }
  };

  const fetchStudentProgress = async (id: string) => {
    try {
      const { ok, data } = await getStudentProgress(id);
      if (ok) {
        setStudentProgressMap((prev) => ({ ...prev, [id]: data }));
      }
    } catch (e) {}
  };

  return {
    studentDashboardData,
    setStudentDashboardData,
    studentProgressMap,
    setStudentProgressMap,
    selectedAssignment,
    setSelectedAssignment,
    fetchStudentDashboard,
    fetchStudentProgress,
    updateStudentProgress,
    submitQuizAssignment,
  };
}
