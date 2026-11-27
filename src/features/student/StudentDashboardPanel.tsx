import React from 'react';
import {
  TrendingUp,
  ClipboardList,
  BarChart2,
  BookOpen,
  Calendar as CalendarIcon,
  Award,
  Sparkles,
} from 'lucide-react';
import { StudentDashboardHeader } from './StudentDashboardHeader';
import { StudentRollCallAlarms } from './StudentRollCallAlarms';
import { StudentCourseProgressList } from './StudentCourseProgressList';
import { StudentQuickStats } from './StudentQuickStats';
import { StudentPerformanceCharts } from './StudentPerformanceCharts';
import { StudentAcademicYearComparison } from './StudentAcademicYearComparison';
import { StudentSchedulePanel } from './StudentSchedulePanel';
import { StudentLearningFocus } from './StudentLearningFocus';

import { StudentAssignmentsPanel } from './StudentAssignmentsPanel';
import { WeeklyProgressTrendChart } from '../../components/WeeklyProgressTrendChart';
import { DashboardWidgetCard } from './components/DashboardWidgetCard';
import { StudentQuickActionsFloatingMenu } from './components/StudentQuickActionsFloatingMenu';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import { useOptionalPluginHost } from '../../plugin-host/plugin-host-context';
import { usePluginHostStore } from '../../plugin-host/plugin-host-store';
import { useStudentActiveSession } from './useStudentActiveSession';
import { StudentActiveClassBanner } from './StudentActiveClassBanner';
import { StudentAssessmentsWidget } from '../assessment/student/StudentAssessmentsWidget';
import { useThemeStore } from '../../store/themeStore';
import type { StudentType } from '../../types/app';
import type { DashboardWidgetId, WidgetLayoutConfig } from './types/dashboardLayout';
import { DEFAULT_WIDGET_LAYOUT } from './types/dashboardLayout';
import {
  isPluginHiddenByPolicy,
  widgetFeatureId,
  type EffectiveStudentUiPolicy,
  type StudentUiFeatureId,
} from '../../../packages/core/student-ui-policy/index';

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
  /** Issue #122：打开「我的测评」全屏视图（缺省时挂件只显示摘要） */
  onOpenAssessments?: () => void;
  /** Gitee Issue IKW5KV：教师配置的生效策略；缺省表示不限制。 */
  studentUiPolicy?: EffectiveStudentUiPolicy | null;
}

const EMPTY_STRING_ARRAY: string[] = [];

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
    onOpenAssessments,
    studentUiPolicy = null,
  } = props;

  const isFeatureVisible = (id: StudentUiFeatureId) =>
    studentUiPolicy === null || studentUiPolicy.features[id] !== false;
  const hideGuidance = studentUiPolicy?.hideGuidance === true;
  const hiddenPluginIds = studentUiPolicy?.hiddenPlugins ?? EMPTY_STRING_ARRAY;
  const hiddenExtensionIds = studentUiPolicy?.hiddenExtensions ?? EMPTY_STRING_ARRAY;

  // Issue #109: 真实进行中的课堂会话（轮询由 StudentView 顶层统一驱动）
  const activeSession = useStudentActiveSession((s) => s.activeSession);

  // 插件扩展卡片在「所有贡献都被隐藏」时自动收起，避免留下空卡片。
  const pluginHost = useOptionalPluginHost();
  const extensionPoints = usePluginHostStore((s) => s.extensionPoints);
  const visibleStudentViewCount = React.useMemo(() => {
    if (!pluginHost) return 1;
    // 直接读 store 的槽位表：extensionPoints 变化本身就会让本组件重渲染
    return (extensionPoints.get('student.view') ?? []).filter(
      (ext) => !isPluginHiddenByPolicy(studentUiPolicy, ext.pluginId, ext.id),
    ).length;
  }, [pluginHost, extensionPoints, studentUiPolicy]);

  const returnToActiveClass = () => {
    if (!activeSession) return;
    setSelectedLesson(activeSession.lessonId);
    setStudentViewStatus('lesson');
  };

  const studentCardColumns = useThemeStore((s) => s.resolvedLayouts.student.cardColumns);

  /**
   * 学生首页固定使用默认布局：不再读取本地保存的自定义顺序/尺寸/折叠状态，
   * 也不再提供预设、拖拽与宽度切换。教师策略只在渲染层过滤。
   */
  const isWidgetAllowed = (widgetId: DashboardWidgetId) =>
    isFeatureVisible(widgetFeatureId(widgetId)) &&
    (widgetId !== 'extension-views' || studentUiPolicy === null || visibleStudentViewCount > 0);

  const visibleLayout: WidgetLayoutConfig[] = DEFAULT_WIDGET_LAYOUT.filter(
    (widget) => widget.visible && isWidgetAllowed(widget.id),
  );

  const hiddenQuickActionKeys: Array<'join-live-session' | 'view-assignments' | 'check-notifications'> = [
    ...(isFeatureVisible('quick-action.join-live-session') ? [] : (['join-live-session'] as const)),
    ...(isFeatureVisible('quick-action.view-assignments') ? [] : (['view-assignments'] as const)),
    ...(isFeatureVisible('quick-action.check-notifications') ? [] : (['check-notifications'] as const)),
  ];

  // Renderer helper for each widget by ID（顺序与尺寸由默认布局固定）
  const renderWidgetContent = (widget: WidgetLayoutConfig) => {
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
            lang={lang}
            hideSubtitle={hideGuidance}
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
            lang={lang}
            hideSubtitle={hideGuidance}
          >
            <WeeklyProgressTrendChart assignments={studentDashboardData.assignments} lang={lang} compact />
          </DashboardWidgetCard>
        );

      case 'assessments':
        return (
          <DashboardWidgetCard
            id="assessments"
            key={widget.id}
            title={lang === 'zh' ? '我的测评 (My Assessments)' : 'My Assessments'}
            subtitle={lang === 'zh' ? '测试 / 考试 / 问卷：待完成与成绩' : 'Quizzes, exams & surveys'}
            icon={<ClipboardList size={18} className="text-indigo-600" />}
            size={widget.size}
            lang={lang}
            hideSubtitle={hideGuidance}
          >
            <StudentAssessmentsWidget lang={lang} onOpen={onOpenAssessments} />
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
            lang={lang}
            hideSubtitle={hideGuidance}
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
            lang={lang}
            hideSubtitle={hideGuidance}
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
            lang={lang}
            hideSubtitle={hideGuidance}
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
            subtitle={
              lang === 'zh' ? '学期绩点走势、近3月表现与评分时间轴' : 'Semester grade trends & evaluation timeline'
            }
            icon={<Award size={18} className="text-purple-600" />}
            size={widget.size}
            lang={lang}
            hideSubtitle={hideGuidance}
          >
            <StudentPerformanceCharts
              assignments={studentDashboardData.assignments}
              lang={lang}
              hideWeeklyTrend={true}
            />
          </DashboardWidgetCard>
        );

      case 'academic-comparison':
        return (
          <DashboardWidgetCard
            id="academic-comparison"
            key={widget.id}
            title={lang === 'zh' ? '多学年综合学业对比' : 'Multi-Year Academic Comparison'}
            subtitle={
              lang === 'zh'
                ? '跨学年作业提交率、均分与课程参与横向对比'
                : 'Cross-year submission rates, grades and course progression'
            }
            icon={<TrendingUp size={18} className="text-teal-600" />}
            size={widget.size}
            lang={lang}
            hideSubtitle={hideGuidance}
          >
            <StudentAcademicYearComparison studentId={activeStudentId || ''} lang={lang} />
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
            lang={lang}
            hideSubtitle={hideGuidance}
          >
            <ExtensionPointRenderer
              slot="student.view"
              excludePluginIds={hiddenPluginIds}
              excludeExtensionIds={hiddenExtensionIds}
              slotProps={{
                studentId: activeStudentId,
                studentName: students.find((s) => s.id === activeStudentId)?.name ?? null,
              }}
            />
          </DashboardWidgetCard>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* 0. Issue #109: 正在进行的课堂 → 醒目返回入口（不受组件布局影响） */}
      {activeSession && (
        <StudentActiveClassBanner activeSession={activeSession} lang={lang} onReturn={returnToActiveClass} />
      )}

      {/* 1. Fixed Top Student Profile Header */}
      <StudentDashboardHeader students={students} activeStudentId={activeStudentId} hideGuidance={hideGuidance} />

      {/* 第三方学生仪表盘顶部激励挂件扩展（每日学习打卡连胜榜 / 积分虚拟商城展位） */}
      {isFeatureVisible('section.hero-widget') && (
        <ExtensionPointRenderer
          slot="student.dashboard.hero_widget"
          excludePluginIds={hiddenPluginIds}
          excludeExtensionIds={hiddenExtensionIds}
          slotProps={{
            studentId: activeStudentId,
            students,
            studentDashboardData,
            lang,
          }}
        />
      )}

      {/* 2. Roll Call Alert / Alarm Notifications */}
      {isFeatureVisible('section.roll-call-alarms') && (
        <StudentRollCallAlarms
          studentDashboardData={studentDashboardData}
          readNotifications={readNotifications}
          setReadNotifications={setReadNotifications}
          activeStudentId={activeStudentId}
          addToast={addToast}
          lang={lang}
        />
      )}

      {/* 3. Issue IKVKVF: 首屏学习路径焦点区（待办 → 最近课节 → 续学），不随栅格布局漂移 */}
      {isFeatureVisible('section.learning-focus') && (
        <StudentLearningFocus
          studentDashboardData={studentDashboardData}
          lang={lang}
          hideGuidance={hideGuidance}
          setSelectedLesson={setSelectedLesson}
          setStudentViewStatus={setStudentViewStatus}
          setSelectedAssignment={setSelectedAssignment}
          setQuizStudentAnswers={setQuizStudentAnswers}
          setSubAssignmentTab={setSubAssignmentTab}
        />
      )}

      {/* 4. 学生首页固定默认布局：不再提供栅格布局工作台（预设/拖拽/尺寸/折叠） */}

      {/* 5. Default CSS Grid Workspace */}
      {visibleLayout.length === 0 ? (
        <div
          data-testid="student-dashboard-empty"
          className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-10 text-center text-sm font-semibold text-slate-500"
        >
          {lang === 'zh' ? '老师已隐藏首屏组件，请等待新的课堂安排' : 'Your teacher has hidden the dashboard widgets.'}
        </div>
      ) : (
        <div
          id="student-dashboard-grid"
          data-card-columns={studentCardColumns}
          className={`grid items-start gap-4 lg:gap-6 ${
            studentCardColumns === 1
              ? 'grid-cols-1'
              : studentCardColumns === 3
                ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
                : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-12'
          }`}
        >
          {visibleLayout.map((widget) => renderWidgetContent(widget))}
        </div>
      )}

      {/* 6. Student Dashboard Quick Actions Floating Menu */}
      {isFeatureVisible('section.floating-quick-actions') && (
        <StudentQuickActionsFloatingMenu
          studentDashboardData={studentDashboardData}
          activeStudentId={activeStudentId}
          readNotifications={readNotifications}
          setReadNotifications={setReadNotifications}
          setSelectedLesson={setSelectedLesson}
          setStudentViewStatus={setStudentViewStatus}
          setSelectedAssignment={setSelectedAssignment}
          addToast={(title: string, description: string, type?: string) => addToast(title, description, type ?? 'info')}
          lang={lang}
          hideGuidance={hideGuidance}
          hiddenQuickActionKeys={hiddenQuickActionKeys}
          hiddenPluginIds={hiddenPluginIds}
          hiddenExtensionIds={hiddenExtensionIds}
        />
      )}
    </div>
  );
}
export default StudentDashboardPanel;
