import React, { lazy, Suspense } from 'react';
import type { ClassTabKey } from './classes/ClassTabs';
import type { Dispatch, SetStateAction, MutableRefObject } from 'react';
import { Loader2 } from 'lucide-react';
import type {
  Lesson,
  ClassType,
  StudentType,
  ScheduleType,
  StudentProgressType,
  AttendanceType,
  AIProvider,
  SessionType,
  ProcessType,
} from '../../types/app';
import { NavigationSidebar } from '../shared/NavigationSidebar';
import { PluginTabPanel } from '../../components/PluginTabPanel';

const Dashboard = lazy(() => import('./Dashboard').then((m) => ({ default: m.Dashboard })));
const LessonEditorView = lazy(() => import('./LessonEditorView').then((m) => ({ default: m.LessonEditorView })));
const LiveClassroomView = lazy(() =>
  import('../../components/LiveClassroomView').then((m) => ({ default: m.LiveClassroomView })),
);
const PluginView = lazy(() => import('./PluginView').then((m) => ({ default: m.PluginView })));
const CourseManagement = lazy(() => import('./CourseManagement').then((m) => ({ default: m.CourseManagement })));
const ClassesView = lazy(() => import('./classes/ClassesView').then((m) => ({ default: m.ClassesView })));
const TimetableView = lazy(() => import('./TimetableView').then((m) => ({ default: m.TimetableView })));
const AdminDirectoryView = lazy(() => import('./AdminDirectoryView').then((m) => ({ default: m.AdminDirectoryView })));
const ComputerLabView = lazy(() => import('./ComputerLabView').then((m) => ({ default: m.ComputerLabView })));
const HelpView = lazy(() => import('./HelpView').then((m) => ({ default: m.HelpView })));

/**
 * TeacherView is the single wrapper for the entire `teacher` branch of App.tsx.
 * TeacherViewProps is a flat composition of every child component's prop bag
 * (mirroring the StudentView precedent). Shared props are typed to the greatest
 * lower bound across the children that declare them, and the few extra
 * identifiers referenced only by App's inline expressions (socketRef,
 * setShowCoursewareHub, fetchTodaySchedules) are added explicitly.
 */
export interface TeacherViewProps {
  // ── NavigationSidebar ───────────────────────────────────────────────
  mainNavCollapsed: boolean;
  setMainNavCollapsed: (v: boolean) => void;
  teacherTab: string;
  setTeacherTab: (tab: string) => void;
  lang: 'zh' | 'en';
  session: SessionType | null;
  todaySchedules: ScheduleType[];

  // ── PluginView ──────────────────────────────────────────────────────
  plugins: any[];
  storeTab: 'logs' | 'store' | 'dev' | 'widgets' | 'community';
  setStoreTab: (tab: any) => void;
  pluginCode: string;
  setPluginCode: (code: string) => void;
  installingPlugin: boolean;
  onInstall: (code: string) => Promise<void>;
  onZipUpload: (
    file: File,
    executionMode: 'worker' | 'inline',
    opts?: { mode?: 'install' | 'update'; targetPluginId?: string; allowDowngrade?: boolean },
  ) => Promise<void>;
  onToggle: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;

  // ── TimetableView ───────────────────────────────────────────────────
  classes: ClassType[];
  lessons: Lesson[];
  onSchedulesUpdated: () => Promise<void>;

  // ── ComputerLabView ─────────────────────────────────────────────────
  computerLabs: any[];
  onRefresh: () => Promise<void>;

  // ── HelpView ────────────────────────────────────────────────────────
  registeredCommands: any[];
  fetchRegisteredCommands: () => void;
}

export function TeacherView(props: TeacherViewProps) {
  const {
    mainNavCollapsed,
    setMainNavCollapsed,
    teacherTab,
    setTeacherTab,
    lang,
    session,
    todaySchedules,
    plugins,
    storeTab,
    setStoreTab,
    pluginCode,
    setPluginCode,
    installingPlugin,
    onInstall,
    onZipUpload,
    onToggle,
    onDelete,
    lessons,
    classes,
    onSchedulesUpdated,
    computerLabs,
    onRefresh,
    registeredCommands,
    fetchRegisteredCommands,
  } = props;

  return (
    <div className="flex-1 overflow-hidden flex bg-gray-50">
      <NavigationSidebar
        mainNavCollapsed={mainNavCollapsed}
        setMainNavCollapsed={setMainNavCollapsed}
        teacherTab={teacherTab}
        setTeacherTab={setTeacherTab}
        lang={lang}
        session={session}
        todaySchedules={todaySchedules}
      />

      <div className="flex-1 p-6 overflow-hidden flex gap-6 relative">
        {/* Phase 9: Dynamic plugin tab content — catch-all for non-hardcoded tabs */}
        {[
          'dashboard',
          'lesson_editor',
          'live_class',
          'plugins',
          'courses',
          'classes',
          'timetable',
          'admin_directory',
          'help',
          'computer_labs',
        ].includes(teacherTab) ? null : (
          <PluginTabPanel activeNavPlugin={teacherTab.includes('/') ? teacherTab.split('/')[0] : null} />
        )}

        <Suspense
          fallback={
            <div className="flex-1 flex flex-col items-center justify-center min-h-[400px] text-slate-400 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
              <span className="text-sm font-medium">加载视图中...</span>
            </div>
          }
        >
          {teacherTab === 'dashboard' ? (
            <Dashboard />
          ) : teacherTab === 'lesson_editor' ? (
            <LessonEditorView />
          ) : teacherTab === 'live_class' ? (
            <div className="flex-grow flex-1 flex flex-col min-h-0 min-w-0">
                            <LiveClassroomView />
            </div>
          ) : teacherTab === 'plugins' ? (
            <PluginView
              plugins={plugins}
              lang={lang}
              storeTab={storeTab}
              setStoreTab={setStoreTab}
              pluginCode={pluginCode}
              setPluginCode={setPluginCode}
              installingPlugin={installingPlugin}
              onInstall={onInstall}
              onZipUpload={onZipUpload}
              onToggle={onToggle}
              onDelete={onDelete}
            />
          ) : teacherTab === 'courses' ? (
            <CourseManagement />
          ) : teacherTab === 'classes' ? (
            <ClassesView />
          ) : teacherTab === 'timetable' ? (
            <TimetableView classes={classes} lessons={lessons} lang={lang} onSchedulesUpdated={onSchedulesUpdated} />
          ) : teacherTab === 'admin_directory' ? (
            <AdminDirectoryView />
          ) : teacherTab === 'computer_labs' ? (
            <ComputerLabView computerLabs={computerLabs} onRefresh={onRefresh} lang={lang} classes={classes} />
          ) : teacherTab === 'help' ? (
            <HelpView registeredCommands={registeredCommands} onRefresh={fetchRegisteredCommands} />
          ) : null}
        </Suspense>
      </div>
    </div>
  );
}
