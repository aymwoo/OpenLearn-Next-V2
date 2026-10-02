/**
 * useStudentViewState — 学生端视图状态机（C1-R2d）。
 *
 * 原 App.tsx 内联 state / ref / effect 迁入。setStudentViewStatus 是学生端
 * 视图切换的唯一收口点：全班专注锁定期间只放行 'lesson'，其余跳转拦截并提示。
 */
import { useEffect, useRef, useState } from 'react';
import type { AddToast } from './useToast';

export type StudentViewStatus = 'dashboard' | 'lesson' | 'assignment';

export function useStudentViewState(deps: {
  activeStudentId: string | null;
  activeRole: 'teacher' | 'student';
  students: Array<{ id: string; locked_lesson_id?: string | null }>;
  liveClassFocusLocked: boolean;
  setIsFollowingTeacher: (v: boolean) => void;
  lang: 'zh' | 'en';
  addToast: AddToast;
}) {
  const { activeStudentId, activeRole, students, liveClassFocusLocked, setIsFollowingTeacher, lang, addToast } = deps;

  const [studentViewStatus, setStudentViewStatusState] = useState<StudentViewStatus>('dashboard');

  // 锁定状态 / 当前视图的最新值：供长期存活的回调（socket、轮询）读取，避免闭包过期
  const isStudentLocked =
    activeRole === 'student' &&
    ((!!activeStudentId && !!students.find((s) => s.id === activeStudentId)?.locked_lesson_id) || liveClassFocusLocked);
  const isStudentLockedRef = useRef(isStudentLocked);
  const studentViewStatusRef = useRef<StudentViewStatus>(studentViewStatus);
  useEffect(() => {
    isStudentLockedRef.current = isStudentLocked;
    studentViewStatusRef.current = studentViewStatus;
  }, [isStudentLocked, studentViewStatus]);

  // 锁定期间强制跟随教师步调，并确保学生落在课节视图，不会被困在其他页面上
  useEffect(() => {
    if (!isStudentLocked) return;
    setIsFollowingTeacher(true);
    setStudentViewStatusState('lesson');
  }, [isStudentLocked]);

  /**
   * 学生端视图切换的唯一收口点。
   * 全班专注锁定期间只放行 'lesson'（教师当前授课），其余跳转
   * （Dashboard、作业工作区、通知直达等）一律拦截并提示。
   */
  const setStudentViewStatus = (
    next:
      | StudentViewStatus
      | ((prev: StudentViewStatus) => StudentViewStatus),
  ) => {
    const resolved = typeof next === 'function' ? next(studentViewStatusRef.current) : next;
    if (isStudentLockedRef.current && resolved !== 'lesson') {
      notifyLockedNavigation();
      return;
    }
    setStudentViewStatusState(resolved);
  };

  const notifyLockedNavigation = () => {
    addToast(
      lang === 'zh' ? '🔒 全班专注锁定' : '🔒 Class Focus Locked',
      lang === 'zh'
        ? '老师已开启全班专注锁定，暂时无法切换页面，请跟随教师当前授课内容。'
        : 'The teacher locked the class focus. Navigation is disabled — please follow the current lesson.',
      'warning',
    );
  };

  const [studentLessonTab, setStudentLessonTab] = useState<'whiteboard' | 'courseware' | 'assignment'>('whiteboard');
  const [studentSelectedCourseware, setStudentSelectedCourseware] = useState<string | null>(null);
  const [studentFullscreenPanel, setStudentFullscreenPanel] = useState<'none' | 'left' | 'right'>('none');
  const [isStudentLessonContentCollapsed, setIsStudentLessonContentCollapsed] = useState(true);

  // Reset Lesson Content to collapsed when leaving student lesson view
  useEffect(() => {
    if (studentViewStatus !== 'lesson') {
      setIsStudentLessonContentCollapsed(true);
    }
  }, [studentViewStatus]);

  return {
    studentViewStatus,
    setStudentViewStatus,
    isStudentLocked,
    studentLessonTab,
    setStudentLessonTab,
    studentSelectedCourseware,
    setStudentSelectedCourseware,
    studentFullscreenPanel,
    setStudentFullscreenPanel,
    isStudentLessonContentCollapsed,
    setIsStudentLessonContentCollapsed,
    notifyLockedNavigation,
  };
}
