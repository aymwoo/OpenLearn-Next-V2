import React, { useState } from 'react';
import { BookOpen, Upload, Plus, Search, X, Users, Edit3, Copy, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import Markdown from 'react-markdown';
import type { Lesson } from '../../store/appStore';

interface CourseStats {
  whiteboardCount: number;
  scheduleCount: number;
  enrollmentCount: number;
  assignmentCount: number;
}

interface CourseManagementProps {
  lang: string;
  lessons: Lesson[];
  lessonsSearchQuery: string;
  setLessonsSearchQuery: (q: string) => void;
  lessonsSortOrder: 'recent' | 'alphabetical' | 'enrollment';
  setLessonsSortOrder: (o: 'recent' | 'alphabetical' | 'enrollment') => void;
  filteredLessons: Lesson[];
  onOpenImportLessons: () => void;
  onOpenCourseWizard: () => void;
  onViewCourse: (lessonId: string) => void;
  onDeleteCourse: (lessonId: string) => Promise<void>;
  onCopyCourse: (lessonId: string) => Promise<void>;
  filterEnrollment: boolean;
  setFilterEnrollment: (v: boolean) => void;
  filterHasContent: boolean;
  setFilterHasContent: (v: boolean) => void;
  filterThisMonth: boolean;
  setFilterThisMonth: (v: boolean) => void;
  copyingLessonId: string | null;
}

export function CourseManagement({
  lang, lessons, lessonsSearchQuery, setLessonsSearchQuery,
  lessonsSortOrder, setLessonsSortOrder, filteredLessons,
  onOpenImportLessons, onOpenCourseWizard, onViewCourse,
  onDeleteCourse, onCopyCourse,
  filterEnrollment, setFilterEnrollment,
  filterHasContent, setFilterHasContent,
  filterThisMonth, setFilterThisMonth,
  copyingLessonId,
}: CourseManagementProps) {
  const [deleteTarget, setDeleteTarget] = useState<Lesson | null>(null);
  const [deleteStats, setDeleteStats] = useState<CourseStats | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteStatsLoading, setDeleteStatsLoading] = useState(false);

  const handleOpenDeleteConfirm = async (lesson: Lesson) => {
    setDeleteTarget(lesson);
    setDeleteStats(null);
    setDeleteStatsLoading(true);
    try {
      const res = await fetch(`/api/lessons/${lesson.id}/stats`);
      if (res.ok) {
        const stats = await res.json();
        setDeleteStats(stats);
      }
    } catch {
      setDeleteStats({ whiteboardCount: 0, scheduleCount: 0, enrollmentCount: 0, assignmentCount: 0 });
    } finally {
      setDeleteStatsLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await onDeleteCourse(deleteTarget.id);
      setDeleteTarget(null);
      setDeleteStats(null);
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col gap-6 h-full overflow-y-auto">
      <div className="flex-1 bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col min-h-0">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h3 className="font-medium text-gray-700 flex items-center gap-2">
            <BookOpen size={16} className="text-gray-400" />
            {lang === 'zh' ? '课程与教学环节管理 (SQLite)' : 'Courses & Lessons Management'}
          </h3>
          <div className="flex items-center gap-2">
            <button
              id="import-lessons-csv-btn"
              onClick={onOpenImportLessons}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-semibold rounded-lg shadow-3xs transition-all hover:shadow-xs hover:-translate-y-0.5 cursor-pointer"
            >
              <Upload size={14} />
              {lang === 'zh' ? '批量导入课程 (CSV)' : 'Import Lessons (CSV)'}
            </button>
            <button
              id="add-course-wizard-btn"
              onClick={onOpenCourseWizard}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 cursor-pointer"
            >
              <Plus size={14} />
              {lang === 'zh' ? '手动添加课程 (向导)' : 'Add Course Wizard'}
            </button>
          </div>
        </div>
        {lessons.length > 0 && (
          <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
            <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
              <div className="relative w-full sm:w-64">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400">
                  <Search size={14} />
                </span>
                <input
                  type="text"
                  placeholder="Search courses by title..."
                  value={lessonsSearchQuery}
                  onChange={(e) => setLessonsSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-800 shadow-sm"
                />
                {lessonsSearchQuery && (
                  <button onClick={() => setLessonsSearchQuery('')} className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-gray-400 hover:text-gray-600">
                    <X size={12} className="bg-gray-100 hover:bg-gray-200 rounded-full p-0.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">{lang === 'zh' ? '排序方式：' : 'Sort by:'}</span>
                <select
                  value={lessonsSortOrder}
                  onChange={(e) => setLessonsSortOrder(e.target.value as any)}
                  className="bg-white border border-gray-200 text-xs text-gray-755 font-bold px-2.5 py-1.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                  id="courses-sort-select"
                >
                  <option value="recent">{lang === 'zh' ? '最新创建' : 'Most Recent'}</option>
                  <option value="alphabetical">{lang === 'zh' ? '按名称 (A-Z)' : 'Alphabetical (A-Z)'}</option>
                  <option value="enrollment">{lang === 'zh' ? '学生选课人次' : 'Student Enrollment Count'}</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setFilterEnrollment(!filterEnrollment)}
                  className={`px-2 py-1 text-[10px] font-bold rounded-md border transition-all cursor-pointer ${
                    filterEnrollment
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <Users size={11} className="inline mr-0.5 -mt-0.5" />
                  {lang === 'zh' ? '有人选' : 'Enrolled'}
                </button>
                <button
                  onClick={() => setFilterHasContent(!filterHasContent)}
                  className={`px-2 py-1 text-[10px] font-bold rounded-md border transition-all cursor-pointer ${
                    filterHasContent
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <BookOpen size={11} className="inline mr-0.5 -mt-0.5" />
                  {lang === 'zh' ? '有内容' : 'Has Content'}
                </button>
                <button
                  onClick={() => setFilterThisMonth(!filterThisMonth)}
                  className={`px-2 py-1 text-[10px] font-bold rounded-md border transition-all cursor-pointer ${
                    filterThisMonth
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {lang === 'zh' ? '本月' : 'This Month'}
                </button>
              </div>
              <div className="text-xs font-semibold text-gray-500">
                Found <span className="text-indigo-650 font-bold">{filteredLessons.length}</span> of <span className="text-gray-700 font-bold">{lessons.length}</span> course{lessons.length === 1 ? '' : 's'}
              </div>
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4">
          {lessons.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 min-h-[300px]">
              <BookOpen size={48} className="mb-4 opacity-30 text-indigo-500" />
              <h3 className="text-lg font-bold text-gray-800">{lang === 'zh' ? '暂无可用课程' : 'No Courses Available'}</h3>
              <p className="mt-2 text-sm text-gray-500 text-center max-w-xs">{lang === 'zh' ? '系统中暂未部署任何课程。请通过下方按钮启动添加向导指南。' : 'There are no courses active in the system yet. Build your first curriculum!'}</p>
              <button id="empty-add-course-btn" onClick={onOpenCourseWizard} className="mt-5 flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md transition-all cursor-pointer">
                <Plus size={16} />
                {lang === 'zh' ? '使用向导指南来创建新课程' : 'Create Course via Wizard'}
              </button>
            </div>
          ) : filteredLessons.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-12 text-gray-450 text-center">
              <Search size={44} className="mb-3 opacity-30 text-gray-450" />
              <h4 className="font-semibold text-gray-700 text-sm">No Courses Match "{lessonsSearchQuery}"</h4>
              <p className="text-xs text-gray-500 mt-1 max-w-xs">Double-check the spelling or try searching for another curriculum keyword.</p>
              <button onClick={() => setLessonsSearchQuery('')} className="mt-3 text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-semibold px-3 py-1.5 rounded-lg transition-colors">
                Clear Search Filter
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredLessons.map((lesson) => {
                const isCopying = copyingLessonId === lesson.id;
                return (
                  <div key={lesson.id} className={`border border-gray-200 hover:border-indigo-300 rounded-xl p-4 flex flex-col bg-gray-50/50 hover:shadow-md transition-all ${isCopying ? 'opacity-60 pointer-events-none' : ''}`}>
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <div className="font-semibold text-gray-800 text-lg truncate cursor-pointer hover:text-indigo-600 transition-colors" title={lesson.title} onClick={() => onViewCourse(lesson.id)}>{lesson.title}</div>
                      <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 px-1.5 py-0.5 border border-indigo-100 rounded text-[10px] font-bold shrink-0">
                        <Users size={10} className="text-indigo-500" />
                        {lesson.enrollment_count || 0}
                      </span>
                    </div>
                    <div className="text-sm text-gray-500 line-clamp-3 mb-4 flex-1">
                      <Markdown>{lesson.content}</Markdown>
                    </div>
                    <div className="flex justify-between items-center mt-auto">
                      <div className="text-xs text-gray-400">ID: {lesson.id.substring(0, 8)}...</div>
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => onViewCourse(lesson.id)}
                          className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors cursor-pointer"
                          title={lang === 'zh' ? '查看编辑' : 'View & Edit'}
                        >
                          <Edit3 size={15} />
                        </button>
                        <button
                          onClick={() => onCopyCourse(lesson.id)}
                          className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors cursor-pointer"
                          title={lang === 'zh' ? '复制课程' : 'Copy Course'}
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          onClick={() => handleOpenDeleteConfirm(lesson)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                          title={lang === 'zh' ? '删除课程' : 'Delete Course'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── 删除确认弹窗 ── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 bg-red-50 flex items-center gap-2">
              <AlertTriangle size={18} className="text-red-600" />
              <h3 className="font-bold text-red-800 text-sm">
                {lang === 'zh' ? '确认删除课程' : 'Confirm Course Deletion'}
              </h3>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-gray-700">
                {lang === 'zh' ? (
                  <>确定要删除课程 <span className="font-bold text-red-600">{deleteTarget.title}</span> 吗？</>
                ) : (
                  <>Are you sure you want to delete <span className="font-bold text-red-600">{deleteTarget.title}</span>?</>
                )}
              </p>
              <p className="text-xs text-red-600 font-medium">
                {lang === 'zh' ? '此操作不可撤销，将删除课程的所有关联数据。' : 'This action is irreversible and will delete all associated data.'}
              </p>
              {deleteStatsLoading ? (
                <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                  <Loader2 size={14} className="animate-spin" />
                  {lang === 'zh' ? '正在统计关联数据...' : 'Counting related data...'}
                </div>
              ) : deleteStats ? (
                <div className="bg-gray-50 rounded-lg p-3 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-600">{lang === 'zh' ? '白板元素' : 'Whiteboard Elements'}</span>
                    <span className="font-bold text-gray-800">{deleteStats.whiteboardCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">{lang === 'zh' ? '排课记录' : 'Schedules'}</span>
                    <span className="font-bold text-gray-800">{deleteStats.scheduleCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">{lang === 'zh' ? '选课学生' : 'Enrollments'}</span>
                    <span className="font-bold text-gray-800">{deleteStats.enrollmentCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">{lang === 'zh' ? '作业任务' : 'Assignments'}</span>
                    <span className="font-bold text-gray-800">{deleteStats.assignmentCount}</span>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex justify-end gap-2">
              <button
                onClick={() => { setDeleteTarget(null); setDeleteStats(null); }}
                className="px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors cursor-pointer"
              >
                {lang === 'zh' ? '取消' : 'Cancel'}
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleteLoading}
                className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {deleteLoading && <Loader2 size={12} className="animate-spin" />}
                {lang === 'zh' ? '确认删除' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
