import { useState, useEffect, useRef, type MutableRefObject } from 'react';
import { getStudentReadNotifications } from '../services/progressService.js';
import { useClassroomLive } from './useClassroomLive';
import { useStudentOps } from './useStudentOps';
import { useStudentNotifications } from './useStudentNotifications';
import { useAgentChat } from './useAgentChat';
import { useAppPolling } from './useAppPolling';
import { useClassroomSocket } from './useClassroomSocket';
import { useLmsBridge } from '../services/lms-bridge';
import { ClassroomSyncChannel } from '../services/classroom-sync-channel';
import { whiteboardViewStore } from '../store/whiteboardViewStore';
import { useAppStore } from '../store/appStore';
import { usePluginHostStore } from '../plugin-host/plugin-host-store';
import { resolveDeclaredCapabilities } from '../plugin-host/capabilities';
import { PluginState } from '../plugin-host/types';
import type { SessionSlice } from './useSessionSlice';
import type { LessonsSlice } from './useLessonsSlice';
import type { FrontendPluginHost } from '../plugin-host/plugin-host';
import type { SessionType } from '../types/app';

import type { useToast } from './useToast';

export interface ClassroomSliceParams {
  lang: 'zh' | 'en';
  t: Record<string, string>;
  addToast: ReturnType<typeof useToast>['addToast'];
  host: FrontendPluginHost;
  session: SessionType | null;
  activeStudentId: SessionSlice['activeStudentId'];
  activeRole: SessionSlice['activeRole'];
  setStudentViewStatus: SessionSlice['setStudentViewStatus'];
  studentViewStatus: 'dashboard' | 'lesson' | 'assignment';
  studentLessonTab: 'whiteboard' | 'courseware' | 'assignment';
  setStudentLessonTab: (tab: 'whiteboard' | 'courseware' | 'assignment') => void;
  setLiveClassFocusLocked: (locked: boolean) => void;
  isStudentLiveMode: boolean;
  isFollowingTeacher: boolean;
  liveStudentParam: string | null;
  fetchStudents: () => Promise<void>;
  fetchLessons: LessonsSlice['fetchLessons'];
  fetchElements: LessonsSlice['fetchElements'];
  fetchClasses: () => Promise<void>;
  fetchClassStudents: LessonsSlice['fetchClassStudents'];
  fetchClassProgress: LessonsSlice['fetchClassProgress'];
  fetchClassDashboard: LessonsSlice['fetchClassDashboard'];
  fetchLiveClassStudentProgress: LessonsSlice['fetchLiveClassStudentProgress'];
  setLiveClassStudentProgress: LessonsSlice['setLiveClassStudentProgress'];
  fetchRegisteredCommands: LessonsSlice['fetchRegisteredCommands'];
  fetchVfs: LessonsSlice['fetchVfs'];
  fetchProcesses: LessonsSlice['fetchProcesses'];
  fetchProcessLogs: LessonsSlice['fetchProcessLogs'];
  fetchTodaySchedules: LessonsSlice['fetchTodaySchedules'];
  fetchLabs: LessonsSlice['fetchLabs'];
  fetchPlugins: LessonsSlice['fetchPlugins'];
  fetchEvents: LessonsSlice['fetchEvents'];
  fetchApprovals: LessonsSlice['fetchApprovals'];
  showProcessLogs: LessonsSlice['showProcessLogs'];
  currentVfsParent: string | null;
  expandedClassId: string | null;
  activeSegmentId: LessonsSlice['activeSegmentId'];
  setActiveSegmentId: LessonsSlice['setActiveSegmentId'];
  quizStudentAnswersRef: MutableRefObject<any>;
  effectiveAgentProviderId: string;
  plugins: Array<{
    id: string;
    name: string;
    version?: string;
    status: string;
    has_frontend?: boolean;
    manifest: string;
  }>;
}

/**
 * 课堂实时域切片（useAppComposer 按域拆分之三）：实时互动、学生同步、
 * AI 助教、轮询与 Socket。
 *
 * 行为与拆分前 useAppComposer 内联实现逐行一致，仅做物理搬运。
 */
export function useClassroomSlice(params: ClassroomSliceParams) {
  const {
    lang,
    t,
    addToast,
    host,
    session,
    activeStudentId,
    activeRole,
    setStudentViewStatus,
    studentViewStatus,
    studentLessonTab,
    setStudentLessonTab,
    setLiveClassFocusLocked,
    isStudentLiveMode,
    isFollowingTeacher,
    liveStudentParam,
    fetchStudents,
    fetchLessons,
    fetchElements,
    fetchClasses,
    fetchClassStudents,
    fetchClassProgress,
    fetchClassDashboard,
    fetchLiveClassStudentProgress,
    setLiveClassStudentProgress,
    fetchRegisteredCommands,
    fetchVfs,
    fetchProcesses,
    fetchProcessLogs,
    fetchTodaySchedules,
    fetchLabs,
    fetchPlugins,
    fetchEvents,
    fetchApprovals,
    showProcessLogs,
    currentVfsParent,
    expandedClassId,
    activeSegmentId,
    setActiveSegmentId,
    quizStudentAnswersRef,
    effectiveAgentProviderId,
    plugins,
  } = params;

  const [localProgressPercent, setLocalProgressPercent] = useState<number>(0);

  // ── C1-R2f: 实时课堂互动横幅/动态流/在线名册 ─────────────────────────────
  const classroomLiveData = useClassroomLive();
  const {
    pickedAlertData,
    setPickedAlertData,
    pickedAnnouncement,
    setPickedAnnouncement,
    liveClassTimeRemaining,
    setLiveClassTimeRemaining,
    liveClassFeed,
    setLiveClassFeed,
    liveClassAcknowledgedMap,
    setLiveClassAcknowledgedMap,
    onlineStudentIds,
    setOnlineStudentIds,
    activeStudentLessons,
    setActiveStudentLessons,
  } = classroomLiveData;
  const liveClassSelectedClassId = useAppStore((s) => s.liveClassSelectedClassId);
  const setLiveClassSelectedClassId = useAppStore((s) => s.setLiveClassSelectedClassId);
  const liveClassIsActive = useAppStore((s) => s.liveClassIsActive);
  const setLiveClassIsActive = useAppStore((s) => s.setLiveClassIsActive);
  const selectedLesson = useAppStore((s) => s.selectedLesson);
  const setSelectedLesson = useAppStore((s) => s.setSelectedLesson);
  const setLessons = useAppStore((s) => s.setLessons);
  const students = useAppStore((s) => s.students);

  // ── C1-R2d: 学生域 hooks ─────────────────────────────────────────────────
  const studentOpsData = useStudentOps({
    activeStudentId,
    activeRole,
    selectedLesson,
    students,
    quizStudentAnswersRef,
    setStudentViewStatus,
  });
  const {
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
  } = studentOpsData;

  const [rosterSearchQuery, setRosterSearchQuery] = useState('');
  const [rosterTagFilter, setRosterTagFilter] = useState<'all' | 'Academic' | 'Behavioral' | 'General' | 'SpecialCare'>(
    'all',
  );
  const [rosterViewMode, setRosterViewMode] = useState<'grid' | 'list'>('grid');
  const [classSubmissionFilters, setClassSubmissionFilters] = useState<
    Record<string, 'all' | 'submitted' | 'graded' | 'pending'>
  >({});
  const [classActiveTabs, setClassActiveTabs] = useState<Record<string, string>>({});
  const [studentActiveTabs, setStudentActiveTabs] = useState<Record<string, 'progress' | 'settings' | 'notes'>>({});

  // ── Hook: 学者通知系统 ──
  const studentNotificationsHook = useStudentNotifications(activeRole, studentDashboardData, lang);
  const {
    studentNotifications,
    unreadNotifications,
    readNotifications,
    setReadNotifications,
    selectedNotificationForModal,
    setSelectedNotificationForModal,
    isNotificationsOpen,
    setIsNotificationsOpen,
  } = studentNotificationsHook;

  useEffect(() => {
    if (activeStudentId) {
      getStudentReadNotifications(activeStudentId)
        .then(({ ok, data }) => {
          setReadNotifications(ok && Array.isArray(data) ? new Set(data) : new Set());
        })
        .catch((err) => {
          console.warn('Failed to load read notifications from DB', err);
          setReadNotifications(new Set());
        });
    }
  }, [activeStudentId]);

  const activatingPluginsRef = useRef<Set<string>>(new Set());

  // Synchronize backend active plugins to frontend PluginHost
  useEffect(() => {
    if (!host.isInitialized() || plugins.length === 0) return;

    const store = usePluginHostStore.getState();

    // 1. Activate active plugins (re-activate when version changes after in-place update)
    const activePluginsFromServer = plugins.filter((p) => p.status === 'active');
    for (const plugin of activePluginsFromServer) {
      if (!plugin.has_frontend) {
        continue;
      }
      if (activatingPluginsRef.current.has(plugin.id)) {
        continue;
      }
      const localPlugin = store.activePlugins.find((p) => p.id === plugin.id);
      const versionChanged = !!(localPlugin && plugin.version && localPlugin.version !== plugin.version);
      const needsActivate =
        !localPlugin ||
        versionChanged ||
        (localPlugin.state !== PluginState.ACTIVE && localPlugin.state !== PluginState.ACTIVATING);

      if (!needsActivate) continue;

      activatingPluginsRef.current.add(plugin.id);
      const startActivate = () => {
        if (!store.activePlugins.find((p) => p.id === plugin.id)) {
          store.addPlugin({
            id: plugin.id,
            name: plugin.name,
            version: plugin.version ?? '',
            state: PluginState.INSTALLED,
            executionMode: 'inline',
            // Worker 模式激活时，ServiceHost Barrier 2 依赖这份能力声明来
            // 决定是否放行非 get* 方法；缺失则回退为空数组（只读）。
            capabilitiesProposed: resolveDeclaredCapabilities(plugin),
          });
        } else if (versionChanged) {
          // Keep store entry but refresh version stamp
          try {
            const declaredCapabilities = resolveDeclaredCapabilities(plugin);
            usePluginHostStore.setState((s) => ({
              activePlugins: s.activePlugins.map((p) =>
                p.id === plugin.id
                  ? { ...p, version: plugin.version ?? '', name: plugin.name, capabilitiesProposed: declaredCapabilities }
                  : p,
              ),
            }));
          } catch {
            /* ignore */
          }
        }
        try {
          const manifest = JSON.parse(plugin.manifest);
          host
            .activateRemotePlugin(plugin.id, manifest)
            .catch((err) => {
              console.error(`[App] Failed to activate remote plugin "${plugin.name}":`, err);
            })
            .finally(() => {
              activatingPluginsRef.current.delete(plugin.id);
            });
        } catch (e) {
          activatingPluginsRef.current.delete(plugin.id);
          console.error(`[App] Failed to parse manifest for plugin "${plugin.name}":`, e);
        }
      };

      if (localPlugin && localPlugin.state === PluginState.ACTIVE && versionChanged) {
        host
          .deactivatePlugin(plugin.id)
          .catch(() => {})
          .finally(startActivate);
      } else {
        startActivate();
      }
    }

    // 2. Deactivate deactivated plugins
    const deactivatedPluginsFromServer = plugins.filter((p) => p.status !== 'active');
    for (const plugin of deactivatedPluginsFromServer) {
      if (!plugin.has_frontend) {
        continue;
      }
      const localPlugin = store.activePlugins.find((p) => p.id === plugin.id);
      if (localPlugin && localPlugin.state === PluginState.ACTIVE) {
        host.deactivatePlugin(plugin.id).catch((err) => {
          console.error(`[App] Failed to deactivate remote plugin "${plugin.name}":`, err);
        });
      }
    }
  }, [plugins, host]);
  // Initialize dashboard widget visibility — defaults to true for active plugins
  // Persisted visibility is hydrated from localStorage in the store itself.
  useEffect(() => {
    if (!host.isInitialized() || plugins.length === 0) return;
    const store = usePluginHostStore.getState();
    for (const plugin of plugins) {
      if (plugin.status !== 'active') continue;
      if (!store.dashboardVisibility.has(plugin.id)) {
        store.setDashboardVisibility(plugin.id, true);
      }
    }
  }, [plugins, host]);

  useEffect(() => {
    if (liveClassSelectedClassId && selectedLesson) {
      fetchLiveClassStudentProgress(liveClassSelectedClassId, selectedLesson);
    } else {
      setLiveClassStudentProgress([]);
    }
  }, [liveClassSelectedClassId, selectedLesson]);

  useEffect(() => {
    if (liveClassSelectedClassId) {
      fetchClassStudents(liveClassSelectedClassId);
    }
  }, [liveClassSelectedClassId]);

  useLmsBridge(session);

  const agentChatData = useAgentChat({
    lang,
    t,
    selectedLesson,
    effectiveAgentProviderId,
    expandedClassId,
    fetchLessons,
    fetchClasses,
    fetchStudents,
    fetchClassStudents,
    fetchClassProgress,
    fetchClassDashboard,
    fetchElements,
  });
  const {
    personaId,
    setPersonaId,
    chatLog,
    setChatLog,
    input,
    setInput,
    loading,
    setLoading,
    chatAttachments,
    setChatAttachments,
    handleChatFileChange,
    handleChatDrop,
    handleSend,
    handleClearAgentMemory,
  } = agentChatData;

  useAppPolling({
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
  });

  const { socketRef } = useClassroomSocket({
    session,
    host,
    activeRole,
    activeStudentId,
    selectedLesson,
    activeSegmentId,
    studentViewStatus,
    lang,
    students,
    addToast,
    setOnlineStudentIds,
    setActiveStudentLessons,
    setLessons,
    setActiveSegmentId,
    setLiveClassStudentProgress,
    setLiveClassAcknowledgedMap,
    setLiveClassFeed,
    setSelectedLesson,
    setStudentViewStatus,
    studentLessonTab,
    setStudentLessonTab,
    selectedAssignment,
    setSelectedAssignment,
    setLocalProgressPercent,
    fetchStudentDashboard,
    fetchStudents,
    fetchElements,
    setPickedAlertData,
    setPickedAnnouncement,
  });

  return {
    localProgressPercent,
    setLocalProgressPercent,
    classroomLiveData,
    pickedAlertData,
    setPickedAlertData,
    pickedAnnouncement,
    setPickedAnnouncement,
    liveClassTimeRemaining,
    setLiveClassTimeRemaining,
    liveClassFeed,
    setLiveClassFeed,
    liveClassAcknowledgedMap,
    setLiveClassAcknowledgedMap,
    onlineStudentIds,
    setOnlineStudentIds,
    activeStudentLessons,
    setActiveStudentLessons,
    liveClassSelectedClassId,
    setLiveClassSelectedClassId,
    liveClassIsActive,
    setLiveClassIsActive,
    studentOpsData,
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
    rosterSearchQuery,
    setRosterSearchQuery,
    rosterTagFilter,
    setRosterTagFilter,
    rosterViewMode,
    setRosterViewMode,
    classSubmissionFilters,
    setClassSubmissionFilters,
    classActiveTabs,
    setClassActiveTabs,
    studentActiveTabs,
    setStudentActiveTabs,
    studentNotificationsHook,
    studentNotifications,
    unreadNotifications,
    readNotifications,
    setReadNotifications,
    selectedNotificationForModal,
    setSelectedNotificationForModal,
    isNotificationsOpen,
    setIsNotificationsOpen,
    agentChatData,
    personaId,
    setPersonaId,
    chatLog,
    setChatLog,
    input,
    setInput,
    loading,
    setLoading,
    chatAttachments,
    setChatAttachments,
    handleChatFileChange,
    handleChatDrop,
    handleSend,
    handleClearAgentMemory,
    socketRef,
  };
}

export type ClassroomSlice = ReturnType<typeof useClassroomSlice>;
