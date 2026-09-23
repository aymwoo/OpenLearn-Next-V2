import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Square,
  Pause,
  Users,
  Presentation,
  Clock,
  Shuffle,
  CheckCircle2,
  XCircle,
  Shield,
  ShieldAlert,
  Check,
  RefreshCw,
  Send,
  HelpCircle,
  Activity,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Database,
  Award,
  Search,
  ExternalLink,
  Sparkles,
  AlertTriangle,
  Trophy,
} from 'lucide-react';
import * as Icons from 'lucide-react';
import { LazyWhiteboard } from '../components/LazyWhiteboard';
import { TeacherAssignmentGradePanel } from './TeacherAssignmentGradePanel';
import { TopPerformersWidget } from '../features/teacher/TopPerformersWidget';
import { io } from 'socket.io-client';
import { resolvePluginCommandType } from '../../packages/core/plugin-host/plugin-namespace';
import { ExtensionPointRenderer } from '../plugin-host/extension-point-renderer';
import { ClassroomSyncChannel } from '../services/classroom-sync-channel';
import { useErrorStore, errorStore } from '../store/errorStore';
import { ClassroomInteractiveCockpit } from '../features/classroom/ClassroomInteractiveCockpit';
import { ClassroomStandardTopbar } from '../features/classroom/ClassroomStandardTopbar';
import { ClassroomAttributionModal } from '../features/classroom/ClassroomAttributionModal';
import { StudentGrowthProfileModal } from '../features/student/StudentGrowthProfileModal';
import {
  ClassroomCockpitHeader,
  ClassroomWorkflowSubHeader,
  ClassroomAgendaPanel,
  ClassroomCanvasArea,
  ClassroomEngagementConsole,
  StudentGaugeItem,
  AuditEventItem,
  AuditEventLevel,
} from '../features/classroom/cockpit';
import { PreClassReadyView } from '../features/classroom/PreClassReadyView';
import { PostClassWrapupView } from '../features/classroom/PostClassWrapupView';
import { ClassroomBriefingView } from '../features/classroom/ClassroomBriefingView';
import { ClassroomCountdownWidget } from '../features/classroom/ClassroomCountdownWidget';


// Dynamic Icon component to render Lucide icons by name string
function DynamicIcon({ name, ...props }: { name: string; [key: string]: any }) {
  const IconComponent = (Icons as any)[name];
  if (!IconComponent) return <HelpCircle {...props} />;
  return React.createElement(IconComponent, props);
}

interface LiveClassroomViewProps {
  selectedLesson: string | null;
  setSelectedLesson: (id: string | null) => void;
  lessons: any[];
  classes: any[];
  students: any[];
  plugins: any[];
  lang: string;
  timelineSegments: any[];
  activeSegmentId: string | null;
  setActiveSegmentId: (id: string | null) => void;
  liveClassSelectedClassId: string | null;
  setLiveClassSelectedClassId: (id: string | null) => void;
  liveClassIsActive: boolean;
  setLiveClassIsActive: (active: boolean) => void;
  liveClassTimeRemaining: number;
  setLiveClassTimeRemaining: (seconds: number) => void;
  liveClassFeed: any[];
  setLiveClassFeed: React.Dispatch<React.SetStateAction<any[]>>;
  liveClassAcknowledgedMap: Map<string, boolean>;
  setLiveClassAcknowledgedMap: React.Dispatch<React.SetStateAction<Map<string, boolean>>>;
  elements: any[];
  fetchElements: (lessonId: string) => Promise<void>;
  fetchStudents: () => Promise<void>;
  addToast: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
  onlineStudentIds: string[];
  activeStudentLessons: Record<string, string>;
  liveClassStudentProgress: any[];
  onPingStudent?: (studentId: string, message?: string) => void;
  onOpenCoursewareHub?: () => void;
  activeRole?: string;
  setActiveRole?: (role: 'teacher' | 'student') => void;
}

export function LiveClassroomView({
  selectedLesson,
  setSelectedLesson,
  lessons,
  classes,
  students,
  plugins,
  lang,
  timelineSegments,
  activeSegmentId,
  setActiveSegmentId,
  liveClassSelectedClassId,
  setLiveClassSelectedClassId,
  liveClassIsActive,
  setLiveClassIsActive,
  liveClassTimeRemaining,
  setLiveClassTimeRemaining,
  liveClassFeed,
  setLiveClassFeed,
  liveClassAcknowledgedMap,
  setLiveClassAcknowledgedMap,
  elements,
  fetchElements,
  fetchStudents,
  addToast,
  onlineStudentIds,
  activeStudentLessons,
  liveClassStudentProgress,
  onPingStudent,
  onOpenCoursewareHub,
  activeRole,
  setActiveRole,
}: LiveClassroomViewProps) {
  const [lockingClass, setLockingClass] = useState(false);
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(false);
  const [hoveredStudentId, setHoveredStudentId] = useState<string | null>(null);
  const studentErrors = useErrorStore((s) => s.studentErrors);

  // Random drawing states
  const [isDrawing, setIsDrawing] = useState(false);
  const [activeDrawStudentId, setActiveDrawStudentId] = useState<string | null>(null);
  const [selectedDrawStudentIds, setSelectedDrawStudentIds] = useState<string[]>([]);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastAutoLockedRef = useRef<{ lesson: string | null; classId: string | null }>({
    lesson: null,
    classId: null,
  });

  // Student Pop-up Window & Real-time Sync Channel
  const studentWindowRef = useRef<Window | null>(null);
  const [isStudentWindowOpen, setIsStudentWindowOpen] = useState(false);
  const syncChannelRef = useRef<ClassroomSyncChannel | null>(null);
  const [liveClassFullscreenElementId, setLiveClassFullscreenElementId] = useState<string | null>(null);

  // Classroom workflow stages: PRE_CLASS_READY, IN_CLASS_TEACHING, WRAP_UP_EXIT_TICKET, ARCHIVED_REPORT
  const [classroomStage, setClassroomStage] = useState<string>('IN_CLASS_TEACHING');

  useEffect(() => {
    if (!selectedLesson) return;
    fetch(`/api/classroom/sessions/${selectedLesson}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.hasActiveSession && data?.stage) {
          setClassroomStage(data.stage);
        }
      })
      .catch(() => {});
  }, [selectedLesson]);

  const handleStageChange = async (newStage: string) => {
    setClassroomStage(newStage);
    if (selectedLesson) {
      try {
        await fetch(`/api/classroom/sessions/${selectedLesson}/stage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: newStage, classId: liveClassSelectedClassId }),
        });
      } catch (err) {
        console.error('Failed to update stage:', err);
      }
    }
  };

  // Interactive courseware submission states
  const [middleTab, setMiddleTab] = useState<'whiteboard' | 'submissions' | 'assignment' | 'top_performers'>('whiteboard');
  const [attempts, setAttempts] = useState<any[]>([]);
  const [loadingAttempts, setLoadingAttempts] = useState(false);
  const [selectedAttempt, setSelectedAttempt] = useState<any | null>(null);
  const [rawPayload, setRawPayload] = useState<any | null>(null);
  const [loadingRaw, setLoadingRaw] = useState(false);
  const [submissionFilter, setSubmissionFilter] = useState<'all' | 'submitted' | 'started'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProfileStudentId, setSelectedProfileStudentId] = useState<string | null>(null);
  const [isCanvasAttributionOpen, setIsCanvasAttributionOpen] = useState(false);

  const fetchAttempts = async () => {
    setLoadingAttempts(true);
    try {
      const res = await fetch('/api/courseware/attempts');
      if (res.ok) {
        const data = await res.json();
        setAttempts(data);
      }
    } catch (e) {
      console.error('Failed to fetch attempts', e);
    } finally {
      setLoadingAttempts(false);
    }
  };

  useEffect(() => {
    if (middleTab === 'submissions') {
      fetchAttempts();
    }
  }, [middleTab]);

  useEffect(() => {
    const socket = io();
    socket.on('courseware-attempt-updated', () => {
      fetchAttempts();
    });
    return () => {
      socket.disconnect();
    };
  }, []);

  const handlePromoteAttempt = async (attemptId: string) => {
    if (!selectedLesson || !liveClassSelectedClassId) {
      addToast(
        lang === 'zh' ? '⚠️ 无法操作' : '⚠️ Action Prevented',
        lang === 'zh' ? '请先在顶部栏选择要绑定的课节和班级。' : 'Please select lesson and class first.',
        'warning',
      );
      return;
    }
    try {
      const res = await fetch(`/api/courseware/attempts/${attemptId}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId: selectedLesson,
          classId: liveClassSelectedClassId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        addToast(
          lang === 'zh' ? '✓ 学习数据已保存' : '✓ Data Recorded',
          lang === 'zh'
            ? `成功将该数据存入数据库！分数: ${data.score}，已同步更新至学生学习进度。`
            : `Successfully recorded submission! Score: ${data.score}.`,
          'success',
        );
        fetchAttempts();
        if (fetchStudents) {
          fetchStudents();
        }
      } else {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Server error');
      }
    } catch (err: any) {
      addToast(
        lang === 'zh' ? '❌ 保存失败' : '❌ Save Failed',
        err.message || 'Error occurred while saving.',
        'warning',
      );
    }
  };

  const handleViewRaw = async (attempt: any) => {
    setSelectedAttempt(attempt);
    setLoadingRaw(true);
    setRawPayload(null);
    try {
      const res = await fetch(`/api/courseware/attempts/${attempt.attemptId}/raw`);
      if (res.ok) {
        const data = await res.json();
        setRawPayload(data);
      } else {
        setRawPayload({ error: 'Failed to load raw data' });
      }
    } catch (e: any) {
      setRawPayload({ error: e.message || 'Error loading data' });
    } finally {
      setLoadingRaw(false);
    }
  };

  // Find if class-wide locking is active (if all students are locked to this lesson)
  const isClassLocked = !!(
    liveClassSelectedClassId && students.filter((s) => s.locked_lesson_id === selectedLesson).length > 0
  );

  // ── 跨浏览器Tab学生端同步信道机制 ───────────────────────────────────────
  const handleOpenStudentWindow = () => {
    // If student tab is already opened and not closed, focus it
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

    // 打开独立浏览器Tab页面（不传入宽高特性参数，由浏览器作为标准标签页打开，便于左右分屏或双屏排布）
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

    const checkInterval = setInterval(() => {
      if (!studentWindowRef.current || studentWindowRef.current.closed) {
        setIsStudentWindowOpen(false);
        studentWindowRef.current = null;
        clearInterval(checkInterval);
      }
    }, 1000);

    addToast(
      lang === 'zh' ? '🎓 学生端新Tab已打开' : '🎓 Student Tab Opened',
      lang === 'zh'
        ? `已在独立浏览器Tab中打开【${targetStudentName}】学生端，教师端所有操作将实时同步！`
        : `Opened student tab for ${targetStudentName}. Operations are syncing in real time!`,
      'success',
    );
  };

  useEffect(() => {
    const channel = new ClassroomSyncChannel();
    syncChannelRef.current = channel;

    const unsub = channel.onMessage((msg) => {
      if (msg.type === 'STUDENT_HANDSHAKE_REQUEST') {
        // Send full current snapshot to newly opened student window
        channel.broadcastInitState({
          selectedLesson,
          activeSegmentId,
          activeTab: middleTab === 'submissions' || middleTab === 'top_performers' ? 'courseware' : middleTab,
          isClassLocked,
          liveClassTimeRemaining,
          liveClassSelectedClassId,
          liveClassIsActive,
          fullscreenElementId: liveClassFullscreenElementId,
        });
      } else if (msg.type === 'STUDENT_ACKNOWLEDGE_PICK') {
        const studentId = msg.payload.studentId;
        const studentName = students.find((s) => s.id === studentId)?.name || studentId;
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
              lang === 'zh'
                ? `学生【${studentName}】已在独立视窗中确认点名并举手答到！`
                : `Student "${studentName}" acknowledged classroom pick from student window!`,
          },
          ...prev,
        ]);
        addToast(
          lang === 'zh' ? '🙋‍♂️ 学生已举手应答' : '🙋‍♂️ Student Acknowledged',
          lang === 'zh'
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
  }, [
    selectedLesson,
    activeSegmentId,
    middleTab,
    isClassLocked,
    liveClassTimeRemaining,
    liveClassSelectedClassId,
    liveClassIsActive,
    students,
    lang,
  ]);

  // Reactive state broadcasts
  useEffect(() => {
    syncChannelRef.current?.broadcastChangeLesson(selectedLesson);
  }, [selectedLesson]);

  useEffect(() => {
    syncChannelRef.current?.broadcastChangeSegment(activeSegmentId);
  }, [activeSegmentId]);

  useEffect(() => {
    syncChannelRef.current?.broadcastChangeTab(
      middleTab === 'submissions' || middleTab === 'top_performers' ? 'courseware' : middleTab,
    );
  }, [middleTab]);

  useEffect(() => {
    syncChannelRef.current?.broadcastLockClass(isClassLocked);
  }, [isClassLocked]);

  useEffect(() => {
    syncChannelRef.current?.broadcastSyncTimer(liveClassTimeRemaining, liveClassIsActive);
  }, [liveClassTimeRemaining, liveClassIsActive]);

  // Extract classroomTools from active plugins (supporting legacy and modern contributes['classroom.tool'])
  const activePlugins = plugins.filter((p) => p.status === 'active');
  const classroomTools = Array.from(
    new Map(
      activePlugins
        .flatMap((p) => {
          try {
            const manifestObj = typeof p.manifest === 'string' ? JSON.parse(p.manifest) : p.manifest;
            const legacyTools = manifestObj.classroomTools || [];
            const modernTools = manifestObj.contributes?.['classroom.tool'] || [];
            return [...legacyTools, ...modernTools].map((t: any) => ({
              ...t,
              pluginId: p.id,
              manifestId: manifestObj.id,
            }));
          } catch (e) {
            return [];
          }
        })
        .map((t) => [t.id, t]), // last-wins dedup by tool id across all plugins
    ).values(),
  );

  // Countdown timer effect
  useEffect(() => {
    if (liveClassIsActive && liveClassTimeRemaining > 0) {
      timerRef.current = setInterval(() => {
        setLiveClassTimeRemaining(liveClassTimeRemaining - 1);
      }, 1000);
    } else if (liveClassTimeRemaining === 0 && liveClassIsActive) {
      addToast(
        lang === 'zh' ? '⏰ 环节时间到' : '⏰ Phase Timer Ended',
        lang === 'zh'
          ? '当前教学环节设定的时间已耗尽，建议转入下一环节。'
          : 'The current segment duration has elapsed. Transition recommended.',
        'warning',
      );
      setLiveClassIsActive(false);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [liveClassIsActive, liveClassTimeRemaining]);

  // Auto-lock class when selection changes
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
      handleToggleClassLock(true);
    }
  }, [selectedLesson, liveClassSelectedClassId]);

  // Helper to parse "5m" or "20m" to seconds
  const parseDuration = (dur: string): number => {
    const num = parseInt(dur.replace(/[^0-9]/g, ''));
    if (isNaN(num)) return 300;
    if (dur.includes('s')) return num;
    return num * 60; // default to minutes
  };

  const handleStartSegment = (seg: any) => {
    setActiveSegmentId(seg.id);
    const secs = parseDuration(seg.duration);
    setLiveClassTimeRemaining(secs);
    setLiveClassIsActive(true);

    setLiveClassFeed((prev) => [
      {
        id: Math.random().toString(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        type: 'info',
        message: `教学环节切换并广播：进入 [${seg.title}] 环节，设定时间 ${seg.duration}。`,
      },
      ...prev,
    ]);

    addToast(
      lang === 'zh' ? '📢 环节已广播' : '📢 Phase Synchronized',
      lang === 'zh'
        ? `已同步广播 [${seg.title}] 环节至所有在线学生端。`
        : `Broadcasted phase [${seg.title}] to all active students.`,
      'success',
    );
  };

  // Lock entire class
  const handleToggleClassLock = async (lock: boolean) => {
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
        body: lock ? JSON.stringify({ lessonId: selectedLesson }) : undefined,
      });

      if (res.ok) {
        await fetchStudents();
        setLiveClassFeed((prev) => [
          {
            id: Math.random().toString(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            type: lock ? 'warning' : 'info',
            message: lock ? `已对全班学生强制锁定专注模式（限定当前课程）。` : `已解锁全班学生专注模式限制。`,
          },
          ...prev,
        ]);
        addToast(
          lang === 'zh' ? '🔒 锁状态更新' : '🔒 Class Status Updated',
          lock ? '全班专注锁定成功，学生将无法切回主页。' : '全班屏幕解锁成功，学生已恢复自由浏览。',
          'success',
        );
      }
    } catch (e) {
      console.error('Failed to toggle class focus lock', e);
    } finally {
      setLockingClass(false);
    }
  };

  // Lock single student
  const handleToggleStudentLock = async (studentId: string, currentLockId: string | null | undefined) => {
    const newLockVal = currentLockId ? null : selectedLesson;
    try {
      const res = await fetch(`/api/students/${studentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locked_lesson_id: newLockVal }),
      });
      if (res.ok) {
        await fetchStudents();
        const stName = students.find((s) => s.id === studentId)?.name || studentId;
        setLiveClassFeed((prev) => [
          {
            id: Math.random().toString(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            type: newLockVal ? 'warning' : 'info',
            message: newLockVal
              ? `已针对学生 [${stName}] 单独开启专注限制锁定。`
              : `已解锁学生 [${stName}] 的专注限制。`,
          },
          ...prev,
        ]);
      }
    } catch (e) {
      console.error('Failed to toggle student lock', e);
    }
  };

  // Execute interactive tool via command bus
  const handleExecuteTool = async (tool: any) => {
    if (!selectedLesson) {
      addToast(
        lang === 'zh' ? '⚠️ 请选择课节' : '⚠️ Select Lesson',
        lang === 'zh' ? '请先选择要授课的课节。' : 'Please select a lesson first.',
        'warning',
      );
      return;
    }

    // Check if $classId replacement is required but no class selected
    const needsClass = JSON.stringify(tool.payload || '').includes('$classId');
    if (needsClass && !liveClassSelectedClassId) {
      addToast(
        lang === 'zh' ? '⚠️ 请选择班级' : '⚠️ Select Class',
        lang === 'zh' ? '该工具需要指定上课班级，请在顶部先选择班级。' : 'Please select class first for this tool.',
        'warning',
      );
      return;
    }

    setLiveClassFeed((prev) => [
      {
        id: Math.random().toString(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        type: 'info',
        message: `正在运行插件工具 [${tool.name}]...`,
      },
      ...prev,
    ]);

    try {
      // Substitute placeholders in payload
      const resolvedPayload = JSON.parse(
        JSON.stringify(tool.payload || {})
          .replace(/\$classId/g, liveClassSelectedClassId || '')
          .replace(/\$lessonId/g, selectedLesson || ''),
      );

      // Auto-append active segment ID into plugin elements
      if (resolvedPayload.type === 'plugin' && resolvedPayload.data) {
        try {
          const dataObj = JSON.parse(resolvedPayload.data);
          if (!dataObj.segmentId && activeSegmentId) {
            dataObj.segmentId = activeSegmentId;
            resolvedPayload.data = JSON.stringify(dataObj);
          }
        } catch {}
      }

      // Only prefix plugin-internal commands (e.g. courseware.open_panel).
      // Kernel commands like whiteboard.draw must pass through unmodified.
      const KERNEL_COMMAND_RE = /^(whiteboard|lesson|assignment|class|student|vfs|plugin|ai|agent|system)\./;
      const prefixedCommandType =
        !KERNEL_COMMAND_RE.test(tool.commandType) && tool.manifestId
          ? resolvePluginCommandType(tool.commandType, tool.manifestId)
          : tool.commandType;
      const res = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commandType: prefixedCommandType,
          payload: resolvedPayload,
        }),
      });

      if (res.ok) {
        if (
          onOpenCoursewareHub &&
          (tool.id === 'courseware-hub-teacher' || tool.commandType === 'courseware.open_panel')
        ) {
          onOpenCoursewareHub();
        }
        setLiveClassFeed((prev) => [
          {
            id: Math.random().toString(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            type: 'success',
            message: `插件工具 [${tool.name}] 执行完毕，数据成功下发。`,
          },
          ...prev,
        ]);
        addToast(
          lang === 'zh' ? '✓ 工具下发成功' : '✓ Tool Synchronized',
          lang === 'zh'
            ? `工具 [${tool.name}] 已成功在当前白板上部署并投射。`
            : `Tool [${tool.name}] synchronized successfully.`,
          'success',
        );
        await fetchElements(selectedLesson);
      } else {
        const data = await res.json();
        throw new Error(data.error || 'Server error');
      }
    } catch (err: any) {
      setLiveClassFeed((prev) => [
        {
          id: Math.random().toString(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          type: 'error',
          message: `运行插件工具 [${tool.name}] 失败: ${err.message}`,
        },
        ...prev,
      ]);
      addToast(lang === 'zh' ? '❌ 运行失败' : '❌ Tool Failed', err.message || 'Execution error', 'warning');
    }
  };

  const handleRandomPick = () => {
    if (students.length === 0 || isDrawing) return;

    // Only select students who are currently online and have entered the classroom (activeStudentLessons[s.id] === selectedLesson)
    const drawPool = students.filter(
      (s) => onlineStudentIds.includes(s.id) && activeStudentLessons[s.id] === selectedLesson,
    );

    if (drawPool.length === 0) {
      addToast(
        lang === 'zh' ? '⚠️ 无法抽问' : '⚠️ Cannot Draw',
        lang === 'zh' ? '当前课堂中没有已进入的活跃学生。' : 'No students have entered the classroom yet.',
        'warning',
      );
      return;
    }

    setIsDrawing(true);

    let count = 0;
    const maxTicks = 18;
    let currentInterval = 75;

    const tick = () => {
      const randIndex = Math.floor(Math.random() * drawPool.length);
      const randomStudent = drawPool[randIndex];
      setActiveDrawStudentId(randomStudent.id);

      count++;
      if (count < maxTicks) {
        if (count > maxTicks - 5) {
          currentInterval += 45;
        }
        setTimeout(tick, currentInterval);
      } else {
        const finalStudent = drawPool[randIndex];
        setActiveDrawStudentId(null);
        setIsDrawing(false);

        // Add the drawn student to the list of highlighted IDs
        setSelectedDrawStudentIds((prev) => {
          if (prev.includes(finalStudent.id)) return prev;
          return [...prev, finalStudent.id];
        });

        // Append draw result to live class feed
        setLiveClassFeed((prev) => [
          {
            id: Math.random().toString(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            type: 'success',
            message: `🎯 随机提问抽选：学生 [${finalStudent.name}] 被抽中回答问题！`,
          },
          ...prev,
        ]);

        addToast(
          lang === 'zh' ? '🎯 随机提问抽选' : '🎯 Student Drawn',
          lang === 'zh'
            ? `恭喜学生 [${finalStudent.name}] 被抽中回答问题！`
            : `Student [${finalStudent.name}] was selected to answer!`,
          'success',
        );

        // 跨窗口同步：向独立学生视窗派发点名事件
        syncChannelRef.current?.broadcastPickStudent(finalStudent.id, finalStudent.name);

        // Recover highlight after 8 seconds
        setTimeout(() => {
          setSelectedDrawStudentIds((prev) => prev.filter((id) => id !== finalStudent.id));
        }, 8000);
      }
    };

    setTimeout(tick, currentInterval);
  };

  const formatTime = (secs: number): string => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // ── 提交数据列表的展示口径（徽标与表格必须共用同一份数据） ──
  // 先按顶部所选班级过滤（未选班级时不筛），再按搜索词与状态筛选。
  // 之前的 bug：徽标直接用未过滤的 attempts.length，表格却用班级过滤后的结果，
  // 导致“徽标显示 8 条记录、列表却空空如也”的矛盾。
  const classStudentIds = liveClassSelectedClassId ? students.map((s) => s.id) : [];
  const classFilteredAttempts = liveClassSelectedClassId
    ? attempts.filter((a) => classStudentIds.includes(a.studentId))
    : attempts;
  const displayAttempts = classFilteredAttempts.filter((a) => {
    const matchesSearch =
      a.studentName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.coursewareName?.toLowerCase().includes(searchQuery.toLowerCase());

    // 终态状态值归一到一处：后端落库可能是 completed，客户端历史上传过 submitted/finished。
    const FINISHED_STATUSES = ['completed', 'submitted', 'finished'];
    const IN_PROGRESS_STATUSES = ['active', 'inprogress', 'started'];
    const matchesStatus =
      submissionFilter === 'all' ||
      (submissionFilter === 'submitted' && FINISHED_STATUSES.includes(a.status)) ||
      (submissionFilter === 'started' && IN_PROGRESS_STATUSES.includes(a.status));

    return matchesSearch && matchesStatus;
  });

  const studentGaugeItems = React.useMemo<StudentGaugeItem[]>(() => {
    return students.map((st) => {
      const isStudentLocked = st.locked_lesson_id === selectedLesson;
      const isOnline = onlineStudentIds.includes(st.id);
      const studentProg = liveClassStudentProgress.find((p) => p.student_id === st.id);
      const progPercent = studentProg?.progress_percent ?? (isOnline ? 59 : 0);
      const hasError = studentErrors.some((e) => e.studentId === st.id);

      return {
        id: st.id,
        name: st.name,
        studentNo: st.student_number,
        focusPercent: progPercent,
        isOnline,
        isLocked: isStudentLocked,
        hasError,
      };
    });
  }, [students, selectedLesson, onlineStudentIds, liveClassStudentProgress, studentErrors]);

  const auditEvents = React.useMemo<AuditEventItem[]>(() => {
    return liveClassFeed.map((f) => {
      let level: AuditEventLevel = 'INFO';
      if (f.type === 'warning' || f.type === 'error') level = 'WARNING';
      else if (f.type === 'checkin' || f.type === 'answer') level = 'ANSWER';
      else if (f.type === 'system') level = 'SYSTEM';
      else if (f.type === 'plugin') level = 'PLUGIN';
      else if (f.type === 'success') level = 'INFO';

      return {
        id: f.id || String(Math.random()),
        time: f.time || new Date().toLocaleTimeString(),
        level,
        message: f.message || '',
      };
    });
  }, [liveClassFeed]);

  const onlineStudentsCount = students.filter((s) => onlineStudentIds.includes(s.id)).length;
  const lockedCount = students.filter((s) => s.locked_lesson_id === selectedLesson).length;
  const averageProgress = React.useMemo(() => {
    const inClassStudents = students.filter((s) => onlineStudentIds.includes(s.id));
    if (inClassStudents.length === 0) return 0;
    const total = inClassStudents.reduce((sum, s) => {
      const p = liveClassStudentProgress.find((prog) => prog.student_id === s.id);
      return sum + (p?.progress_percent ?? 0);
    }, 0);
    return Math.round(total / inClassStudents.length);
  }, [students, onlineStudentIds, liveClassStudentProgress]);

  return (
    <div className="flex-grow flex-1 flex flex-col min-h-0 bg-surface border border-theme rounded-2xl shadow-xl text-main overflow-hidden font-sans">
      {/* 1. Global Navigation Topbar (Stitch Screen 1219a481) */}
      <ClassroomCockpitHeader
        lessonId={selectedLesson}
        lessonTitle={lessons.find((l) => l.id === selectedLesson)?.title}
        classId={liveClassSelectedClassId}
        className={classes.find((c) => c.id === liveClassSelectedClassId)?.name}
        lessons={lessons}
        classes={classes}
        onSelectLesson={(val) => {
          setSelectedLesson(val);
          if (val) fetchElements(val);
        }}
        onSelectClass={(val) => setLiveClassSelectedClassId(val)}
        isClassLocked={isClassLocked}
        lockingClass={lockingClass}
        onToggleClassLock={(locked) => handleToggleClassLock(locked)}
        isStudentWindowOpen={isStudentWindowOpen}
        onOpenStudentWindow={handleOpenStudentWindow}
        studentCount={students.length || 32}
        onlineCount={onlineStudentIds?.length || 1}
        lang={lang as any}
        addToast={addToast}
      />

      {/* 2. Sub-Header: Lesson Phase Stepper & Quick Actions (Stitch Screen 1219a481) */}
      <ClassroomWorkflowSubHeader
        currentStage={classroomStage}
        onStageChange={handleStageChange}
        lang={lang as any}
        lessonId={selectedLesson}
        lessonTitle={lessons.find((l) => l.id === selectedLesson)?.title}
        classId={liveClassSelectedClassId}
        className={classes.find((c) => c.id === liveClassSelectedClassId)?.name}
        students={students}
        addToast={addToast}
        pollSubmissionsCount={24}
        buzzerReadyCount={2}
        countdownSeconds={60}
      />

      {/* 2. Main Stage Router: Switches based on classroomStage */}
      {!selectedLesson ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-455 gap-2.5 select-none bg-surface">
          <Presentation size={38} className="text-slate-300 animate-bounce" style={{ animationDuration: '2.5s' }} />
          <div className="text-sm font-bold text-slate-655">
            {lang === 'zh' ? '请在顶部栏选择一个授课课节' : 'Please select a lesson to start teaching'}
          </div>
          <p className="text-xs text-slate-400">
            {lang === 'zh' ? '课前准备、课中白板、课后小结与简报将在选择课节后就绪' : 'Classroom workflows activate once a lesson is selected.'}
          </p>
        </div>
      ) : classroomStage === 'PRE_CLASS_READY' ? (
        <PreClassReadyView
          selectedLesson={selectedLesson}
          lessonTitle={lessons.find((l) => l.id === selectedLesson)?.title || ''}
          selectedClassId={liveClassSelectedClassId}
          className={classes.find((c) => c.id === liveClassSelectedClassId)?.name || ''}
          students={students}
          onlineStudentIds={Array.from(liveClassAcknowledgedMap.keys())}
          timelineSegments={timelineSegments}
          lang={lang as any}
          isClassLocked={isClassLocked}
          onToggleClassLock={() => handleToggleClassLock(!isClassLocked)}
          onStartClass={() => handleStageChange('IN_CLASS_TEACHING')}
          onPingStudent={() => handleRandomPick()}
          onOpenStudentWindow={handleOpenStudentWindow}
          isStudentWindowOpen={isStudentWindowOpen}
          addToast={addToast}
          onBroadcastNotice={(msg) => {
            setLiveClassFeed((prev) => [
              {
                id: `feed-notice-${Date.now()}`,
                time: new Date().toLocaleTimeString(),
                type: 'checkin',
                message: msg,
              },
              ...prev,
            ]);
          }}
        />
      ) : classroomStage === 'WRAP_UP_EXIT_TICKET' ? (
        <PostClassWrapupView
          selectedLesson={selectedLesson}
          lessonTitle={lessons.find((l) => l.id === selectedLesson)?.title || ''}
          selectedClassId={liveClassSelectedClassId}
          className={classes.find((c) => c.id === liveClassSelectedClassId)?.name || ''}
          students={students}
          lang={lang as any}
          attempts={attempts}
          loadingAttempts={loadingAttempts}
          onFetchAttempts={() => fetchAttempts()}
          onPromoteAttempt={handlePromoteAttempt}
          onViewRaw={(a) => handleViewRaw(a)}
          onAdvanceToReport={() => handleStageChange('ARCHIVED_REPORT')}
          onReturnToTeaching={() => handleStageChange('IN_CLASS_TEACHING')}
          addToast={addToast}
          onBroadcastNotice={(msg) => {
            setLiveClassFeed((prev) => [
              {
                id: `feed-hw-${Date.now()}`,
                time: new Date().toLocaleTimeString(),
                type: 'checkin',
                message: msg,
              },
              ...prev,
            ]);
          }}
        />
      ) : classroomStage === 'ARCHIVED_REPORT' ? (
        <ClassroomBriefingView
          selectedLesson={selectedLesson}
          lessonTitle={lessons.find((l) => l.id === selectedLesson)?.title || ''}
          selectedClassId={liveClassSelectedClassId}
          className={classes.find((c) => c.id === liveClassSelectedClassId)?.name || ''}
          students={students}
          lang={lang as any}
          onReturnToTeaching={() => handleStageChange('IN_CLASS_TEACHING')}
          onReturnToPreClass={() => handleStageChange('PRE_CLASS_READY')}
          addToast={addToast}
        />
      ) : (
        /* classroomStage === 'IN_CLASS_TEACHING' - Stitch Screen 1219a481 Modular Cockpit Architecture */
        <div className="flex-1 flex overflow-hidden min-h-0 bg-surface-secondary/30 relative">
          {/* 3. Left Column: Agenda & Lesson Steps Panel */}
          <ClassroomAgendaPanel
            timelineSegments={timelineSegments}
            activeSegmentId={activeSegmentId}
            onSelectSegment={(seg) => handleStartSegment(seg)}
            isCollapsed={isLeftSidebarCollapsed}
            onToggleCollapse={() => setIsLeftSidebarCollapsed(!isLeftSidebarCollapsed)}
            lang={lang as any}
            timeRemaining={liveClassTimeRemaining}
            setTimeRemaining={setLiveClassTimeRemaining}
            isActive={liveClassIsActive}
            setIsActive={setLiveClassIsActive}
            syncChannel={syncChannelRef.current}
            addToast={addToast}
          />

          {/* 4. Center Main Column: Interactive Canvas, Whiteboard, and Submissions */}
          <ClassroomCanvasArea
            currentTab={middleTab}
            onTabChange={setMiddleTab}
            lang={lang as any}
            isLiveBroadcasterConnected={true}
            studentErrorCount={studentErrors.length}
            onOpenErrorCenter={() => {
              errorStore.getState().setActiveTab('student');
              errorStore.getState().setIsErrorCenterOpen(true);
            }}
            onOpenAttributionTool={() => setIsCanvasAttributionOpen(true)}
            submissionsCount={attempts.length}
            showDemoTaskCard={true}
          >
            {middleTab === 'whiteboard' ? (
              <div className="w-full h-full relative flex flex-col">
                <LazyWhiteboard
                  lessonId={selectedLesson}
                  userRole={'teacher'}
                  isEditMode={false}
                  broadcastFullscreen
                  fullscreenBroadcastClassId={liveClassSelectedClassId}
                  onFullscreenSync={(elId: string | null) => {
                    setLiveClassFullscreenElementId(elId);
                    syncChannelRef.current?.broadcastFullscreen(elId, selectedLesson || undefined);
                  }}
                  elements={elements}
                  activeSegmentId={activeSegmentId}
                  onSegmentSync={(segId: string) => setActiveSegmentId(segId)}
                  onElementAdd={async (type: string, data: any) => {
                    await fetch(`/api/lessons/${selectedLesson}/whiteboard`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ type, data }),
                    });
                    fetchElements(selectedLesson);
                  }}
                  onElementUpdate={async (elementId: string, data: any) => {
                    await fetch(`/api/lessons/${selectedLesson}/whiteboard/${elementId}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ data }),
                    });
                    fetchElements(selectedLesson);
                  }}
                  onElementDelete={async (elementId: string) => {
                    await fetch(`/api/lessons/${selectedLesson}/whiteboard/${elementId}`, {
                      method: 'DELETE',
                    });
                    fetchElements(selectedLesson);
                  }}
                  onRefresh={() => fetchElements(selectedLesson)}
                />
              </div>
            ) : middleTab === 'submissions' ? (
              <div className="flex-grow flex-1 min-h-0 w-full h-full relative rounded-xl overflow-hidden border border-theme shadow-md bg-surface flex flex-col p-4">
                {/* Submissions list view */}
                <div className="flex justify-between items-center mb-4 gap-3 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-main">
                      {lang === 'zh' ? '学生互动提交数据列表' : 'Student Submissions'}
                    </span>
                    {attempts.length > 0 && (
                      <span className="text-xs bg-primary-theme/10 text-primary-theme px-2 py-0.5 rounded-full border border-primary-theme/20 font-bold">
                        {displayAttempts.length} {lang === 'zh' ? '条记录' : 'records'}
                        {displayAttempts.length !== attempts.length && (
                          <span className="ml-1 font-normal opacity-70">/ {attempts.length}</span>
                        )}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Search */}
                    <div className="relative">
                      <input
                        type="text"
                        placeholder={lang === 'zh' ? '搜索学生或课件...' : 'Search student or courseware...'}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="bg-surface border border-theme rounded-lg text-xs pl-8 pr-3 py-1.5 focus:ring-1 focus:ring-primary-theme text-main outline-none w-44 transition-all"
                      />
                      <Search size={12} className="absolute left-2.5 top-2.5 text-muted" />
                    </div>

                    {/* Filter */}
                    <select
                      value={submissionFilter}
                      onChange={(e) => setSubmissionFilter(e.target.value as any)}
                      className="bg-surface border border-theme rounded-lg text-xs px-2.5 py-1.5 text-main outline-none focus:ring-1 focus:ring-primary-theme cursor-pointer"
                    >
                      <option value="all">{lang === 'zh' ? '全部状态' : 'All Status'}</option>
                      <option value="submitted">{lang === 'zh' ? '已提交' : 'Submitted'}</option>
                      <option value="started">{lang === 'zh' ? '进行中' : 'In Progress'}</option>
                    </select>

                    {/* Refresh */}
                    <button
                      onClick={() => fetchAttempts()}
                      className="p-1.5 text-muted hover:text-main hover:bg-surface-secondary rounded-lg border border-theme transition-colors cursor-pointer"
                      title={lang === 'zh' ? '刷新列表' : 'Refresh'}
                    >
                      <RefreshCw size={13} className={loadingAttempts ? 'animate-spin text-primary-theme' : ''} />
                    </button>
                  </div>
                </div>

                <div className="overflow-y-auto flex-1 border border-theme rounded-xl bg-surface-secondary/20">
                  {loadingAttempts ? (
                    <div className="py-12 flex flex-col items-center justify-center text-muted gap-2">
                      <RefreshCw size={24} className="animate-spin text-primary-theme" />
                      <span className="text-xs">{lang === 'zh' ? '正在加载学生提交数据...' : 'Loading submissions...'}</span>
                    </div>
                  ) : displayAttempts.length === 0 ? (
                    <div className="py-12 text-center text-xs text-muted italic">
                      {lang === 'zh' ? '暂无匹配的提交记录。' : 'No matching submissions found.'}
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-surface-secondary/60 text-muted uppercase font-bold sticky top-0 border-b border-theme z-10">
                        <tr>
                          <th className="p-3">{lang === 'zh' ? '学生姓名' : 'Student'}</th>
                          <th className="p-3">{lang === 'zh' ? '课件交互卡片' : 'Courseware'}</th>
                          <th className="p-3 text-center">{lang === 'zh' ? '状态' : 'Status'}</th>
                          <th className="p-3 text-center">{lang === 'zh' ? '得分' : 'Score'}</th>
                          <th className="p-3 text-center">{lang === 'zh' ? '完成进度' : 'Progress'}</th>
                          <th className="p-3 text-right">{lang === 'zh' ? '操作' : 'Actions'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-theme">
                        {displayAttempts.map((a) => {
                          const FINISHED_STATUSES = ['completed', 'submitted', 'finished'];
                          const isFinished = FINISHED_STATUSES.includes(a.status);
                          return (
                            <tr key={a.attemptId} className="hover:bg-surface-secondary/50 transition-colors">
                              <td className="p-3 font-semibold text-main">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 rounded-full bg-primary-theme/10 text-primary-theme flex items-center justify-center text-xs font-bold shrink-0">
                                    {a.studentName?.slice(0, 1) || 'S'}
                                  </div>
                                  <span>{a.studentName}</span>
                                </div>
                              </td>
                              <td className="p-3 text-muted max-w-[180px] truncate" title={a.coursewareName}>
                                {a.coursewareName}
                              </td>
                              <td className="p-3 text-center">
                                <span
                                  className={`px-2 py-0.5 rounded-full border text-xs font-bold ${
                                    isFinished
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300'
                                      : 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-950/40 dark:text-blue-300 animate-pulse'
                                  }`}
                                >
                                  {isFinished
                                    ? lang === 'zh'
                                      ? '已提交'
                                      : 'Finished'
                                    : lang === 'zh'
                                      ? '进行中'
                                      : 'Running'}
                                </span>
                              </td>
                              <td className="p-3 text-center font-bold font-mono">
                                {a.score !== null ? (
                                  <span className="text-primary-theme bg-primary-theme/10 border border-primary-theme/20 px-1.5 py-0.5 rounded-md">
                                    {a.score}分
                                  </span>
                                ) : (
                                  <span className="text-muted font-medium">-</span>
                                )}
                              </td>
                              <td className="p-3 text-center font-semibold font-mono">
                                {a.completion !== null ? `${Math.round(a.completion * 100)}%` : '0%'}
                              </td>
                              <td className="p-3 text-right">
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={() => handleViewRaw(a)}
                                    className="p-1 text-muted hover:text-primary-theme hover:bg-surface-secondary border border-transparent hover:border-theme rounded-lg transition-colors cursor-pointer flex items-center gap-1 text-xs"
                                    title={lang === 'zh' ? '查看提交轨迹事件数据' : 'View Raw Data'}
                                  >
                                    <Eye size={12} />
                                    <span>{lang === 'zh' ? '轨迹' : 'Events'}</span>
                                  </button>

                                  {a.isPromoted > 0 ? (
                                    <span className="px-2 py-1 text-emerald-650 font-bold text-xs flex items-center gap-0.5 bg-emerald-50/50 rounded-lg border border-emerald-100">
                                      <Check size={11} />
                                      {lang === 'zh' ? '已归档' : 'Saved'}
                                    </span>
                                  ) : (
                                    <button
                                      onClick={() => handlePromoteAttempt(a.attemptId)}
                                      disabled={!isFinished}
                                      className={`px-2 py-1 text-xs font-bold rounded-lg flex items-center gap-1 shadow-sm transition-all active:scale-95 cursor-pointer border ${
                                        isFinished
                                          ? 'bg-primary-theme hover:bg-primary-theme-hover text-white border-primary-theme'
                                          : 'bg-surface-secondary text-muted border-theme cursor-not-allowed opacity-60'
                                      }`}
                                      title={
                                        lang === 'zh'
                                          ? '将分数和进度作为随堂学习数据存入数据库，记入学期成绩'
                                          : 'Save to DB & Semester grade'
                                      }
                                    >
                                      <Database size={11} />
                                      <span>{lang === 'zh' ? '录入成绩' : 'Record'}</span>
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            ) : middleTab === 'top_performers' ? (
              <div className="flex-grow flex-1 min-h-0 w-full h-full relative rounded-xl overflow-y-auto border border-theme shadow-md bg-surface flex flex-col p-4">
                <TopPerformersWidget
                  lang={lang as any}
                  lessonId={selectedLesson}
                  classId={liveClassSelectedClassId}
                  lessons={lessons}
                  classes={classes}
                  students={students}
                  addToast={addToast}
                />
              </div>
            ) : (
              <TeacherAssignmentGradePanel
                lessonId={selectedLesson || ''}
                lang={lang === 'zh' ? 'zh' : 'en'}
                addToast={addToast}
              />
            )}
          </ClassroomCanvasArea>

          {/* 5. Right Column: Student Attention & Engagement Console */}
          <ClassroomEngagementConsole
            students={studentGaugeItems}
            events={auditEvents}
            onClearEvents={() => {
              setLiveClassFeed([
                {
                  id: 'clear',
                  time: new Date().toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  }),
                  type: 'info',
                  message: lang === 'zh' ? '反馈流已清空。' : 'Feedback log cleared.',
                },
              ]);
            }}
            onRandomPick={handleRandomPick}
            onPingStudent={(stId, msg) => {
              if (onPingStudent) {
                const st = students.find((s) => s.id === stId);
                const prog = liveClassStudentProgress.find((p) => p.student_id === stId);
                const pct = prog?.progress_percent ?? 0;
                const fullMsg =
                  msg ||
                  (lang === 'zh'
                    ? `⚠️ 学习进度预警：您当前的进度 (${pct}%) 落后于老师的讲解进度。请专注课堂，跟上讲解！`
                    : `⚠️ Progress Alert: Your progress (${pct}%) is behind.`);
                onPingStudent(stId, fullMsg);
                addToast(
                  lang === 'zh' ? '🔔 已发送提醒' : '🔔 Alert Sent',
                  `已向学生 ${st?.name || stId} 发送进度提醒。`,
                  'success',
                );
              }
            }}
            onToggleLockStudent={(stId, currentLocked) => {
              handleToggleStudentLock(stId, currentLocked ? selectedLesson : null);
            }}
            onSelectStudentProfile={(stId) => {
              setSelectedProfileStudentId(stId);
            }}
            totalStudentsCount={students.length}
            onlineStudentsCount={onlineStudentsCount}
            lockedCount={lockedCount}
            averageProgress={averageProgress}
            isDrawing={isDrawing}
            lang={lang as any}
          />
        </div>
      )}

      {/* Raw Data Detail Modal */}
      {selectedAttempt && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden border border-theme animate-in fade-in zoom-in duration-200 text-main">
            {/* Modal Header */}
            <div className="bg-surface-secondary px-6 py-4 border-b border-theme flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="text-primary-theme" size={18} />
                <h3 className="text-sm font-bold text-main">
                  {lang === 'zh'
                    ? `[${selectedAttempt.studentName}] 的互动提交轨迹详情`
                    : `Submission Details - ${selectedAttempt.studentName}`}
                </h3>
              </div>
              <button
                onClick={() => setSelectedAttempt(null)}
                className="text-muted hover:text-main p-1.5 hover:bg-surface-secondary rounded-lg transition-colors cursor-pointer"
              >
                <XCircle size={18} />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto space-y-4 flex-1 scrollbar-thin">
              {/* Summary Cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-surface-secondary p-3 rounded-xl border border-theme">
                  <div className="text-xs text-muted font-bold uppercase tracking-wider">
                    {lang === 'zh' ? '课件名称' : 'Courseware'}
                  </div>
                  <div className="text-xs font-semibold text-main mt-1 truncate" title={selectedAttempt.coursewareName}>
                    {selectedAttempt.coursewareName}
                  </div>
                </div>
                <div className="bg-surface-secondary p-3 rounded-xl border border-theme">
                  <div className="text-xs text-muted font-bold uppercase tracking-wider">
                    {lang === 'zh' ? '提交成绩' : 'Score'}
                  </div>
                  <div className="text-xs font-bold text-primary-theme mt-1">
                    {selectedAttempt.score !== null ? `${selectedAttempt.score} 分` : lang === 'zh' ? '未打分' : 'N/A'}
                  </div>
                </div>
                <div className="bg-surface-secondary p-3 rounded-xl border border-theme">
                  <div className="text-xs text-muted font-bold uppercase tracking-wider">
                    {lang === 'zh' ? '课件完成度' : 'Completion'}
                  </div>
                  <div className="text-xs font-bold text-emerald-600 mt-1">
                    {selectedAttempt.completion !== null ? `${Math.round(selectedAttempt.completion * 100)}%` : '0%'}
                  </div>
                </div>
              </div>

              {/* Event Logs Timeline */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-main border-b border-theme pb-1.5 flex items-center gap-1.5 flex-wrap">
                  <Activity size={13} className="text-primary-theme" />
                  <span>{lang === 'zh' ? '实时捕获轨迹事件流 (LMS Bridge)' : 'LMS Event Captures'}</span>
                </h4>

                {loadingRaw ? (
                  <div className="py-12 flex flex-col items-center justify-center text-muted gap-2">
                    <RefreshCw size={20} className="animate-spin text-primary-theme" />
                    <span className="text-xs">{lang === 'zh' ? '正在查询原始数据...' : 'Loading raw data...'}</span>
                  </div>
                ) : Array.isArray(rawPayload) && rawPayload.length > 0 ? (
                  <div className="space-y-3 font-mono text-xs max-h-[40vh] overflow-y-auto pr-1 scrollbar-thin">
                    {rawPayload.map((evt, idx) => {
                      let parsedPayload = {};
                      try {
                        parsedPayload =
                          typeof evt.payload_json === 'string' ? JSON.parse(evt.payload_json) : evt.payload_json;
                      } catch (e) {}

                      return (
                        <div
                          key={evt.id || idx}
                          className="p-3 bg-slate-900 text-slate-200 rounded-xl border border-slate-800 flex flex-col gap-1.5"
                        >
                          <div className="flex justify-between items-center text-xs text-slate-400 border-b border-slate-800 pb-1">
                            <span className="font-bold text-indigo-400 bg-indigo-950/50 border border-indigo-900/50 px-1.5 py-0.5 rounded">
                              {evt.event_type}
                            </span>
                            <span>{new Date(evt.created_at).toLocaleTimeString()}</span>
                          </div>
                          <pre className="overflow-x-auto text-xs leading-relaxed p-1 text-emerald-400/90 whitespace-pre-wrap word-break-all">
                            {JSON.stringify(parsedPayload, null, 2)}
                          </pre>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-8 text-center text-xs text-muted italic">
                    {lang === 'zh' ? '该学生未产生任何轨迹事件数据。' : 'No trace events captured.'}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-surface-secondary px-6 py-4 border-t border-theme flex justify-between gap-3 shrink-0">
              <div className="text-xs text-muted flex items-center gap-1">
                <Award size={10} />
                <span>Powered by LMS Bridge API v1</span>
              </div>
              <button
                onClick={() => setSelectedAttempt(null)}
                className="px-4 py-1.5 bg-surface hover:bg-surface-secondary border border-theme text-main font-bold rounded-lg text-xs transition-all cursor-pointer shadow-sm active:scale-95"
              >
                {lang === 'zh' ? '关闭窗口' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 学生个人成长雷达与全景档案弹窗 (Stitch Screen 07fd3861 / 1219a481) */}
      {selectedProfileStudentId && (() => {
        const st = students.find((s) => s.id === selectedProfileStudentId);
        if (!st) return null;
        const studentProg = liveClassStudentProgress.find((p) => p.student_id === st.id);
        const progPercent = studentProg?.progress_percent ?? (onlineStudentIds.includes(st.id) ? 59 : 0);
        return (
          <StudentGrowthProfileModal
            isOpen={!!selectedProfileStudentId}
            onClose={() => setSelectedProfileStudentId(null)}
            student={{
              id: st.id,
              name: st.name,
              student_number: st.student_number,
              role: lang === 'zh' ? '组员' : 'Student',
              focusPercentage: progPercent,
            }}
            lessonId={selectedLesson}
            classId={liveClassSelectedClassId}
            lang={lang as any}
            addToast={addToast}
            onInspectSandbox={() => {
              addToast(
                lang === 'zh' ? '打开学生沙箱' : 'Inspect Sandbox',
                `正在调取学生 ${st.name} 的沙箱实例...`,
                'info',
              );
            }}
            onCastStudentScreen={() => {
              addToast(
                lang === 'zh' ? '学生投屏' : 'Screen Cast',
                `已将学生 ${st.name} 的屏幕投射至主演示台`,
                'success',
              );
            }}
            onAwardPoints={(_sId, delta, reason) => {
              addToast(
                lang === 'zh' ? '积分激励' : 'Points Awarded',
                `已向学生 ${st.name} 奖励 +${delta} 积分 (${reason || '课堂积极表现'})`,
                'success',
              );
            }}
          />
        );
      })()}

      {/* 课堂评价归因弹窗 (Triggered from Canvas Active Plugins Dock) */}
      {isCanvasAttributionOpen && (
        <ClassroomAttributionModal
          isOpen={isCanvasAttributionOpen}
          onClose={() => setIsCanvasAttributionOpen(false)}
          lessonId={selectedLesson}
          classId={liveClassSelectedClassId}
          students={students}
          addToast={addToast}
          lang={lang as any}
        />
      )}
    </div>
  );
}
