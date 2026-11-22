import React, { useState, type ComponentProps, type RefObject } from 'react';
import { Presentation, ChevronRight, Activity, AlertTriangle, Trophy, Sparkles } from 'lucide-react';
import { LazyWhiteboard } from '../../components/LazyWhiteboard';
import type { WhiteboardHandle } from '../whiteboard/InteractiveWhiteboard';
import { TeacherAssignmentGradePanel } from '../../components/TeacherAssignmentGradePanel';
import { TopPerformersWidget } from '../teacher/TopPerformersWidget';
import { normalizeSegmentType } from '../../../packages/core/plugin-host/mode-pack';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import {
  isModePacksEnabled,
  WhiteboardHostBridgeProvider,
  WhiteboardModeWorkspace,
  type WhiteboardHostBridgeValue,
} from './mode-pack';
import { LiveSubmissionsPanel, type LiveSubmissionsPanelProps } from './LiveSubmissionsPanel';
import { errorStore } from '../../store/errorStore';
import type { TeacherMiddleTab } from './map-teacher-middle-tab';
import type { ClassroomFlowController } from '../../plugin-host/types';
import type { Lesson, ClassType, StudentType } from '../../store/appStore';

type LazyWhiteboardProps = ComponentProps<typeof LazyWhiteboard>;
type TopPerformersAddToast = NonNullable<ComponentProps<typeof TopPerformersWidget>['addToast']>;

export type LiveClassroomMiddleWorkspaceProps = LiveSubmissionsPanelProps & {
  isLeftSidebarCollapsed: boolean;
  setIsLeftSidebarCollapsed: (v: boolean) => void;
  middleTab: TeacherMiddleTab;
  hasSegmentMainExtension: boolean;
  currentActiveSegment: { id: string; title?: string; type?: string } | undefined;
  studentErrors: { studentId?: string }[];
  isSocketConnected: boolean;
  onFinishTeaching: () => void;
  teacherWhiteboardBridge: WhiteboardHostBridgeValue;
  segmentMainFlowController: ClassroomFlowController;
  onWhiteboardRefresh: () => void;
  whiteboardRef: RefObject<WhiteboardHandle | null>;
  restoredCurrentPage: number | undefined;
  onFullscreenSync: NonNullable<LazyWhiteboardProps['onFullscreenSync']>;
  elements: LazyWhiteboardProps['elements'];
  activeSegmentId: string | null;
  onSegmentSync: NonNullable<LazyWhiteboardProps['onSegmentSync']>;
  classroomTools: LazyWhiteboardProps['classroomTools'];
  onExecuteTool: NonNullable<LazyWhiteboardProps['onExecuteTool']>;
  onPagesStateChange: NonNullable<LazyWhiteboardProps['onPagesStateChange']>;
  onElementAdd: NonNullable<LazyWhiteboardProps['onElementAdd']>;
  onElementUpdate: NonNullable<LazyWhiteboardProps['onElementUpdate']>;
  onElementDelete: NonNullable<LazyWhiteboardProps['onElementDelete']>;
  lessons: Lesson[];
  classes: ClassType[];
  students: StudentType[];
  addToast: TopPerformersAddToast;
  fetchElements: (lessonId: string) => void;
  /** 白板课：中栏默认只有画布，「课堂面板」里再打开提交、成绩和榜单。 */
  compact?: boolean;
};

export function LiveClassroomMiddleWorkspace(props: LiveClassroomMiddleWorkspaceProps) {
  const {
    selectedLesson,
    isLeftSidebarCollapsed,
    setIsLeftSidebarCollapsed,
    middleTab,
    setMiddleTab,
    lang,
    hasSegmentMainExtension,
    currentActiveSegment,
    studentErrors,
    isSocketConnected,
    onFinishTeaching,
    teacherWhiteboardBridge,
    liveClassSelectedClassId,
    segmentMainFlowController,
    onWhiteboardRefresh,
    whiteboardRef,
    restoredCurrentPage,
    onFullscreenSync,
    elements,
    activeSegmentId,
    onSegmentSync,
    classroomTools,
    onExecuteTool,
    onPagesStateChange,
    onElementAdd,
    onElementUpdate,
    onElementDelete,
    fetchElements,
    lessons,
    classes,
    students,
    addToast,
    compact = false,
    ...submissionsProps
  } = props;
  const [panelsOpen, setPanelsOpen] = useState(false);

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-surface-secondary/40 p-3 gap-3 relative">
      {selectedLesson ? (
        <div className="w-full h-full relative flex flex-col min-h-0">
          <div className="flex justify-between items-center px-1.5 py-1 select-none text-muted text-xs uppercase font-extrabold tracking-wide shrink-0 mb-1">
            <div className="flex items-center gap-3">
              {isLeftSidebarCollapsed && (
                <button
                  onClick={() => setIsLeftSidebarCollapsed(false)}
                  className="p-1 rounded-lg bg-surface hover:bg-surface-secondary border border-theme text-primary-ink hover:text-primary-ink-hover transition-colors cursor-pointer mr-1.5 flex items-center gap-1 shadow-sm"
                  title={lang === 'zh' ? '展开环节大纲' : 'Expand Sidebar'}
                >
                  <ChevronRight size={10} />
                  <span className="text-xs font-bold tracking-wider">{lang === 'zh' ? '展开' : 'Expand'}</span>
                </button>
              )}
              {compact ? (
                <div className="relative">
                  <button
                    type="button"
                    data-testid="teacher-whiteboard-panels"
                    aria-expanded={panelsOpen}
                    aria-controls="teacher-whiteboard-panel-menu"
                    onClick={() => setPanelsOpen((open) => !open)}
                    className="px-3 py-1 rounded-full text-xs font-medium cursor-pointer bg-surface border border-theme text-main"
                  >
                    {lang === 'zh' ? '课堂面板' : 'Class panels'}
                  </button>
                  <div
                    id="teacher-whiteboard-panel-menu"
                    data-testid="teacher-whiteboard-panel-menu"
                    data-open={panelsOpen ? 'true' : 'false'}
                    hidden={!panelsOpen}
                    className="absolute z-20 mt-1 flex min-w-40 flex-col gap-1 rounded-xl border border-theme bg-surface p-2 shadow-md"
                  >
                    {panelsOpen ? (
                      <>
                        <button
                          type="button"
                          className="text-left text-xs font-medium px-2 py-1 rounded-md hover:bg-surface-secondary cursor-pointer"
                          onClick={() => {
                            setMiddleTab('whiteboard');
                            setPanelsOpen(false);
                          }}
                        >
                          {lang === 'zh' ? '演示白板' : 'Whiteboard'}
                        </button>
                        <button
                          type="button"
                          className="text-left text-xs font-medium px-2 py-1 rounded-md hover:bg-surface-secondary cursor-pointer"
                          onClick={() => {
                            setMiddleTab('submissions');
                            setPanelsOpen(false);
                          }}
                        >
                          {lang === 'zh' ? '学生提交数据' : 'Student Submissions'}
                        </button>
                        <button
                          type="button"
                          id="teacher_assignment_eval_tab_btn"
                          className="text-left text-xs font-medium px-2 py-1 rounded-md hover:bg-surface-secondary cursor-pointer"
                          onClick={() => {
                            setMiddleTab('assignment');
                            setPanelsOpen(false);
                          }}
                        >
                          {lang === 'zh' ? '作业成绩评定' : 'Assignment Grades'}
                        </button>
                        <button
                          type="button"
                          id="teacher_top_performers_tab_btn"
                          data-testid="teacher-top-performers-tab-btn"
                          className="text-left text-xs font-medium px-2 py-1 rounded-md hover:bg-surface-secondary cursor-pointer"
                          onClick={() => {
                            setMiddleTab('top_performers');
                            setPanelsOpen(false);
                          }}
                        >
                          {lang === 'zh' ? '随堂测验榜' : 'Top Performers'}
                        </button>
                        {hasSegmentMainExtension && currentActiveSegment ? (
                          <button
                            type="button"
                            id="teacher_active_segment_main_tab_btn"
                            data-testid="teacher-active-segment-main-tab-btn"
                            className="text-left text-xs font-medium px-2 py-1 rounded-md hover:bg-surface-secondary cursor-pointer"
                            onClick={() => {
                              setMiddleTab('segment_main');
                              setPanelsOpen(false);
                            }}
                          >
                            {lang === 'zh'
                              ? currentActiveSegment.title || '环节工作区'
                              : currentActiveSegment.title || 'Segment Workspace'}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="text-left text-xs font-medium px-2 py-1 rounded-md hover:bg-surface-secondary cursor-pointer"
                          onClick={() => {
                            setPanelsOpen(false);
                            onFinishTeaching();
                          }}
                        >
                          {lang === 'zh' ? '完成授课，进入课后' : 'Finish Teaching → Post-Class'}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="bg-surface-secondary p-0.5 rounded-lg flex items-center gap-1 border border-theme">
                  <button
                    onClick={() => setMiddleTab('whiteboard')}
                    className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                      middleTab === 'whiteboard'
                        ? 'bg-surface text-primary-ink shadow-sm'
                        : 'text-muted hover:text-main'
                    }`}
                  >
                    {lang === 'zh' ? '💻 演示白板' : '💻 Whiteboard'}
                  </button>
                  <button
                    onClick={() => setMiddleTab('submissions')}
                    className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                      middleTab === 'submissions'
                        ? 'bg-surface text-primary-ink shadow-sm'
                        : 'text-muted hover:text-main'
                    }`}
                  >
                    {lang === 'zh' ? '📊 学生提交数据' : '📊 Student Submissions'}
                  </button>
                  <button
                    id="teacher_assignment_eval_tab_btn"
                    onClick={() => setMiddleTab('assignment')}
                    className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                      middleTab === 'assignment'
                        ? 'bg-surface text-primary-ink shadow-sm'
                        : 'text-muted hover:text-main'
                    }`}
                  >
                    {lang === 'zh' ? '🎓 作业成绩评定' : '🎓 Assignment Grades'}
                  </button>
                  <button
                    id="teacher_top_performers_tab_btn"
                    data-testid="teacher-top-performers-tab-btn"
                    onClick={() => setMiddleTab('top_performers')}
                    className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                      middleTab === 'top_performers'
                        ? 'bg-surface text-amber-700 dark:text-amber-400 shadow-sm'
                        : 'text-muted hover:text-main'
                    }`}
                  >
                    <Trophy size={12} className="text-amber-700 dark:text-amber-400" />
                    <span>{lang === 'zh' ? '🏆 随堂测验榜' : '🏆 Top Performers'}</span>
                  </button>
                  {hasSegmentMainExtension && currentActiveSegment && (
                    <button
                      id="teacher_active_segment_main_tab_btn"
                      data-testid="teacher-active-segment-main-tab-btn"
                      onClick={() => setMiddleTab('segment_main')}
                      className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                        middleTab === 'segment_main'
                          ? 'bg-surface text-primary-theme shadow-sm'
                          : 'text-muted hover:text-main'
                      }`}
                    >
                      <Sparkles size={12} className="text-primary-theme" />
                      <span>
                        {lang === 'zh'
                          ? `🧩 ${currentActiveSegment.title || '环节工作区'}`
                          : `🧩 ${currentActiveSegment.title || 'Segment Workspace'}`}
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {studentErrors.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    errorStore.getState().setActiveTab('student');
                    errorStore.getState().setIsErrorCenterOpen(true);
                  }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-800 hover:bg-rose-100 transition-colors cursor-pointer mr-1"
                  title={lang === 'zh' ? '点击查看学生端异常诊断日志' : 'View Student Client Errors'}
                >
                  <AlertTriangle size={12} className="text-rose-700 dark:text-rose-400 animate-pulse" />
                  <span>
                    {lang === 'zh'
                      ? `学生端异常 (${studentErrors.length})`
                      : `Student Errors (${studentErrors.length})`}
                  </span>
                </button>
              )}
              <span
                data-testid="live-broadcaster-status"
                className={`font-mono tracking-widest flex items-center gap-1 ${
                  isSocketConnected ? 'text-primary-ink animate-pulse' : 'text-amber-600 dark:text-amber-400'
                }`}
                title={
                  isSocketConnected
                    ? lang === 'zh'
                      ? '实时广播信令通道已连接'
                      : 'Socket.IO real-time broadcaster connected'
                    : lang === 'zh'
                      ? '实时信令连接断开/重连中，将自动恢复'
                      : 'Socket.IO disconnected / reconnecting'
                }
              >
                <Activity size={10} /> {isSocketConnected ? 'Live Broadcaster Connected' : 'Broadcaster Reconnecting'}
              </span>
              {compact ? null : (
                <button
                  type="button"
                  onClick={() => onFinishTeaching()}
                  className="ml-2 px-3 py-1 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-xs cursor-pointer hover:shadow-md transition-all active:scale-95"
                >
                  <span>{lang === 'zh' ? '完成授课，进入课后' : 'Finish Teaching → Post-Class'}</span>
                  <ChevronRight size={12} />
                </button>
              )}
            </div>
          </div>

          {middleTab === 'whiteboard' ? (
            <>
              {!compact && hasSegmentMainExtension && currentActiveSegment && (
                <div
                  data-testid="classroom-active-segment-main-hint"
                  className="flex items-center justify-between px-3 py-1.5 bg-primary-theme/10 border border-primary-theme/20 rounded-lg text-xs text-primary-theme shrink-0"
                >
                  <span className="flex items-center gap-1.5 font-medium truncate">
                    <Sparkles size={13} className="shrink-0" />
                    <span>
                      {lang === 'zh'
                        ? `当前环节「${currentActiveSegment.title}」已配备专属互动工作区`
                        : `Current segment "${currentActiveSegment.title}" has a dedicated interactive workspace`}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setMiddleTab('segment_main')}
                    className="px-2.5 py-0.5 bg-primary-theme text-white rounded-md font-bold hover:bg-primary-theme-hover cursor-pointer text-xs shrink-0 transition-colors shadow-xs"
                  >
                    {lang === 'zh' ? '切换至环节工作区' : 'Switch to Workspace'}
                  </button>
                </div>
              )}
              {/* Whiteboard canvas wrapper — flag 开时走 Mode Pack 工作区，契约与旧路径一致 */}
              <div className="flex-grow flex-1 min-h-0 w-full relative rounded-xl overflow-hidden border border-theme shadow-md bg-surface flex flex-col">
                {isModePacksEnabled() ? (
                  <WhiteboardHostBridgeProvider value={teacherWhiteboardBridge}>
                    <WhiteboardModeWorkspace
                      segment={
                        currentActiveSegment
                          ? {
                              ...currentActiveSegment,
                              type: normalizeSegmentType((currentActiveSegment as { type?: string }).type),
                            }
                          : { id: 'whiteboard-default', type: 'whiteboard', title: 'Whiteboard' }
                      }
                      lessonId={selectedLesson}
                      classId={liveClassSelectedClassId}
                      lang={lang}
                      flow={segmentMainFlowController}
                      onRefresh={onWhiteboardRefresh}
                    />
                  </WhiteboardHostBridgeProvider>
                ) : (
                  <LazyWhiteboard
                    ref={whiteboardRef}
                    lessonId={selectedLesson}
                    classId={liveClassSelectedClassId}
                    userRole={'teacher'}
                    initialPage={restoredCurrentPage}
                    isEditMode={false}
                    broadcastFullscreen
                    fullscreenBroadcastClassId={liveClassSelectedClassId}
                    onFullscreenSync={onFullscreenSync}
                    elements={elements}
                    activeSegmentId={activeSegmentId}
                    onSegmentSync={onSegmentSync}
                    classroomTools={classroomTools}
                    onExecuteTool={onExecuteTool}
                    hidePageBar={true}
                    onPagesStateChange={onPagesStateChange}
                    onElementAdd={onElementAdd}
                    onElementUpdate={onElementUpdate}
                    onElementDelete={onElementDelete}
                    onRefresh={onWhiteboardRefresh}
                  />
                )}
              </div>
            </>
          ) : middleTab === 'submissions' ? (
            <LiveSubmissionsPanel
              {...submissionsProps}
              lang={lang as LiveSubmissionsPanelProps['lang']}
              selectedLesson={selectedLesson}
              liveClassSelectedClassId={liveClassSelectedClassId}
              activeSegmentId={activeSegmentId}
              setMiddleTab={setMiddleTab}
            />
          ) : middleTab === 'top_performers' ? (
            <div className="flex-grow flex-1 min-h-0 w-full relative rounded-xl overflow-y-auto border border-theme shadow-md bg-surface flex flex-col p-4">
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
          ) : middleTab === 'segment_main' ? (
            <div
              data-testid="classroom-active-segment-main-container"
              className="flex-grow flex-1 min-h-0 w-full relative rounded-xl overflow-hidden border border-theme shadow-md bg-surface flex flex-col p-4"
            >
              {currentActiveSegment ? (
                <WhiteboardHostBridgeProvider value={isModePacksEnabled() ? teacherWhiteboardBridge : null}>
                  <ExtensionPointRenderer
                    slot="classroom.active_segment.main"
                    slotProps={{
                      segment: isModePacksEnabled()
                        ? {
                            ...currentActiveSegment,
                            type: normalizeSegmentType((currentActiveSegment as { type?: string }).type),
                          }
                        : currentActiveSegment,
                      lessonId: selectedLesson,
                      classId: liveClassSelectedClassId,
                      lang,
                      flow: segmentMainFlowController,
                      onRefresh: () => fetchElements(selectedLesson),
                    }}
                  />
                </WhiteboardHostBridgeProvider>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-muted text-sm space-y-2">
                  <p>{lang === 'zh' ? '当前没有正在进行的教学环节。' : 'No active lesson segment currently.'}</p>
                  <button
                    type="button"
                    onClick={() => setMiddleTab('whiteboard')}
                    className="px-3 py-1 text-xs font-bold bg-primary-theme text-white rounded-lg cursor-pointer hover:bg-primary-theme-hover transition-colors"
                  >
                    {lang === 'zh' ? '返回演示白板' : 'Back to Whiteboard'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <TeacherAssignmentGradePanel
              lessonId={selectedLesson || ''}
              lang={lang === 'zh' ? 'zh' : 'en'}
              addToast={addToast}
            />
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-subtle gap-2.5 select-none">
          <Presentation size={38} className="text-slate-300 animate-bounce" style={{ animationDuration: '2.5s' }} />
          <div className="text-sm font-bold text-muted">
            {lang === 'zh' ? '请在顶部栏选择一个授课课节' : 'Please select a lesson to start teaching'}
          </div>
          <p className="text-xs text-subtle">白板及环节控制面板将在课节载入后自动生成</p>
        </div>
      )}
    </div>
  );
}
