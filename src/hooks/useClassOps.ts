/**
 * useClassOps — 班级学情数据（名册/进度/看板/作业）与快捷操作（C1-R2c）。
 *
 * 原 App.tsx 内联 state 与函数迁入；fetchClassSchedules 由 useLabAndSchedule
 * 提供（App 内先于本 hook 调用），schedule 数据本体在该 hook。
 */
import { useState } from 'react';
import { postClassSchedule } from '../services/systemService.js';
import { postGenerateAssignment } from '../services/assignmentService.js';
import { getClassStudents } from '../services/rosterService.js';
import { getClassProgress, getClassDashboard } from '../services/dashboardService.js';
import { getClassLessonProgress } from '../services/progressService.js';
import type { AssignmentType, SubmissionType } from '../types/app';

export function useClassOps(deps: { fetchClassSchedules: (id: string) => Promise<void> }) {
  const { fetchClassSchedules } = deps;
  const [classStudentsMap, setClassStudentsMap] = useState<Record<string, any[]>>({});
  const [classProgressMap, setClassProgressMap] = useState<
    Record<string, { lesson_id: string; lesson_title: string; average_progress: number }[]>
  >({});
  const [classDashboardMap, setClassDashboardMap] = useState<Record<string, any>>({});
  const [classAssignmentsMap, setClassAssignmentsMap] = useState<Record<string, AssignmentType[]>>({});
  const [assignmentSubmissionsMap, setAssignmentSubmissionsMap] = useState<Record<string, SubmissionType[]>>({});
  const [liveClassStudentProgress, setLiveClassStudentProgress] = useState<any[]>([]);

  const fetchClassStudents = async (id: string) => {
    try {
      const { ok, data } = await getClassStudents(id);
      if (ok) {
        setClassStudentsMap((prev) => ({ ...prev, [id]: data }));
      }
    } catch (e) {}
  };

  const fetchClassProgress = async (id: string) => {
    try {
      const { ok, data } = await getClassProgress(id);
      if (ok) {
        setClassProgressMap((prev) => ({ ...prev, [id]: data }));
      }
    } catch (e) {}
  };

  const fetchClassDashboard = async (id: string) => {
    try {
      const { ok, data } = await getClassDashboard(id);
      if (ok) {
        setClassDashboardMap((prev) => ({ ...prev, [id]: data }));
      }
    } catch (e) {}
  };

  const fetchLiveClassStudentProgress = async (classId: string, lessonId: string) => {
    try {
      const { ok, data } = await getClassLessonProgress(classId, lessonId);
      if (ok) {
        setLiveClassStudentProgress(data);
      }
    } catch (e) {}
  };

  const handleQuickScheduleClass = async (classId: string, lessonId: string, date: string): Promise<boolean> => {
    try {
      const { ok } = await postClassSchedule(classId, { lessonId, scheduledDate: date });
      if (ok) {
        await fetchClassSchedules(classId);
        return true;
      }
    } catch (e) {
      console.error('Quick schedule class failed', e);
    }
    return false;
  };

  const handleQuickGenerateAssignment = async (
    classId: string,
    title: string,
    desc: string,
  ): Promise<string | null> => {
    const topic = title || desc || 'Assignment';
    try {
      const { ok, data } = await postGenerateAssignment(classId, topic);
      if (ok) {
        await fetchClassDashboard(classId);
        return data.id || 'assignment-created';
      }
    } catch (e) {
      console.error('Quick generate assignment failed', e);
    }
    return null;
  };

  return {
    classStudentsMap,
    setClassStudentsMap,
    classProgressMap,
    setClassProgressMap,
    classDashboardMap,
    setClassDashboardMap,
    classAssignmentsMap,
    setClassAssignmentsMap,
    assignmentSubmissionsMap,
    setAssignmentSubmissionsMap,
    liveClassStudentProgress,
    setLiveClassStudentProgress,
    fetchClassStudents,
    fetchClassProgress,
    fetchClassDashboard,
    fetchLiveClassStudentProgress,
    handleQuickScheduleClass,
    handleQuickGenerateAssignment,
  };
}
