import { useState, useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { StudentType, Lesson } from '../../types/app';
import { StudentLessonHeader } from './StudentLessonHeader';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import { resolveStudentClassroomMode } from './mode-classroom/resolveStudentClassroomMode';
import { guardStudentFlow } from './mode-classroom/studentFlowGuard';
import { WhiteboardStudentClassroom } from './mode-classroom/WhiteboardStudentClassroom';
import { XueanStudentClassroom } from './mode-classroom/XueanStudentClassroom';
import { SegmentGateBanner } from './SegmentGateBanner';
import { useSegmentAccess } from './useSegmentAccess';
import { StudentIcebreakerModal } from './StudentIcebreakerModal';
import { useStudentActiveSession } from './useStudentActiveSession';
import type { StudentFullscreenPanel } from './studentFullscreenLayout';
import { useOptionalPluginHost } from '../../plugin-host/plugin-host-context';
import { extensionCoversSegmentType, normalizeSegmentType } from '../../../packages/core/plugin-host/mode-pack';
import {
  isModePacksEnabled,
  registerWhiteboardModePack,
  unregisterWhiteboardModePack,
  registerXueanModePack,
  unregisterXueanModePack,
  WhiteboardHostBridgeProvider,
  type WhiteboardHostBridgeValue,
} from '../classroom/mode-pack';

export interface StudentLessonViewProps {
  students: StudentType[];
  activeStudentId: string | null;
  /** 全班专注锁定中：学生端进入只读跟随模式 */
  isStudentLocked?: boolean;
  /** 导航限制：禁止切 Tab、返回看板（答题锁定与完全锁定均开启） */
  isNavigationLocked?: boolean;
  /** 交互限制：白板设为只读并拦截内容写入（仅完全锁定开启，答题锁定为 false） */
  isInteractionLocked?: boolean;
  /** 锁定模式：'full' | 'navigation' */
  lockMode?: 'full' | 'navigation';
  setStudentViewStatus: (status: 'dashboard' | 'lesson' | 'assignment') => void;
  setSelectedLesson: (id: string | null) => void;
  lessons: Lesson[];
  selectedLesson: string | null;
  studentFullscreenPanel: StudentFullscreenPanel;
  setStudentFullscreenPanel: Dispatch<SetStateAction<StudentFullscreenPanel>>;
  timelineSegments: any[];
  lang: 'zh' | 'en';
  activeSegmentId: string | null;
  setActiveSegmentId: (id: string) => void;
  localProgressPercent: number;
  setLocalProgressPercent: (v: number) => void;
  updateStudentProgress: (percent: number) => void;
  isStudentLessonContentCollapsed: boolean;
  setIsStudentLessonContentCollapsed: (b: boolean) => void;
  studentLessonTab: 'whiteboard' | 'courseware' | 'assignment' | 'xuean';
  setStudentLessonTab: (tab: 'whiteboard' | 'courseware' | 'assignment' | 'xuean') => void;
  elements: any[];
  activeRole: 'student' | 'teacher';
  fetchElements: (lessonId: string) => void;
  currentVfsParent: string | null;
  setCurrentVfsParent: (id: string | null) => void;
  vfsNodes: any[];
  studentSelectedCourseware: string | null;
  setStudentSelectedCourseware: (id: string | null) => void;
  addToast: (title: string, description: string, type: string) => void;
}

export function StudentLessonView(props: StudentLessonViewProps) {
  const {
    students,
    activeStudentId,
    isStudentLocked = false,
    isNavigationLocked,
    isInteractionLocked,
    lockMode,
    setStudentViewStatus,
    setSelectedLesson,
    lessons,
    selectedLesson,
    timelineSegments,
    lang,
    activeSegmentId,
    setActiveSegmentId,
    elements,
    activeRole,
    fetchElements,
    addToast,
  } = props;
  const segmentAccess = useSegmentAccess(selectedLesson, activeSegmentId);
  const checkingSegment = !!activeSegmentId && (segmentAccess.status === 'idle' || segmentAccess.status === 'loading');
  const blockSegmentContent = checkingSegment || (segmentAccess.status === 'locked' && !segmentAccess.visibleSegmentId);
  const contentSegmentId =
    segmentAccess.status === 'locked' && segmentAccess.visibleSegmentId
      ? segmentAccess.visibleSegmentId
      : activeSegmentId;

  // 班级 id（供授课工作区控制器与破冰逻辑共用）
  const [resolvedClassId, setResolvedClassId] = useState<string | null>(null);
  const [sessionStage, setSessionStage] = useState('IN_CLASS_TEACHING');
  const activeSession = useStudentActiveSession((s) => s.activeSession);
  const effectiveClassId =
    resolvedClassId || (activeSession?.lessonId === selectedLesson ? activeSession.classId : null);

  // ── 最小授课壳（学生端对称工作区）────────────────────────────────────
  // 学生不自建流程引擎：用宿主现成的 activeSegmentId/timelineSegments 快照 +
  // 命令总线的 sendMessage 动作，驱动学案/Moodle 学生视图。
  const studentHost = useOptionalPluginHost();
  const activeSegment = (timelineSegments as Array<{ id: string; type?: string; title?: string }> | undefined)?.find(
    (s) => s.id === activeSegmentId,
  );
  const segmentType = isModePacksEnabled() ? normalizeSegmentType(activeSegment?.type) : activeSegment?.type;
  const studentMainExts = studentHost?.getExtensions('classroom.active_segment.student_main' as never) ?? [];
  const matchingStudentMain = segmentType
    ? studentMainExts.filter((ext) => {
        const e = ext as { targetType?: string; slotProps?: Record<string, unknown> };
        const declared = e.targetType ?? e.slotProps?.segmentType ?? e.slotProps?.targetType;
        return extensionCoversSegmentType(
          typeof declared === 'string' ? declared : declared == null ? null : String(declared),
          segmentType,
        );
      })
    : [];
  // primary 工作区命中时替代原生内容面板，实现学生端"不用白板"接管
  const primaryStudentWorkspace = matchingStudentMain.some(
    (ext) => (ext as { slotProps?: Record<string, unknown> }).slotProps?.primary === true,
  );

  // Mode Pack 灰度：学生端独立会话也需注册白板/学案包（与教师 LiveClassroom 对称）。
  useEffect(() => {
    if (!studentHost) return;
    if (isModePacksEnabled()) {
      registerWhiteboardModePack();
      registerXueanModePack();
      return () => {
        unregisterWhiteboardModePack();
        unregisterXueanModePack();
      };
    }
    unregisterWhiteboardModePack();
    unregisterXueanModePack();
    return undefined;
  }, [studentHost]);

  const interactionLocked = isInteractionLocked ?? (lockMode === 'navigation' ? false : isStudentLocked);
  const boardSegmentId = contentSegmentId || activeSegmentId;
  const studentName = students.find((s) => s.id === activeStudentId)?.name ?? null;

  // 与 StudentLessonInteractionPanel 白板 tab 同一 props 契约，供 Mode Pack primary 工作区挂载。
  const studentWhiteboardBridge = useMemo<WhiteboardHostBridgeValue>(
    () => ({
      canvasProps: {
        lessonId: selectedLesson,
        classId: effectiveClassId ?? null,
        studentId: activeStudentId,
        studentName,
        elements,
        userRole: activeRole,
        readOnly: interactionLocked,
        followRemoteFullscreen: true,
        activeSegmentId: boardSegmentId,
        onSegmentSync: (segId: string) => {
          if (contentSegmentId !== undefined && contentSegmentId !== activeSegmentId) return;
          setActiveSegmentId(segId);
        },
        onElementUpdate: async () => {
          /* readonly or sync */
        },
        onElementDelete: async (elementId: string) => {
          if (interactionLocked) return;
          if (!selectedLesson) return;
          await fetch(`/api/lessons/${selectedLesson}/whiteboard/${elementId}`, { method: 'DELETE' });
          fetchElements(selectedLesson);
        },
        onClearBoard: async () => {
          if (interactionLocked) return;
          if (!selectedLesson) return;
          await fetch(`/api/lessons/${selectedLesson}/whiteboard`, { method: 'DELETE' });
          fetchElements(selectedLesson);
        },
        onElementAdd: async () => {
          /* readonly or sync */
        },
        onRefresh: () => {
          if (!selectedLesson) return;
          fetchElements(selectedLesson);
        },
      },
    }),
    [
      selectedLesson,
      effectiveClassId,
      activeStudentId,
      studentName,
      elements,
      activeRole,
      interactionLocked,
      boardSegmentId,
      contentSegmentId,
      activeSegmentId,
      setActiveSegmentId,
      fetchElements,
    ],
  );

  const studentFlowController = guardStudentFlow({
    snapshot: {
      lessonId: selectedLesson,
      classId: effectiveClassId,
      stage: sessionStage,
      activeSegmentId,
      segments: timelineSegments ?? [],
      students,
      onlineStudentIds: [],
      attempts: [],
    },
    setActiveSegment() {
      /* guardStudentFlow 会替换；这里不再请求全班环节接口 */
    },
    advanceStage() {
      /* guardStudentFlow 会替换；这里不再请求全班阶段接口 */
    },
    sendMessage: async (input: {
      channel: string;
      msgType: 'request' | 'response';
      payload: unknown;
      targetUserIds?: string[] | null;
      ttlMs?: number | null;
      messageId?: string;
    }) => {
      const res = await fetch('/api/classroomflowserver/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, lessonId: selectedLesson, classId: effectiveClassId }),
      });
      if (!res.ok) throw new Error(`sendMessage failed: HTTP ${res.status}`);
      return res.json();
    },
    refresh: () => {
      if (selectedLesson) fetchElements(selectedLesson);
    },
  });

  // Issue #131: 学生端破冰心情打卡状态
  const [icebreakerOpen, setIcebreakerOpen] = useState(false);

  useEffect(() => {
    if (!effectiveClassId || !selectedLesson) return;
    try {
      const keyChecked = `icebreaker_checked_${activeStudentId || 'cur'}_${effectiveClassId}_${selectedLesson}`;
      const keySkipped = `icebreaker_skipped_${activeStudentId || 'cur'}_${effectiveClassId}_${selectedLesson}`;
      if (!sessionStorage.getItem(keyChecked) && !sessionStorage.getItem(keySkipped)) {
        setIcebreakerOpen(true);
      }
    } catch {
      /* ignore storage error */
    }
  }, [effectiveClassId, selectedLesson, activeStudentId]);

  // 迟到进入的学生收不到当时的广播。轮询课堂会话，把本地指针对齐到全班当前环节。
  useEffect(() => {
    if (!selectedLesson || typeof fetch !== 'function') return;
    let cancelled = false;
    const pull = async () => {
      try {
        const res = await fetch(`/api/classroom/sessions/${encodeURIComponent(selectedLesson)}`, {
          credentials: 'same-origin',
        });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        const id = json?.session?.current_segment_id;
        const clsId = json?.session?.class_id;
        if (clsId && typeof clsId === 'string') {
          setResolvedClassId(clsId);
        }
        const stage = json?.session?.stage;
        if (typeof stage === 'string' && stage) setSessionStage(stage);
        if (typeof id === 'string' && id && id !== activeSegmentId) {
          setActiveSegmentId(id);
        }
      } catch {
        /* 会话尚未建立时保持本地环节，下一次轮询再对齐 */
      }
    };
    void pull();
    const timer = window.setInterval(() => {
      void pull();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedLesson, activeSegmentId, setActiveSegmentId]);

  const segmentForWorkspace = activeSegment
    ? {
        ...activeSegment,
        type: isModePacksEnabled() ? normalizeSegmentType(activeSegment.type) : activeSegment.type,
      }
    : null;
  const workspace =
    segmentForWorkspace && activeSegmentId ? (
      <div
        data-testid="classroom-active-segment-student-main-container"
        className="flex min-h-0 flex-1 flex-col overflow-hidden text-main"
      >
        <WhiteboardHostBridgeProvider value={isModePacksEnabled() ? studentWhiteboardBridge : null}>
          <ExtensionPointRenderer
            slot="classroom.active_segment.student_main"
            slotProps={{
              segment: segmentForWorkspace,
              lessonId: selectedLesson,
              classId: effectiveClassId,
              lang,
              flow: studentFlowController,
            }}
          />
        </WhiteboardHostBridgeProvider>
      </div>
    ) : null;

  const lesson = lessons.find((item) => item.id === selectedLesson);
  const classroomMode = resolveStudentClassroomMode(lesson?.delivery_mode);
  const lessonTitle = lesson?.title || (lang === 'zh' ? '课堂' : 'Class');
  const segmentTitle = segmentForWorkspace?.title?.trim() || '';
  const topic = segmentTitle || lessonTitle;
  const shellProps = {
    props,
    topic,
    lessonTitle,
    classId: effectiveClassId,
    segmentAccess,
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <StudentLessonHeader
        students={students}
        activeStudentId={activeStudentId}
        isStudentLocked={isNavigationLocked ?? isStudentLocked}
        lockMode={lockMode}
        setStudentViewStatus={setStudentViewStatus}
        setSelectedLesson={setSelectedLesson}
        lessons={lessons}
        selectedLesson={selectedLesson}
        addToast={addToast}
        lang={lang}
        showTitle={false}
        onOpenIcebreaker={() => setIcebreakerOpen(true)}
      />
      <SegmentGateBanner access={segmentAccess} lang={lang} />
      {classroomMode === 'xuean' ? (
        <XueanStudentClassroom
          {...shellProps}
          flow={studentFlowController}
          blockSegmentContent={blockSegmentContent}
          segment={segmentForWorkspace ?? { id: selectedLesson || 'xuean', type: 'xuean', title: topic }}
        />
      ) : (
        <WhiteboardStudentClassroom
          {...shellProps}
          contentSegmentId={contentSegmentId}
          blockSegmentContent={blockSegmentContent}
          studentName={studentName}
          primarySurface={primaryStudentWorkspace ? workspace : null}
          extraSurface={!primaryStudentWorkspace && matchingStudentMain.length > 0 ? workspace : null}
        />
      )}

      {/* Issue #131: 学生端课前破冰心情打卡弹窗 */}
      <StudentIcebreakerModal
        isOpen={icebreakerOpen}
        onClose={() => setIcebreakerOpen(false)}
        classId={effectiveClassId}
        lessonId={selectedLesson}
        studentId={activeStudentId}
        lang={lang}
        addToast={addToast}
      />
    </div>
  );
}
