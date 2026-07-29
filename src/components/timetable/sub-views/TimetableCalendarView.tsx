import React from 'react';
import {
  CalendarDays,
  Clock,
  Edit2,
  Trash2,
  Filter,
  Search,
  Loader2,
  Sparkles,
  Grid,
  List,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Plus,
  X
} from 'lucide-react';
import type { ClassType, ScheduleType } from '../types';
import { getWeekDates, getIsAfternoon } from '../utils/timetableUtils';

export interface TimetableCalendarViewProps {
  lang: 'zh' | 'en';
  viewMode: 'list' | 'week' | 'cycle';
  setViewMode: (mode: 'list' | 'week' | 'cycle') => void;
  selectedClassId: string;
  setSelectedClassId: (id: string) => void;
  statusFilter: string;
  setStatusFilter: (status: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  classes: ClassType[];
  getClassDisplayName: (name: string) => string;
  loading: boolean;
  filteredSchedules: ScheduleType[];
  currentWeekMonday: Date;
  setCurrentWeekMonday: React.Dispatch<React.SetStateAction<Date>>;
  showWeekend: boolean;
  setShowWeekend: (show: boolean) => void;
  dateOverrides: Record<string, string>;
  setDateOverrides: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setOverridingDateKey: (key: string | null) => void;
  setOverrideMode: (mode: 'dow' | 'date') => void;
  setOverrideTargetDow: (dow: string) => void;
  setOverrideTargetDate: (date: string) => void;
  openEditModal: (sch: ScheduleType) => void;
  handleDeleteSchedule: (
    scheduleId: string,
    classId: string,
    isRepeating?: boolean,
    targetDate?: string
  ) => Promise<void>;
  getDayOfWeekIndex: (dateStr: string) => number;
  getMonday: (d: Date) => Date;
  getWeekRangeString: (monday: Date) => string;
  setFormClassId: (id: string) => void;
  setFormLessonId: (id: string) => void;
  setFormDate: (date: string) => void;
  setFormStatus: (status: string) => void;
  setFormNotes: (notes: string) => void;
  setIsAddOpen: (open: boolean) => void;
}

export const TimetableCalendarView: React.FC<TimetableCalendarViewProps> = ({
  lang,
  viewMode,
  setViewMode,
  selectedClassId,
  setSelectedClassId,
  statusFilter,
  setStatusFilter,
  searchQuery,
  setSearchQuery,
  classes,
  getClassDisplayName,
  loading,
  filteredSchedules,
  currentWeekMonday,
  setCurrentWeekMonday,
  showWeekend,
  setShowWeekend,
  dateOverrides,
  setDateOverrides,
  setOverridingDateKey,
  setOverrideMode,
  setOverrideTargetDow,
  setOverrideTargetDate,
  openEditModal,
  handleDeleteSchedule,
  getDayOfWeekIndex,
  getMonday,
  getWeekRangeString,
  setFormClassId,
  setFormLessonId,
  setFormDate,
  setFormStatus,
  setFormNotes,
  setIsAddOpen
}) => {
  const weekDays = [
    { key: 1, label: lang === 'zh' ? '周一 (Mon)' : 'Mon' },
    { key: 2, label: lang === 'zh' ? '周二 (Tue)' : 'Tue' },
    { key: 3, label: lang === 'zh' ? '周三 (Wed)' : 'Wed' },
    { key: 4, label: lang === 'zh' ? '周四 (Thu)' : 'Thu' },
    { key: 5, label: lang === 'zh' ? '周五 (Fri)' : 'Fri' },
    { key: 6, label: lang === 'zh' ? '周六 (Sat)' : 'Sat' },
    { key: 7, label: lang === 'zh' ? '周日 (Sun)' : 'Sun' }
  ];

  const weekDates = getWeekDates(currentWeekMonday);

  const renderScheduleCard = (sch: ScheduleType) => {
    const isCancel = sch.status === 'cancelled' || sch.status === 'holiday';

    let statusColorClass = 'border-l-green-500 bg-green-50/5 hover:bg-green-50/10 hover:border-l-green-600';
    if (sch.status === 'cancelled') {
      statusColorClass = 'border-l-red-500 bg-red-50/5 hover:bg-red-50/10 hover:border-l-red-600';
    } else if (sch.status === 'holiday') {
      statusColorClass = 'border-l-amber-500 bg-amber-50/5 hover:bg-amber-50/10 hover:border-l-amber-600';
    } else if (sch.status === 'swap') {
      statusColorClass = 'border-l-blue-500 bg-blue-50/5 hover:bg-blue-50/10 hover:border-l-blue-600';
    }

    return (
      <div 
        key={sch.id} 
        className={`p-2.5 rounded-xl border border-slate-150 border-l-4 ${statusColorClass} transition-all hover:shadow-xs relative group flex flex-col justify-between min-h-[85px]`}
      >
        <div>
          <div className="text-[9px] font-mono text-slate-500 mb-1 font-bold flex justify-between items-center">
            <span className="flex items-center gap-1">
              <Clock size={11} className="text-slate-400" />
              {sch.time_slot || (lang === 'zh' ? '全天' : 'All-day')}
            </span>
            {viewMode === 'cycle' && (
              <span className="text-[8px] text-slate-400 font-sans font-normal bg-slate-100 px-1 py-0.5 rounded-sm">
                {sch.scheduled_date}
              </span>
            )}
          </div>
          <div className={`font-extrabold text-sm text-slate-805 tracking-tight leading-snug mt-1 ${isCancel ? 'line-through opacity-60 text-slate-400' : ''}`} title={sch.lesson_title || ''}>
            {sch.class_name}
          </div>
          {sch.notes && (
            <div className="text-[9px] text-amber-600 font-medium mt-1 truncate" title={sch.notes}>
              📌 {sch.notes}
            </div>
          )}
        </div>
        
        <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-slate-100/50">
          <span className={`inline-block text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide border ${
            sch.status === 'cancelled' 
              ? 'bg-red-50 border-red-100 text-red-600'
              : sch.status === 'holiday'
                ? 'bg-amber-50 border-amber-100 text-amber-600'
                : sch.status === 'swap'
                  ? 'bg-blue-50 border-blue-100 text-blue-600'
                  : 'bg-green-50 border-green-100 text-green-600'
          }`}>
            {sch.status === 'cancelled' 
              ? (lang === 'zh' ? '停课' : 'Cancelled')
              : sch.status === 'holiday'
                ? (lang === 'zh' ? '假期' : 'Holiday')
                : sch.status === 'swap'
                  ? (lang === 'zh' ? '代课' : 'Swapped')
                  : (lang === 'zh' ? '正常' : 'Active')}
          </span>

          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              onClick={() => openEditModal(sch)}
              className="text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 p-1 rounded-md transition-colors cursor-pointer"
              title={lang === 'zh' ? '微调' : 'Edit'}
            >
              <Edit2 size={11} />
            </button>
            <button 
              onClick={() => handleDeleteSchedule(sch.id, sch.class_id, sch.isRepeating, sch.scheduled_date)}
              className="text-slate-400 hover:text-red-600 hover:bg-red-50 p-1 rounded-md transition-colors cursor-pointer"
              title={lang === 'zh' ? '删除' : 'Delete'}
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const getSchedulesForDate = (target: string, virtualDate: string): ScheduleType[] => {
    if (target === virtualDate) {
      const realSchedules = filteredSchedules.filter(s => s.scheduled_date === virtualDate);
      if (realSchedules.length > 0) {
        return realSchedules;
      }

      const targetDow = getDayOfWeekIndex(virtualDate);
      const historicalSchedules = filteredSchedules.filter(s => 
        getDayOfWeekIndex(s.scheduled_date) === targetDow && 
        s.scheduled_date <= virtualDate
      );

      const latestSchedulesMap: Record<string, ScheduleType> = {};
      historicalSchedules.forEach(sch => {
        const groupKey = `${sch.class_id}_${sch.time_slot || 'all-day'}`;
        if (!latestSchedulesMap[groupKey]) {
          latestSchedulesMap[groupKey] = {
            ...sch,
            scheduled_date: virtualDate,
            isRepeating: true
          };
        }
      });

      return Object.values(latestSchedulesMap);
    }

    let targetSchedules: ScheduleType[] = [];

    if (target.startsWith('dow-')) {
      const targetDow = parseInt(target.split('-')[1], 10);
      const historicalSchedules = filteredSchedules.filter(s => 
        getDayOfWeekIndex(s.scheduled_date) === targetDow && 
        s.scheduled_date <= virtualDate
      );

      const latestSchedulesMap: Record<string, ScheduleType> = {};
      historicalSchedules.forEach(sch => {
        const groupKey = `${sch.class_id}_${sch.time_slot || 'all-day'}`;
        if (!latestSchedulesMap[groupKey]) {
          latestSchedulesMap[groupKey] = {
            ...sch,
            scheduled_date: virtualDate,
            isRepeating: true
          };
        }
      });
      targetSchedules = Object.values(latestSchedulesMap);
    } else {
      const realSchedules = filteredSchedules.filter(s => s.scheduled_date === target);
      if (realSchedules.length > 0) {
        targetSchedules = realSchedules.map(sch => ({
          ...sch,
          scheduled_date: virtualDate,
          isRepeating: true
        }));
      } else {
        const targetDow = getDayOfWeekIndex(target);
        const historicalSchedules = filteredSchedules.filter(s => 
          getDayOfWeekIndex(s.scheduled_date) === targetDow && 
          s.scheduled_date <= target
        );

        const latestSchedulesMap: Record<string, ScheduleType> = {};
        historicalSchedules.forEach(sch => {
          const groupKey = `${sch.class_id}_${sch.time_slot || 'all-day'}`;
          if (!latestSchedulesMap[groupKey]) {
            latestSchedulesMap[groupKey] = {
              ...sch,
              scheduled_date: virtualDate,
              isRepeating: true
            };
          }
        });
        targetSchedules = Object.values(latestSchedulesMap);
      }
    }

    const localOverrides = filteredSchedules.filter(s => s.scheduled_date === virtualDate);
    if (localOverrides.length > 0) {
      const mergedSchedules = [...targetSchedules];
      localOverrides.forEach(localSch => {
        const groupKey = `${localSch.class_id}_${localSch.time_slot || 'all-day'}`;
        const matchIdx = mergedSchedules.findIndex(s => `${s.class_id}_${s.time_slot || 'all-day'}` === groupKey);
        if (matchIdx !== -1) {
          mergedSchedules[matchIdx] = localSch;
        } else {
          if (localSch.status !== 'cancelled' && localSch.status !== 'holiday') {
            mergedSchedules.push(localSch);
          }
        }
      });
      return mergedSchedules;
    }

    return targetSchedules;
  };

  const weeklySchedulesByDay = weekDays.map((day, idx) => {
    const dateStr = weekDates[idx];
    const targetDateStr = dateOverrides[dateStr] || dateStr;
    const daySchedules = getSchedulesForDate(targetDateStr, dateStr);
    daySchedules.sort((a, b) => (a.time_slot || '').localeCompare(b.time_slot || ''));
    return {
      ...day,
      dateStr,
      displayLabel: lang === 'zh' ? `${day.label.split(' ')[0]} (${dateStr.substring(5)})` : `${day.label} (${dateStr.substring(5)})`,
      schedules: daySchedules
    };
  });

  const cycleSchedulesByDay = weekDays.map(day => {
    const dateStr = weekDates[day.key - 1];
    const daySchedules = filteredSchedules.filter(s => getDayOfWeekIndex(s.scheduled_date) === day.key);
    daySchedules.sort((a, b) => (a.time_slot || '').localeCompare(b.time_slot || ''));
    return {
      ...day,
      dateStr,
      displayLabel: day.label,
      schedules: daySchedules
    };
  });

  const currentSchedulesByDay = (viewMode === 'week' ? weeklySchedulesByDay : cycleSchedulesByDay)
    .filter(day => {
      if (viewMode === 'week' && !showWeekend) {
        return day.key !== 6 && day.key !== 7;
      }
      return true;
    });

  return (
    <div className="flex flex-col gap-4">
      {/* Filters Row */}
      <div className="bg-slate-50 border border-slate-200/50 p-3 rounded-xl flex flex-wrap gap-3 items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-gray-500 flex items-center gap-1">
            <Filter size={13} />
            {lang === 'zh' ? '筛选：' : 'Filters:'}
          </span>

          <div className="flex bg-slate-200/70 p-0.5 rounded-lg border border-slate-300/30 shadow-xs mr-2 shrink-0">
            <button 
              onClick={() => setViewMode('week')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 ${viewMode === 'week' ? 'bg-white text-indigo-700 shadow-xs' : 'text-gray-500 hover:text-gray-800'}`}
            >
              <Grid size={11} />
              {lang === 'zh' ? '周课表' : 'Week View'}
            </button>
            <button 
              onClick={() => setViewMode('cycle')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 ${viewMode === 'cycle' ? 'bg-white text-indigo-700 shadow-xs' : 'text-gray-500 hover:text-gray-800'}`}
            >
              <RotateCcw size={11} />
              {lang === 'zh' ? '星期总览' : 'Cycle View'}
            </button>
            <button 
              onClick={() => setViewMode('list')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 ${viewMode === 'list' ? 'bg-white text-indigo-700 shadow-xs' : 'text-gray-500 hover:text-gray-800'}`}
            >
              <List size={11} />
              {lang === 'zh' ? '列表' : 'List View'}
            </button>
          </div>
          
          <select 
            id="timetable_class_select"
            title="Select Class"
            className="bg-white border border-gray-200 rounded-lg text-xs py-1.5 px-2 text-gray-700 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 font-sans cursor-pointer"
            value={selectedClassId}
            onChange={e => setSelectedClassId(e.target.value)}
          >
            <option value="all">{lang === 'zh' ? '所有班级 (All Classes)' : 'All Classes'}</option>
            {classes.map(c => <option key={c.id} value={c.id}>{getClassDisplayName(c.name)}</option>)}
          </select>

          <select 
            id="timetable_status_select"
            title="Select Status"
            className="bg-white border border-gray-200 rounded-lg text-xs py-1.5 px-2 text-gray-700 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 font-sans cursor-pointer"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="all">{lang === 'zh' ? '所有状态 (All Status)' : 'All Status'}</option>
            <option value="scheduled">{lang === 'zh' ? '正常上课 (Scheduled)' : 'Scheduled'}</option>
            <option value="cancelled">{lang === 'zh' ? '停课 (Cancelled)' : 'Cancelled'}</option>
            <option value="holiday">{lang === 'zh' ? '假期调休 (Holiday)' : 'Holiday'}</option>
            <option value="swap">{lang === 'zh' ? '代课换课 (Swapped)' : 'Swapped'}</option>
          </select>
        </div>

        <div className="flex items-center gap-2 flex-1 max-w-xs min-w-[200px]">
          <div className="relative w-full">
            <Search className="absolute left-2.5 top-2 text-gray-400" size={14} />
            <input 
              type="text"
              placeholder={lang === 'zh' ? '检索课程标题, 班级, 备注...' : 'Search title, class, notes...'}
              className="w-full bg-white border border-gray-200 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-gray-700 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-2 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}
          </div>

          <button 
            onClick={() => {
              setFormClassId(classes[0]?.id || '');
              setFormLessonId('');
              setFormDate(new Date().toISOString().split('T')[0]);
              setFormStatus('scheduled');
              setFormNotes('');
              setIsAddOpen(true);
            }}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs py-1.5 px-3 rounded-lg flex items-center gap-1 shadow-sm shrink-0 cursor-pointer transition-all"
          >
            <Plus size={14} />
            {lang === 'zh' ? '排定课时' : 'Schedule Class'}
          </button>
        </div>
      </div>

      {/* List / Grid Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-indigo-500">
          <Loader2 className="animate-spin mb-2" size={32} />
          <span className="text-xs font-semibold">{lang === 'zh' ? '查询数据中...' : 'Accessing SQLite Database...'}</span>
        </div>
      ) : filteredSchedules.length === 0 ? (
        <div className="text-center py-16 bg-slate-50/50 border border-dashed rounded-xl border-slate-200 flex flex-col items-center">
          <CalendarDays className="text-gray-300 mb-2" size={40} />
          <p className="text-gray-500 text-sm font-semibold">{lang === 'zh' ? '暂未匹配到对应的课次安排数据' : 'No schedules match your filters'}</p>
          <p className="text-gray-400 text-xs mt-1">{lang === 'zh' ? '您可以点击右上角“排定课时”为班级新增课程。' : 'Try adding a new entry using the schedule button above.'}</p>
        </div>
      ) : viewMode === 'list' ? (
        <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
          <table className="w-full text-left border-collapse table-auto text-sm bg-white">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-gray-600 font-semibold text-xs">
                <th className="p-3 w-[15%]">{lang === 'zh' ? '上课日期' : 'Date'}</th>
                <th className="p-3 w-[15%]">{lang === 'zh' ? '具体时间段' : 'Time Slot'}</th>
                <th className="p-3 w-[20%]">{lang === 'zh' ? '关联班级' : 'Class'}</th>
                <th className="p-3 w-[25%]">{lang === 'zh' ? '授课内容主题' : 'Lesson Topic'}</th>
                <th className="p-3 w-[10%] text-center">{lang === 'zh' ? '日常状态' : 'Status'}</th>
                <th className="p-3 w-[15%] text-right">{lang === 'zh' ? '教务微调' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-150">
              {filteredSchedules.map(sch => {
                const isCancel = sch.status === 'cancelled' || sch.status === 'holiday';
                return (
                  <tr key={sch.id} className={`hover:bg-slate-50/80 transition-colors ${isCancel ? 'bg-red-50/10 text-gray-400' : 'text-gray-700'}`}>
                    <td className="p-3 font-semibold text-xs">
                      <span className="flex items-center gap-1">
                        <CalendarDays size={13} className="text-slate-400" />
                        {sch.scheduled_date}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-xs text-indigo-750">
                      {sch.time_slot || <span className="text-[10px] text-gray-300 italic">{lang === 'zh' ? '全天' : 'All-day'}</span>}
                    </td>
                    <td className="p-3 text-xs">
                      <span className="bg-slate-100 text-slate-800 px-2 py-1 rounded-md border border-slate-250 font-medium">
                        {sch.class_name}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-col leading-snug">
                        <span className={`font-semibold ${isCancel ? 'line-through opacity-70' : ''}`}>{sch.lesson_title}</span>
                        {sch.notes && (
                          <span className={`text-[10px] italic mt-0.5 ${sch.status === 'holiday' ? 'text-amber-600 font-medium' : sch.status === 'cancelled' ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
                            📌 {sch.notes}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-center">
                      <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide border ${
                        sch.status === 'cancelled' 
                          ? 'bg-red-100 border-red-200 text-red-700'
                          : sch.status === 'holiday'
                            ? 'bg-amber-100 border-amber-200 text-amber-700'
                            : sch.status === 'swap'
                              ? 'bg-blue-100 border-blue-200 text-blue-700'
                              : 'bg-green-100 border-green-200 text-green-700'
                      }`}>
                        {sch.status === 'cancelled' 
                          ? (lang === 'zh' ? '停课' : 'Cancelled')
                          : sch.status === 'holiday'
                            ? (lang === 'zh' ? '假期调休' : 'Holiday')
                            : sch.status === 'swap'
                              ? (lang === 'zh' ? '换代课' : 'Swapped')
                              : (lang === 'zh' ? '正常上课' : 'Active')}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button 
                          onClick={() => openEditModal(sch)}
                          className="text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 p-1.5 rounded transition-colors cursor-pointer"
                          title={lang === 'zh' ? '调整此节课排课 (换课/换时间/写备注)' : 'Adjust this class (Swap/Edit)'}
                        >
                          <Edit2 size={13} />
                        </button>
                        <button 
                          onClick={() => handleDeleteSchedule(sch.id, sch.class_id)}
                          className="text-slate-500 hover:text-red-600 hover:bg-red-50 p-1.5 rounded transition-colors cursor-pointer"
                          title={lang === 'zh' ? '永久删除该课课表' : 'Delete schedule'}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {viewMode === 'week' && (
            <div className="flex flex-col md:flex-row items-center justify-between bg-indigo-50/40 border border-indigo-100/60 p-3 rounded-xl gap-3 shadow-2xs">
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setCurrentWeekMonday(prev => new Date(prev.getTime() - 7 * 24 * 60 * 60 * 1000))}
                  className="p-1.5 rounded-lg hover:bg-indigo-100 hover:text-indigo-700 text-indigo-600 transition-all cursor-pointer border border-indigo-200/50 bg-white shadow-2xs flex items-center justify-center"
                  title={lang === 'zh' ? '上一周' : 'Previous Week'}
                >
                  <ChevronLeft size={16} />
                </button>
                <button 
                  onClick={() => setCurrentWeekMonday(getMonday(new Date()))}
                  className="px-3 py-1.5 rounded-lg hover:bg-indigo-100 hover:text-indigo-700 text-indigo-600 transition-all cursor-pointer text-xs font-bold border border-indigo-200/50 bg-white shadow-2xs"
                >
                  {lang === 'zh' ? '本周' : 'This Week'}
                </button>
                <button 
                  onClick={() => setCurrentWeekMonday(prev => new Date(prev.getTime() + 7 * 24 * 60 * 60 * 1000))}
                  className="p-1.5 rounded-lg hover:bg-indigo-100 hover:text-indigo-700 text-indigo-600 transition-all cursor-pointer border border-indigo-200/50 bg-white shadow-2xs flex items-center justify-center"
                  title={lang === 'zh' ? '下一周' : 'Next Week'}
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              <div className="text-sm font-bold text-indigo-900 flex items-center gap-2">
                <CalendarDays size={16} className="text-indigo-500" />
                <span>{getWeekRangeString(currentWeekMonday)}</span>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-indigo-700 font-semibold">{lang === 'zh' ? '跳转日期：' : 'Go to Date:'}</span>
                  <input 
                    type="date" 
                    title="Go to Date"
                    className="bg-white border border-indigo-200 rounded-lg text-xs py-1 px-2 text-indigo-950 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 font-sans cursor-pointer"
                    onChange={(e) => {
                      if (e.target.value) {
                        setCurrentWeekMonday(getMonday(new Date(e.target.value)));
                      }
                    }}
                  />
                </div>

                <div className="flex items-center gap-2 border-l border-indigo-150 pl-3">
                  <label className="flex items-center gap-1.5 text-xs text-indigo-700 font-semibold cursor-pointer select-none">
                    <input 
                      type="checkbox"
                      checked={showWeekend}
                      onChange={e => setShowWeekend(e.target.checked)}
                      className="w-3.5 h-3.5 text-indigo-600 border-indigo-300 rounded-sm focus:ring-indigo-500 focus:outline-hidden cursor-pointer"
                    />
                    {lang === 'zh' ? '显示周末' : 'Show Weekend'}
                  </label>
                </div>
              </div>
            </div>
          )}

          <div className="w-full overflow-x-auto pb-2">
            <div className="flex flex-col gap-4 min-w-[1050px]">
              
              {/* 1. Weekdays Headers Grid */}
              <div className={`grid ${currentSchedulesByDay.length === 5 ? 'grid-cols-5' : 'grid-cols-7'} gap-4`}>
                {currentSchedulesByDay.map(day => (
                  <div key={`header-${day.key}`} className="bg-slate-50 border border-slate-200/50 rounded-xl p-3 text-center flex flex-col items-center justify-center gap-1 relative group/col">
                    <div className="flex items-center justify-center gap-1.5 w-full">
                      <span className="font-extrabold text-xs text-indigo-700 uppercase tracking-wider">{day.displayLabel}</span>
                      
                      {/* Override Date Button */}
                      {viewMode === 'week' && (
                        <button
                          onClick={() => {
                            const val = dateOverrides[day.dateStr] || '';
                            setOverridingDateKey(day.dateStr);
                            if (val.startsWith('dow-')) {
                              setOverrideMode('dow');
                              setOverrideTargetDow(val.split('-')[1]);
                              setOverrideTargetDate('');
                            } else if (val) {
                              setOverrideMode('date');
                              setOverrideTargetDate(val);
                              setOverrideTargetDow('');
                            } else {
                              setOverrideMode('dow');
                              setOverrideTargetDow('');
                              setOverrideTargetDate('');
                            }
                          }}
                          className="text-slate-400 hover:text-indigo-600 p-0.5 rounded-md hover:bg-slate-200/50 transition-all opacity-0 group-hover/col:opacity-100 focus:opacity-100 cursor-pointer flex items-center justify-center"
                          title={lang === 'zh' ? '临时切换显示日期' : 'Temporarily switch date'}
                        >
                          <Edit2 size={10} />
                        </button>
                      )}
                    </div>

                    {/* Override Indicator */}
                    {viewMode === 'week' && dateOverrides[day.dateStr] && (() => {
                      const val = dateOverrides[day.dateStr];
                      let label = '';
                      if (val.startsWith('dow-')) {
                        const dowNum = parseInt(val.split('-')[1], 10);
                        const dowNamesZh = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
                        const dowNamesEn = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                        label = lang === 'zh' ? `常规${dowNamesZh[dowNum]}` : `Regular ${dowNamesEn[dowNum]}`;
                      } else {
                        label = val.substring(5);
                      }
                      return (
                        <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 text-amber-700 text-[9px] px-1.5 py-0.5 rounded-md font-semibold select-none shadow-3xs animate-fade-in">
                          <span>🔄 {label}</span>
                          <button 
                            onClick={() => {
                              const next = { ...dateOverrides };
                              delete next[day.dateStr];
                              setDateOverrides(next);
                            }}
                            className="hover:text-red-600 hover:bg-amber-100 rounded-sm p-px flex items-center justify-center cursor-pointer"
                            title={lang === 'zh' ? '恢复原日期课程' : 'Reset to original'}
                          >
                            <X size={8} />
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>

              {/* 2. Morning Row Grid */}
              <div className="bg-slate-50/30 border border-slate-200/50 rounded-2xl p-3 flex flex-col gap-2.5">
                <div className="flex items-center gap-1.5 text-[9px] font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-lg w-fit select-none border border-sky-100/60 shadow-3xs">
                  <Sparkles size={10} className="animate-pulse" />
                  {lang === 'zh' ? '上午课程 (AM)' : 'Morning (AM)'}
                </div>
                
                <div className={`grid ${currentSchedulesByDay.length === 5 ? 'grid-cols-5' : 'grid-cols-7'} gap-4`}>
                  {currentSchedulesByDay.map(day => {
                    const morningSchedules = day.schedules.filter(sch => !getIsAfternoon(sch.time_slot));
                    return (
                      <div key={`morning-col-${day.key}`} className="flex flex-col gap-2 bg-white/40 p-2.5 rounded-xl border border-dashed border-slate-200/60 min-h-[160px] justify-start">
                        {morningSchedules.length === 0 ? (
                          <div className="flex-1 flex items-center justify-center text-[10px] text-slate-350 italic text-center p-3 border border-dashed border-slate-150 rounded-xl bg-white/30 select-none">
                            {lang === 'zh' ? '无课' : 'Free'}
                          </div>
                        ) : (
                          morningSchedules.map(sch => renderScheduleCard(sch))
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 3. Midday Break */}
              <div className="relative my-2 flex items-center justify-center">
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="w-full border-t-2 border-dashed border-slate-200/80"></div>
                </div>
                <div className="relative flex justify-center text-[9px] font-extrabold uppercase tracking-wider text-slate-400 bg-white px-4 py-1.5 rounded-full border border-slate-200/60 shadow-3xs">
                  ☕ {lang === 'zh' ? '午休时间 / Midday Break' : 'Lunch Break'}
                </div>
              </div>

              {/* 4. Afternoon Row Grid */}
              <div className="bg-slate-50/30 border border-slate-200/50 rounded-2xl p-3 flex flex-col gap-2.5">
                <div className="flex items-center gap-1.5 text-[9px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-lg w-fit select-none border border-amber-100/60 shadow-3xs">
                  <Clock size={10} />
                  {lang === 'zh' ? '下午课程 (PM)' : 'Afternoon (PM)'}
                </div>
                
                <div className={`grid ${currentSchedulesByDay.length === 5 ? 'grid-cols-5' : 'grid-cols-7'} gap-4`}>
                  {currentSchedulesByDay.map(day => {
                    const afternoonSchedules = day.schedules.filter(sch => getIsAfternoon(sch.time_slot));
                    return (
                      <div key={`afternoon-col-${day.key}`} className="flex flex-col gap-2 bg-white/40 p-2.5 rounded-xl border border-dashed border-slate-200/60 min-h-[160px] justify-start">
                        {afternoonSchedules.length === 0 ? (
                          <div className="flex-1 flex items-center justify-center text-[10px] text-slate-350 italic text-center p-3 border border-dashed border-slate-150 rounded-xl bg-white/30 select-none">
                            {lang === 'zh' ? '无课' : 'Free'}
                          </div>
                        ) : (
                          afternoonSchedules.map(sch => renderScheduleCard(sch))
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
};
