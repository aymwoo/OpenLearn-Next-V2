import { useState, useEffect, useRef, useCallback, type Dispatch, type SetStateAction } from 'react';
import { ClassroomSyncChannel, CLASSROOM_SYNC_CHANNEL_NAME } from '../../../services/classroom-sync-channel';
import { mapTeacherMiddleTabToStudentTab, type TeacherMiddleTab } from '../map-teacher-middle-tab';
import type { DiffScreenLayout, DiffStudentWork } from '../showcase-diff/types';

export function useLiveClassroomSyncBroadcast(options: {
  selectedLesson: string | null;
  liveClassSelectedClassId: string | null;
  activeSegmentId: string | null;
  middleTab: TeacherMiddleTab;
  isClassLocked: boolean;
  liveClassIsActive: boolean;
  students: { id: string; name?: string }[];
  lang: string;
  addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  setLiveClassAcknowledgedMap: Dispatch<SetStateAction<Map<string, boolean>>>;
  setLiveClassFeed: Dispatch<SetStateAction<any[]>>;
  hasActiveSession: boolean;
}) {
  const {
    selectedLesson,
    liveClassSelectedClassId,
    activeSegmentId,
    middleTab,
    isClassLocked,
    liveClassIsActive,
    students,
    lang,
    addToast,
    setLiveClassAcknowledgedMap,
    setLiveClassFeed,
    hasActiveSession,
  } = options;

  const studentWindowRef = useRef<Window | null>(null);
  const studentWindowCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isStudentWindowOpen, setIsStudentWindowOpen] = useState(false);
  const syncChannelRef = useRef<ClassroomSyncChannel | null>(null);
  const segWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistedSegmentRef = useRef<string | null>(null);

  const syncSnapshotRef = useRef({
    selectedLesson,
    activeSegmentId,
    middleTab,
    isClassLocked,
    liveClassSelectedClassId,
    liveClassIsActive,
    students,
    lang,
  });
  syncSnapshotRef.current = {
    selectedLesson,
    activeSegmentId,
    middleTab,
    isClassLocked,
    liveClassSelectedClassId,
    liveClassIsActive,
    students,
    lang,
  };

  const handleOpenStudentWindow = useCallback(() => {
    if (studentWindowRef.current && !studentWindowRef.current.closed) {
      studentWindowRef.current.focus();
      addToast(
        lang === 'zh' ? '🎓 学生Tab已激活' : '🎓 Student Tab Focused',
        lang === 'zh' ? '已将联动学生端浏览器Tab置顶激活。' : 'Focused the student browser tab.',
        'info',
      );
      return;
    }

    const targetStudent = students[0];
    const targetStudentId = targetStudent?.id || 'student-demo';
    const targetStudentName = targetStudent?.name || (lang === 'zh' ? '演示学生' : 'Demo Student');
    const lessonParam = selectedLesson || '';
    const classParam = liveClassSelectedClassId || '';

    const studentUrl = `${window.location.origin}${window.location.pathname}?mode=student_live&studentId=${encodeURIComponent(targetStudentId)}&lessonId=${encodeURIComponent(lessonParam)}&classId=${encodeURIComponent(classParam)}#/student_live`;

    const studentTab = window.open(studentUrl, '_blank');

    if (!studentTab || studentTab.closed) {
      addToast(
        lang === 'zh' ? '⚠️ 新Tab打开被拦截' : '⚠️ Tab Open Blocked',
        lang === 'zh'
          ? '请在浏览器设置中允许打开新标签页，以查看联动学生端。'
          : 'Please allow new tabs in browser settings.',
        'warning',
      );
      return;
    }

    studentWindowRef.current = studentTab;
    setIsStudentWindowOpen(true);

    if (studentWindowCheckIntervalRef.current) {
      clearInterval(studentWindowCheckIntervalRef.current);
    }
    studentWindowCheckIntervalRef.current = setInterval(() => {
      if (!studentWindowRef.current || studentWindowRef.current.closed) {
        setIsStudentWindowOpen(false);
        studentWindowRef.current = null;
        if (studentWindowCheckIntervalRef.current) {
          clearInterval(studentWindowCheckIntervalRef.current);
          studentWindowCheckIntervalRef.current = null;
        }
      }
    }, 1000);

    addToast(
      lang === 'zh' ? '🎓 学生端新Tab已打开' : '🎓 Student Tab Opened',
      lang === 'zh'
        ? `已在独立浏览器Tab中打开【${targetStudentName}】学生端，教师端所有操作将实时同步！`
        : `Opened student tab for ${targetStudentName}. Operations are syncing in real time!`,
      'success',
    );
  }, [addToast, lang, liveClassSelectedClassId, selectedLesson, students]);

  useEffect(() => {
    const channel = new ClassroomSyncChannel(CLASSROOM_SYNC_CHANNEL_NAME, selectedLesson, liveClassSelectedClassId);
    syncChannelRef.current = channel;

    const unsub = channel.onMessage((msg) => {
      if (msg.type === 'STUDENT_ACKNOWLEDGE_PICK') {
        const studentId = msg.payload.studentId;
        const studentName = syncSnapshotRef.current.students.find((s) => s.id === studentId)?.name || studentId;
        setLiveClassAcknowledgedMap((prev) => {
          const next = new Map(prev);
          next.set(studentId, true);
          return next;
        });
        setLiveClassFeed((prev) => [
          {
            id: `feed-ack-${studentId}-${Date.now()}`,
            time: new Date().toLocaleTimeString(),
            type: 'checkin',
            message:
              syncSnapshotRef.current.lang === 'zh'
                ? `学生【${studentName}】已在独立视窗中确认点名并举手答到！`
                : `Student "${studentName}" acknowledged classroom pick from student window!`,
          },
          ...prev,
        ]);
        addToast(
          syncSnapshotRef.current.lang === 'zh' ? '🙋‍♂️ 学生已举手应答' : '🙋‍♂️ Student Acknowledged',
          syncSnapshotRef.current.lang === 'zh'
            ? `学生【${studentName}】已在独立视窗中确认收到点名！`
            : `Student "${studentName}" acknowledged!`,
          'success',
        );
      }
    });

    return () => {
      unsub();
      channel.destroy();
      syncChannelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 与 LiveClassroomView 原 effect 依赖一致
  }, [selectedLesson, liveClassSelectedClassId]);

  useEffect(() => {
    syncChannelRef.current?.setLessonContext(selectedLesson, liveClassSelectedClassId);
    syncChannelRef.current?.broadcastChangeLesson(selectedLesson);
  }, [selectedLesson, liveClassSelectedClassId]);

  useEffect(() => {
    lastPersistedSegmentRef.current = null;
  }, [selectedLesson]);

  useEffect(() => {
    syncChannelRef.current?.broadcastChangeSegment(activeSegmentId);
    if (selectedLesson && hasActiveSession && segWriteTimerRef.current) {
      clearTimeout(segWriteTimerRef.current);
      segWriteTimerRef.current = null;
    }
    if (selectedLesson && hasActiveSession && activeSegmentId !== lastPersistedSegmentRef.current) {
      segWriteTimerRef.current = setTimeout(() => {
        const targetSegmentId = activeSegmentId;
        fetch(`/api/classroom/sessions/${encodeURIComponent(selectedLesson)}/view-state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activeSegmentId: targetSegmentId }),
        })
          .then((res) => {
            if (res.ok) {
              lastPersistedSegmentRef.current = targetSegmentId;
            } else if (res.status === 429) {
              console.warn('[LiveClassroomView] view-state rate-limited (HTTP 429), skipping transient update.');
            }
          })
          .catch(() => {});
      }, 500);
    }
    return () => {
      if (segWriteTimerRef.current) {
        clearTimeout(segWriteTimerRef.current);
        segWriteTimerRef.current = null;
      }
    };
  }, [activeSegmentId, selectedLesson, hasActiveSession]);

  useEffect(() => {
    syncChannelRef.current?.broadcastChangeTab(mapTeacherMiddleTabToStudentTab(middleTab));
  }, [middleTab]);

  useEffect(() => {
    syncChannelRef.current?.broadcastLockClass(isClassLocked);
  }, [isClassLocked]);

  const handleSyncShowcaseDiffToClass = useCallback(
    (data: { selectedIds: string[]; layout: DiffScreenLayout; works?: DiffStudentWork[]; anonymous?: boolean }) => {
      syncChannelRef.current?.broadcastShowcaseDiff({
        selectedIds: data.selectedIds,
        layout: data.layout,
        anonymous: data.anonymous,
        works: (data.works || []).map((w) => ({
          studentId: w.studentId,
          studentName: w.studentName,
          title: w.title || '',
          content: w.content,
          source: w.source,
          tags: w.tags,
          accuracyScore: w.accuracyScore,
        })),
      });
      setLiveClassFeed((prev) => [
        {
          id: `diff-sync-${Date.now()}`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          type: 'info',
          message:
            lang === 'zh'
              ? `已将 ${data.selectedIds.length} 份学生作答 (${data.layout.toUpperCase()}) 同步投屏至全班。`
              : `Synced ${data.selectedIds.length} student works (${data.layout}) to class.`,
        },
        ...prev,
      ]);
    },
    [lang, setLiveClassFeed],
  );

  useEffect(() => {
    return () => {
      if (studentWindowCheckIntervalRef.current) clearInterval(studentWindowCheckIntervalRef.current);
      if (segWriteTimerRef.current) clearTimeout(segWriteTimerRef.current);
    };
  }, []);

  return {
    syncChannelRef,
    isStudentWindowOpen,
    handleOpenStudentWindow,
    handleSyncShowcaseDiffToClass,
  };
}
