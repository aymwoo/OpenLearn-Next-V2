import type { Dispatch, SetStateAction } from 'react';
import type { StudentType } from '../../types/app';
import { BookOpen, Minimize2, Maximize2, ChevronRight, Folder, Globe } from 'lucide-react';
import { LazyWhiteboard } from '../../components/LazyWhiteboard';
import { LazyCourseware } from '../../components/LazyCourseware';
import { StudentAssignmentEvalPanel } from '../../components/StudentAssignmentEvalPanel';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';

export interface StudentLessonInteractionPanelProps {
  /** 全班专注锁定中：标签页与白板均变为只读 */
  isStudentLocked?: boolean;
  /** 导航限制：禁止切 Tab、返回看板（答题锁定与完全锁定均开启） */
  isNavigationLocked?: boolean;
  /** 交互限制：白板设为只读并拦截内容写入（仅完全锁定开启，答题锁定为 false） */
  isInteractionLocked?: boolean;
  /** 锁定模式：'full' | 'navigation' */
  lockMode?: 'full' | 'navigation';
  studentLessonTab: 'whiteboard' | 'courseware' | 'assignment';
  setStudentLessonTab: (tab: 'whiteboard' | 'courseware' | 'assignment') => void;
  isStudentLessonContentCollapsed: boolean;
  setIsStudentLessonContentCollapsed: (b: boolean) => void;
  lang: 'zh' | 'en';
  studentFullscreenPanel: 'left' | 'right' | 'none';
  setStudentFullscreenPanel: Dispatch<SetStateAction<'left' | 'right' | 'none'>>;
  selectedLesson: string | null;
  elements: any[];
  activeRole: 'student' | 'teacher';
  activeSegmentId: string | null;
  /** 未达标时改为上一环节，让学生能补齐条件。 */
  contentSegmentId?: string | null;
  /** 正在核对，或锁定且没有可回看的上一环节。 */
  blockSegmentContent?: boolean;
  setActiveSegmentId: (id: string) => void;
  fetchElements: (lessonId: string) => void;
  currentVfsParent: string | null;
  setCurrentVfsParent: (id: string | null) => void;
  vfsNodes: any[];
  studentSelectedCourseware: string | null;
  setStudentSelectedCourseware: (id: string | null) => void;
  activeStudentId: string | null;
  /** 当前学生姓名（供白板内的插件挂件标注作者） */
  studentName?: string | null;
  /** 当前课堂所属班级（白板内插件挂件的作用域） */
  classId?: string | null;
  addToast: (title: string, description: string, type: string) => void;
}

export function StudentLessonInteractionPanel(props: StudentLessonInteractionPanelProps) {
  const {
    isStudentLocked = false,
    isNavigationLocked,
    isInteractionLocked,
    lockMode,
    studentLessonTab,
    setStudentLessonTab,
    isStudentLessonContentCollapsed,
    setIsStudentLessonContentCollapsed,
    lang,
    studentFullscreenPanel,
    setStudentFullscreenPanel,
    selectedLesson,
    elements,
    activeRole,
    activeSegmentId,
    contentSegmentId,
    blockSegmentContent = false,
    setActiveSegmentId,
    fetchElements,
    currentVfsParent,
    setCurrentVfsParent,
    vfsNodes,
    studentSelectedCourseware,
    setStudentSelectedCourseware,
    activeStudentId,
    studentName,
    classId,
    addToast,
  } = props;

  const navigationLocked = isNavigationLocked ?? isStudentLocked;
  const interactionLocked = isInteractionLocked ?? (lockMode === 'navigation' ? false : isStudentLocked);
  const isAnswerMode = (lockMode || (!interactionLocked && navigationLocked ? 'navigation' : 'full')) === 'navigation';

  // 锁定期间禁止自行切换标签页，仅允许跟随教师端广播的 TEACHER_CHANGE_TAB
  const handleTabChange = (tab: 'whiteboard' | 'courseware' | 'assignment') => {
    if (navigationLocked) {
      if (tab !== studentLessonTab) {
        addToast(
          lang === 'zh'
            ? isAnswerMode
              ? '🔒 答题锁定'
              : '🔒 全班专注锁定'
            : isAnswerMode
              ? '🔒 Answer Locked'
              : '🔒 Class Focus Locked',
          lang === 'zh'
            ? isAnswerMode
              ? '答题锁定中，请在当前页面完成作答并提交。'
              : '锁定期间无法切换标签页，请跟随教师当前授课内容。'
            : isAnswerMode
              ? 'Answer lock active. Complete your work on this page.'
              : 'Switching tabs is disabled while the class is locked.',
          'warning',
        );
      }
      return;
    }
    setStudentLessonTab(tab);
  };

  const boardSegmentId = contentSegmentId || activeSegmentId;
  const hideSegmentBody = blockSegmentContent;

  const tabButtonClass = (tab: 'whiteboard' | 'courseware' | 'assignment') =>
    `px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
      studentLessonTab === tab
        ? 'bg-primary-theme/10 text-primary-theme shadow-sm font-bold'
        : 'text-muted hover:bg-surface-secondary'
    } ${navigationLocked && studentLessonTab !== tab ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`;

  return (
    <div
      className={`${isStudentLessonContentCollapsed || studentFullscreenPanel === 'right' ? 'w-full flex-grow' : 'flex-grow flex-1'} relative flex flex-col min-h-0 ${studentFullscreenPanel === 'left' ? 'hidden' : ''} transition-all duration-300`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsStudentLessonContentCollapsed(!isStudentLessonContentCollapsed)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-primary-theme/10 text-primary-theme rounded-lg hover:bg-primary-theme/20 transition-colors border border-primary-theme/20 cursor-pointer shadow-3xs"
            title={isStudentLessonContentCollapsed ? '展开课程内容' : '折叠课程内容'}
          >
            <BookOpen size={13} className="text-primary-theme" />
            <span>
              {isStudentLessonContentCollapsed
                ? lang === 'zh'
                  ? '展开课程内容'
                  : 'Expand Content'
                : lang === 'zh'
                  ? '折叠课程内容'
                  : 'Collapse Content'}
            </span>
          </button>
          <button
            onClick={() => handleTabChange('whiteboard')}
            className={tabButtonClass('whiteboard')}
            title={
              interactionLocked && lang === 'zh'
                ? '锁定中：白板为只读跟随模式'
                : navigationLocked && lang === 'zh'
                  ? '答题锁定中：请在此页面完成作答'
                  : undefined
            }
          >
            Interactive Whiteboard
            {interactionLocked && studentLessonTab === 'whiteboard' && (
              <span className="ml-1.5 text-xs font-bold text-indigo-500">🔒 {lang === 'zh' ? '只读' : 'RO'}</span>
            )}
            {!interactionLocked && navigationLocked && studentLessonTab === 'whiteboard' && (
              <span className="ml-1.5 text-xs font-bold text-amber-600">
                ✏️ {lang === 'zh' ? '答题锁定' : 'Answering'}
              </span>
            )}
          </button>
          <button onClick={() => handleTabChange('courseware')} className={tabButtonClass('courseware')}>
            Interactive Courseware Viewer
          </button>
          <button onClick={() => handleTabChange('assignment')} className={tabButtonClass('assignment')}>
            {lang === 'zh' ? '作业提交与互评' : 'Assignments & Peer Reviews'}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* 学生端随堂工具扩展 */}
          <ExtensionPointRenderer
            slot="student.lesson.tool"
            slotProps={{
              lessonId: selectedLesson,
              studentId: activeStudentId,
              activeSegmentId,
              lang,
            }}
          />

          <button
            onClick={() => setStudentFullscreenPanel((p) => (p === 'right' ? 'none' : 'right'))}
            className="p-1 hover:bg-gray-100 text-subtle hover:text-main rounded transition-colors cursor-pointer flex items-center gap-1"
            title={studentFullscreenPanel === 'right' ? '退出全屏' : '全屏'}
          >
            {studentFullscreenPanel === 'right' ? (
              <>
                <Minimize2 size={13} />
                <span className="text-xs font-medium">退出全屏</span>
              </>
            ) : (
              <>
                <Maximize2 size={13} />
                <span className="text-xs font-medium">全屏</span>
              </>
            )}
          </button>
        </div>
      </div>
      {hideSegmentBody ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-amber-800 bg-amber-50/60 rounded-xl border border-amber-200 gap-3">
          <div className="text-sm font-semibold flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span>{lang === 'zh' ? '本教学环节尚未解锁' : 'This segment is not unlocked yet'}</span>
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-400 max-w-md text-center">
            {lang === 'zh'
              ? '您尚未满足本教学环节的进入门禁条件，请完成前置任务或等待教师统一推进。'
              : 'You have not met the gate conditions for this segment yet. Please complete prerequisites or wait for the teacher.'}
          </p>
          <ExtensionPointRenderer
            slot="student.segment.gate_fallback"
            slotProps={{
              lessonId: selectedLesson,
              activeSegmentId,
              studentId: activeStudentId,
              contentSegmentId,
              lang,
            }}
          />
        </div>
      ) : null}
      {!hideSegmentBody && studentLessonTab === 'whiteboard' && (
        <LazyWhiteboard
          lessonId={selectedLesson}
          classId={classId ?? null}
          studentId={activeStudentId}
          studentName={studentName ?? null}
          elements={elements}
          userRole={activeRole}
          readOnly={interactionLocked}
          followRemoteFullscreen
          activeSegmentId={boardSegmentId}
          onSegmentSync={(segId: string) => {
            if (contentSegmentId !== undefined && contentSegmentId !== activeSegmentId) return;
            setActiveSegmentId(segId);
          }}
          onElementUpdate={async () => {
            /* readonly or sync */
          }}
          onElementDelete={async (elementId: string) => {
            // 完全锁定期间白板只读：拒绝任何删除写入
            if (interactionLocked) return;
            if (!selectedLesson) return;
            await fetch(`/api/lessons/${selectedLesson}/whiteboard/${elementId}`, { method: 'DELETE' });
            fetchElements(selectedLesson);
          }}
          onClearBoard={async () => {
            // 完全锁定期间白板只读：拒绝清空写入
            if (interactionLocked) return;
            if (!selectedLesson) return;
            await fetch(`/api/lessons/${selectedLesson}/whiteboard`, { method: 'DELETE' });
            fetchElements(selectedLesson);
          }}
          onElementAdd={async () => {
            /* readonly or sync */
          }}
          onRefresh={() => {
            if (!selectedLesson) return;
            fetchElements(selectedLesson);
          }}
        />
      )}
      {!hideSegmentBody && studentLessonTab === 'courseware' && (
        <div className="flex-1 flex gap-4 min-h-0">
          {/* Courseware Selector Sidebar */}
          <div className="w-48 flex-shrink-0 bg-gray-50 border border-gray-200 rounded-lg p-3 flex flex-col min-h-0">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2 border-b border-gray-200 pb-2">
              Cloud Apps
            </h4>
            <div className="flex-1 overflow-y-auto space-y-1">
              {currentVfsParent !== null && (
                <button
                  onClick={() => setCurrentVfsParent(null)}
                  className="flex items-center gap-2 p-1.5 text-xs text-indigo-600 w-full hover:bg-gray-200 rounded mb-1 font-medium"
                >
                  <ChevronRight className="rotate-180" size={14} /> Back to Root
                </button>
              )}
              {vfsNodes
                .filter((n) => n.type === 'dir')
                .map((node) => (
                  <button
                    key={node.id}
                    onClick={() => setCurrentVfsParent(node.id)}
                    className="w-full text-left p-1.5 rounded text-xs text-gray-700 hover:bg-gray-200 flex items-center gap-2 group truncate"
                    title={node.name}
                  >
                    <Folder size={14} className="text-indigo-400 shrink-0 group-hover:text-indigo-600" />
                    <span className="truncate">{node.name}</span>
                  </button>
                ))}
              {vfsNodes.filter(
                (n) =>
                  n.type === 'file' &&
                  (n.name.endsWith('.html') || n.name.endsWith('.htm') || n.content?.includes('<html')),
              ).length === 0 ? (
                <div className="text-xs text-center text-gray-400 italic py-4">No interactive HTML apps found.</div>
              ) : (
                vfsNodes
                  .filter(
                    (n) =>
                      n.type === 'file' &&
                      (n.name.endsWith('.html') || n.name.endsWith('.htm') || n.content?.includes('<html')),
                  )
                  .map((node) => (
                    <button
                      key={node.id}
                      onClick={() => setStudentSelectedCourseware(node.id)}
                      className={`w-full text-left p-2 rounded text-xs flex items-center gap-2 truncate transition-colors ${studentSelectedCourseware === node.id ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
                      title={node.name}
                    >
                      <Globe size={14} className="shrink-0" />
                      <span className="truncate">{node.name}</span>
                    </button>
                  ))
              )}
            </div>
            <div className="mt-2 text-xs text-gray-400 leading-tight">
              Note: Showing HTML courseware from current OS drive directory. Ask agent to generate courseware.
            </div>
          </div>
          <div className="flex-1 relative bg-white min-h-0">
            <LazyCourseware
              coursewareId={studentSelectedCourseware}
              onClose={() => setStudentSelectedCourseware(null)}
            />
          </div>
        </div>
      )}
      {!hideSegmentBody && studentLessonTab === 'assignment' && selectedLesson && activeStudentId && (
        <StudentAssignmentEvalPanel
          lessonId={selectedLesson}
          studentId={activeStudentId}
          lang={lang}
          addToast={addToast}
        />
      )}
    </div>
  );
}
