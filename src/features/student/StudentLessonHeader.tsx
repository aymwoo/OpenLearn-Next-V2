import type { StudentType, Lesson } from '../../types/app';
import { ChevronRight, Lock } from 'lucide-react';
import { useStudentActiveSession } from './useStudentActiveSession';

export interface StudentLessonHeaderProps {
  students: StudentType[];
  activeStudentId: string | null;
  /** 全班专注锁定中：学生端进入只读跟随模式 */
  isStudentLocked?: boolean;
  /** 锁定模式：'full' (完全锁定) | 'navigation' (答题锁定) */
  lockMode?: 'full' | 'navigation';
  setStudentViewStatus: (status: 'dashboard' | 'lesson' | 'assignment') => void;
  setSelectedLesson: (id: string | null) => void;
  lessons: Lesson[];
  selectedLesson: string | null;
  lang?: 'zh' | 'en';
  /** Issue #109: 离开课堂时若课堂仍在进行，用 Toast 告知可从顶部返回 */
  addToast?: (title: string, description: string, type: string) => void;
  /** Issue #131: 打开课前心情打卡弹窗 */
  onOpenIcebreaker?: () => void;
  /** 当前环节名；缺省时回退课节名（学生课堂的标题就是本环节） */
  topic?: string;
  /** 课节名（面包屑前段）；缺省时按 selectedLesson 从 lessons 反查 */
  lessonTitle?: string;
  /** 当前环节序号（1 起）与总数，用于展示「环节 2/3」 */
  segmentIndex?: number;
  segmentCount?: number;
}

/**
 * 学生课堂顶栏：一行承载「离开/锁定 + 课节›环节 + 环节位置 + 心情打卡」。
 * 学案/白板两种课堂共用，不再各自渲染标题块（避免顶部叠出两行空白）。
 */
export function StudentLessonHeader(props: StudentLessonHeaderProps) {
  const {
    students,
    activeStudentId,
    isStudentLocked = false,
    lockMode,
    setStudentViewStatus,
    setSelectedLesson,
    lessons,
    selectedLesson,
    lang = 'zh',
    addToast,
    onOpenIcebreaker,
    segmentIndex = 0,
    segmentCount = 0,
  } = props;

  // Issue #109: 课堂仍在进行时，离开课堂给一条「可随时返回」的提示
  const activeSession = useStudentActiveSession((s) => s.activeSession);

  // 兼容旧调用方：未显式传入锁定时，回退到 students 表派生（单一数据源仍是 locked_lesson_id）
  const currentStudent = students.find((s) => s.id === activeStudentId);
  const locked = isStudentLocked || !!currentStudent?.locked_lesson_id;
  const effectiveLockMode = lockMode || currentStudent?.lock_mode || 'full';
  const isAnswerMode = effectiveLockMode === 'navigation';

  const resolvedLessonTitle = props.lessonTitle?.trim() || lessons.find((l) => l.id === selectedLesson)?.title || '';
  const topic = props.topic?.trim() || resolvedLessonTitle;
  const showBreadcrumb = Boolean(resolvedLessonTitle) && resolvedLessonTitle !== topic;

  return (
    <header
      aria-label={lang === 'zh' ? '课堂信息' : 'Lesson info'}
      className="flex h-14 shrink-0 items-center gap-3 rounded-xl border border-theme bg-surface px-3"
    >
      {locked ? (
        isAnswerMode ? (
          <div
            className="text-amber-800 dark:text-amber-300 font-semibold text-xs flex shrink-0 items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 select-none"
            role="status"
            title={
              lang === 'zh'
                ? '答题锁定中 · 请完成作答后提交，暂时无法离开本页'
                : 'Answer Locked · Complete and submit your work before leaving'
            }
          >
            <Lock size={14} className="text-amber-600 shrink-0" />
            {lang === 'zh'
              ? '答题锁定中 · 请完成作答后提交，暂时无法离开本页'
              : 'Answer Locked · Complete and submit work'}
          </div>
        ) : (
          <div
            className="text-indigo-700 dark:text-indigo-300 font-semibold text-xs flex shrink-0 items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900 select-none"
            role="status"
            title={
              lang === 'zh'
                ? '老师已开启全班专注锁定，您暂时无法切换页面'
                : 'The teacher locked the class focus. Navigating away is disabled.'
            }
          >
            <Lock size={14} className="text-indigo-600 shrink-0" />
            {lang === 'zh' ? '全班专注锁定 · 跟随教师授课' : 'Class Focus Locked · Following Teacher'}
          </div>
        )
      ) : (
        <button
          onClick={() => {
            setStudentViewStatus('dashboard');
            setSelectedLesson(null);
            if (activeSession) {
              addToast?.(
                lang === 'zh' ? '课堂仍在进行' : 'Class still in progress',
                lang === 'zh'
                  ? `可随时从看板顶部的「${activeSession.lessonTitle} · 返回课堂」回到课堂。`
                  : `You can return anytime via the banner at the top of your dashboard.`,
                'info',
              );
            }
          }}
          className="flex shrink-0 items-center gap-2 text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors font-medium text-sm cursor-pointer"
        >
          <ChevronRight className="rotate-180" size={16} /> Back to Dashboard
        </button>
      )}

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {showBreadcrumb ? (
          <>
            <span className="shrink-0 truncate text-xs text-muted max-w-[10rem]">{resolvedLessonTitle}</span>
            <ChevronRight size={12} aria-hidden="true" className="shrink-0 text-subtle" />
          </>
        ) : null}
        <h2
          data-testid="student-learning-topic"
          className="min-w-0 truncate text-base font-semibold tracking-tight text-main"
          title={topic}
        >
          {topic}
        </h2>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {segmentCount > 1 && segmentIndex > 0 ? (
          <span className="hidden text-xs tabular-nums text-muted sm:inline">
            {lang === 'zh' ? `环节 ${segmentIndex}/${segmentCount}` : `Part ${segmentIndex}/${segmentCount}`}
          </span>
        ) : null}
        {onOpenIcebreaker ? (
          <button
            type="button"
            data-testid="open-icebreaker-btn"
            onClick={onOpenIcebreaker}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50/80 hover:bg-amber-100/80 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 text-amber-900 dark:text-amber-200 text-xs font-semibold shadow-3xs transition-colors cursor-pointer"
            title={lang === 'zh' ? '课前破冰心情打卡' : 'Pre-class Icebreaker Check-in'}
          >
            <span aria-hidden="true">✨</span>
            <span>{lang === 'zh' ? '心情打卡' : 'Mood Check-in'}</span>
          </button>
        ) : null}
      </div>
    </header>
  );
}
