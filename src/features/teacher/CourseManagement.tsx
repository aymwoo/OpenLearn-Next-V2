import React from 'react';
import { BookOpen, Upload, Plus, Search, X, Users, Wand2 } from 'lucide-react';
import Markdown from 'react-markdown';
import type { Lesson } from '../../store/appStore';

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
}

export function CourseManagement({
  lang, lessons, lessonsSearchQuery, setLessonsSearchQuery,
  lessonsSortOrder, setLessonsSortOrder, filteredLessons,
  onOpenImportLessons, onOpenCourseWizard, onViewCourse,
}: CourseManagementProps) {
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
            <div className="text-xs font-semibold text-gray-500">
              Found <span className="text-indigo-650 font-bold">{filteredLessons.length}</span> of <span className="text-gray-700 font-bold">{lessons.length}</span> course{lessons.length === 1 ? '' : 's'}
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
              {filteredLessons.map((lesson) => (
                <div key={lesson.id} className="border border-gray-200 hover:border-indigo-300 rounded-xl p-4 flex flex-col bg-gray-50/50 hover:shadow-md transition-all">
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <div className="font-semibold text-gray-800 text-lg truncate" title={lesson.title}>{lesson.title}</div>
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
                    <button onClick={() => onViewCourse(lesson.id)} className="text-xs font-medium text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-2 py-1.5 rounded flex items-center gap-1 transition-colors">
                      <Wand2 size={12} /> View Interactive
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
