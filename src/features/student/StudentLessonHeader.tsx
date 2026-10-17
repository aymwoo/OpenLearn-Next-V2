import type { StudentType, Lesson } from '../../types/app';
import { ChevronRight, Lock } from 'lucide-react';
import { useStudentActiveSession } from './useStudentActiveSession';

export interface StudentLessonHeaderProps {
  students: StudentType[];
  activeStudentId: string | null;
  /** 全班专注锁定中：学生端进入只读跟随模式 */
  isStudentLocked?: boolean;
  setStudentViewStatus: (status: 'dashboard' | 'lesson' | 'assignment') => void;
  setSelectedLesson: (id: string | null) => void;
  lessons: Lesson[];
  selectedLesson: string | null;
  lang?: 'zh' | 'en';
  /** Issue #109: 离开课堂时若课堂仍在进行，用 Toast 告知可从顶部返回 */
  addToast?: (title: string, description: string, type: string) => void;
}

export function StudentLessonHeader(props: StudentLessonHeaderProps) {
  const {
    students,
    activeStudentId,
    isStudentLocked = false,
    setStudentViewStatus,
    setSelectedLesson,
    lessons,
    selectedLesson,
    lang = 'zh',
    addToast,
  } = props;

  // Issue #109: 课堂仍在进行时，离开课堂给一条「可随时返回」的提示
  const activeSession = useStudentActiveSession((s) => s.activeSession);

  // 兼容旧调用方：未显式传入锁定时，回退到 students 表派生（单一数据源仍是 locked_lesson_id）
  const locked = isStudentLocked || !!students.find((s) => s.id === activeStudentId)?.locked_lesson_id;

  return (
    <div className="flex items-center justify-between gap-4">
      {locked ? (
        <div
          className="text-indigo-700 font-semibold text-sm flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 shadow-3xs select-none"
          role="status"
          title={
            lang === 'zh'
              ? '老师已开启全班专注锁定，您暂时无法切换页面'
              : 'The teacher locked the class focus. Navigating away is disabled.'
          }
        >
          <Lock size={15} className="text-indigo-600 shrink-0" />
          {lang === 'zh' ? '全班专注锁定 · 跟随教师授课' : 'Class Focus Locked · Following Teacher'}
        </div>
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
          className="flex items-center gap-2 text-indigo-600 hover:text-indigo-800 transition-colors font-medium text-sm cursor-pointer"
        >
          <ChevronRight className="rotate-180" size={16} /> Back to Dashboard
        </button>
      )}
      <h2 className="text-xl font-bold text-gray-800">{lessons.find((l) => l.id === selectedLesson)?.title}</h2>
    </div>
  );
}
