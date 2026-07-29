import React, { useState, useEffect, useRef } from 'react';
import { 
  Calendar, Check, X, Clock, Edit2, Trash2, CalendarDays, Download, Upload, 
  Plus, AlertCircle, FileSpreadsheet, RotateCcw, Filter, Search, Loader2, Sparkles,
  Camera, ImagePlus, ScanLine, CheckCircle2, XCircle, ArrowRight, Eye, Grid, List,
  ChevronLeft, ChevronRight
} from 'lucide-react';
import type { ClassType, LessonType, ScheduleType, TimetableManagerProps } from './timetable/types';
import { getMonday, getWeekRangeString, getWeekDates, getIsAfternoon } from './timetable/utils/timetableUtils';
import { TimetableCalendarView } from './timetable/sub-views/TimetableCalendarView';
import { TimetableAdjustView } from './timetable/sub-views/TimetableAdjustView';
import { TimetableImportExportView } from './timetable/sub-views/TimetableImportExportView';
import { TimetableOcrView } from './timetable/sub-views/TimetableOcrView';

export type { ClassType, LessonType, ScheduleType, TimetableManagerProps };

export const TimetableManager: React.FC<TimetableManagerProps> = ({
  classes,
  lessons,
  lang,
  onSchedulesUpdated,
  onClassesUpdated
}) => {
  // Navigation states
  const [activeTab, setActiveTab] = useState<'view' | 'adjust' | 'import_export' | 'ocr_import'>('view');
  const [viewMode, setViewMode] = useState<'list' | 'week' | 'cycle'>('week');
  
  // Weekly calendar states
  const getMonday = (d: Date): Date => {
    const date = new Date(d.getTime());
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(date.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday;
  };

  const [currentWeekMonday, setCurrentWeekMonday] = useState<Date>(() => getMonday(new Date()));

  const getWeekRangeString = (monday: Date): string => {
    const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
    const formatDate = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const r = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${r}`;
    };
    return `${formatDate(monday)} ~ ${formatDate(sunday)}`;
  };

  const getWeekDates = (monday: Date): string[] => {
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getTime() + i * 24 * 60 * 60 * 1000);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const r = String(d.getDate()).padStart(2, '0');
      dates.push(`${y}-${m}-${r}`);
    }
    return dates;
  };

  const getIsAfternoon = (timeSlot: string | null | undefined): boolean => {
    if (!timeSlot) return false;
    const match = timeSlot.match(/^(\d{1,2}):(\d{2})/);
    if (match) {
      const hour = parseInt(match[1], 10);
      return hour >= 12;
    }
    return false;
  };

  const renderScheduleCard = (sch: ScheduleType) => {
    const isCancel = sch.status === 'cancelled' || sch.status === 'holiday';
    
    // Status color classes with left border
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

  // Date temporary override & weekend states
  const [overridingDateKey, setOverridingDateKey] = useState<string | null>(null);
  const [overrideTargetDate, setOverrideTargetDate] = useState<string>('');
  const [overrideMode, setOverrideMode] = useState<'dow' | 'date'>('dow');
  const [overrideTargetDow, setOverrideTargetDow] = useState<string>('');
  const [dateOverrides, setDateOverrides] = useState<Record<string, string>>({});
  const [showWeekend, setShowWeekend] = useState<boolean>(false);
  
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

  // OCR Image Recognition States
  const [ocrImagePreview, setOcrImagePreview] = useState<string | null>(null);
  const [ocrImageBase64, setOcrImageBase64] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState<boolean>(false);
  const [ocrProgress, setOcrProgress] = useState<number>(0);
  const [ocrProgressStatus, setOcrProgressStatus] = useState<string>('');
  const [ocrEntries, setOcrEntries] = useState<any[]>([]);
  const [ocrMessage, setOcrMessage] = useState<{ type: 'success' | 'error' | 'info', text: string } | null>(null);
  const [ocrClassId, setOcrClassId] = useState<string>('');
  const [ocrWeekStartDate, setOcrWeekStartDate] = useState<string>('');
  const [ocrImporting, setOcrImporting] = useState<boolean>(false);
  const [ocrSelectedEntries, setOcrSelectedEntries] = useState<Set<number>>(new Set());
  const ocrFileInputRef = useRef<HTMLInputElement>(null);
  const [aiProviders, setAiProviders] = useState<{id: string; name: string; model_name: string}[]>([]);
  const [ocrProviderId, setOcrProviderId] = useState<string>('');
  
  // Time slots suggestions
  const presetTimeSlots = [
    '08:00 - 09:30',
    '09:45 - 11:15',
    '11:30 - 13:00',
    '13:30 - 15:00',
    '15:15 - 16:45',
    '19:00 - 20:30'
  ];

  const prevClassesKeyRef = useRef<string>('');
  const prevSelectedClassIdRef = useRef<string>('');

  const getDayOfWeekIndex = (dateStr: string): number => {
    try {
      const parts = dateStr.split('-');
      if (parts.length < 3) return 1;
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // 0-indexed month
      const day = parseInt(parts[2], 10);
      const date = new Date(year, month, day);
      const dayOfWeek = date.getDay(); // 0 is Sunday, 1 is Monday, ..., 6 is Saturday
      return dayOfWeek === 0 ? 7 : dayOfWeek;
    } catch (e) {
      return 1;
    }
  };

  const fetchAllSchedules = async () => {
    setLoading(true);
    try {
      let all: ScheduleType[] = [];
      if (selectedClassId === 'all') {
        const res = await fetch('/api/schedules');
        if (res.ok) {
          all = await res.json() as ScheduleType[];
        }
      } else {
        const cls = classes.find(c => c.id === selectedClassId);
        if (cls) {
          const res = await fetch(`/api/classes/${cls.id}/schedules`);
          if (res.ok) {
            all = await res.json() as ScheduleType[];
            all.forEach(sch => {
              sch.class_name = cls.name;
            });
          }
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
    const classesKey = classes.map(c => `${c.id}:${c.name}`).join(',');
    const hasClassChanged = classesKey !== prevClassesKeyRef.current;
    const hasSelectedClassChanged = selectedClassId !== prevSelectedClassIdRef.current;
    
    if (classes.length > 0 && (hasClassChanged || hasSelectedClassChanged)) {
      prevClassesKeyRef.current = classesKey;
      prevSelectedClassIdRef.current = selectedClassId;
      fetchAllSchedules();
    }
  }, [selectedClassId, classes]);

  // Fetch AI providers for OCR feature
  useEffect(() => {
    fetch('/api/ai-providers')
      .then(r => r.ok ? r.json() : [])
      .then(data => setAiProviders(Array.isArray(data) ? data : []))
      .catch(() => setAiProviders([]));
  }, []);

  // Handle schedule creation
  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formClassId || !formDate) {
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
      const isRepeating = selectedSchedule.isRepeating;
      const url = isRepeating 
        ? `/api/classes/${selectedSchedule.class_id}/schedules` 
        : `/api/classes/${selectedSchedule.class_id}/schedules/${selectedSchedule.id}`;
      const method = isRepeating ? 'POST' : 'PUT';

      const response = await fetch(url, {
        method,
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
  const handleDeleteSchedule = async (scheduleId: string, classId: string, isRepeating?: boolean, targetDate?: string) => {
    if (isRepeating && targetDate) {
      const confirmation = confirm(
        lang === 'zh'
          ? '该课程是由上周循环生成的。您确定要取消（停课）本周这一天的课程安排吗？'
          : 'This is a repeating class. Do you want to cancel (set to Cancelled) this class for this week?'
      );
      if (!confirmation) return;
      
      try {
        const sch = schedules.find(s => s.id === scheduleId);
        const response = await fetch(`/api/classes/${classId}/schedules`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lessonId: sch?.lesson_id || '',
            scheduledDate: targetDate,
            timeSlot: sch?.time_slot || '',
            status: 'cancelled',
            notes: lang === 'zh' ? '循环排课取消' : 'Repeating schedule cancelled'
          })
        });
        if (response.ok) {
          fetchAllSchedules();
          onSchedulesUpdated();
        } else {
          alert('Cancel failed');
        }
      } catch (err: any) {
        alert(err.message);
      }
      return;
    }

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

  // OCR Image Recognition handler
  const processOcrImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setOcrMessage({ type: 'error', text: lang === 'zh' ? '请选择图片文件（PNG, JPG, JPEG）' : 'Please select an image file (PNG, JPG, JPEG)' });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setOcrMessage({ type: 'error', text: lang === 'zh' ? '图片大小不能超过 20MB' : 'Image size must be under 20MB' });
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setOcrImagePreview(dataUrl);
      setOcrImageBase64(dataUrl);
      setOcrEntries([]);
      setOcrMessage(null);
      setOcrSelectedEntries(new Set());
    };
    reader.readAsDataURL(file);
  };

  const handleOcrImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processOcrImageFile(file);
  };

  const handleOcrPaste = (e: React.ClipboardEvent | ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) processOcrImageFile(file);
        return;
      }
    }
  };

  const handleOcrDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) {
      processOcrImageFile(file);
    }
  };

  // Listen for global paste when on OCR tab
  useEffect(() => {
    if (activeTab !== 'ocr_import') return;
    const handler = (e: ClipboardEvent) => handleOcrPaste(e);
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [activeTab, lang]);

  const handleOcrRecognize = async () => {
    if (!ocrImageBase64) {
      setOcrMessage({ type: 'error', text: lang === 'zh' ? '请先上传课表图片' : 'Please upload a timetable image first' });
      return;
    }
    
    setOcrLoading(true);
    setOcrProgress(0);
    setOcrProgressStatus(lang === 'zh' ? '📤 正在上传并优化图像...' : '📤 Uploading and optimizing image...');
    setOcrMessage({ type: 'info', text: lang === 'zh' ? '🔍 AI 正在分析课表图片，请稍候...' : '🔍 AI is analyzing the timetable image, please wait...' });
    setOcrEntries([]);

    let currentProgress = 0;
    const interval = setInterval(() => {
      currentProgress += Math.random() * 6 + 1; // Increment progress by 1-7%
      if (currentProgress >= 95) {
        currentProgress = 95;
        clearInterval(interval);
      }
      setOcrProgress(Math.round(currentProgress));

      // Update status text based on progress
      if (currentProgress < 20) {
        setOcrProgressStatus(lang === 'zh' ? '📤 正在上传并优化图像...' : '📤 Uploading and optimizing image...');
      } else if (currentProgress < 50) {
        setOcrProgressStatus(lang === 'zh' ? '🧠 AI 正在分析表格排版与单元格...' : '🧠 AI analyzing table layout...');
      } else if (currentProgress < 75) {
        setOcrProgressStatus(lang === 'zh' ? '📝 提取课程、班级及教师信息...' : '📝 Extracting lesson and teacher info...');
      } else {
        setOcrProgressStatus(lang === 'zh' ? '🔮 正在进行最终数据格式校验...' : '🔮 Verifying data formats...');
      }
    }, 400);
    
    try {
      const response = await fetch('/api/timetable/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: ocrImageBase64, lang, providerId: ocrProviderId || undefined })
      });
      
      const responseText = await response.text();
      let data: any;
      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error(lang === 'zh' ? `服务端返回了无效响应: ${responseText.substring(0, 150)}` : `Server returned invalid response: ${responseText.substring(0, 150)}`);
      }
      
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'OCR recognition failed');
      }
      
      clearInterval(interval);
      setOcrProgress(100);
      setOcrProgressStatus(lang === 'zh' ? '✅ 识别成功，正在载入结果...' : '✅ Recognition complete, loading results...');

      if (data.entries && data.entries.length > 0) {
        setOcrEntries(data.entries);
        // Select all by default
        setOcrSelectedEntries(new Set(data.entries.map((_: any, i: number) => i)));
        setOcrMessage({ 
          type: 'success', 
          text: lang === 'zh' 
            ? `✅ 识别成功！共检测到 ${data.entries.length} 节课程安排，请审核后导入。` 
            : `✅ Success! Detected ${data.entries.length} class entries. Review and import below.` 
        });
      } else {
        setOcrMessage({ type: 'error', text: lang === 'zh' ? '未能从图片中识别出课程信息，请尝试更清晰的图片。' : 'No class entries detected. Try a clearer image.' });
      }
    } catch (e: any) {
      clearInterval(interval);
      setOcrProgress(0);
      setOcrMessage({ type: 'error', text: `${lang === 'zh' ? 'AI 识别失败：' : 'OCR Failed: '}${e.message}` });
    } finally {
      setOcrLoading(false);
    }
  };

  const dayOfWeekToDate = (dayOfWeek: any, weekStartDate: string): string => {
    if (!weekStartDate) return '';
    try {
      const start = new Date(weekStartDate);
      let dayNum = Number(dayOfWeek);
      if (isNaN(dayNum)) {
        if (typeof dayOfWeek === 'string') {
          if (dayOfWeek.includes('一') || dayOfWeek.includes('1') || dayOfWeek.includes('Mon')) dayNum = 1;
          else if (dayOfWeek.includes('二') || dayOfWeek.includes('2') || dayOfWeek.includes('Tue')) dayNum = 2;
          else if (dayOfWeek.includes('三') || dayOfWeek.includes('3') || dayOfWeek.includes('Wed')) dayNum = 3;
          else if (dayOfWeek.includes('四') || dayOfWeek.includes('4') || dayOfWeek.includes('Thu')) dayNum = 4;
          else if (dayOfWeek.includes('五') || dayOfWeek.includes('5') || dayOfWeek.includes('Fri')) dayNum = 5;
          else if (dayOfWeek.includes('六') || dayOfWeek.includes('6') || dayOfWeek.includes('Sat')) dayNum = 6;
          else if (dayOfWeek.includes('日') || dayOfWeek.includes('天') || dayOfWeek.includes('7') || dayOfWeek.includes('Sun')) dayNum = 7;
        }
      }
      if (isNaN(dayNum) || dayNum < 1 || dayNum > 7) {
        dayNum = 1;
      }
      const offset = dayNum - 1;
      const target = new Date(start);
      target.setDate(start.getDate() + offset);
      return target.toISOString().split('T')[0];
    } catch (err) {
      console.error('Failed to convert day of week to date:', err);
      return weekStartDate;
    }
  };

  const normalizeClassName = (rawName: string): string | null => {
    if (!rawName) return null;
    const clean = rawName.replace(/\s+/g, '').trim();

    // Find the class number at the end, e.g., (6), 6班, 6, (13), 13班
    const classNumMatch = clean.match(/(\d+)(?:班)?\)?$/) || clean.match(/\((\d+)\)/);
    if (!classNumMatch) return null;
    const classNum = classNumMatch[1];

    let segment = '';
    let grade = 0;

    // 1. Check Senior High (高中): 高一, 高二, 高三
    if (clean.startsWith('高')) {
      segment = '高';
      if (clean.includes('一') || clean.includes('1')) grade = 1;
      else if (clean.includes('二') || clean.includes('2')) grade = 2;
      else if (clean.includes('三') || clean.includes('3')) grade = 3;
    }
    // 2. Check Junior High (初中): 初一, 初二, 初三, 七年级, 八年级, 九年级
    else if (clean.startsWith('初')) {
      segment = '初';
      if (clean.includes('一') || clean.includes('1')) grade = 1;
      else if (clean.includes('二') || clean.includes('2')) grade = 2;
      else if (clean.includes('三') || clean.includes('3')) grade = 3;
    } else if (clean.startsWith('七') || clean.startsWith('7')) {
      segment = '初';
      grade = 1;
    } else if (clean.startsWith('八') || clean.startsWith('8')) {
      segment = '初';
      grade = 2;
    } else if (clean.startsWith('九') || clean.startsWith('9')) {
      segment = '初';
      grade = 3;
    }
    // 3. Check Primary School (小学): 一年级, 二年级, 三年级, 四年级, 五年级, 六年级, 小学
    else if (clean.startsWith('小')) {
      segment = '小';
      if (clean.includes('一') || clean.includes('1')) grade = 1;
      else if (clean.includes('二') || clean.includes('2')) grade = 2;
      else if (clean.includes('三') || clean.includes('3')) grade = 3;
      else if (clean.includes('四') || clean.includes('4')) grade = 4;
      else if (clean.includes('五') || clean.includes('5')) grade = 5;
      else if (clean.includes('六') || clean.includes('6')) grade = 6;
    } else {
      if (clean.startsWith('一') || clean.startsWith('1')) { segment = '小'; grade = 1; }
      else if (clean.startsWith('二') || clean.startsWith('2')) { segment = '小'; grade = 2; }
      else if (clean.startsWith('三') || clean.startsWith('3')) { segment = '小'; grade = 3; }
      else if (clean.startsWith('四') || clean.startsWith('4')) { segment = '小'; grade = 4; }
      else if (clean.startsWith('五') || clean.startsWith('5')) { segment = '小'; grade = 5; }
      else if (clean.startsWith('六') || clean.startsWith('6')) { segment = '小'; grade = 6; }
    }

    if (!segment || grade === 0) {
      return null;
    }

    // Compute entry year
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;
    const baseYear = (currentMonth >= 9) ? currentYear : (currentYear - 1);
    const entryYear = baseYear - (grade - 1);

    return `${segment}${entryYear}级${classNum}班`;
  };

  const getClassDynamicTag = (className: string): string | null => {
    if (!className) return null;
    const match = className.match(/^(初|高|小|小学)(\d{4})级(\d+)班$/);
    if (!match) return null;

    const segment = match[1];
    const entryYear = parseInt(match[2], 10);
    const classNum = match[3];

    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;

    let grade = currentYear - entryYear;
    if (currentMonth >= 9) {
      grade += 1;
    }

    if (grade < 1) {
      return lang === 'zh' ? '未开学' : 'Not Started';
    }

    const maxGrade = (segment === '高' || segment === '初') ? 3 : 6;
    if (grade > maxGrade) {
      return lang === 'zh' ? '已毕业' : 'Graduated';
    }

    const chineseNumbers = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    const gradeStr = lang === 'zh' 
      ? (chineseNumbers[grade] || grade.toString()) 
      : grade.toString();

    return `${segment}${gradeStr}(${classNum})`;
  };

  const getClassDisplayName = (className: string): string => {
    const tag = getClassDynamicTag(className);
    if (tag) {
      return `${className} (${tag})`;
    }
    return className;
  };

  const findMatchedClass = (ocrClassName: string) => {
    if (!ocrClassName) return null;
    const cleanOcr = ocrClassName.replace(/\s+/g, '').toLowerCase();
    
    // 1. Try exact/substring match
    let found = classes.find(c => {
      if (!c || !c.name) return false;
      const cleanDb = c.name.replace(/\s+/g, '').toLowerCase();
      return cleanDb === cleanOcr || cleanDb.includes(cleanOcr) || cleanOcr.includes(cleanDb);
    });

    // 2. Try robust alphanumeric-only fallback match
    if (!found) {
      const ocrNum = cleanOcr.replace(/[^0-9a-zA-Z\u4e00-\u9fa5]/g, '');
      found = classes.find(c => {
        if (!c || !c.name) return false;
        const dbNum = c.name.replace(/\s+/g, '').toLowerCase().replace(/[^0-9a-zA-Z\u4e00-\u9fa5]/g, '');
        return dbNum === ocrNum || dbNum.includes(ocrNum) || ocrNum.includes(dbNum);
      });
    }
    return found || null;
  };

  const handleOcrImport = async () => {
    try {
      if (ocrSelectedEntries.size === 0) {
        setOcrMessage({ type: 'error', text: lang === 'zh' ? '请至少选择一条课程记录' : 'Please select at least one entry' });
        return;
      }

      const defaultTimeSlots: Record<number, string> = {
        1: '08:00 - 08:40',
        2: '08:50 - 09:30',
        3: '10:00 - 10:40',
        4: '10:50 - 11:30',
        5: '11:40 - 12:15',
        6: '14:20 - 15:00',
        7: '15:10 - 15:50',
        8: '16:20 - 17:00',
        9: '19:00 - 20:30'
      };

      // Calculate current Monday automatically
      const today = new Date();
      const day = today.getDay();
      const diff = today.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(today.setDate(diff));
      const autoWeekStartDate = monday.toISOString().split('T')[0];

      setOcrImporting(true);
      setOcrMessage(null);

      const selectedItems = ocrEntries.filter((_, i) => ocrSelectedEntries.has(i));
      
      // Determine which classes need to be created dynamically
      const classesToCreate = new Set<string>();
      selectedItems.forEach(entry => {
        if (entry.className) {
          const normalized = normalizeClassName(entry.className) || entry.className.trim();
          const matched = findMatchedClass(normalized);
          if (!matched) {
            classesToCreate.add(normalized);
          }
        }
      });

      // Create missing classes dynamically
      const createdClassMap: Record<string, string> = {};
      if (classesToCreate.size > 0) {
        await Promise.all(
          Array.from(classesToCreate).map(async className => {
            try {
              const res = await fetch('/api/classes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: className, description: 'OCR自动生成规范班级' })
              });
              if (res.ok) {
                const data = await res.json();
                if (data.success && data.id) {
                  createdClassMap[className] = data.id;
                }
              }
            } catch (err) {
              console.error(`Failed to dynamically create class ${className}:`, err);
            }
          })
        );

        // Notify parent to refetch classes
        if (onClassesUpdated) {
          onClassesUpdated();
        }
      }

      // Group schedules by class ID
      const groupedSchedules: Record<string, any[]> = {};
      const unmatchedClasses = new Set<string>();

      selectedItems.forEach(entry => {
        const scheduledDate = dayOfWeekToDate(entry.dayOfWeek || 1, autoWeekStartDate);
        const timeSlot = entry.timeSlot || defaultTimeSlots[entry.periodNumber] || '09:00 - 10:30';
        
        const normalized = entry.className ? (normalizeClassName(entry.className) || entry.className.trim()) : '';
        const matchedClass = findMatchedClass(normalized);
        const classId = matchedClass ? matchedClass.id : (normalized ? createdClassMap[normalized] : null);

        if (!classId) {
          if (entry.className) unmatchedClasses.add(entry.className);
          return;
        }

        // Try matching a lesson from the system by className/subject
        const matchedLesson = lessons.find(l => {
          const title = l.title.toLowerCase();
          const className = normalized.toLowerCase();
          const subject = (entry.subject || '').toLowerCase();
          return title.includes(className) || title.includes(subject) || className.includes(title);
        });

        if (!groupedSchedules[classId]) {
          groupedSchedules[classId] = [];
        }

        groupedSchedules[classId].push({
          lessonId: matchedLesson?.id || '',
          scheduledDate,
          timeSlot,
          status: 'scheduled',
          notes: `${entry.className || ''} ${entry.subject || ''} ${entry.location ? '教室:' + entry.location : ''} ${entry.teacherName ? '教师:' + entry.teacherName : ''}`.trim()
        });
      });

      const matchedClassIds = Object.keys(groupedSchedules);
      if (matchedClassIds.length === 0) {
        setOcrMessage({ 
          type: 'error', 
          text: lang === 'zh' 
            ? '无法导入：没有解析出任何有效的班级名称。' 
            : 'Could not match or create any classes for import.'
        });
        setOcrImporting(false);
        return;
      }

      // Fire parallel batch requests for each class
      let totalCount = 0;
      await Promise.all(
        matchedClassIds.map(async classId => {
          const response = await fetch(`/api/classes/${classId}/schedules/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schedules: groupedSchedules[classId] })
          });
          if (response.ok) {
            const resData = await response.json();
            totalCount += resData.count || 0;
          } else {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `Failed to import schedules for class ${classId}`);
          }
        })
      );

      // Reset OCR state upon success
      setOcrEntries([]);
      setOcrSelectedEntries(new Set());
      setOcrImagePreview(null);
      setOcrImageBase64(null);
      
      let successMsg = lang === 'zh' 
        ? `🎉 导入成功！共写入 ${totalCount} 节课时安排。` 
        : `🎉 Import successful! Saved ${totalCount} schedule entries.`;

      if (classesToCreate.size > 0) {
        const successfullyCreated = Array.from(classesToCreate).filter(name => createdClassMap[name]);
        if (successfullyCreated.length > 0) {
          successMsg += lang === 'zh'
            ? `（自动创建并规范了新班级：${successfullyCreated.join(', ')}）`
            : ` (Automatically created classes: ${successfullyCreated.join(', ')})`;
        }
      }

      setOcrMessage({ type: 'success', text: successMsg });
      fetchAllSchedules();
      onSchedulesUpdated();
    } catch (err: any) {
      console.error('OCR Import Error:', err);
      alert(`${lang === 'zh' ? '导入出错提示：' : 'Import error alert: '}${err.message}`);
      setOcrMessage({ type: 'error', text: `${lang === 'zh' ? '导入失败：' : 'Import failed: '}${err.message}` });
    } finally {
      setOcrImporting(false);
    }
  };

  const toggleOcrEntry = (index: number) => {
    setOcrSelectedEntries(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleAllOcrEntries = () => {
    if (ocrSelectedEntries.size === ocrEntries.length) {
      setOcrSelectedEntries(new Set());
    } else {
      setOcrSelectedEntries(new Set(ocrEntries.map((_, i) => i)));
    }
  };

  const dayNames = lang === 'zh' 
    ? ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']
    : ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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
          if (item.scheduledDate) {
            itemsToImport.push(item);
          }
        }
      }

      if (itemsToImport.length === 0) {
        throw new Error(lang === 'zh' ? '未解析到合法的课时数据记录。请保证包含日期字段！' : 'No valid schedules parsed. Date is required!');
      }

      // Verify that parsed lesson_ids exist or we search and maps properly
      // Match lessonIds to existing system lessons
      const verifiedItems = itemsToImport.map(item => {
        // Try exact match on lesson_id or title match
        const found = item.lessonId ? lessons.find(l => l.id === item.lessonId || l.title.toLowerCase() === item.lessonId.toLowerCase()) : null;
        return {
          lessonId: found ? found.id : '',
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
          <button 
            onClick={() => setActiveTab('ocr_import')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all ${activeTab === 'ocr_import' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
          >
            {lang === 'zh' ? '📷 AI 图片识课' : 'AI Image OCR'}
          </button>
        </div>
      </div>

      {/* Main workspace */}
      <div className="flex-1 overflow-y-auto p-5">
        {activeTab === 'view' && (
          <TimetableCalendarView
            lang={lang}
            viewMode={viewMode}
            setViewMode={setViewMode}
            selectedClassId={selectedClassId}
            setSelectedClassId={setSelectedClassId}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            classes={classes}
            getClassDisplayName={getClassDisplayName}
            loading={loading}
            filteredSchedules={filteredSchedules}
            currentWeekMonday={currentWeekMonday}
            setCurrentWeekMonday={setCurrentWeekMonday}
            showWeekend={showWeekend}
            setShowWeekend={setShowWeekend}
            dateOverrides={dateOverrides}
            setDateOverrides={setDateOverrides}
            setOverridingDateKey={setOverridingDateKey}
            setOverrideMode={setOverrideMode}
            setOverrideTargetDow={setOverrideTargetDow}
            setOverrideTargetDate={setOverrideTargetDate}
            openEditModal={openEditModal}
            handleDeleteSchedule={handleDeleteSchedule}
            getDayOfWeekIndex={getDayOfWeekIndex}
            getMonday={getMonday}
            getWeekRangeString={getWeekRangeString}
            setFormClassId={setFormClassId}
            setFormLessonId={setFormLessonId}
            setFormDate={setFormDate}
            setFormStatus={setFormStatus}
            setFormNotes={setFormNotes}
            setIsAddOpen={setIsAddOpen}
          />
        )}

        {activeTab === 'adjust' && (
          <TimetableAdjustView
            lang={lang}
            holStartDate={holStartDate}
            setHolStartDate={setHolStartDate}
            holEndDate={holEndDate}
            setHolEndDate={setHolEndDate}
            holType={holType}
            setHolType={setHolType}
            holNotes={holNotes}
            setHolNotes={setHolNotes}
            handleBatchHolidayAdjustment={handleBatchHolidayAdjustment}
            loading={loading}
          />
        )}

        {activeTab === 'import_export' && (
          <TimetableImportExportView
            lang={lang}
            classes={classes}
            getClassDisplayName={getClassDisplayName}
            handleExportCSV={handleExportCSV}
            handleExportJSON={handleExportJSON}
            importClassId={importClassId}
            setImportClassId={setImportClassId}
            csvText={csvText}
            setCsvText={setCsvText}
            importMessage={importMessage}
            handleImportData={handleImportData}
          />
        )}

        {activeTab === 'ocr_import' && (
          <TimetableOcrView
            lang={lang}
            ocrProviderId={ocrProviderId}
            setOcrProviderId={setOcrProviderId}
            aiProviders={aiProviders}
            ocrFileInputRef={ocrFileInputRef}
            handleOcrDrop={handleOcrDrop}
            handleOcrImageSelect={handleOcrImageSelect}
            ocrImagePreview={ocrImagePreview}
            setOcrImagePreview={setOcrImagePreview}
            setOcrImageBase64={setOcrImageBase64}
            setOcrEntries={setOcrEntries}
            setOcrMessage={setOcrMessage}
            setOcrSelectedEntries={setOcrSelectedEntries}
            ocrImageBase64={ocrImageBase64}
            ocrLoading={ocrLoading}
            handleOcrRecognize={handleOcrRecognize}
            ocrProgressStatus={ocrProgressStatus}
            ocrProgress={ocrProgress}
            ocrMessage={ocrMessage}
            ocrEntries={ocrEntries}
            ocrSelectedEntries={ocrSelectedEntries}
            toggleAllOcrEntries={toggleAllOcrEntries}
            toggleOcrEntry={toggleOcrEntry}
            dayNames={dayNames}
            findMatchedClass={findMatchedClass}
            handleOcrImport={handleOcrImport}
            ocrImporting={ocrImporting}
          />
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
                  {classes.map(c => <option key={c.id} value={c.id}>{getClassDisplayName(c.name)}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">{lang === 'zh' ? '对应授课课题 / 课时 (可空，上课时自选)' : 'Syllabus Lesson (Optional, select during class)'}</label>
                <select 
                  title="Form Lesson ID"
                  className="w-full border border-gray-250 text-xs p-2 rounded-lg bg-white select-none cursor-pointer focus:outline-hidden rounded-lg"
                  value={formLessonId}
                  onChange={e => setFormLessonId(e.target.value)}
                >
                  <option value="">{lang === 'zh' ? '暂不设定内容 (上课时自由选择)' : 'No fixed content (select during class)'}</option>
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
                <label className="block text-xs font-semibold text-gray-700 mb-1">{lang === 'zh' ? '换课：关联授课主体 (可空，上课时自选)' : 'Swap Topic / Lesson (Optional, select during class)'}</label>
                <select 
                  id="edit_lesson_select"
                  title="Edit Lesson"
                  className="w-full border border-gray-250 text-xs p-2 rounded-lg bg-white select-none cursor-pointer focus:outline-hidden rounded-lg"
                  value={formLessonId}
                  onChange={e => setFormLessonId(e.target.value)}
                >
                  <option value="">{lang === 'zh' ? '暂不设定内容 (上课时自由选择)' : 'No fixed content (select during class)'}</option>
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

      {/* 临时切换显示日期对话框 */}
      {overridingDateKey && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-sm w-full p-5 flex flex-col gap-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                <RotateCcw size={16} className="text-amber-500" />
                {lang === 'zh' ? '临时切换显示课程日期' : 'Temporarily Override Date'}
              </h3>
              <button 
                onClick={() => {
                  setOverridingDateKey(null);
                  setOverrideTargetDate('');
                  setOverrideTargetDow('');
                }}
                className="text-slate-400 hover:text-slate-600 hover:bg-slate-50 p-1 rounded-lg transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="text-xs text-slate-500 leading-relaxed">
              <p>
                {lang === 'zh' 
                  ? `您正在设置 [${overridingDateKey}] 的课程显示。` 
                  : `You are overriding schedules displayed for [${overridingDateKey}].`}
              </p>
              <p className="mt-1">
                {lang === 'zh' 
                  ? '您可以将某一个日期的课临时指定为星期几的常规课表，或者指定为系统内的任意其他具体日期课程。' 
                  : 'Specify a day of the week or another target date to temporarily view its lessons.'}
              </p>
            </div>

            {/* Tabs */}
            <div className="flex bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setOverrideMode('dow')}
                className={`flex-1 text-center py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  overrideMode === 'dow'
                    ? 'bg-white text-indigo-700 shadow-3xs'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {lang === 'zh' ? '常规星期几' : 'Day of Week'}
              </button>
              <button
                type="button"
                onClick={() => setOverrideMode('date')}
                className={`flex-1 text-center py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  overrideMode === 'date'
                    ? 'bg-white text-indigo-700 shadow-3xs'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {lang === 'zh' ? '具体日期' : 'Specific Date'}
              </button>
            </div>

            {overrideMode === 'dow' ? (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  {lang === 'zh' ? '选择常规星期几 *' : 'Select Day of Week *'}
                </label>
                <select
                  value={overrideTargetDow}
                  onChange={e => setOverrideTargetDow(e.target.value)}
                  className="w-full border border-gray-250 rounded-lg text-xs p-2.5 bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500 transition-all font-sans text-gray-750 cursor-pointer"
                >
                  <option value="">{lang === 'zh' ? '-- 请选择星期 --' : '-- Select Day --'}</option>
                  <option value="1">{lang === 'zh' ? '星期一' : 'Monday'}</option>
                  <option value="2">{lang === 'zh' ? '星期二' : 'Tuesday'}</option>
                  <option value="3">{lang === 'zh' ? '星期三' : 'Wednesday'}</option>
                  <option value="4">{lang === 'zh' ? '星期四' : 'Thursday'}</option>
                  <option value="5">{lang === 'zh' ? '星期五' : 'Friday'}</option>
                  <option value="6">{lang === 'zh' ? '星期六' : 'Saturday'}</option>
                  <option value="7">{lang === 'zh' ? '星期日' : 'Sunday'}</option>
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  {lang === 'zh' ? '选择具体日期 *' : 'Select Target Date *'}
                </label>
                <input 
                  type="date"
                  className="w-full border border-gray-250 rounded-lg text-xs p-2.5 bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500 transition-all font-sans text-gray-750 cursor-pointer"
                  value={overrideTargetDate}
                  onChange={e => setOverrideTargetDate(e.target.value)}
                />
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2 border-t border-slate-100">
              <button 
                onClick={() => {
                  setOverridingDateKey(null);
                  setOverrideTargetDate('');
                  setOverrideTargetDow('');
                }}
                className="px-3.5 py-2 rounded-lg text-xs font-bold text-slate-500 bg-slate-100 hover:bg-slate-200/80 transition-all cursor-pointer"
              >
                {lang === 'zh' ? '取消' : 'Cancel'}
              </button>
              <button 
                onClick={() => {
                  let val = '';
                  if (overrideMode === 'dow') {
                    if (!overrideTargetDow) {
                      alert(lang === 'zh' ? '请选择星期几' : 'Please select a day of the week');
                      return;
                    }
                    val = `dow-${overrideTargetDow}`;
                  } else {
                    if (!overrideTargetDate) {
                      alert(lang === 'zh' ? '请选择一个日期' : 'Please select a date');
                      return;
                    }
                    val = overrideTargetDate;
                  }
                  setDateOverrides(prev => ({
                    ...prev,
                    [overridingDateKey]: val
                  }));
                  setOverridingDateKey(null);
                  setOverrideTargetDate('');
                  setOverrideTargetDow('');
                }}
                className="px-3.5 py-2 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-all cursor-pointer"
              >
                {lang === 'zh' ? '应用切换' : 'Apply Switch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
