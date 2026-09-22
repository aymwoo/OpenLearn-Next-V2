import React, { useState, useEffect, useCallback } from 'react';
import {
  LayoutGrid,
  RotateCcw,
  TrendingUp,
  ClipboardList,
  BarChart2,
  BookOpen,
  Calendar as CalendarIcon,
  Award,
  Sparkles,
  Sliders,
  Check,
} from 'lucide-react';
import { StudentDashboardHeader } from './StudentDashboardHeader';
import { StudentRollCallAlarms } from './StudentRollCallAlarms';
import { StudentCourseProgressList } from './StudentCourseProgressList';
import { StudentQuickStats } from './StudentQuickStats';
import { StudentPerformanceCharts } from './StudentPerformanceCharts';
import { StudentSchedulePanel } from './StudentSchedulePanel';
import { StudentAssignmentsPanel } from './StudentAssignmentsPanel';
import { WeeklyProgressTrendChart } from '../../components/WeeklyProgressTrendChart';
import { DashboardWidgetCard } from './components/DashboardWidgetCard';
import { StudentQuickActionsFloatingMenu } from './components/StudentQuickActionsFloatingMenu';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import type { StudentType } from '../../types/app';
import type { DashboardWidgetId, WidgetSize, WidgetLayoutConfig } from './types/dashboardLayout';
import { DEFAULT_WIDGET_LAYOUT, LAYOUT_PRESETS } from './types/dashboardLayout';

export interface StudentDashboardPanelProps {
  students: StudentType[];
  activeStudentId: string | null;
  studentDashboardData: any;
  readNotifications: Set<string>;
  setReadNotifications: (updater: (prev: Set<string>) => Set<string>) => void;
  addToast: (title: string, description: string, type: string) => void;
  lang: 'zh' | 'en';
  setSelectedLesson: (lessonId: string) => void;
  setStudentViewStatus: (status: 'dashboard' | 'lesson' | 'assignment') => void;
  setSelectedAssignment: (ast: any) => void;
  setQuizStudentAnswers: (answers: any) => void;
  setSubAssignmentTab: (tab: string) => void;
}

export function StudentDashboardPanel(props: StudentDashboardPanelProps) {
  const {
    students,
    activeStudentId,
    studentDashboardData,
    readNotifications,
    setReadNotifications,
    addToast,
    lang,
    setSelectedLesson,
    setStudentViewStatus,
    setSelectedAssignment,
    setQuizStudentAnswers,
    setSubAssignmentTab,
  } = props;

  const storageKey = `student_dashboard_layout_v2_${activeStudentId || 'default'}`;

  // Initialize layout configuration
  const [layout, setLayout] = useState<WidgetLayoutConfig[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Ensure all default widget IDs exist in case of schema update
          const existingIds = new Set(parsed.map((item: any) => item.id));
          const missing = DEFAULT_WIDGET_LAYOUT.filter((def) => !existingIds.has(def.id));
          return [...parsed, ...missing];
        }
      }
    } catch {
      // Fallback
    }
    return DEFAULT_WIDGET_LAYOUT;
  });

  const [activePreset, setActivePreset] = useState<string>('default');
  const [draggedWidgetId, setDraggedWidgetId] = useState<DashboardWidgetId | null>(null);

  // Sync to localStorage
  const saveLayout = useCallback(
    (newLayout: WidgetLayoutConfig[]) => {
      setLayout(newLayout);
      try {
        localStorage.setItem(storageKey, JSON.stringify(newLayout));
      } catch {
        // Ignore quota/private mode errors
      }
    },
    [storageKey],
  );

  // Resize widget handler
  const handleResize = (widgetId: DashboardWidgetId, newSize: WidgetSize) => {
    const updated = layout.map((item) => (item.id === widgetId ? { ...item, size: newSize } : item));
    saveLayout(updated);
    addToast?.(
      lang === 'zh' ? '组件尺寸已调整' : 'Widget Resized',
      lang === 'zh' ? `已将组件调整为 ${newSize} 栅格宽度` : `Widget resized to ${newSize}`,
      'info',
    );
  };

  // Move widget position left/right (up/down in array)
  const handleMove = (widgetId: DashboardWidgetId, direction: 'left' | 'right') => {
    const currentIndex = layout.findIndex((item) => item.id === widgetId);
    if (currentIndex === -1) return;

    const targetIndex = direction === 'left' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= layout.length) return;

    const updated = [...layout];
    const [movedItem] = updated.splice(currentIndex, 1);
    updated.splice(targetIndex, 0, movedItem);

    saveLayout(updated);
  };

  // Toggle collapsed state
  const handleToggleCollapse = (widgetId: DashboardWidgetId) => {
    const updated = layout.map((item) =>
      item.id === widgetId ? { ...item, collapsed: !item.collapsed } : item,
    );
    saveLayout(updated);
  };

  // Expand widget if collapsed
  const handleExpandWidget = (widgetId: string) => {
    const target = layout.find((w) => w.id === widgetId);
    if (target && target.collapsed) {
      handleToggleCollapse(widgetId as DashboardWidgetId);
    }
  };

  // HTML5 Drag & Drop handlers
  const handleDragStart = (e: React.DragEvent, widgetId: DashboardWidgetId) => {
    setDraggedWidgetId(widgetId);
    e.dataTransfer.setData('text/plain', widgetId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetWidgetId: DashboardWidgetId) => {
    const sourceId = draggedWidgetId || (e.dataTransfer.getData('text/plain') as DashboardWidgetId);
    if (!sourceId || sourceId === targetWidgetId) {
      setDraggedWidgetId(null);
      return;
    }

    const sourceIndex = layout.findIndex((item) => item.id === sourceId);
    const targetIndex = layout.findIndex((item) => item.id === targetWidgetId);

    if (sourceIndex !== -1 && targetIndex !== -1) {
      const updated = [...layout];
      const [movedItem] = updated.splice(sourceIndex, 1);
      updated.splice(targetIndex, 0, movedItem);
      saveLayout(updated);
      addToast?.(
        lang === 'zh' ? '布局已重排' : 'Layout Reordered',
        lang === 'zh' ? '已成功调整组件展示次序并保存' : 'Widget order updated and saved',
        'success',
      );
    }
    setDraggedWidgetId(null);
  };

  // Preset Application
  const handleApplyPreset = (presetKey: string) => {
    const preset = LAYOUT_PRESETS[presetKey];
    if (preset) {
      setActivePreset(presetKey);
      saveLayout(preset.layout);
      addToast?.(
        lang === 'zh' ? '预设布局已应用' : 'Preset Applied',
        lang === 'zh' ? `已切换至「${preset.label.zh}」` : `Switched to ${preset.label.en}`,
        'success',
      );
    }
  };

  // Reset layout to factory defaults
  const handleResetLayout = () => {
    setActivePreset('default');
    saveLayout(DEFAULT_WIDGET_LAYOUT);
    addToast?.(
      lang === 'zh' ? '已恢复默认布局' : 'Layout Reset',
      lang === 'zh' ? '学生仪表盘已重置为标准栅格排版' : 'Dashboard reset to default grid layout',
      'info',
    );
  };

  // Renderer helper for each widget by ID
  const renderWidgetContent = (widget: WidgetLayoutConfig, index: number) => {
    switch (widget.id) {
      case 'quick-stats':
        return (
          <DashboardWidgetCard
            id="quick-stats"
            key={widget.id}
            title={lang === 'zh' ? '学情概览看板 (Quick Stats)' : 'Learning Quick Stats'}
            subtitle={lang === 'zh' ? '总作业量、平均得分率与出勤概览' : 'Overview of assignments, score & attendance'}
            icon={<BarChart2 size={18} className="text-blue-600" />}
            size={widget.size}
            collapsed={widget.collapsed}
            onResize={(s) => handleResize('quick-stats', s)}
            onMoveLeft={() => handleMove('quick-stats', 'left')}
            onMoveRight={() => handleMove('quick-stats', 'right')}
            isFirst={index === 0}
            isLast={index === layout.length - 1}
            onToggleCollapse={() => handleToggleCollapse('quick-stats')}
            lang={lang}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            isDragging={draggedWidgetId === 'quick-stats'}
          >
            <StudentQuickStats studentDashboardData={studentDashboardData} />
          </DashboardWidgetCard>
        );

      case 'progress-trends':
        return (
          <DashboardWidgetCard
            id="progress-trends"
            key={widget.id}
            title={lang === 'zh' ? '周度学习进度走势 (Progress Trends)' : 'Progress Trends'}
            subtitle={lang === 'zh' ? '成绩走势、历史周均分与目标线' : 'Weekly score trends, targets & analytics'}
            icon={<TrendingUp size={18} className="text-teal-600" />}
            size={widget.size}
            collapsed={widget.collapsed}
            onResize={(s) => handleResize('progress-trends', s)}
            onMoveLeft={() => handleMove('progress-trends', 'left')}
            onMoveRight={() => handleMove('progress-trends', 'right')}
            isFirst={index === 0}
            isLast={index === layout.length - 1}
            onToggleCollapse={() => handleToggleCollapse('progress-trends')}
            lang={lang}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            isDragging={draggedWidgetId === 'progress-trends'}
          >
            <WeeklyProgressTrendChart assignments={studentDashboardData.assignments} lang={lang} />
          </DashboardWidgetCard>
        );

      case 'upcoming-assignments':
        return (
          <DashboardWidgetCard
            id="upcoming-assignments"
            key={widget.id}
            title={lang === 'zh' ? '待办与已交作业 (Upcoming Assignments)' : 'Upcoming Assignments'}
            subtitle={lang === 'zh' ? '包含未交作业提醒、待批改与成绩反馈' : 'Pending & graded assignments'}
            icon={<ClipboardList size={18} className="text-indigo-600" />}
            size={widget.size}
            collapsed={widget.collapsed}
            onResize={(s) => handleResize('upcoming-assignments', s)}
            onMoveLeft={() => handleMove('upcoming-assignments', 'left')}
            onMoveRight={() => handleMove('upcoming-assignments', 'right')}
            isFirst={index === 0}
            isLast={index === layout.length - 1}
            onToggleCollapse={() => handleToggleCollapse('upcoming-assignments')}
            lang={lang}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            isDragging={draggedWidgetId === 'upcoming-assignments'}
          >
            <StudentAssignmentsPanel
              assignments={studentDashboardData.assignments}
              setSelectedAssignment={setSelectedAssignment}
              setStudentViewStatus={setStudentViewStatus}
              setQuizStudentAnswers={setQuizStudentAnswers}
              setSubAssignmentTab={setSubAssignmentTab}
              lang={lang}
            />
          </DashboardWidgetCard>
        );

      case 'course-progress':
        return (
          <DashboardWidgetCard
            id="course-progress"
            key={widget.id}
            title={lang === 'zh' ? '课程学习进度 (Course Progress)' : 'Course Progress'}
            subtitle={lang === 'zh' ? '正在进行的课程完成百分比与快捷进入' : 'Active courses progression'}
            icon={<BookOpen size={18} className="text-emerald-600" />}
            size={widget.size}
            collapsed={widget.collapsed}
            onResize={(s) => handleResize('course-progress', s)}
            onMoveLeft={() => handleMove('course-progress', 'left')}
            onMoveRight={() => handleMove('course-progress', 'right')}
            isFirst={index === 0}
            isLast={index === layout.length - 1}
            onToggleCollapse={() => handleToggleCollapse('course-progress')}
            lang={lang}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            isDragging={draggedWidgetId === 'course-progress'}
          >
            <StudentCourseProgressList
              progress={studentDashboardData.progress}
              setSelectedLesson={setSelectedLesson}
              setStudentViewStatus={setStudentViewStatus}
            />
          </DashboardWidgetCard>
        );

      case 'schedules':
        return (
          <DashboardWidgetCard
            id="schedules"
            key={widget.id}
            title={lang === 'zh' ? '课表与出勤日程 (My Schedule)' : 'Class Schedule & Timetable'}
            subtitle={lang === 'zh' ? '今日授课计划与历史出勤记录' : 'Daily class timetable & attendance'}
            icon={<CalendarIcon size={18} className="text-pink-600" />}
            size={widget.size}
            collapsed={widget.collapsed}
            onResize={(s) => handleResize('schedules', s)}
            onMoveLeft={() => handleMove('schedules', 'left')}
            onMoveRight={() => handleMove('schedules', 'right')}
            isFirst={index === 0}
            isLast={index === layout.length - 1}
            onToggleCollapse={() => handleToggleCollapse('schedules')}
            lang={lang}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            isDragging={draggedWidgetId === 'schedules'}
          >
            <StudentSchedulePanel
              schedules={studentDashboardData.schedules}
              setSelectedLesson={setSelectedLesson}
              setStudentViewStatus={setStudentViewStatus}
            />
          </DashboardWidgetCard>
        );

      case 'academic-trajectory':
        return (
          <DashboardWidgetCard
            id="academic-trajectory"
            key={widget.id}
            title={lang === 'zh' ? '长期学业成长轨迹与评定历史' : 'Academic Growth Trajectory & History'}
            subtitle={lang === 'zh' ? '学期绩点走势、近3月表现与评分时间轴' : 'Semester grade trends & evaluation timeline'}
            icon={<Award size={18} className="text-purple-600" />}
            size={widget.size}
            collapsed={widget.collapsed}
            onResize={(s) => handleResize('academic-trajectory', s)}
            onMoveLeft={() => handleMove('academic-trajectory', 'left')}
            onMoveRight={() => handleMove('academic-trajectory', 'right')}
            isFirst={index === 0}
            isLast={index === layout.length - 1}
            onToggleCollapse={() => handleToggleCollapse('academic-trajectory')}
            lang={lang}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            isDragging={draggedWidgetId === 'academic-trajectory'}
          >
            <StudentPerformanceCharts
              assignments={studentDashboardData.assignments}
              lang={lang}
              hideWeeklyTrend={true}
            />
          </DashboardWidgetCard>
        );

      case 'extension-views':
        return (
          <DashboardWidgetCard
            id="extension-views"
            key={widget.id}
            title={lang === 'zh' ? '扩展应用视图 (Plugin Extensions)' : 'Plugin Extensions'}
            subtitle={lang === 'zh' ? '由教育插件系统注册的自定义组件' : 'Custom components from plugin registry'}
            icon={<Sparkles size={18} className="text-amber-600" />}
            size={widget.size}
            collapsed={widget.collapsed}
            onResize={(s) => handleResize('extension-views', s)}
            onMoveLeft={() => handleMove('extension-views', 'left')}
            onMoveRight={() => handleMove('extension-views', 'right')}
            isFirst={index === 0}
            isLast={index === layout.length - 1}
            onToggleCollapse={() => handleToggleCollapse('extension-views')}
            lang={lang}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            isDragging={draggedWidgetId === 'extension-views'}
          >
            <ExtensionPointRenderer slot="student.view" slotProps={{ studentId: activeStudentId }} />
          </DashboardWidgetCard>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Fixed Top Student Profile Header */}
      <StudentDashboardHeader students={students} activeStudentId={activeStudentId} />

      {/* 2. Roll Call Alert / Alarm Notifications */}
      <StudentRollCallAlarms
        studentDashboardData={studentDashboardData}
        readNotifications={readNotifications}
        setReadNotifications={setReadNotifications}
        activeStudentId={activeStudentId}
        addToast={addToast}
        lang={lang}
      />

      {/* 3. Modular Layout Customization Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl shadow-3xs">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center shrink-0">
            <LayoutGrid size={16} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-slate-800 tracking-tight">
                {lang === 'zh' ? '模块化自适应栅格工作台' : 'Modular CSS Grid Dashboard'}
              </span>
              <span className="text-2xs font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100">
                {layout.length} {lang === 'zh' ? '个自适应组件' : 'Widgets'}
              </span>
            </div>
            <p className="text-2xs text-slate-455">
              {lang === 'zh'
                ? '支持自由拖拽排序、切换 1/3~整行 宽度以及一键折叠展开'
                : 'Drag to reorder, resize from 1/3 to full width, or collapse widgets'}
            </p>
          </div>
        </div>

        {/* Preset Selector & Reset Action */}
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto justify-end">
          <div className="flex items-center bg-white p-0.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 shadow-3xs">
            {Object.entries(LAYOUT_PRESETS).map(([key, config]) => (
              <button
                key={key}
                type="button"
                onClick={() => handleApplyPreset(key)}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer text-2xs ${
                  activePreset === key
                    ? 'bg-indigo-600 text-white shadow-2xs font-extrabold'
                    : 'hover:text-slate-900 text-slate-600'
                }`}
              >
                {lang === 'zh' ? config.label.zh : config.label.en}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleResetLayout}
            title={lang === 'zh' ? '恢复默认布局' : 'Reset to default layout'}
            className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-white rounded-xl border border-transparent hover:border-slate-200 transition-all cursor-pointer shadow-3xs"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>

      {/* 4. Modular CSS Grid Workspace */}
      <div
        id="student-dashboard-modular-grid"
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6 items-start"
      >
        {layout.filter((w) => w.visible).map((widget, index) => renderWidgetContent(widget, index))}
      </div>

      {/* 5. Student Dashboard Quick Actions Floating Menu */}
      <StudentQuickActionsFloatingMenu
        studentDashboardData={studentDashboardData}
        activeStudentId={activeStudentId}
        readNotifications={readNotifications}
        setReadNotifications={setReadNotifications}
        setSelectedLesson={setSelectedLesson}
        setStudentViewStatus={setStudentViewStatus}
        setSelectedAssignment={setSelectedAssignment}
        addToast={addToast}
        lang={lang}
        onExpandWidget={handleExpandWidget}
      />
    </div>
  );
}
export default StudentDashboardPanel;
