import type { Dispatch, SetStateAction } from 'react';
import {
  Users,
  Check,
  Trash2,
  Download,
  Shield,
  Calendar as CalendarIcon,
  ChevronDown,
  Sparkles,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { translations, type Language } from '../../../i18n';
import type {
  ClassType,
  StudentType,
  Lesson,
  StudentProgressType,
  ScheduleType,
  AttendanceType,
} from '../../../types/app';
import { parseCSV } from '../../../utils/pluginParsers.js';
import { ClassRowHeader } from './ClassRowHeader.js';
import { ClassPasscodeController } from './ClassPasscodeController.js';
import { ClassTabs } from './ClassTabs.js';
import { ClassSchedulesCharts } from './ClassSchedulesCharts';
import { ClassAssignmentsPanel } from './ClassAssignmentsPanel.js';
import { ClassScheduleAttendance } from './ClassScheduleAttendance';
import { ClassStudentsPanel } from './ClassStudentsPanel.js';
import { ManualImportButton } from './ManualImportButton.js';
import { CreateClassButton } from './CreateClassButton.js';
import { SemesterGradeManager } from '../../../components/SemesterGradeManager';

type Translation = typeof translations['zh'];

export interface ClassesViewProps {
  t: Translation;
  lang: Language;
  classes: ClassType[];
  students: StudentType[];
  lessons: Lesson[];
  batchMode: boolean;
  selectedClassIds: Set<string>;
  setSelectedClassIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedStudentIds: Dispatch<SetStateAction<Set<string>>>;
  setBatchMode: Dispatch<SetStateAction<boolean>>;
  expandedClassId: string | null;
  setExpandedClassId: (id: string | null) => void;
  exportTooltipOpen: boolean;
  setExportTooltipOpen: Dispatch<SetStateAction<boolean>>;
  exportDropdownOpen: boolean;
  setExportDropdownOpen: Dispatch<SetStateAction<boolean>>;
  isExportingAllCombined: boolean;
  loadingExportClassId: string | null;
  classStudentsMap: Record<string, StudentType[]>;
  setClassStudentsMap: Dispatch<SetStateAction<Record<string, StudentType[]>>>;
  expandedStudentId: string | null;
  setExpandedStudentId: Dispatch<SetStateAction<string | null>>;
  selectedStudentIds: Set<string>;
  rosterViewMode: 'grid' | 'list';
  setRosterViewMode: Dispatch<SetStateAction<'grid' | 'list'>>;
  rosterSearchQuery: string;
  setRosterSearchQuery: Dispatch<SetStateAction<string>>;
  rosterTagFilter: 'all' | 'Academic' | 'Behavioral' | 'General' | 'SpecialCare';
  setRosterTagFilter: Dispatch<SetStateAction<'all' | 'Academic' | 'Behavioral' | 'General' | 'SpecialCare'>>;
  toggleSelectAllStudents: (list: StudentType[]) => void;
  handleBatchDeleteStudents: () => Promise<void>;
  handleBatchResetPassword: () => Promise<void>;
  handleBatchTransferStudents: () => void;
  handleBatchSetLockedLesson: () => void;
  toggleStudentSelection: (id: string) => void;
  get30DayAverageWarning: (studentId: string, classId: string) => number | null;
  studentProgressMap: Record<string, StudentProgressType[]>;
  studentActiveTabs: Record<string, 'progress' | 'settings' | 'notes'>;
  setStudentActiveTabs: Dispatch<SetStateAction<Record<string, 'progress' | 'settings' | 'notes'>>>;
  setStudents: (students: StudentType[]) => void;
  fetchClassStudents: (id: string) => Promise<void>;
  fetchStudents: () => Promise<void>;
  parseCSV: typeof parseCSV;
  setImportError: Dispatch<SetStateAction<string | null>>;
  setImportSuccess: Dispatch<SetStateAction<string | null>>;
  setShowImportModal: Dispatch<SetStateAction<boolean>>;
  fetchClasses: () => Promise<void>;
  classSubmissionFilters: Record<string, 'all' | 'submitted' | 'graded' | 'pending'>;
  setClassSubmissionFilters: Dispatch<SetStateAction<Record<string, 'all' | 'submitted' | 'graded' | 'pending'>>>;
  classActiveTabs: Record<string, 'students' | 'assignments' | 'schedules' | 'seating' | 'grades'>;
  setClassActiveTabs: Dispatch<SetStateAction<Record<string, 'students' | 'assignments' | 'schedules' | 'seating' | 'grades'>>>;
  classProgressMap: Record<string, { lesson_id: string; lesson_title: string; average_progress: number }[]>;
  classSchedulesMap: Record<string, ScheduleType[]>;
  classDashboardMap: Record<string, any>;
  assignmentSortOrder: 'dueDate' | 'status' | 'avgScore';
  setAssignmentSortOrder: Dispatch<SetStateAction<'dueDate' | 'status' | 'avgScore'>>;
  isGeneratingPDFReport: Record<string, boolean>;
  handleGeneratePDFReport: (classId: string, className: string) => Promise<void>;
  setExportClassId: Dispatch<SetStateAction<string>>;
  setExportClassName: Dispatch<SetStateAction<string>>;
  setQuizzesWeight: Dispatch<SetStateAction<number>>;
  setAssignmentsWeight: Dispatch<SetStateAction<number>>;
  setCustomCategoryOverrides: Dispatch<SetStateAction<Record<string, 'quiz' | 'assignment'>>>;
  setIsExportWeightModalOpen: Dispatch<SetStateAction<boolean>>;
  isGeneratingAssignment: string | null;
  setQuizGeneratorClassId: Dispatch<SetStateAction<string | null>>;
  setQuizGenMode: Dispatch<SetStateAction<'scan_lesson' | 'topic'>>;
  setQuizGenSelectedLessonId: Dispatch<SetStateAction<string>>;
  setQuizGenTopic: Dispatch<SetStateAction<string>>;
  setSuggestedObjectives: Dispatch<SetStateAction<string[]>>;
  setSuggestedQuestions: Dispatch<SetStateAction<any[]>>;
  setIsQuizGeneratorOpen: Dispatch<SetStateAction<boolean>>;
  setActiveStudentId: Dispatch<SetStateAction<string | null>>;
  setSelectedAssignment: Dispatch<SetStateAction<any | null>>;
  setStudentViewStatus: Dispatch<SetStateAction<'dashboard' | 'lesson' | 'assignment'>>;
  setActiveRole: Dispatch<SetStateAction<'teacher' | 'student'>>;
  isGrading: Record<string, boolean>;
  setIsGrading: Dispatch<SetStateAction<Record<string, boolean>>>;
  fetchClassDashboard: (id: string) => Promise<void>;
  newScheduleDate: string;
  setNewScheduleDate: Dispatch<SetStateAction<string>>;
  newScheduleLessonId: string;
  setNewScheduleLessonId: Dispatch<SetStateAction<string>>;
  expandedScheduleId: string | null;
  setExpandedScheduleId: Dispatch<SetStateAction<string | null>>;
  fetchScheduleAttendance: (id: string) => Promise<void>;
  scheduleAttendanceMap: Record<string, AttendanceType[]>;
  toggleSelectAllClasses: () => void;
  handleBatchDeleteClasses: () => Promise<void>;
  handleBatchExportClasses: () => Promise<void>;
  handleBatchSetPasscode: () => Promise<void>;
  handleBatchScheduleClasses: () => void;
  handleExportAllClassesCombined: (...args: any[]) => Promise<void>;
  triggerExportForClass: (classId: string, className: string) => Promise<void>;
  fetchClassProgress: (id: string) => Promise<void>;
  fetchClassSchedules: (id: string) => Promise<void>;
  fetchStudentProgress: (id: string) => Promise<void>;
  toggleClassSelection: (id: string) => void;
}

export function ClassesView(props: ClassesViewProps) {
  return (
    <div className="flex-1 flex flex-col gap-6 h-full overflow-y-auto relative p-1 pr-3">

      {/* School Management Module */}
      <div className="flex-1 bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col min-h-0">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h3 className="font-medium text-gray-700 flex items-center gap-2">
            <Users size={16} className="text-gray-400" />
            {props.t.classes} & {props.t.students}
          </h3>
          {/* 批量管理模式开关 + 班级级操作栏 */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                props.setBatchMode(b => !b);
                props.setSelectedClassIds(new Set());
                props.setSelectedStudentIds(new Set());
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg font-medium border transition-colors cursor-pointer ${props.batchMode ? 'bg-amber-500 text-white border-amber-500' : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'}`}
            >
              <Check size={14} /> {props.lang === 'zh' ? '批量管理' : 'Batch Mode'}
            </button>
            {props.batchMode && (
              <>
                <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer select-none">
                  <input type="checkbox" checked={props.classes.length > 0 && props.selectedClassIds.size === props.classes.length} onChange={props.toggleSelectAllClasses} />
                  {props.lang === 'zh' ? '全选' : 'Select All'}
                </label>
                <span className="text-xs text-gray-400">({props.selectedClassIds.size})</span>
                <button
                  onClick={props.handleBatchDeleteClasses}
                  disabled={props.selectedClassIds.size === 0}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 rounded-lg font-medium transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Trash2 size={13} /> {props.lang === 'zh' ? '删除' : 'Delete'}
                </button>
                <button
                  onClick={props.handleBatchExportClasses}
                  disabled={props.selectedClassIds.size === 0}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200 rounded-lg font-medium transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Download size={13} /> {props.lang === 'zh' ? '导出' : 'Export'}
                </button>
                <button
                  onClick={props.handleBatchSetPasscode}
                  disabled={props.selectedClassIds.size === 0}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200 rounded-lg font-medium transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Shield size={13} /> {props.lang === 'zh' ? '设密码' : 'Passcode'}
                </button>
                <button
                  onClick={props.handleBatchScheduleClasses}
                  disabled={props.selectedClassIds.size === 0}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-violet-50 text-violet-600 hover:bg-violet-100 border border-violet-200 rounded-lg font-medium transition-colors cursor-pointer disabled:opacity-50"
                >
                  <CalendarIcon size={13} /> {props.lang === 'zh' ? '排课' : 'Schedule'}
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {props.expandedClassId && (
              <div
                className="relative font-sans animate-in fade-in duration-200"
                onMouseEnter={() => props.setExportTooltipOpen(true)}
                onMouseLeave={() => props.setExportTooltipOpen(false)}
              >
                <AnimatePresence>
                  {props.exportTooltipOpen && !props.exportDropdownOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 4, scale: 0.95 }}
                      transition={{ duration: 0.15, ease: "easeOut" }}
                      className="absolute right-0 bottom-full mb-2.5 px-3 py-1.5 bg-slate-900 text-white text-[10px] font-semibold rounded-lg shadow-xl z-55 pointer-events-none border border-slate-800 flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <span>{props.lang === 'zh' ? '导出所有班级的成绩数据' : 'Export grade data for all classes'}</span>
                      <div className="absolute right-8 -translate-x-1/2 top-full w-2 h-2 bg-slate-900 rotate-45 -mt-1 border-r border-b border-slate-800"></div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <motion.button
                  type="button"
                  id="floating-export-all-grades-btn"
                  onClick={() => props.setExportDropdownOpen(!props.exportDropdownOpen)}
                  whileHover={{
                    scale: 1.05,
                    y: -1,
                    boxShadow: "0 10px 15px -3px rgba(16, 185, 129, 0.3), 0 4px 6px -4px rgba(16, 185, 129, 0.3)"
                  }}
                  whileTap={{ scale: 0.95, y: 0 }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-linear-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-medium rounded-lg shadow-sm transition-all cursor-pointer select-none"
                >
                  <Download size={14} className="animate-pulse" />
                  <span>{props.lang === 'zh' ? '一键导出所有成绩' : 'Export All Grades'}</span>
                  <ChevronDown size={12} className={`transition-transform duration-200 ${props.exportDropdownOpen ? 'rotate-180' : ''}`} />
                </motion.button>

                {props.exportDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-150 rounded-2xl shadow-2xl z-50 p-4 font-sans text-gray-800 animate-in fade-in slide-in-from-top-3 duration-200">
                    <div className="flex items-center justify-between border-b border-gray-100 pb-2 mb-3">
                      <span className="text-[11px] font-black uppercase text-slate-400 tracking-wider">
                        {props.lang === 'zh' ? '成绩单导出工具' : 'Grade Export Tools'}
                      </span>
                      <button
                        type="button"
                        onClick={() => props.setExportDropdownOpen(false)}
                        className="text-gray-400 hover:text-gray-600 text-[10px] font-extrabold cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>

                    {/* Combined Export option */}
                    <div className="mb-4">
                      <button
                        type="button"
                        onClick={props.handleExportAllClassesCombined}
                        disabled={props.isExportingAllCombined}
                        className="w-full flex items-center justify-between gap-2 p-3 bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-100 text-emerald-950 rounded-xl font-bold text-xs cursor-pointer transition-all disabled:opacity-55"
                      >
                        <div className="flex items-center gap-2 text-left">
                          <Sparkles size={14} className="text-emerald-600 animate-pulse" />
                          <div>
                            <div className="font-extrabold">{props.lang === 'zh' ? '全班级汇总表' : 'All Classes Multi-Sheet'}</div>
                            <div className="text-[9px] text-emerald-600 font-medium">{props.lang === 'zh' ? '将所有学科班级合并至单张CSV表' : 'Consolidate everyone to a single CSV'}</div>
                          </div>
                        </div>
                        {props.isExportingAllCombined ? (
                          <Loader2 size={14} className="animate-spin text-emerald-600" />
                        ) : (
                          <ChevronRight size={14} className="text-emerald-500" />
                        )}
                      </button>
                    </div>

                    <div className="text-[9.5px] font-bold text-gray-400 uppercase tracking-widest mb-2 select-none">
                      {props.lang === 'zh' ? '选择特定学科导出' : 'Export Individual Subjects'}
                    </div>

                    {/* Classes roster */}
                    {props.classes.length === 0 ? (
                      <div className="text-center p-4 text-xs text-gray-400 italic">
                        {props.lang === 'zh' ? '暂无班级' : 'No classes available'}
                      </div>
                    ) : (
                      <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                        {props.classes.map((cls) => (
                          <button
                            key={cls.id}
                            type="button"
                            onClick={() => props.triggerExportForClass(cls.id, cls.name)}
                            disabled={props.loadingExportClassId === cls.id}
                            className="w-full text-left p-2.5 rounded-xl border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50/20 flex items-center justify-between cursor-pointer transition-all text-xs"
                          >
                            <div className="min-w-0 pr-2">
                              <div className="font-bold text-slate-800 truncate">{cls.name}</div>
                              <div className="text-[9px] text-gray-400 mt-0.5">
                                {(props.classStudentsMap[cls.id] || []).length} {props.lang === 'zh' ? '名学生已注册' : 'registered pupils'}
                              </div>
                            </div>
                            {props.loadingExportClassId === cls.id ? (
                              <Loader2 size={12} className="animate-spin text-indigo-500" />
                            ) : (
                              <Download className="text-gray-400 shrink-0 hover:text-indigo-600" size={12} />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <ManualImportButton
              lang={props.lang}
              setImportError={props.setImportError}
              setImportSuccess={props.setImportSuccess}
              setShowImportModal={props.setShowImportModal}
            />
            <CreateClassButton lang={props.lang} fetchClasses={props.fetchClasses} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {props.classes.length === 0 && props.students.length === 0 ? (
             <div className="text-center p-8 text-sm text-gray-500">
               {props.t.noClasses} & {props.t.noStudents}
             </div>
          ) : (
            <>
              {props.classes.map(cls => {
                const isExpanded = props.expandedClassId === cls.id;
                const cStudents = props.classStudentsMap[cls.id] || [];
                const activeSubmissionFilter = props.classSubmissionFilters[cls.id] || 'all';
                const recentSubs = props.classDashboardMap[cls.id]?.recentSubmissions || [];
                const performanceData = props.classDashboardMap[cls.id]?.performance || [];

                const filteredSubmissions = (() => {
                  if (activeSubmissionFilter === 'all') {
                    return recentSubs;
                  } else if (activeSubmissionFilter === 'submitted') {
                    return recentSubs.filter((sub: any) => sub.status === 'submitted');
                  } else if (activeSubmissionFilter === 'graded') {
                    return recentSubs.filter((sub: any) => sub.status === 'graded');
                  } else if (activeSubmissionFilter === 'pending') {
                    const pendingGradingSubmissions = recentSubs.filter((sub: any) => sub.status === 'submitted');
                    const unsubmittedTasks = performanceData
                      .filter((p: any) => !p.submission_status || p.submission_status === null)
                      .map((p: any) => ({
                        assignment_id: p.assignment_id,
                        assignment_title: p.assignment_title,
                        student_id: p.student_id,
                        student_name: p.student_name,
                        content: props.lang === 'zh' ? '尚未提交此作业' : 'Has not submitted this assignment yet',
                        status: 'pending_student',
                      }));
                    return [...pendingGradingSubmissions, ...unsubmittedTasks];
                  }
                  return recentSubs;
                })();
                return (
                  <div key={cls.id} className="w-full mb-1 border-b border-gray-50 flex flex-col">
                    <ClassRowHeader
                      cls={cls}
                      lang={props.lang}
                      isExpanded={isExpanded}
                      batchMode={props.batchMode}
                      selectedClassIds={props.selectedClassIds}
                      setExpandedClassId={props.setExpandedClassId}
                      setSelectedStudentIds={props.setSelectedStudentIds}
                      toggleClassSelection={props.toggleClassSelection}
                      fetchClassStudents={props.fetchClassStudents}
                      fetchClassProgress={props.fetchClassProgress}
                      fetchClassDashboard={props.fetchClassDashboard}
                      fetchClassSchedules={props.fetchClassSchedules}
                    />
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                        className="pl-6 bg-gray-50 pb-2 pt-2 border-t border-gray-100 pr-2"
                      >
                         <ClassPasscodeController cls={cls} lang={props.lang} fetchClasses={props.fetchClasses} />
                         <ClassTabs
                           cls={cls}
                           lang={props.lang}
                           classActiveTabs={props.classActiveTabs}
                           setClassActiveTabs={props.setClassActiveTabs}
                         />
                        {(props.classActiveTabs[cls.id] || 'students') === 'schedules' && (
                          <ClassSchedulesCharts
                            cls={cls}
                            lang={props.lang}
                            cStudents={cStudents}
                            classProgressMap={props.classProgressMap}
                            classSchedulesMap={props.classSchedulesMap}
                            classDashboardMap={props.classDashboardMap}
                          />
                        )}

                         {(props.classActiveTabs[cls.id] || 'students') === 'assignments' && (
                           <ClassAssignmentsPanel
                             cls={cls}
                             lang={props.lang}
                             cStudents={cStudents}
                             activeSubmissionFilter={activeSubmissionFilter}
                             classDashboardMap={props.classDashboardMap}
                             assignmentSortOrder={props.assignmentSortOrder}
                             setAssignmentSortOrder={props.setAssignmentSortOrder}
                             lessons={props.lessons}
                             isGeneratingPDFReport={props.isGeneratingPDFReport}
                             handleGeneratePDFReport={props.handleGeneratePDFReport}
                             setExportClassId={props.setExportClassId}
                             setExportClassName={props.setExportClassName}
                             setQuizzesWeight={props.setQuizzesWeight}
                             setAssignmentsWeight={props.setAssignmentsWeight}
                             setCustomCategoryOverrides={props.setCustomCategoryOverrides}
                             setIsExportWeightModalOpen={props.setIsExportWeightModalOpen}
                             isGeneratingAssignment={props.isGeneratingAssignment}
                             setQuizGeneratorClassId={props.setQuizGeneratorClassId}
                             setQuizGenMode={props.setQuizGenMode}
                             setQuizGenSelectedLessonId={props.setQuizGenSelectedLessonId}
                             setQuizGenTopic={props.setQuizGenTopic}
                             setSuggestedObjectives={props.setSuggestedObjectives}
                             setSuggestedQuestions={props.setSuggestedQuestions}
                             setIsQuizGeneratorOpen={props.setIsQuizGeneratorOpen}
                             setClassSubmissionFilters={props.setClassSubmissionFilters}
                             setActiveStudentId={props.setActiveStudentId}
                             setSelectedAssignment={props.setSelectedAssignment}
                             setStudentViewStatus={props.setStudentViewStatus}
                             setActiveRole={props.setActiveRole}
                             isGrading={props.isGrading}
                             setIsGrading={props.setIsGrading}
                             fetchClassDashboard={props.fetchClassDashboard}
                             get30DayAverageWarning={props.get30DayAverageWarning}
                           />
                         )}

                         {(props.classActiveTabs[cls.id] || 'students') === 'schedules' && (
                           <ClassScheduleAttendance
                             cls={cls}
                             lang={props.lang}
                             cStudents={cStudents}
                             newScheduleDate={props.newScheduleDate}
                             setNewScheduleDate={props.setNewScheduleDate}
                             newScheduleLessonId={props.newScheduleLessonId}
                             setNewScheduleLessonId={props.setNewScheduleLessonId}
                             lessons={props.lessons}
                             fetchClassSchedules={props.fetchClassSchedules}
                             classSchedulesMap={props.classSchedulesMap}
                             expandedScheduleId={props.expandedScheduleId}
                             setExpandedScheduleId={props.setExpandedScheduleId}
                             fetchScheduleAttendance={props.fetchScheduleAttendance}
                             scheduleAttendanceMap={props.scheduleAttendanceMap}
                             get30DayAverageWarning={props.get30DayAverageWarning}
                           />
                         )}

                         <ClassStudentsPanel
                           cls={cls}
                           classStudentsMap={props.classStudentsMap}
                           students={props.students}
                           lang={props.lang}
                           selectedStudentIds={props.selectedStudentIds}
                           rosterViewMode={props.rosterViewMode}
                           setRosterViewMode={props.setRosterViewMode}
                           rosterSearchQuery={props.rosterSearchQuery}
                           setRosterSearchQuery={props.setRosterSearchQuery}
                           rosterTagFilter={props.rosterTagFilter}
                           setRosterTagFilter={props.setRosterTagFilter}
                           batchMode={props.batchMode}
                           toggleSelectAllStudents={props.toggleSelectAllStudents}
                           handleBatchDeleteStudents={props.handleBatchDeleteStudents}
                           handleBatchResetPassword={props.handleBatchResetPassword}
                           handleBatchTransferStudents={props.handleBatchTransferStudents}
                           handleBatchSetLockedLesson={props.handleBatchSetLockedLesson}
                           expandedStudentId={props.expandedStudentId}
                           setExpandedStudentId={props.setExpandedStudentId}
                           fetchStudentProgress={props.fetchStudentProgress}
                           studentProgressMap={props.studentProgressMap}
                           studentActiveTabs={props.studentActiveTabs}
                           setStudentActiveTabs={props.setStudentActiveTabs}
                           toggleStudentSelection={props.toggleStudentSelection}
                           get30DayAverageWarning={props.get30DayAverageWarning}
                           lessons={props.lessons}
                           setStudents={props.setStudents}
                           setClassStudentsMap={props.setClassStudentsMap}
                           fetchClassStudents={props.fetchClassStudents}
                           fetchStudents={props.fetchStudents}
                           parseCSV={props.parseCSV}
                         />

                         {(props.classActiveTabs[cls.id] || 'students') === 'grades' && (
                           <SemesterGradeManager
                             classId={cls.id}
                             className={cls.name}
                             students={cStudents}
                             lang={props.lang}
                           />
                         )}
                       </motion.div>
                     )}
                   </div>
                 );
               })}
             </>
          )}
        </div>
      </div>

      </div>
  );
}
