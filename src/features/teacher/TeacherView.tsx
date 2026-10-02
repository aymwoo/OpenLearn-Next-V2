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

import { useOptionalAppData } from '../../context/AppDataContext';

/**
 * TeacherView is the single routing wrapper for the entire `teacher` branch of App.tsx.
 * C1-R3j: 全部 tab 组件与 NavigationSidebar 均已改经 AppDataContext 取数。
 * TeacherView 自身成为 0 props 的纯路由与布局分发容器。
 */
export interface TeacherViewProps {
  [key: string]: any;
}

export function TeacherView(_props: TeacherViewProps = {}) {
  const appData = useOptionalAppData();
  const teacherTab = _props.teacherTab ?? appData?.teacherTab ?? 'dashboard';

  return (
    <div className="flex-1 overflow-hidden flex bg-gray-50">
      <NavigationSidebar />

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
            <PluginView />
          ) : teacherTab === 'courses' ? (
            <CourseManagement />
          ) : teacherTab === 'classes' ? (
            <ClassesView />
          ) : teacherTab === 'timetable' ? (
            <TimetableView />
          ) : teacherTab === 'admin_directory' ? (
            <AdminDirectoryView />
          ) : teacherTab === 'computer_labs' ? (
            <ComputerLabView />
          ) : teacherTab === 'help' ? (
            <HelpView />
          ) : null}
        </Suspense>
      </div>
    </div>
  );
}
