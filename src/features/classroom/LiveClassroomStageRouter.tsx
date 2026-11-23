import React, { useState, type ComponentProps } from 'react';
import { Presentation } from 'lucide-react';
import { PreClassReadyView } from './PreClassReadyView';
import { PostClassWrapupView } from './PostClassWrapupView';
import { ClassroomBriefingView } from './ClassroomBriefingView';
import { ClassroomTimelineSidebar } from './ClassroomTimelineSidebar';
import { LiveClassroomMiddleWorkspace } from './LiveClassroomMiddleWorkspace';
import { LiveStudentMonitorPanel } from './student-monitor/LiveStudentMonitorPanel';

type MiddleWorkspaceProps = ComponentProps<typeof LiveClassroomMiddleWorkspace>;
type StudentMonitorProps = ComponentProps<typeof LiveStudentMonitorPanel>;
type TimelineSidebarProps = ComponentProps<typeof ClassroomTimelineSidebar>;

type PreClassReadyViewInjected =
  'selectedLesson' | 'lessonTitle' | 'isClassLocked' | 'onToggleClassLock' | 'onStartClass';
type PostClassWrapupViewInjected = 'selectedLesson' | 'lessonTitle' | 'onAdvanceToReport' | 'onReturnToTeaching';
type ClassroomBriefingViewInjected = 'selectedLesson' | 'lessonTitle' | 'onReturnToTeaching' | 'onReturnToPreClass';

export function LiveClassroomStageRouter({
  selectedLesson,
  classroomStage,
  lessons,
  classes: _classes,
  lang,
  isClassLocked,
  isLeftSidebarCollapsed,
  onToggleClassLock,
  onStageChange,
  preClassProps,
  wrapUpProps,
  briefingProps,
  timelineProps,
  middleWorkspaceProps,
  studentMonitorProps,
}: {
  selectedLesson: string | null;
  classroomStage: string;
  lessons: { id: string; title: string }[];
  classes: { id: string; name: string }[];
  lang: string;
  isClassLocked: boolean;
  isLeftSidebarCollapsed: boolean;
  onToggleClassLock: () => void;
  onStageChange: (stage: string) => void;
  preClassProps: Omit<ComponentProps<typeof PreClassReadyView>, PreClassReadyViewInjected>;
  wrapUpProps: Omit<ComponentProps<typeof PostClassWrapupView>, PostClassWrapupViewInjected>;
  briefingProps: Omit<ComponentProps<typeof ClassroomBriefingView>, ClassroomBriefingViewInjected>;
  timelineProps: Omit<TimelineSidebarProps, 'selectedLesson' | 'lang'>;
  middleWorkspaceProps: Omit<MiddleWorkspaceProps, 'selectedLesson'>;
  studentMonitorProps: Omit<StudentMonitorProps, 'lang' | 'selectedLesson' | 'isCollapsed' | 'onToggleCollapse'>;
}) {
  // 右侧「学生专注」面板默认展开，可收起成窄条把空间让给白板与大纲。
  const [isMonitorCollapsed, setIsMonitorCollapsed] = useState(false);

  if (!selectedLesson) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-subtle gap-2.5 select-none bg-surface">
        <Presentation size={38} className="text-slate-300 animate-bounce" style={{ animationDuration: '2.5s' }} />
        <div className="text-sm font-bold text-muted">
          {lang === 'zh' ? '请在顶部栏选择一个授课课节' : 'Please select a lesson to start teaching'}
        </div>
        <p className="text-xs text-subtle">
          {lang === 'zh'
            ? '课前准备、课中白板、课后小结与简报将在选择课节后就绪'
            : 'Classroom workflows activate once a lesson is selected.'}
        </p>
      </div>
    );
  }

  if (classroomStage === 'PRE_CLASS_READY') {
    return (
      <PreClassReadyView
        {...preClassProps}
        selectedLesson={selectedLesson}
        lessonTitle={lessons.find((l) => l.id === selectedLesson)?.title || ''}
        isClassLocked={isClassLocked}
        onToggleClassLock={onToggleClassLock}
        onStartClass={() => onStageChange('IN_CLASS_TEACHING')}
      />
    );
  }

  if (classroomStage === 'WRAP_UP_EXIT_TICKET') {
    return (
      <PostClassWrapupView
        {...wrapUpProps}
        selectedLesson={selectedLesson}
        lessonTitle={lessons.find((l) => l.id === selectedLesson)?.title || ''}
        onAdvanceToReport={() => onStageChange('ARCHIVED_REPORT')}
        onReturnToTeaching={() => onStageChange('IN_CLASS_TEACHING')}
      />
    );
  }

  if (classroomStage === 'ARCHIVED_REPORT') {
    return (
      <ClassroomBriefingView
        {...briefingProps}
        selectedLesson={selectedLesson}
        lessonTitle={lessons.find((l) => l.id === selectedLesson)?.title || ''}
        onReturnToTeaching={() => onStageChange('IN_CLASS_TEACHING')}
        onReturnToPreClass={() => onStageChange('PRE_CLASS_READY')}
      />
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden min-h-0 bg-surface-secondary/30">
      {!isLeftSidebarCollapsed && (
        <ClassroomTimelineSidebar {...timelineProps} selectedLesson={selectedLesson} lang={lang} />
      )}
      <LiveClassroomMiddleWorkspace {...middleWorkspaceProps} selectedLesson={selectedLesson} />
      <LiveStudentMonitorPanel
        {...studentMonitorProps}
        lang={lang}
        selectedLesson={selectedLesson}
        isCollapsed={isMonitorCollapsed}
        onToggleCollapse={() => setIsMonitorCollapsed((v) => !v)}
      />
    </div>
  );
}
