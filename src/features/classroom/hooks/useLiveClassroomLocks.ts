import { useState, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { LockMode } from '../../../types/app';

export function useLiveClassroomLocks(options: {
  students: {
    id: string;
    name?: string;
    locked_lesson_id?: string | null;
    lock_mode?: 'full' | 'navigation' | null;
  }[];
  selectedLesson: string | null;
  liveClassSelectedClassId: string | null;
  lang: string;
  addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  fetchStudents: () => Promise<void>;
  setLiveClassFeed: Dispatch<SetStateAction<any[]>>;
  lastAutoLockedRef: MutableRefObject<{ lesson: string | null; classId: string | null }>;
  macroRuntimeRef: MutableRefObject<{
    selectedLesson: string | null;
    classId: string | null;
    lang: string;
    toggleLock: (lock: boolean, mode?: 'full' | 'navigation') => Promise<void>;
    fetchAttempts: () => void;
    addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  }>;
  fetchAttempts: () => void;
}) {
  const {
    students,
    selectedLesson,
    liveClassSelectedClassId,
    lang,
    addToast,
    fetchStudents,
    setLiveClassFeed,
    lastAutoLockedRef,
    macroRuntimeRef,
    fetchAttempts,
  } = options;

  const [lockingClass, setLockingClass] = useState(false);

  const lockedStudents = students.filter((s) => s.locked_lesson_id === selectedLesson);
  const isClassLocked = !!(liveClassSelectedClassId && lockedStudents.length > 0);
  const classLockMode: LockMode =
    lockedStudents.some((s) => s.lock_mode === 'navigation') && !lockedStudents.some((s) => s.lock_mode === 'full')
      ? 'navigation'
      : 'full';

  const handleToggleClassLock = async (lock: boolean, mode: 'full' | 'navigation' = 'full') => {
    if (!liveClassSelectedClassId || !selectedLesson) {
      addToast(
        lang === 'zh' ? '⚠️ 无法操作' : '⚠️ Action Prevented',
        lang === 'zh' ? '请先选择需要授课的课节及班级。' : 'Please select a lesson and class first.',
        'warning',
      );
      return;
    }

    setLockingClass(true);
    try {
      const endpoint = lock
        ? `/api/classes/${liveClassSelectedClassId}/lock_lesson`
        : `/api/classes/${liveClassSelectedClassId}/unlock_lesson`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: lock ? JSON.stringify({ lessonId: selectedLesson, mode }) : undefined,
      });

      if (res.ok) {
        await fetchStudents();
        const isAnswer = mode === 'navigation';
        setLiveClassFeed((prev) => [
          {
            id: Math.random().toString(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            type: lock ? 'warning' : 'info',
            message: lock
              ? isAnswer
                ? `已对全班学生开启答题锁定（放开作答，限制离开当前页面）。`
                : `已对全班学生强制锁定专注模式（限定当前课程，只读跟随）。`
              : `已解锁全班学生专注模式限制。`,
          },
          ...prev,
        ]);
        addToast(
          lang === 'zh' ? '🔒 锁状态更新' : '🔒 Class Status Updated',
          lock
            ? isAnswer
              ? '全班答题锁定成功，学生可在当前页面作答，无法切出。'
              : '全班专注锁定成功，学生将无法切回主页。'
            : '全班屏幕解锁成功，学生已恢复自由浏览。',
          'success',
        );
      }
    } catch (e) {
      console.error('Failed to toggle class focus lock', e);
    } finally {
      setLockingClass(false);
    }
  };

  const handleToggleStudentLock = async (
    studentId: string,
    currentLockId: string | null | undefined,
    currentLockMode?: LockMode | null,
    targetMode?: LockMode | null,
  ) => {
    let newLockVal: string | null = selectedLesson;
    let newMode: LockMode = targetMode && targetMode !== null ? targetMode : 'full';

    if (currentLockId) {
      if (targetMode && targetMode !== null && currentLockMode !== targetMode) {
        newLockVal = selectedLesson;
        newMode = targetMode;
      } else {
        newLockVal = null;
      }
    }

    try {
      const res = await fetch(`/api/students/${studentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locked_lesson_id: newLockVal,
          lock_mode: newLockVal ? newMode : 'full',
        }),
      });
      if (res.ok) {
        await fetchStudents();
        const stName = students.find((s) => s.id === studentId)?.name || studentId;
        const isAnswer = newMode === 'navigation';
        setLiveClassFeed((prev) => [
          {
            id: Math.random().toString(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            type: newLockVal ? 'warning' : 'info',
            message: newLockVal
              ? `已针对学生 [${stName}] 开启${isAnswer ? '答题锁定' : '专注限制锁定'}。`
              : `已解锁学生 [${stName}] 的屏幕锁定。`,
          },
          ...prev,
        ]);
      }
    } catch (e) {
      console.error('Failed to toggle student lock', e);
    }
  };

  useEffect(() => {
    if (!selectedLesson || !liveClassSelectedClassId) {
      lastAutoLockedRef.current = { lesson: null, classId: null };
      return;
    }

    if (
      lastAutoLockedRef.current.lesson !== selectedLesson ||
      lastAutoLockedRef.current.classId !== liveClassSelectedClassId
    ) {
      lastAutoLockedRef.current = { lesson: selectedLesson, classId: liveClassSelectedClassId };
      void handleToggleClassLock(true);
    }
  }, [selectedLesson, liveClassSelectedClassId]);

  useEffect(() => {
    macroRuntimeRef.current = {
      selectedLesson,
      classId: liveClassSelectedClassId,
      lang,
      toggleLock: handleToggleClassLock,
      fetchAttempts,
      addToast,
    };
  });

  return {
    lockingClass,
    isClassLocked,
    classLockMode,
    handleToggleClassLock,
    handleToggleStudentLock,
  };
}
