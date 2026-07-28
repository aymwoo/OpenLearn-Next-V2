import {
  Users,
  LayoutGrid,
  List,
  Upload,
  Search,
  X,
  Trash2,
  Shield,
  Shuffle,
  BookOpen,
  FileText,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  Settings2,
} from 'lucide-react';
import { StudentPrivateNotesEditor } from '../../../components/StudentPrivateNotesEditor';
import { parseCSV } from '../../../utils/pluginParsers.js';
import type { ClassType, StudentType, StudentProgressType, Lesson } from '../../../types/app';

export type RosterTagFilter = 'all' | 'Academic' | 'Behavioral' | 'General' | 'SpecialCare';
export type StudentActiveTab = 'progress' | 'settings' | 'notes';

export interface ClassStudentsPanelProps {
  cls: ClassType;
  classStudentsMap: Record<string, StudentType[]>;
  students: StudentType[];
  lang: 'zh' | 'en';
  selectedStudentIds: Set<string>;
  rosterViewMode: 'grid' | 'list';
  setRosterViewMode: (v: 'grid' | 'list') => void;
  rosterSearchQuery: string;
  setRosterSearchQuery: (v: string) => void;
  rosterTagFilter: RosterTagFilter;
  setRosterTagFilter: (v: RosterTagFilter) => void;
  batchMode: boolean;
  toggleSelectAllStudents: (list: StudentType[]) => void;
  handleBatchDeleteStudents: () => void;
  handleBatchResetPassword: () => void;
  handleBatchTransferStudents: () => void;
  handleBatchSetLockedLesson: () => void;
  expandedStudentId: string | null;
  setExpandedStudentId: (v: string | null) => void;
  fetchStudentProgress: (id: string) => Promise<void>;
  studentProgressMap: Record<string, StudentProgressType[]>;
  studentActiveTabs: Record<string, StudentActiveTab>;
  setStudentActiveTabs: (updater: (prev: Record<string, StudentActiveTab>) => Record<string, StudentActiveTab>) => void;
  toggleStudentSelection: (id: string) => void;
  get30DayAverageWarning: (studentId: string, classId: string) => number | null;
  lessons: Lesson[];
  setStudents: (students: StudentType[]) => void;
  setClassStudentsMap: (updater: (prev: Record<string, StudentType[]>) => Record<string, StudentType[]>) => void;
  fetchClassStudents: (id: string) => Promise<void>;
  fetchStudents: () => Promise<void>;
  parseCSV: (text: string) => { name: string; email: string }[];
}

export function ClassStudentsPanel({
  cls,
  classStudentsMap,
  students,
  lang,
  selectedStudentIds,
  rosterViewMode,
  setRosterViewMode,
  rosterSearchQuery,
  setRosterSearchQuery,
  rosterTagFilter,
  setRosterTagFilter,
  batchMode,
  toggleSelectAllStudents,
  handleBatchDeleteStudents,
  handleBatchResetPassword,
  handleBatchTransferStudents,
  handleBatchSetLockedLesson,
  expandedStudentId,
  setExpandedStudentId,
  fetchStudentProgress,
  studentProgressMap,
  studentActiveTabs,
  setStudentActiveTabs,
  toggleStudentSelection,
  get30DayAverageWarning,
  lessons,
  setStudents,
  setClassStudentsMap,
  fetchClassStudents,
  fetchStudents,
  parseCSV,
}: ClassStudentsPanelProps) {
  const cStudents = classStudentsMap[cls.id] || [];
  return (
                               <div className="mb-4 bg-white p-3 rounded-xl border border-slate-100 shadow-xs">
                                 <div className="flex items-center justify-between mb-3 border-b border-gray-200 pb-2">
                                   <div className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                                      <Users size={14} className="text-indigo-500 animate-pulse" />
                                      {lang === 'zh' ? '班级学生花名册' : 'Class Student Roster'}
                                   </div>
                                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                     <div className="flex items-center gap-1 mr-1.5 bg-slate-100 rounded-lg p-0.5">
                                        <button
                                          type="button"
                                          title={lang === 'zh' ? '卡片视图' : 'Card view'}
                                          onClick={() => setRosterViewMode('grid')}
                                          className={`p-1 rounded-md transition-colors ${rosterViewMode === 'grid' ? 'bg-white text-indigo-600 shadow-xs' : 'text-gray-500 hover:text-gray-700'}`}
                                        >
                                          <LayoutGrid size={14} />
                                        </button>
                                        <button
                                          type="button"
                                          title={lang === 'zh' ? '列表视图（便于批量选中）' : 'List view (batch select)'}
                                          onClick={() => setRosterViewMode('list')}
                                          className={`p-1 rounded-md transition-colors ${rosterViewMode === 'list' ? 'bg-white text-indigo-600 shadow-xs' : 'text-gray-500 hover:text-gray-700'}`}
                                        >
                                          <List size={14} />
                                        </button>
                                      </div>
                                     {/* Dropdown selects from existing students not currently in this class */}
                                      {students.filter(st => !cStudents.some(cs => cs.id === st.id)).length > 0 ? (
                                        <>
                                          <select
                                            id={`enroll-student-select-${cls.id}`}
                                            className="border border-slate-200 hover:border-slate-300 rounded-lg text-[10px] md:text-xs p-1.5 bg-white text-gray-750 font-sans focus:outline-none focus:ring-1 focus:ring-indigo-500 max-w-[130px]"
                                            defaultValue=""
                                          >
                                            <option value="" disabled>{lang === 'zh' ? '添加已有学生...' : 'Enroll existing...'}</option>
                                            {students.filter(st => !cStudents.some(cs => cs.id === st.id)).map(st => (
                                              <option key={st.id} value={st.id}>{st.name}</option>
                                            ))}
                                          </select>
                                          <button
                                            onClick={async (e) => {
                                              const selectEl = document.getElementById(`enroll-student-select-${cls.id}`) as HTMLSelectElement;
                                              if (selectEl && selectEl.value) {
                                                const res = await fetch(`/api/classes/${cls.id}/students`, {
                                                  method: 'POST',
                                                  headers: { 'Content-Type': 'application/json' },
                                                  body: JSON.stringify({ studentId: selectEl.value })
                                                });
                                                if (res.ok) {
                                                  await fetchClassStudents(cls.id);
                                                  selectEl.value = "";
                                                }
                                              }
                                            }}
                                            className="text-white bg-indigo-600 hover:bg-indigo-700 text-[10px] px-2 py-1 rounded shadow-sm font-medium transition-colors cursor-pointer"
                                          >
                                            {lang === 'zh' ? '添加' : 'Enroll'}
                                          </button>
                                        </>
                                      ) : null}

                                      <button
                                        onClick={async (e) => {
                                          const name = window.prompt(lang === 'zh' ? '请输入学生姓名:' : 'Enter student name:');
                                          if (!name) return;
                                          const email = window.prompt(lang === 'zh' ? '请输入学生邮箱 (可选):' : 'Enter student email (optional):') || '';
                                          const password = window.prompt(lang === 'zh' ? '请输入登录密码 (可选，默认 123456):' : 'Enter login password (optional, default 123456):') || '123456';
                                          
                                          // 1. Create a new student record
                                          const createRes = await fetch('/api/students', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ name, email, password })
                                          });
                                          if (createRes.ok) {
                                            const newStudent = await createRes.json();
                                            // 2. Link student to this class ID
                                            const linkRes = await fetch(`/api/classes/${cls.id}/students`, {
                                              method: 'POST',
                                              headers: { 'Content-Type': 'application/json' },
                                              body: JSON.stringify({ studentId: newStudent.id })
                                            });
                                            if (linkRes.ok) {
                                              await fetchStudents();
                                              await fetchClassStudents(cls.id);
                                            }
                                          }
                                        }}
                                        className="text-indigo-600 bg-white hover:bg-gray-50 border border-gray-200 text-[10px] px-2 py-1 rounded shadow-sm font-medium transition-colors cursor-pointer"
                                      >
                                        + {lang === 'zh' ? '注册并加入本班' : 'Register New'}
                                      </button>

                                      <input
                                        type="file"
                                        accept=".csv"
                                        id={`bulk-enroll-csv-${cls.id}`}
                                        className="hidden"
                                        onChange={async (e) => {
                                          const file = e.target.files?.[0];
                                          if (!file) return;
                                          
                                          const reader = new FileReader();
                                          reader.onload = async (evt) => {
                                            const text = evt.target?.result as string;
                                            if (!text) return;
                                            
                                            const studentsToEnroll = parseCSV(text);
                                            if (studentsToEnroll.length === 0) {
                                              alert(lang === 'zh' 
                                                ? '未能识别出有效的学生数据。请确保 CSV 文件包含 "学生姓名" (或 "name") 和 "学生邮箱" (或 "email") 字段。' 
                                                : 'No valid student records found. Maintain at least a "name" column in your CSV.');
                                              return;
                                            }
                                            
                                            if (!window.confirm(lang === 'zh'
                                              ? `确认从此 CSV 导入并注册/加入 ${studentsToEnroll.length} 位学生到本班吗？`
                                              : `Are you sure you want to enroll ${studentsToEnroll.length} students from the selected CSV file into this class?`)) {
                                              return;
                                            }

                                            try {
                                              const res = await fetch(`/api/classes/${cls.id}/students/bulk-enroll`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ students: studentsToEnroll })
                                              });
                                              if (res.ok) {
                                                const data = await res.json();
                                                alert(lang === 'zh' 
                                                  ? `成功在该班级注册/加入了 ${data.count} 名学生！` 
                                                  : `Successfully enrolled ${data.count} students!`);
                                                await fetchStudents();
                                                await fetchClassStudents(cls.id);
                                              } else {
                                                alert(lang === 'zh' ? '导入失败，请稍后重试。' : 'Failed to import. Please retry.');
                                              }
                                            } catch (err) {
                                              alert(lang === 'zh' ? '处理过程出错，请检查格式后重试。' : 'An error occurred during CSV parsing.');
                                            }
                                          };
                                          reader.readAsText(file);
                                          e.target.value = '';
                                        }}
                                      />
                                      
                                      <button
                                        onClick={() => {
                                          document.getElementById(`bulk-enroll-csv-${cls.id}`)?.click();
                                        }}
                                        className="text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-[10px] px-2 py-1 rounded shadow-sm font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                                        title={lang === 'zh' ? '通过 CSV 批量加入学生' : 'Bulk Enroll via CSV file'}
                                      >
                                        <Upload size={10} />
                                        {lang === 'zh' ? 'CSV 批量加入' : 'CSV Bulk Enroll'}
                                      </button>
                                   </div>
                                 </div>

                                 {cStudents.length === 0 ? (
                                    <div className="text-xs text-gray-500 italic p-1 text-left">{lang === 'zh' ? '该班级暂无学生。可以使用右侧按钮添加或注册学生' : 'No students registered in this class.'}</div>
                                 ) : (() => {
                                    const filtered = cStudents.filter(st => {
                                      if (!rosterSearchQuery) return true;
                                      const q = rosterSearchQuery.toLowerCase();
                                      return (st.name && st.name.toLowerCase().includes(q)) || (st.email && st.email.toLowerCase().includes(q));
                                    });
                                    return (
                                      <div className="flex flex-col gap-2">
                                        {/* Search bar inside Class Student Roster card */}
                                        <div className="mb-1 relative" onClick={(e) => e.stopPropagation()}>
                                          <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                                            <Search size={13} className="text-gray-400" />
                                          </div>
                                          <input
                                            type="text"
                                            placeholder={lang === 'zh' ? '搜索姓名或邮箱...' : 'Search student by name or email...'}
                                            value={rosterSearchQuery}
                                            onChange={(e) => setRosterSearchQuery(e.target.value)}
                                            className="w-full pl-8 pr-8 py-1.5 bg-white border border-gray-200 hover:border-gray-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-lg text-xs font-sans transition-all focus:outline-none"
                                          />
                                          {rosterSearchQuery && (
                                            <button
                                              type="button"
                                              onClick={() => setRosterSearchQuery('')}
                                              className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
                                            >
                                              <X size={13} className="stroke-[2.5]" />
                                            </button>
                                          )}
                                        </div>

                                        {/* Quick Note Category Filters */}
                                        <div className="mb-2.5 flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                          <span className="text-[9px] font-bold text-gray-400 mr-1 uppercase tracking-wider">{lang === 'zh' ? '备忘分类' : 'Notes Tag'}:</span>
                                          <button
                                            type="button"
                                            onClick={() => setRosterTagFilter('all')}
                                            className={`px-2 py-0.5 text-[9px] font-bold rounded-full border cursor-pointer transition-all ${
                                              rosterTagFilter === 'all'
                                                ? 'bg-slate-700 text-white border-slate-700 shadow-3xs'
                                                : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                                            }`}
                                          >
                                            {lang === 'zh' ? '全部' : 'All'}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setRosterTagFilter('General')}
                                            className={`px-2 py-0.5 text-[9px] font-bold rounded-full border cursor-pointer transition-all ${
                                              rosterTagFilter === 'General'
                                                ? 'bg-emerald-600 text-white border-emerald-600 shadow-3xs'
                                                : 'bg-white text-emerald-700 border-emerald-150 hover:bg-emerald-50'
                                            }`}
                                          >
                                            {lang === 'zh' ? '日常' : 'General'}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setRosterTagFilter('Academic')}
                                            className={`px-2 py-0.5 text-[9px] font-bold rounded-full border cursor-pointer transition-all ${
                                              rosterTagFilter === 'Academic'
                                                ? 'bg-blue-600 text-white border-blue-600 shadow-3xs'
                                                : 'bg-white text-blue-700 border-blue-150 hover:bg-blue-50'
                                            }`}
                                          >
                                            {lang === 'zh' ? '学术' : 'Academic'}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setRosterTagFilter('Behavioral')}
                                            className={`px-2 py-0.5 text-[9px] font-bold rounded-full border cursor-pointer transition-all ${
                                              rosterTagFilter === 'Behavioral'
                                                ? 'bg-purple-600 text-white border-purple-600 shadow-3xs'
                                                : 'bg-white text-purple-700 border-purple-150 hover:bg-purple-50'
                                            }`}
                                          >
                                            {lang === 'zh' ? '行为' : 'Behavior'}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setRosterTagFilter('SpecialCare')}
                                            className={`px-2 py-0.5 text-[9px] font-bold rounded-full border cursor-pointer transition-all ${
                                              rosterTagFilter === 'SpecialCare'
                                                ? 'bg-rose-600 text-white border-rose-600 shadow-3xs'
                                                : 'bg-white text-rose-700 border-rose-150 hover:bg-rose-50'
                                            }`}
                                          >
                                            {lang === 'zh' ? '特别关注' : 'Care'}
                                          </button>
                                        </div>

                                        {filtered.length === 0 ? (
                                          <div className="text-xs text-gray-400 italic p-4 text-center bg-white border border-dashed border-gray-150 rounded-lg select-none">
                                            {lang === 'zh' ? '未找到符合查询条件的学生。' : 'No students matched this search criteria.'}
                                          </div>
                                        ) : (
                                          <>
                                          {(batchMode || rosterViewMode === 'list') && (
                                            <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 rounded-xl flex flex-wrap items-center gap-2">
                                              <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer select-none">
                                                <input
                                                  type="checkbox"
                                                  checked={filtered.length > 0 && filtered.every((s: any) => selectedStudentIds.has(s.id))}
                                                  onChange={() => toggleSelectAllStudents(filtered)}
                                                />
                                                {lang === 'zh' ? '全选本班' : 'Select All'}
                                              </label>
                                              <span className="text-xs text-gray-400">({selectedStudentIds.size})</span>
                                              <button
                                                onClick={handleBatchDeleteStudents}
                                                disabled={selectedStudentIds.size === 0}
                                                className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 rounded-lg font-medium transition-colors cursor-pointer disabled:opacity-50"
                                              >
                                                <Trash2 size={13} /> {lang === 'zh' ? '删除' : 'Delete'}
                                              </button>
                                              <button
                                                onClick={handleBatchResetPassword}
                                                disabled={selectedStudentIds.size === 0}
                                                className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200 rounded-lg font-medium transition-colors cursor-pointer disabled:opacity-50"
                                              >
                                                <Shield size={13} /> {lang === 'zh' ? '重置密码' : 'Reset PW'}
                                              </button>
                                              <button
                                                onClick={handleBatchTransferStudents}
                                                disabled={selectedStudentIds.size === 0}
                                                className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-violet-50 text-violet-600 hover:bg-violet-100 border border-violet-200 rounded-lg font-medium transition-colors cursor-pointer disabled:opacity-50"
                                              >
                                                <Shuffle size={13} /> {lang === 'zh' ? '转班' : 'Transfer'}
                                              </button>
                                              <button
                                                onClick={handleBatchSetLockedLesson}
                                                disabled={selectedStudentIds.size === 0}
                                                className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-teal-50 text-teal-600 hover:bg-teal-100 border border-teal-200 rounded-lg font-medium transition-colors cursor-pointer disabled:opacity-50"
                                              >
                                                <BookOpen size={13} /> {lang === 'zh' ? '设课程' : 'Lock Lesson'}
                                              </button>
                                            </div>
                                          )}
                                          <div className={rosterViewMode === 'list' ? 'flex flex-col gap-1' : 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 items-start'}>
                                            {filtered.map(st => {
                                        const isStExpanded = expandedStudentId === st.id;
                                        const progress = studentProgressMap[st.id] || [];
                                        const stActiveTab = studentActiveTabs[st.id] || 'progress';
                                        return (
                                          <div key={st.id} className="border border-slate-100/75 w-full min-w-0 flex flex-col bg-white rounded-xl p-2.5 shadow-xs hover:border-slate-200 hover:shadow-sm transition-all duration-200 text-left">
                                            <div
                                              className="flex justify-between items-center text-sm text-gray-700 py-1 cursor-pointer hover:bg-gray-50 w-full rounded gap-2"
                                              onClick={() => {
                                                if (batchMode || rosterViewMode === 'list') {
                                                  toggleStudentSelection(st.id);
                                                  return;
                                                }
                                                if (isStExpanded) {
                                                  setExpandedStudentId(null);
                                                } else {
                                                  setExpandedStudentId(st.id);
                                                  fetchStudentProgress(st.id);
                                                }
                                              }}
                                            >
                                              <div className="flex items-center gap-2 min-w-0">
                                                {(batchMode || rosterViewMode === 'list') && (
                                                  <input
                                                    type="checkbox"
                                                    className="shrink-0 accent-amber-500"
                                                    checked={selectedStudentIds.has(st.id)}
                                                    onChange={() => toggleStudentSelection(st.id)}
                                                    onClick={(e) => e.stopPropagation()}
                                                  />
                                                )}
                                                {isStExpanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                                                <div className="flex flex-col min-w-0">
                                                  <div className="flex items-center gap-1.5 min-w-0">
                                                     <span className="font-medium text-gray-800 text-xs truncate">{st.name}</span>
                                                     {(() => {
                                                       let noteCategory: string | null = null;
                                                       if (st.private_notes && st.private_notes !== '<br>' && st.private_notes.trim() !== '') {
                                                         const val = st.private_notes.trim();
                                                         if (val.startsWith('{') && val.endsWith('}')) {
                                                           try {
                                                             const parsed = JSON.parse(val);
                                                             if (parsed.html && parsed.html !== '<br>' && parsed.html.trim() !== '') {
                                                               noteCategory = parsed.category || 'General';
                                                             }
                                                           } catch (e) {
                                                             noteCategory = 'General';
                                                           }
                                                         } else {
                                                           noteCategory = 'General';
                                                         }
                                                       }
                                                       if (!noteCategory) return null;
                                                       let label = lang === 'zh' ? '备忘' : 'Dossier';
                                                       let style = 'bg-emerald-50 text-emerald-700 border-emerald-150';
                                                       if (noteCategory === 'Academic') {
                                                         label = lang === 'zh' ? '学术' : 'Academic';
                                                         style = 'bg-blue-50 text-blue-700 border-blue-150';
                                                       } else if (noteCategory === 'Behavioral') {
                                                         label = lang === 'zh' ? '行为' : 'Behavior';
                                                         style = 'bg-purple-50 text-purple-700 border-purple-150';
                                                       } else if (noteCategory === 'SpecialCare') {
                                                         label = lang === 'zh' ? '关注' : 'Care';
                                                         style = 'bg-rose-50 text-rose-700 border-rose-150 animate-pulse font-semibold';
                                                       }
                                                       return (
                                                         <span className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-bold border ${style}`} title={lang === 'zh' ? '有私密备忘录' : 'Confidential teacher observations available'}>
                                                           <FileText size={8} />
                                                           {label}
                                                         </span>
                                                       );
                                                     })()}
                                                     {(() => {
                                                       const avg30 = get30DayAverageWarning(st.id, cls.id);
                                                       if (avg30 !== null) {
                                                         return (
                                                           <span 
                                                             className="inline-flex items-center gap-0.5 bg-red-50 text-red-700 border border-red-200 px-1 py-0.5 rounded text-[9px] font-bold animate-pulse"
                                                             title={lang === 'zh' ? `30天平均成绩已降至60%以下 (${avg30}%)` : `30-day average has dropped below 60% (${avg30}%)`}
                                                           >
                                                             <ShieldAlert size={10} className="text-red-500" />
                                                             {avg30}%
                                                           </span>
                                                         );
                                                       }
                                                       return null;
                                                     })()}
                                                   </div>
                                                  {st.email && <span className="text-[9px] text-gray-400">{st.email}</span>}
                                                </div>
                                              </div>
                                              <div className="flex items-center gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                                                <button
                                                  title={lang === 'zh' ? '从当前班级移除' : 'Remove from Class'}
                                                  onClick={async (e) => {
                                                    if (window.confirm(lang === 'zh' ? `确定要将学生 [${st.name}] 从本班级移除吗？` : `Remove student [${st.name}] from this class?`)) {
                                                      const dRes = await fetch(`/api/classes/${cls.id}/students/${st.id}`, {
                                                        method: 'DELETE'
                                                      });
                                                      if (dRes.ok) {
                                                        await fetchClassStudents(cls.id);
                                                      }
                                                    }
                                                  }}
                                                  className="text-gray-400 hover:text-red-500 transition-colors p-1 cursor-pointer"
                                                >
                                                  <Trash2 size={13} />
                                                </button>
                                                <span className="text-[10px] text-gray-400 font-medium">Student</span>
                                              </div>
                                            </div>
                                            {isStExpanded && (
                                              <div className="pl-6 pb-2 pr-2 text-left">
                                                {/* Student level Tabs */}
                                                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl mb-3 max-w-[320px] border border-slate-200/40" onClick={(e) => e.stopPropagation()}>
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setStudentActiveTabs(prev => ({ ...prev, [st.id]: 'progress' }));
                                                    }}
                                                    className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer ${
                                                      stActiveTab === 'progress'
                                                        ? 'bg-white text-indigo-600 shadow-xs font-bold border border-slate-200/50'
                                                        : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
                                                    }`}
                                                  >
                                                    <BookOpen size={10} />
                                                    <span>{lang === 'zh' ? '学习进度' : 'Progress'}</span>
                                                  </button>
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setStudentActiveTabs(prev => ({ ...prev, [st.id]: 'settings' }));
                                                    }}
                                                    className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer ${
                                                      stActiveTab === 'settings'
                                                        ? 'bg-white text-indigo-600 shadow-xs font-bold border border-slate-200/50'
                                                        : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
                                                    }`}
                                                  >
                                                    <Settings2 size={10} />
                                                    <span>{lang === 'zh' ? '教学控制' : 'Control'}</span>
                                                  </button>
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setStudentActiveTabs(prev => ({ ...prev, [st.id]: 'notes' }));
                                                    }}
                                                    className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer ${
                                                      stActiveTab === 'notes'
                                                        ? 'bg-white text-indigo-600 shadow-xs font-bold border border-slate-200/50'
                                                        : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
                                                    }`}
                                                  >
                                                    <FileText size={10} />
                                                    <span>{lang === 'zh' ? '私有备忘' : 'Private Notes'}</span>
                                                  </button>
                                                </div>

                                                {stActiveTab === 'settings' ? (
                                                  <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
                                                    <div className="mt-1 flex items-center justify-between text-[11px] p-1.5 bg-gray-150/35 rounded border border-gray-100">
                                                      <span className="font-semibold text-gray-600">{lang === 'zh' ? '专注模式锁定(强制课程):' : 'Focus Mode Lock (Force Lesson):'}</span>
                                                      <select 
                                                        className="border rounded text-[11px] p-1 bg-white focus:ring-1 focus:ring-indigo-500 font-sans cursor-pointer text-gray-700"
                                                        value={st.locked_lesson_id || ""}
                                                        onChange={async (e) => {
                                                          const val = e.target.value === "" ? null : e.target.value;
                                                          const res = await fetch(`/api/students/${st.id}`, {
                                                            method: 'PUT',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ locked_lesson_id: val })
                                                          });
                                                          if (res.ok) await fetchStudents();
                                                        }}
                                                        onClick={(e) => e.stopPropagation()}
                                                      >
                                                        <option value="">{lang === 'zh' ? '无 (自主学习)' : 'None (Free Dashboard)'}</option>
                                                        {lessons.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
                                                      </select>
                                                    </div>

                                                    <div className="flex items-center justify-between text-[11px] p-1.5 bg-gray-150/35 rounded border border-gray-100 mt-1">
                                                      <span className="font-semibold text-gray-600">
                                                        {lang === 'zh' ? '该生个人登录密码:' : 'Personal Login Password:'}
                                                      </span>
                                                      <input 
                                                        type="text"
                                                        className="border rounded text-[11px] p-1 bg-white focus:ring-1 focus:ring-indigo-500 font-mono w-28 text-center select-all text-gray-750"
                                                        value={st.password || "123456"}
                                                        onChange={async (e) => {
                                                          const newPwd = e.target.value;
                                                          await fetch(`/api/students/${st.id}`, {
                                                            method: 'PUT',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ password: newPwd })
                                                          });
                                                          setStudents(prev => prev.map(s => s.id === st.id ? { ...s, password: newPwd } : s));
                                                        }}
                                                        onClick={(e) => e.stopPropagation()}
                                                        title={lang === 'zh' ? '点击可修改密码' : 'Click to edit student password'}
                                                      />
                                                    </div>
                                                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                                      <select 
                                                        id={`assign-lesson-class-${st.id}`}
                                                        className="border rounded text-[11px] p-1 flex-1 bg-white focus:ring-1 focus:ring-indigo-500 font-sans cursor-pointer text-gray-700"
                                                      >
                                                        <option value="">-- {lang === 'zh' ? '分配独立拓展课程' : 'Assign Independent Course'} --</option>
                                                        {lessons.filter(l => !progress.some(p => p.lesson_id === l.id)).map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
                                                      </select>
                                                      <button 
                                                        className="bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200 px-2 py-1 rounded text-xs font-semibold cursor-pointer"
                                                        onClick={async (e) => {
                                                          const sel = document.getElementById(`assign-lesson-class-${st.id}`) as HTMLSelectElement;
                                                          if (sel && sel.value) {
                                                            const res = await fetch(`/api/students/${st.id}/progress`, {
                                                              method: 'POST',
                                                              headers: { 'Content-Type': 'application/json' },
                                                              body: JSON.stringify({ lessonId: sel.value, completed: false, progressPercent: 0 })
                                                            });
                                                            if (res.ok) {
                                                              fetchStudentProgress(st.id);
                                                              sel.value = "";
                                                            }
                                                          }
                                                        }}
                                                      >
                                                        {lang === 'zh' ? '分配' : 'Assign'}
                                                      </button>
                                                    </div>
                                                  </div>
                                                ) : stActiveTab === 'notes' ? (
                                                  <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                                                    <StudentPrivateNotesEditor
                                                      studentId={st.id}
                                                      studentName={st.name}
                                                      initialValue={st.private_notes}
                                                      lang={lang}
                                                      onSave={async (newNotes) => {
                                                        const res = await fetch(`/api/students/${st.id}`, {
                                                          method: 'PUT',
                                                          headers: { 'Content-Type': 'application/json' },
                                                          body: JSON.stringify({ private_notes: newNotes })
                                                        });
                                                        if (res.ok) {
                                                          setStudents(prev => prev.map(s => s.id === st.id ? { ...s, private_notes: newNotes } : s));
                                                          if (classStudentsMap[cls.id]) {
                                                            setClassStudentsMap(prev => {
                                                              const list = prev[cls.id] || [];
                                                              return {
                                                                ...prev,
                                                                [cls.id]: list.map(s => s.id === st.id ? { ...s, private_notes: newNotes } : s)
                                                              };
                                                            });
                                                          }
                                                          return true;
                                                        }
                                                        return false;
                                                      }}
                                                    />
                                                  </div>
                                                ) : (
                                                  <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                                                    {progress.length === 0 ? (
                                                      <div className="text-xs text-gray-500 italic">{lang === 'zh' ? '未分配任何课程。' : 'No assigned lessons.'}</div>
                                                    ) : (
                                                      <div className="flex flex-col gap-2">
                                                        {progress.map(p => (
                                                          <div key={p.lesson_id} className="text-xs flex items-center justify-between pr-2">
                                                            <span className="truncate max-w-[130px] font-semibold text-gray-750" title={p.lesson_title}>{p.lesson_title}</span>
                                                            <div className="flex-1 mx-2 h-1.5 bg-gray-200 rounded-full overflow-hidden shrink-0">
                                                              <div className={`h-full ${p.progress_percent === 100 ? 'bg-green-500' : 'bg-indigo-500'}`} style={{ width: `${p.progress_percent}%` }}></div>
                                                            </div>
                                                            <span className="text-[9px] text-gray-400 w-6 text-right shrink-0 font-medium font-sans">{p.progress_percent}%</span>
                                                          </div>
                                                        ))}
                                                      </div>
                                                    )}
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        );
                                            })}
                                          </div>
                                        </>)}
                                      </div>
                                    );
                                 })()}
                               </div>
                               
  );
}
