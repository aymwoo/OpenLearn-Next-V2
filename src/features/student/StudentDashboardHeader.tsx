import type { StudentType } from '../../types/app';
import { Radio, ArrowRight } from 'lucide-react';
import type { StudentActiveSession } from './useStudentActiveSession';

export interface StudentDashboardHeaderProps {
  students: StudentType[];
  activeStudentId: string | null;
  /** Issue #109: 正在进行的课堂会话（存在时常驻「返回课堂」入口） */
  activeSession?: StudentActiveSession | null;
  onReturnToClass?: () => void;
  lang?: 'zh' | 'en';
}

export function StudentDashboardHeader(props: StudentDashboardHeaderProps) {
  const { students, activeStudentId, activeSession, onReturnToClass, lang = 'zh' } = props;
  const zh = lang === 'zh';
  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-gray-200 pb-4">
      <div className="h-16 w-16 bg-indigo-600 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-lg">
        {students
          .find((s) => s.id === activeStudentId)
          ?.name.charAt(0)
          .toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-2xl font-bold text-gray-800">
          Welcome, {students.find((s) => s.id === activeStudentId)?.name}
        </h2>
        <p className="text-gray-500">Here is your learning summary.</p>
      </div>

      {/* Issue #109: 顶部导航常驻返回入口，不依赖看板卡片布局 */}
      {activeSession && (
        <button
          type="button"
          data-testid="student-header-return-to-class"
          onClick={onReturnToClass}
          className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
          title={
            zh
              ? `返回正在进行的课堂：${activeSession.lessonTitle}`
              : `Return to the ongoing class: ${activeSession.lessonTitle}`
          }
        >
          <Radio size={13} className="animate-pulse" aria-hidden="true" />
          <span>{zh ? '返回课堂' : 'Return to class'}</span>
          <ArrowRight size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
