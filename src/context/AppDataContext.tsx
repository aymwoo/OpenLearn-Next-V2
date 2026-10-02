/**
 * AppDataContext（C1-R3 / 路线图 C1-R3 P0′）。
 *
 * 目标：消除 App → AppShell → TeacherView/StudentView → tab 组件的 227 props
 * 透传。App 仍是唯一数据源（组装 `AppDataValue` 显式传入），tab 组件经
 * `useAppData()` 消费；不移动任何 state 位置。
 *
 * 类型策略：AppDataValue = 9 个 R2 hooks + 既有 hooks 的 ReturnType 交集
 * （类型直接从实现推导，零漂移）∪ AppExtras（Pick 自 TeacherViewProps 的
 * App 局部 state/派生值）。
 *
 * 重渲染说明：value 为每渲染新对象（依赖即全部数据，useMemo 无效）。全库仅
 * LoginPage 使用 React.memo，各 tab 组件本就随 App 渲染而重渲染，context
 * 传递不劣于现状；未来对重 tab 引入 memo 时再按领域拆分 context。
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { useToast } from '../hooks/useToast';
import type { useSystemData } from '../hooks/useSystemData';
import type { useResourceLibrary } from '../hooks/useResourceLibrary';
import type { useLessonCrud } from '../hooks/useLessonCrud';
import type { useClassOps } from '../hooks/useClassOps';
import type { useStudentViewState } from '../hooks/useStudentViewState';
import type { useStudentOps } from '../hooks/useStudentOps';
import type { useSessionBootstrap } from '../hooks/useSessionBootstrap';
import type { useClassroomLive } from '../hooks/useClassroomLive';
import type { useLabAndSchedule } from '../hooks/useLabAndSchedule';
import type { usePluginManagement } from '../hooks/usePluginManagement';
import type { useAgentChat } from '../hooks/useAgentChat';
import type { useQuizGenerator } from '../hooks/useQuizGenerator';
import type { useCourseWizard } from '../hooks/useCourseWizard';
import type { useClassBatchOperations } from '../hooks/useClassBatchOperations';
import type { useLessonTimeline } from '../hooks/useLessonTimeline';
import type { useStudentNotifications } from '../hooks/useStudentNotifications';
import type { useGradeExport } from '../hooks/useGradeExport';
import type { useLessonFiltering } from '../hooks/useLessonFiltering';
import type { TeacherViewProps } from '../features/teacher/TeacherView';

/** App 局部 state / 派生值：既有的从 TeacherViewProps 精选，其余手写 */
export type AppExtras = Pick<
  TeacherViewProps,
  | 't'
  | 'lessons'
  | 'classes'
  | 'students'
  | 'session'
  | 'whiteboardRef'
  | 'paletteEdit'
  | 'handlePaletteActivate'
  | 'handlePaletteConfirm'
  | 'setPaletteEdit'
  | 'activeSegmentId'
  | 'setActiveSegmentId'
  | 'timelineSegments'
  | 'draggedSegmentIdx'
  | 'setDraggedSegmentIdx'
  | 'saveTimeline'
  | 'editorSaveStatus'
  | 'setEditorSaveStatus'
  | 'editorLastSavedTime'
  | 'setEditorLastSavedTime'
  | 'editorPanelsExpanded'
  | 'setEditorPanelsExpanded'
> & {
  isApprovalsCollapsed: boolean;
  setIsApprovalsCollapsed: (v: boolean) => void;
  isProcessesCollapsed: boolean;
  setIsProcessesCollapsed: (v: boolean) => void;
};

export type AppDataValue = ReturnType<typeof useToast> &
  ReturnType<typeof useSystemData> &
  ReturnType<typeof useResourceLibrary> &
  ReturnType<typeof useLessonCrud> &
  ReturnType<typeof useClassOps> &
  ReturnType<typeof useStudentViewState> &
  ReturnType<typeof useStudentOps> &
  ReturnType<typeof useSessionBootstrap> &
  ReturnType<typeof useClassroomLive> &
  ReturnType<typeof useLabAndSchedule> &
  ReturnType<typeof usePluginManagement> &
  ReturnType<typeof useAgentChat> &
  ReturnType<typeof useQuizGenerator> &
  ReturnType<typeof useCourseWizard> &
  ReturnType<typeof useClassBatchOperations> &
  ReturnType<typeof useLessonTimeline> &
  ReturnType<typeof useStudentNotifications> &
  ReturnType<typeof useGradeExport> &
  ReturnType<typeof useLessonFiltering> &
  AppExtras;

const AppDataContext = createContext<AppDataValue | null>(null);

export function AppDataProvider({ value, children }: { value: AppDataValue; children: ReactNode }) {
  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

/** 消费 App 级数据；必须在 AppDataProvider 内使用 */
export function useAppData(): AppDataValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) {
    throw new Error('useAppData must be used within <AppDataProvider>');
  }
  return ctx;
}
