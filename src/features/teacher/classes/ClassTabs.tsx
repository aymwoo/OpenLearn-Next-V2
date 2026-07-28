import { Users, Activity, Calendar as CalendarIcon, ClipboardList } from 'lucide-react';
import type { ClassType } from '../../../types/app';

export type ClassTabKey = 'students' | 'assignments' | 'schedules' | 'seating' | 'grades';

export interface ClassTabsProps {
  cls: ClassType;
  lang: 'zh' | 'en';
  classActiveTabs: Record<string, ClassTabKey>;
  setClassActiveTabs: (updater: (prev: Record<string, ClassTabKey>) => Record<string, ClassTabKey>) => void;
}

export function ClassTabs({ cls, lang, classActiveTabs, setClassActiveTabs }: ClassTabsProps) {
  return (
    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl mb-4 max-w-md border border-slate-200/40" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setClassActiveTabs((prev) => ({ ...prev, [cls.id]: 'students' }));
        }}
        className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer ${
          (classActiveTabs[cls.id] || 'students') === 'students'
            ? 'bg-white text-indigo-600 shadow-xs font-bold border border-slate-200/50'
            : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
        }`}
      >
        <Users size={12} />
        <span>{lang === 'zh' ? '学生名单' : 'Students'}</span>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setClassActiveTabs((prev) => ({ ...prev, [cls.id]: 'assignments' }));
        }}
        className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer ${
          (classActiveTabs[cls.id] || 'students') === 'assignments'
            ? 'bg-white text-indigo-600 shadow-xs font-bold border border-slate-200/50'
            : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
        }`}
      >
        <Activity size={12} />
        <span>{lang === 'zh' ? '作业成绩' : 'Assignments'}</span>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setClassActiveTabs((prev) => ({ ...prev, [cls.id]: 'schedules' }));
        }}
        className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer ${
          (classActiveTabs[cls.id] || 'students') === 'schedules'
            ? 'bg-white text-indigo-600 shadow-xs font-bold border border-slate-200/50'
            : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
        }`}
      >
        <CalendarIcon size={12} />
        <span>{lang === 'zh' ? '课表考勤' : 'Attendance'}</span>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setClassActiveTabs((prev) => ({ ...prev, [cls.id]: 'grades' }));
        }}
        className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer ${
          (classActiveTabs[cls.id] || 'students') === 'grades'
            ? 'bg-white text-indigo-600 shadow-xs font-bold border border-slate-200/50'
            : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
        }`}
      >
        <ClipboardList size={12} />
        <span>{lang === 'zh' ? '学期总评' : 'Grades'}</span>
      </button>
    </div>
  );
}
