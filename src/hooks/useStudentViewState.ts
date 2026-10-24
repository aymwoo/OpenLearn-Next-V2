/**
 * useStudentViewState — 学生端视图状态机（C1-R2d）。
 *
 * 原 App.tsx 内联 state / ref / effect 迁入。setStudentViewStatus 是学生端
 * 视图切换的唯一收口点：全班专注锁定期间只放行 'lesson'，其余跳转拦截并提示。
 */
import { useEffect, useRef, useState } from 'react';
import type { AddToast } from './useToast';
import type { LockMode, LockTarget } from '../types/app';

export type StudentViewStatus = 'dashboard' | 'lesson' | 'assignment';

export function useStudentViewState(deps: {
  activeStudentId: string | null;
  activeRole: 'teacher' | 'student';
  students: Array<{
    id: string;
    locked_lesson_id?: string | null;
    lock_mode?: LockMode | null;
    lock_target?: string | null;
  }>;
  liveClassFocusLocked: boolean;
  setIsFollowingTeacher: (v: boolean) => void;
  lang: 'zh' | 'en';
  addToast: AddToast;
}) {
  const { activeStudentId, activeRole, students, liveClassFocusLocked, setIsFollowingTeacher, lang, addToast } = deps;

  const [studentViewStatus, setStudentViewStatusState] = useState<StudentViewStatus>('dashboard');

  const currentStudent = students.find((s) => s.id === activeStudentId);

  // 基础锁定判断（向后兼容：有锁定课节或 liveClassFocusLocked 即处于锁定状态）
  const isStudentLocked =
    activeRole === 'student' && ((!!activeStudentId && !!currentStudent?.locked_lesson_id) || liveClassFocusLocked);

  // 模式：'full' (完全锁定/只读跟随) | 'navigation' (答题锁定/只锁页面导航，放开作答)
  const studentLockMode: LockMode = currentStudent?.lock_mode || 'full';

  // 导航限制：两种模式下均禁止随意切换页面、返回看板或离开课节
  const isNavigationLocked = isStudentLocked;

  // 交互限制：仅 full 模式下把白板设为只读并拦截内容交互；navigation 模式下放开鼠标与键盘供作答
  const isInteractionLocked = isStudentLocked && studentLockMode === 'full';

  // 解析目标定位（如指定锁在某个 Tab 或作业）
  const studentLockTarget: LockTarget | null = (() => {
    if (!currentStudent?.lock_target) return null;
    try {
      return typeof currentStudent.lock_target === 'string'
        ? JSON.parse(currentStudent.lock_target)
        : (currentStudent.lock_target as LockTarget);
    } catch {
      return null;
    }
  })();

  const isNavigationLockedRef = useRef(isNavigationLocked);
  const studentLockModeRef = useRef(studentLockMode);
  const studentViewStatusRef = useRef<StudentViewStatus>(studentViewStatus);

  useEffect(() => {
    isNavigationLockedRef.current = isNavigationLocked;
    studentLockModeRef.current = studentLockMode;
    studentViewStatusRef.current = studentViewStatus;
  }, [isNavigationLocked, studentLockMode, studentViewStatus]);

  // 锁定期间强制跟随教师步调，并确保学生落在课节视图，不会被困在其他页面上
  useEffect(() => {
    if (!isNavigationLocked) return;
    setIsFollowingTeacher(true);
    setStudentViewStatusState('lesson');
  }, [isNavigationLocked, setIsFollowingTeacher]);

  const [studentLessonTab, setStudentLessonTab] = useState<'whiteboard' | 'courseware' | 'assignment'>('whiteboard');

  // 当锁定时指定了目标 Tab，自动切换到对应 Tab
  useEffect(() => {
    if (isNavigationLocked && studentLockTarget?.tab) {
      setStudentLessonTab(studentLockTarget.tab);
    }
  }, [isNavigationLocked, studentLockTarget?.tab]);

  /**
   * 学生端视图切换的唯一收口点。
   * 锁定期间只放行 'lesson'（教师当前授课），其余跳转
   * （Dashboard、作业工作区、通知直达等）一律拦截并提示。
   */
  const setStudentViewStatus = (next: StudentViewStatus | ((prev: StudentViewStatus) => StudentViewStatus)) => {
    const resolved = typeof next === 'function' ? next(studentViewStatusRef.current) : next;
    if (isNavigationLockedRef.current && resolved !== 'lesson') {
      notifyLockedNavigation();
      return;
    }
    setStudentViewStatusState(resolved);
  };

  const notifyLockedNavigation = () => {
    const isAnswerMode = studentLockModeRef.current === 'navigation';
    addToast(
      lang === 'zh'
        ? isAnswerMode
          ? '🔒 答题锁定'
          : '🔒 全班专注锁定'
        : isAnswerMode
          ? '🔒 Answer Locked'
          : '🔒 Class Focus Locked',
      lang === 'zh'
        ? isAnswerMode
          ? '老师已开启答题锁定，请在当前页面完成作答并提交，暂时无法离开本页。'
          : '老师已开启全班专注锁定，暂时无法切换页面，请跟随教师当前授课内容。'
        : isAnswerMode
          ? 'The teacher locked the screen for answering. Please complete your work on this page before leaving.'
          : 'The teacher locked the class focus. Navigation is disabled — please follow the current lesson.',
      'warning',
    );
  };

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
    isNavigationLocked,
    isInteractionLocked,
    studentLockMode,
    studentLockTarget,
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
