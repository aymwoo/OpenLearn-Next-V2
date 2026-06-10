import React, { useState, useEffect } from 'react';
import { 
  Calendar, Check, X, Clock, Edit2, Trash2, CalendarDays, Download, Upload, 
  Plus, AlertCircle, FileSpreadsheet, RotateCcw, Filter, Search, Loader2, Sparkles
} from 'lucide-react';

interface ClassType {
  id: string;
  name: string;
  description?: string;
}

interface LessonType {
  id: string;
  title: string;
}

interface ScheduleType {
  id: string;
  class_id: string;
  lesson_id: string;
  scheduled_date: string;
  time_slot?: string | null;
  status?: 'scheduled' | 'cancelled' | 'holiday' | 'swap' | string;
  notes?: string | null;
  lesson_title?: string;
  class_name?: string;
}

interface TimetableManagerProps {
  classes: ClassType[];
  lessons: LessonType[];
  lang: 'zh' | 'en';
  onSchedulesUpdated: () => void;
}

export const TimetableManager: React.FC<TimetableManagerProps> = ({
  classes,
  lessons,
  lang,
  onSchedulesUpdated
}) => {
  // Navigation states
  const [activeTab, setActiveTab] = useState<'view' | 'adjust' | 'import_export'>('view');
  
  // Filtering states
  const [selectedClassId, setSelectedClassId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [schedules, setSchedules] = useState<ScheduleType[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  
  // Custom dialogs & form states
  const [isAddOpen, setIsAddOpen] = useState<boolean>(false);
  const [isEditOpen, setIsEditOpen] = useState<boolean>(false);
  const [selectedSchedule, setSelectedSchedule] = useState<ScheduleType | null>(null);
  
  // New schedule form state
  const [formClassId, setFormClassId] = useState<string>('');
  const [formLessonId, setFormLessonId] = useState<string>('');
  const [formDate, setFormDate] = useState<string>('');
  const [formTimeSlot, setFormTimeSlot] = useState<string>('09:00 - 10:30');
  const [formStatus, setFormStatus] = useState<string>('scheduled');
  const [formNotes, setFormNotes] = useState<string>('');
  
  // Import/Export States
  const [csvText, setCsvText] = useState<string>('');
  const [importClassId, setImportClassId] = useState<string>('');
  const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Holiday range adjustment states
  const [holStartDate, setHolStartDate] = useState<string>('');
  const [holEndDate, setHolEndDate] = useState<string>('');
  const [holType, setHolType] = useState<'holiday' | 'cancelled'>('holiday');
  const [holNotes, setHolNotes] = useState<string>('');
  
  // Time slots suggestions
  const presetTimeSlots = [
    '08:00 - 09:30',
    '09:45 - 11:15',
    '11:30 - 13:00',
    '13:30 - 15:00',
    '15:15 - 16:45',
    '19:00 - 20:30'
  ];

  const fetchAllSchedules = async () => {
    setLoading(true);
    try {
      // We will pull schedules class-by-class or design a global fetch query.
      // Since local SQLite has /api/classes/:classId/schedules, we compile results for all classes.
      const classList = selectedClassId === 'all' ? classes : classes.filter(c => c.id === selectedClassId);
      
      const all: ScheduleType[] = [];
      for (const cls of classList) {
        const res = await fetch(`/api/classes/${cls.id}/schedules`);
        if (res.ok) {
          const list = await res.json() as ScheduleType[];
          // Attach class identifier helper
          list.forEach(sch => {
            sch.class_name = cls.name;
          });
          all.push(...list);
        }
      }
      
      // Sort by scheduledDate (descending) and timeSlot (ascending)
      all.sort((a, b) => {
        const dateComp = b.scheduled_date.localeCompare(a.scheduled_date);
        if (dateComp !== 0) return dateComp;
        return (a.time_slot || '').localeCompare(b.time_slot || '');
      });
      
      setSchedules(all);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (classes.length > 0) {
      fetchAllSchedules();
    }
  }, [selectedClassId, classes]);

  // Handle schedule creation
  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formClassId || !formLessonId || !formDate) {
      alert(lang === 'zh' ? '请填写所有必填字段' : 'Please fill all required fields');
      return;
    }
    
    try {
      const response = await fetch(`/api/classes/${formClassId}/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId: formLessonId,
          scheduledDate: formDate,
          timeSlot: formTimeSlot,
          status: formStatus,
          notes: formNotes
        })
      });
      
      if (response.ok) {
        setIsAddOpen(false);
        // Reset form
        setFormClassId('');
        setFormLessonId('');
        setFormDate('');
        setFormNotes('');
        setFormStatus('scheduled');
        fetchAllSchedules();
        onSchedulesUpdated();
      } else {
        const err = await response.json();
        alert(err.error || 'Failed to schedule');
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Handle schedule edit/update (for swaps, cancellations, holidays)
  const handleUpdateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSchedule) return;
    
    try {
      const response = await fetch(`/api/classes/${selectedSchedule.class_id}/schedules/${selectedSchedule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId: formLessonId,
          scheduledDate: formDate,
          timeSlot: formTimeSlot,
          status: formStatus,
          notes: formNotes
        })
      });
      
      if (response.ok) {
        setIsEditOpen(false);
        setSelectedSchedule(null);
        fetchAllSchedules();
        onSchedulesUpdated();
      } else {
        const err = await response.json();
        alert(err.error || 'Failed to update schedule');
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Handle schedule deletion
  const handleDeleteSchedule = async (scheduleId: string, classId: string) => {
    const confirmation = confirm(
      lang === 'zh' 
        ? '您确定要完全删除该条课表排课记录吗？关联的考勤记录也将一并清除！' 
        : 'Are you sure you want to completely delete this schedule record? Associated attendance logs will be cleared as well!'
    );
    if (!confirmation) return;
    
    try {
      const response = await fetch(`/api/classes/${classId}/schedules/${scheduleId}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        fetchAllSchedules();
        onSchedulesUpdated();
      } else {
        alert('Delete failed');
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Open edit modal prefilled
  const openEditModal = (sch: ScheduleType) => {
    setSelectedSchedule(sch);
    setFormClassId(sch.class_id);
    setFormLessonId(sch.lesson_id);
    setFormDate(sch.scheduled_date);
    setFormTimeSlot(sch.time_slot || '09:00 - 10:30');
    setFormStatus(sch.status || 'scheduled');
    setFormNotes(sch.notes || '');
    setIsEditOpen(true);
  };

  // Batch holiday setter
  const handleBatchHolidayAdjustment = async () => {
    if (!holStartDate || !holEndDate) {
      alert(lang === 'zh' ? '请选择开始日期和结束日期' : 'Please select both start and end dates');
      return;
    }
    
    const countToUpdate = schedules.filter(s => {
      const d = s.scheduled_date;
      return d >= holStartDate && d <= holEndDate && s.status !== holType;
    });

    if (countToUpdate.length === 0) {
      alert(lang === 'zh' ? '在此日期范围内没有找到可调整的研究课表记录！' : 'No schedules found in the selected date range to adjust!');
      return;
    }

    const confirmText = lang === 'zh'
      ? `此操作将会把 ${holStartDate} 到 ${holEndDate} 之间的共 ${countToUpdate.length} 个课时记录一键标记为 [${holType === 'holiday' ? '假日停课' : '异常停课'}]。确认执行吗？`
      : `This will mark ${countToUpdate.length} active classes between ${holStartDate} and ${holEndDate} as [${holType}]. Continue?`;

    if (!confirm) return;
    if (!confirm(confirmText)) return;

    setLoading(true);
    let successCount = 0;
    try {
      for (const sch of countToUpdate) {
        const res = await fetch(`/api/classes/${sch.class_id}/schedules/${sch.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lessonId: sch.lesson_id,
            scheduledDate: sch.scheduled_date,
            timeSlot: sch.time_slot,
            status: holType,
            notes: holNotes || (lang === 'zh' ? '假期统一调休' : 'Holiday adjustments')
          })
        });
        if (res.ok) successCount++;
      }
      
      alert(lang === 'zh' ? `调整成功！共更新 ${successCount} 个课表安排。` : `Success! Updated ${successCount} entries.`);
      setHolStartDate('');
      setHolEndDate('');
      setHolNotes('');
      fetchAllSchedules();
      onSchedulesUpdated();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  // General CSV Export
  const handleExportCSV = () => {
    // Columns: Date, Class Name, Lesson Title, Time Slot, Status, Notes, Class ID, Lesson ID
    const headers = ['Date', 'Class Name', 'Lesson Title', 'Time Slot', 'Status', 'Notes', 'Class ID', 'Lesson ID'];
    const rows = schedules.map(s => [
      s.scheduled_date,
      s.class_name || '',
      s.lesson_title || '',
      s.time_slot || '',
      s.status || 'scheduled',
      s.notes || '',
      s.class_id,
      s.lesson_id
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))].join('\n');
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `timetable_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // General JSON Export
  const handleExportJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(schedules, null, 2));
    const link = document.createElement("a");
    link.setAttribute("href", dataStr);
    link.setAttribute("download", `timetable_export_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Handle CSV/JSON string import
  const handleImportData = async () => {
    if (!importClassId) {
      setImportMessage({ type: 'error', text: lang === 'zh' ? '请先选择需要导入的班级！' : 'Please select a Class first!' });
      return;
    }
    if (!csvText.trim()) {
      setImportMessage({ type: 'error', text: lang === 'zh' ? '请在框中输入或粘贴数据内容' : 'Please paste formatting data content!' });
      return;
    }

    try {
      let itemsToImport: any[] = [];
      const trimmed = csvText.trim();

      if (trimmed.startsWith('[')) {
        // Assume JSON Format
        const rawJson = JSON.parse(trimmed);
        itemsToImport = Array.isArray(rawJson) ? rawJson : [rawJson];
      } else {
        // Assume CSV Format
        // Header example: date, lesson_id, time_slot, status, notes
        const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length <= 1) {
          throw new Error(lang === 'zh' ? 'CSV 数据行不足（必须包含表头与内容行）' : 'Insufficient CSV rows!');
        }

        const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
        
        for (let i = 1; i < lines.length; i++) {
          const colVals = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
          const item: any = {};
          
          headers.forEach((hdr, idx) => {
            const val = colVals[idx];
            if (hdr === 'date' || hdr === 'scheduled_date') item.scheduledDate = val;
            else if (hdr === 'lesson_id' || hdr === 'lesson id' || hdr === 'lesson') item.lessonId = val;
            else if (hdr === 'time_slot' || hdr === 'time slot' || hdr === 'time') item.timeSlot = val;
            else if (hdr === 'status') item.status = val;
            else if (hdr === 'notes' || hdr === 'note') item.notes = val;
          });

          // Validation
          if (item.scheduledDate && item.lessonId) {
            itemsToImport.push(item);
          }
        }
      }

      if (itemsToImport.length === 0) {
        throw new Error(lang === 'zh' ? '未解析到合法的课时数据记录。请保证包含日期与课室ID字段！' : 'No valid schedules parsed. Date and lesson_id are required!');
      }

      // Verify that parsed lesson_ids exist or we search and maps properly
      // Match lessonIds to existing system lessons
      const verifiedItems = itemsToImport.map(item => {
        // Try exact match on lesson_id or title match
        const found = lessons.find(l => l.id === item.lessonId || l.title.toLowerCase() === item.lessonId.toLowerCase());
        return {
          lessonId: found ? found.id : (lessons[0]?.id || ''),
          scheduledDate: item.scheduledDate,
          timeSlot: item.timeSlot || '09:00 - 10:30',
          status: item.status || 'scheduled',
          notes: item.notes || ''
        };
      });

      // Post batch API
      const response = await fetch(`/api/classes/${importClassId}/schedules/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedules: verifiedItems })
      });

      if (response.ok) {
        const resData = await response.json();
        setImportMessage({ 
          type: 'success', 
          text: lang === 'zh' 
            ? `👍 导入成功！共写入 ${resData.count} 节课时安排至所选班级。` 
            : `Success! Imported ${resData.count} schedules layout.` 
        });
        setCsvText('');
        fetchAllSchedules();
        onSchedulesUpdated();
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Batch insert error');
      }

    } catch (e: any) {
      setImportMessage({ type: 'error', text: `${lang === 'zh' ? '导入失败: ' : 'Import failed: '}${e.message}` });
    }
  };

  // Filtered schedules for view list
  const filteredSchedules = schedules.filter(sch => {
    // Class filter (already applied at fetch but check safe)
    if (selectedClassId !== 'all' && sch.class_id !== selectedClassId) return false;
    
    // Status filter
    if (statusFilter !== 'all' && sch.status !== statusFilter) return false;
    
    // Search query (matches lesson title, class name, notes)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = (sch.lesson_title || '').toLowerCase().includes(q);
      const matchClass = (sch.class_name || '').toLowerCase().includes(q);
      const matchNotes = (sch.notes || '').toLowerCase().includes(q);
      return matchTitle || matchClass || matchNotes;
    }
    
    return true;
  });

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm font-sans" id="timetable_manager_container">
      {/* Header and top tab selections */}
      <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Calendar className="text-indigo-600 animate-pulse" size={22} />
            {lang === 'zh' ? '班级课表中心 & 动态调整' : 'Timetable Center & Adjustments'}
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {lang === 'zh' ? '统一管理日常排课，支持节假日批量停课、讲师临时换课、换班及 CSV 导入导出。' : 'Orchestrate routines schedules, holidays exclusions, and instructors swapping items.'}
          </p>
        </div>
        
        <div className="flex bg-gray-100 p-1 rounded-xl shrink-0 self-start sm:self-auto shadow-inner border border-slate-200/50">
          <button 
            onClick={() => setActiveTab('view')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all ${activeTab === 'view' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
          >
            {lang === 'zh' ? '🗓️ 课表看板' : 'Schedule Grid'}
          </button>
          <button 
            onClick={() => setActiveTab('adjust')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all ${activeTab === 'adjust' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
          >
            {lang === 'zh' ? '🛠️ 临时调休调课' : 'Holiday Adjusts'}
          </button>
          <button 
            onClick={() => setActiveTab('import_export')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all ${activeTab === 'import_export' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
          >
            {lang === 'zh' ? '📥 快速导入导出' : 'Import / Export'}
          </button>
        </div>
      </div>

      {/* Main workspace */}
      <div className="flex-1 overflow-y-auto p-5">
        {activeTab === 'view' && (
          <div className="flex flex-col gap-4">
            {/* Filters Row */}
            <div className="bg-slate-50 border border-slate-200/50 p-3 rounded-xl flex flex-wrap gap-3 items-center justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-gray-500 flex items-center gap-1">
                  <Filter size={13} />
                  {lang === 'zh' ? '筛选：' : 'Filters:'}
                </span>
                
                <select 
                  id="timetable_class_select"
                  title="Select Class"
                  className="bg-white border border-gray-200 rounded-lg text-xs py-1.5 px-2 text-gray-700 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 font-sans cursor-pointer"
                  value={selectedClassId}
                  onChange={e => setSelectedClassId(e.target.value)}
                >
                  <option value="all">{lang === 'zh' ? '所有班级 (All Classes)' : 'All Classes'}</option>
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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
                    setFormLessonId(lessons[0]?.id || '');
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

            {/* List Table of schedules */}
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
            ) : (
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
            )}
          </div>
        )}

        {/* Holiday batch adjustments */}
        {activeTab === 'adjust' && (
          <div className="max-w-2xl mx-auto bg-slate-50/50 border border-slate-200 rounded-2xl p-6 shadow-3xs">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 border-b border-slate-200 pb-3 mb-4">
              <Sparkles className="text-amber-500 shrink-0" size={18} />
              {lang === 'zh' ? '批量节假日调休排班' : 'Holiday / Cancellation Scheduler'}
            </h2>
            <p className="text-xs text-gray-500 mb-5">
              {lang === 'zh' 
                ? '此工具能快速把选定日期范围内的课程一键设为“假期调休”或“统一停课”，避免讲师依次手动调整，极大提高教务效率。' 
                : 'Instantly cancel or exclude classes falling within a holiday or default break period.'}
            </p>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">{lang === 'zh' ? '开始日期 *' : 'Start Date *'}</label>
                  <input 
                    type="date"
                    className="w-full border border-gray-200 rounded-lg text-xs p-2.5 bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500 transition-all font-sans text-gray-750"
                    value={holStartDate}
                    onChange={e => setHolStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">{lang === 'zh' ? '结束日期 *' : 'End Date *'}</label>
                  <input 
                    type="date"
                    className="w-full border border-gray-200 rounded-lg text-xs p-2.5 bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500 transition-all font-sans text-gray-750"
                    value={holEndDate}
                    onChange={e => setHolEndDate(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">{lang === 'zh' ? '调整状态标签' : 'Target Status'}</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                    <input 
                      type="radio" 
                      name="holType" 
                      checked={holType === 'holiday'} 
                      onChange={() => setHolType('holiday')}
                      className="accent-indigo-600 cursor-pointer"
                    />
                    🏝️ {lang === 'zh' ? '假期调休 (Holiday)' : 'Holiday Exclusion'}
                  </label>
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                    <input 
                      type="radio" 
                      name="holType" 
                      checked={holType === 'cancelled'} 
                      onChange={() => setHolType('cancelled')}
                      className="accent-red-600 cursor-pointer"
                    />
                    🛑 {lang === 'zh' ? '异常停课 (Cancelled)' : 'Suspicious Cancellation'}
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">{lang === 'zh' ? '假日说明 / 停课备注' : 'Exclusion Note / Reason'}</label>
                <input 
                  type="text"
                  placeholder={lang === 'zh' ? '例: 国庆节假期停课调休 / 因极寒气象全市停课' : 'e.g., National Day break / weather closures'}
                  className="w-full border border-gray-200 rounded-lg text-xs p-2.5 bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500 transition-all"
                  value={holNotes}
                  onChange={e => setHolNotes(e.target.value)}
                />
              </div>

              <button 
                onClick={handleBatchHolidayAdjustment}
                disabled={loading}
                className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs py-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {loading ? <Loader2 className="animate-spin" size={14} /> : <RotateCcw size={14} />}
                {lang === 'zh' ? '一键更新该周期课表' : 'Execute Batch Holiday Updates'}
              </button>
            </div>
          </div>
        )}

        {/* CSV/JSON Import & Export */}
        {activeTab === 'import_export' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Export panel */}
            <div className="bg-slate-50/50 border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2 border-b border-slate-100 pb-2.5 mb-3">
                  <Download className="text-green-600" size={16} />
                  {lang === 'zh' ? '导出系统课表' : 'Export Timetables'}
                </h3>
                <p className="text-xs text-gray-500 mb-4 leading-relaxed">
                  {lang === 'zh' 
                    ? '把系统中当前排定的所有班级课表一键备份成标准 CSV 或 JSON 文件。您可以使用 Excel 便捷编辑修改后再导入回来。' 
                    : 'Download the compiled records from SQLite memory db into standard JSON or CSV sheet formats.'}
                </p>
              </div>

              <div className="flex gap-2.5 mt-4">
                <button 
                  onClick={handleExportCSV}
                  className="flex-1 bg-white hover:bg-slate-50 text-slate-800 border border-slate-250 font-bold text-xs py-2 rounded-lg cursor-pointer transition-all flex justify-center items-center gap-1"
                >
                  <FileSpreadsheet className="text-green-600" size={13} />
                  {lang === 'zh' ? '导出为 Excel CSV' : 'Export CSV Sheet'}
                </button>
                <button 
                  onClick={handleExportJSON}
                  className="flex-1 bg-white hover:bg-slate-50 text-slate-800 border border-slate-250 font-bold text-xs py-2 rounded-lg cursor-pointer transition-all flex justify-center items-center gap-1"
                >
                  <FileSpreadsheet className="text-amber-500" size={13} />
                  {lang === 'zh' ? '导出为 JSON 树' : 'Export JSON Data'}
                </button>
              </div>
            </div>

            {/* Import panel */}
            <div className="bg-slate-50/50 border border-slate-200 rounded-xl p-5 flex flex-col gap-3">
              <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2 border-b border-slate-100 pb-2.5">
                <Upload className="text-indigo-600" size={16} />
                {lang === 'zh' ? '导入课表流程' : 'Import New Schedule'}
              </h3>
              
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">{lang === 'zh' ? '分配排定给哪一个班级 *' : 'Target Class to load schedules *'}</label>
                  <select 
                    id="import_class_select"
                    title="Import Target Class"
                    className="w-full bg-white border border-gray-200 rounded-lg text-xs p-2 text-gray-750 cursor-pointer focus:outline-hidden"
                    value={importClassId}
                    onChange={e => setImportClassId(e.target.value)}
                  >
                    <option value="">{lang === 'zh' ? '选择班级...' : 'Select Class...'}</option>
                    {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">
                    {lang === 'zh' ? '粘贴 CSV 数据内容' : 'Paste CSV data rows'}
                  </label>
                  <textarea 
                    rows={4}
                    placeholder={lang === 'zh' ? "date,lesson_id,time_slot,status,notes\n2026-06-15,les-1,09:00 - 10:30,scheduled,首节授课\n2026-06-16,les-2,10:45 - 12:15,holiday,假期放假停课" : "date,lesson_id,time_slot,status,notes\n2026-06-15,les-1,09:00 - 10:30,scheduled,First Class"}
                    className="w-full bg-white border border-gray-250 text-xs p-2 rounded-lg font-mono placeholder:text-gray-350 focus:outline-hidden"
                    value={csvText}
                    onChange={e => setCsvText(e.target.value)}
                  />
                  <span className="text-[10px] text-gray-400 mt-1 block">
                    {lang === 'zh' 
                      ? '首行必须为属性列（支持：date, lesson_id, time_slot, status, notes）。支持复制 JSON 树粘贴直接解析。' 
                      : 'Ensure first line consists of column keys (date, lesson_id, time_slots).'}
                  </span>
                </div>

                {importMessage && (
                  <div className={`p-2.5 rounded-lg text-xs border flex items-center gap-1.5 ${importMessage.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'}`}>
                    <AlertCircle size={14} />
                    <span>{importMessage.text}</span>
                  </div>
                )}

                <button 
                  onClick={handleImportData}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-2 rounded-lg cursor-pointer transition-all flex items-center justify-center gap-1 shadow-xs"
                >
                  <Plus size={13} />
                  {lang === 'zh' ? '开始解析并安全导入' : 'Execute Schema Check & Upload'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add Schedule Dialog */}
      {isAddOpen && (
        <div className="fixed inset-0 z-55 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 shadow-2xl rounded-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-150">
            <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800 flex items-center gap-1.5 text-sm xl:text-base">
                <CalendarDays className="text-indigo-600" size={18} />
                {lang === 'zh' ? '为班级排排定课次' : 'Arrange Timetable Scheduled'}
              </h3>
              <button onClick={() => setIsAddOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-150 transition-colors">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateSchedule} className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">{lang === 'zh' ? '选择对应上课班级 *' : 'Target Class *'}</label>
                <select 
                  title="Form Class ID"
                  className="w-full border border-gray-250 text-xs p-2 rounded-lg bg-white select-none cursor-pointer focus:outline-hidden"
                  value={formClassId}
                  onChange={e => setFormClassId(e.target.value)}
                  required
                >
                  <option value="">{lang === 'zh' ? '请选择班级...' : 'Select Class...'}</option>
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">{lang === 'zh' ? '对应授课课题 / 课时 *' : 'Syllabus Lesson *'}</label>
                <select 
                  title="Form Lesson ID"
                  className="w-full border border-gray-250 text-xs p-2 rounded-lg bg-white select-none cursor-pointer focus:outline-hidden"
                  value={formLessonId}
                  onChange={e => setFormLessonId(e.target.value)}
                  required
                >
                  <option value="">{lang === 'zh' ? '选择对应课时主题...' : 'Select Lesson...'}</option>
                  {lessons.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">{lang === 'zh' ? '公历排定日期 *' : 'Scheduled Date *'}</label>
                  <input 
                    type="date"
                    className="w-full border border-gray-250 text-xs p-2 rounded-lg bg-white focus:outline-hidden"
                    value={formDate}
                    onChange={e => setFormDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">{lang === 'zh' ? '日常状态' : 'Daily Status'}</label>
                  <select 
                    title="Form Status"
                    className="w-full border border-gray-250 text-xs p-2 rounded-lg bg-white cursor-pointer focus:outline-hidden"
                    value={formStatus}
                    onChange={e => setFormStatus(e.target.value)}
                  >
                    <option value="scheduled">{lang === 'zh' ? '正常授课' : 'Scheduled'}</option>
                    <option value="cancelled">{lang === 'zh' ? '停课' : 'Cancelled'}</option>
                    <option value="holiday">{lang === 'zh' ? '假期调休' : 'Holiday'}</option>
                    <option value="swap">{lang === 'zh' ? '临时授课/换课' : 'Swapped'}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">{lang === 'zh' ? '具体上课时间段' : 'Class Period / Time Slot'}</label>
                <div className="flex gap-1.5 items-center">
                  <input 
                    type="text"
                    className="flex-1 border border-gray-200 rounded-lg text-xs p-2 bg-white text-gray-750 focus:outline-hidden"
                    value={formTimeSlot}
                    onChange={e => setFormTimeSlot(e.target.value)}
                    placeholder="e.g. 09:00 - 10:30"
                  />
                  <select 
                    title="Preset Time Slot"
                    className="border border-gray-250 text-xs p-2 rounded-lg bg-white cursor-pointer focus:outline-hidden"
                    onChange={e => { if (e.target.value) setFormTimeSlot(e.target.value); }}
                  >
                    <option value="">{lang === 'zh' ? '建议课时...' : 'Presets...'}</option>
                    {presetTimeSlots.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">{lang === 'zh' ? '调课备注说明' : 'Schedule Notes'}</label>
                <input 
                  type="text"
                  placeholder={lang === 'zh' ? '例如：节假日补课、更替老师讲义，不填则无' : 'e.g. Substitute instructor lesson outline'}
                  className="w-full border border-gray-250 text-xs p-2 rounded-lg bg-white focus:outline-hidden"
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 mt-4">
                <button 
                  type="button" 
                  onClick={() => setIsAddOpen(false)}
                  className="px-3 py-1.5 rounded-lg border text-xs font-medium text-gray-500 hover:bg-gray-150 transition-colors"
                >
                  {lang === 'zh' ? '取消' : 'Cancel'}
                </button>
                <button 
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm transition-colors"
                >
                  {lang === 'zh' ? '排定并发布' : 'Publish & Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Schedule / Adjust Dialog */}
      {isEditOpen && selectedSchedule && (
        <div className="fixed inset-0 z-55 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 shadow-2xl rounded-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-150">
            <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800 flex items-center gap-1.5 text-sm xl:text-base">
                <Edit2 className="text-indigo-600" size={18} />
                {lang === 'zh' ? '微调/临时变动排课记录' : 'Custom Adjust Schedule'}
              </h3>
              <button 
                onClick={() => { setIsEditOpen(false); setSelectedSchedule(null); }} 
                className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-150 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleUpdateSchedule} className="p-4 space-y-4">
              <div className="p-2.5 bg-indigo-50 border border-indigo-100 rounded-lg text-xs leading-5">
                <div className="font-semibold text-indigo-850">{lang === 'zh' ? '提示：课表的临时变动将实时更新至今日课程气泡及学生白板客户端。' : 'Changes will load instantly on students whiteboards and dashboards.'}</div>
                <div className="text-gray-600 mt-1">{lang === 'zh' ? '目标班级：' : 'Target Class: '} <span className="font-bold">{selectedSchedule.class_name}</span></div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">{lang === 'zh' ? '换课：关联授课主体 *' : 'Swap Topic / Lesson *'}</label>
                <select 
                  id="edit_lesson_select"
                  title="Edit Lesson"
                  className="w-full border border-gray-250 text-xs p-2 rounded-lg bg-white select-none cursor-pointer focus:outline-hidden"
                  value={formLessonId}
                  onChange={e => setFormLessonId(e.target.value)}
                  required
                >
                  {lessons.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">{lang === 'zh' ? '换时间：上课日期 *' : 'Scheduled Date *'}</label>
                  <input 
                    type="date"
                    className="w-full border border-gray-250 text-xs p-2 rounded-lg bg-white focus:outline-hidden"
                    value={formDate}
                    onChange={e => setFormDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">{lang === 'zh' ? '临时教务状态' : 'Ad-hoc Status'}</label>
                  <select 
                    id="edit_status_select"
                    title="Edit Status"
                    className="w-full border border-gray-250 text-xs p-2 rounded-lg bg-white cursor-pointer focus:outline-hidden"
                    value={formStatus}
                    onChange={e => setFormStatus(e.target.value)}
                  >
                    <option value="scheduled">{lang === 'zh' ? '正常授课 (Scheduled)' : 'Scheduled'}</option>
                    <option value="cancelled">{lang === 'zh' ? '临时停课 (Cancelled)' : 'Cancelled'}</option>
                    <option value="holiday">{lang === 'zh' ? '节日假期 (Holiday)' : 'Holiday'}</option>
                    <option value="swap">{lang === 'zh' ? '换课/代授课 (Swapped)' : 'Swapped'}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">{lang === 'zh' ? '具体上课时段' : 'Class Time Slot'}</label>
                <div className="flex gap-1.5 items-center">
                  <input 
                    type="text"
                    className="flex-1 border border-gray-200 rounded-lg text-xs p-2 bg-white text-gray-750 focus:outline-hidden"
                    value={formTimeSlot}
                    onChange={e => setFormTimeSlot(e.target.value)}
                    placeholder="e.g. 09:00 - 10:30"
                  />
                  <select 
                    title="Edit Preset Time"
                    className="border border-gray-250 text-xs p-2 rounded-lg bg-white cursor-pointer focus:outline-hidden"
                    onChange={e => { if (e.target.value) setFormTimeSlot(e.target.value); }}
                  >
                    <option value="">{lang === 'zh' ? '建议时段...' : 'Presets...'}</option>
                    {presetTimeSlots.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">{lang === 'zh' ? '微调备注（说明换课/放假原因）' : 'Notes/Adjustments Reason'}</label>
                <input 
                  type="text"
                  placeholder={lang === 'zh' ? '例：国庆假停课 / 本课更替为第二节' : 'Explain reasons of ad-hoc swaps'}
                  className="w-full border border-gray-250 text-xs p-2 rounded-lg bg-white focus:outline-hidden"
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 mt-4">
                <button 
                  type="button" 
                  onClick={() => { setIsEditOpen(false); setSelectedSchedule(null); }}
                  className="px-3 py-1.5 rounded-lg border text-xs font-medium text-gray-500 hover:bg-gray-150 transition-colors"
                >
                  {lang === 'zh' ? '取消' : 'Cancel'}
                </button>
                <button 
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm transition-colors"
                >
                  {lang === 'zh' ? '保存调整' : 'Apply Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
