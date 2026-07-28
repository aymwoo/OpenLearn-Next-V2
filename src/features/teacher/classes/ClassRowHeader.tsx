import { ChevronDown, ChevronRight, Users, BookOpen, ClipboardList } from 'lucide-react';
import type { ClassType } from '../../../types/app';

export interface ClassRowHeaderProps {
  cls: ClassType;
  lang: 'zh' | 'en';
  isExpanded: boolean;
  batchMode: boolean;
  selectedClassIds: Set<string>;
  setExpandedClassId: (value: string | null) => void;
  setSelectedStudentIds: (value: Set<string>) => void;
  toggleClassSelection: (classId: string) => void;
  fetchClassStudents: (classId: string) => Promise<void>;
  fetchClassProgress: (classId: string) => Promise<void>;
  fetchClassDashboard: (classId: string) => Promise<void>;
  fetchClassSchedules: (classId: string) => Promise<void>;
}

export function ClassRowHeader({
  cls,
  lang,
  isExpanded,
  batchMode,
  selectedClassIds,
  setExpandedClassId,
  setSelectedStudentIds,
  toggleClassSelection,
  fetchClassStudents,
  fetchClassProgress,
  fetchClassDashboard,
  fetchClassSchedules,
}: ClassRowHeaderProps) {
  const expand = () => {
    setExpandedClassId(cls.id);
    setSelectedStudentIds(new Set());
    fetchClassStudents(cls.id);
    fetchClassProgress(cls.id);
    fetchClassDashboard(cls.id);
    fetchClassSchedules(cls.id);
  };

  return (
    <div
      className={`p-2 flex items-center justify-between ${batchMode ? 'cursor-pointer hover:bg-amber-50/60' : 'cursor-pointer hover:bg-gray-50'}`}
      onClick={() => {
        if (batchMode) {
          toggleClassSelection(cls.id);
          return;
        }
        if (isExpanded) {
          setExpandedClassId(null);
        } else {
          expand();
        }
      }}
    >
      <div className="flex items-center gap-2">
        {batchMode && (
          <input
            type="checkbox"
            className="shrink-0 accent-amber-500"
            checked={selectedClassIds.has(cls.id)}
            onChange={() => toggleClassSelection(cls.id)}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (isExpanded) {
              setExpandedClassId(null);
            } else {
              expand();
            }
          }}
          className="text-gray-400 hover:text-gray-600 shrink-0"
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <div className={`text-sm font-medium ${batchMode && selectedClassIds.has(cls.id) ? 'text-amber-700' : 'text-gray-800'}`}>{cls.name}</div>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-gray-500 shrink-0">
        <span className="flex items-center gap-1" title={lang === 'zh' ? '学生人数' : 'Students'}>
          <Users size={13} className="text-gray-400" />
          {cls.student_count ?? 0}
        </span>
        <span className="flex items-center gap-1" title={lang === 'zh' ? '课程数量' : 'Courses'}>
          <BookOpen size={13} className="text-gray-400" />
          {cls.course_count ?? 0}
        </span>
        <span className="flex items-center gap-1" title={lang === 'zh' ? '作业数量' : 'Assignments'}>
          <ClipboardList size={13} className="text-gray-400" />
          {cls.assignment_count ?? 0}
        </span>
      </div>
    </div>
  );
}
