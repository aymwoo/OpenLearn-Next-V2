import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend
} from 'recharts';
import { 
  Calendar, 
  Users, 
  CheckCircle2, 
  Clock, 
  XCircle, 
  Loader2,
  TrendingUp,
  AlertCircle
} from 'lucide-react';

interface AttendanceSummaryItem {
  id: string;
  lessonTitle: string;
  date: string;
  present: number;
  late: number;
  absent: number;
  total: number;
  attendanceRate: number;
}

interface ClassAttendanceSummaryChartProps {
  classId: string;
  lang?: 'en' | 'zh';
}

export function ClassAttendanceSummaryChart({ 
  classId, 
  lang = 'en' 
}: ClassAttendanceSummaryChartProps) {
  const [data, setData] = useState<AttendanceSummaryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'chart' | 'heatmap'>('heatmap');
  const [selectedDay, setSelectedDay] = useState<any | null>(null);

  // Identify lowest check-in rate day for problem diagnostics
  const lowestAttendanceDay = useMemo(() => {
    if (data.length === 0) return null;
    return [...data].sort((a, b) => a.attendanceRate - b.attendanceRate)[0];
  }, [data]);

  // Generate 35 days (5 full columns of Mon-Sun) aligned to Monday
  const heatmapGrid = useMemo(() => {
    const today = new Date();
    
    // Go back approx 5 weeks (34 days)
    const startDay = new Date();
    startDay.setDate(today.getDate() - 34);
    
    // Find nearest preceding Monday
    const dOfWeek = startDay.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
    const diffToMonday = dOfWeek === 0 ? 6 : dOfWeek - 1;
    startDay.setDate(startDay.getDate() - diffToMonday);
    
    const grid = [];
    const current = new Date(startDay);
    
    // End limit is Sunday of current week to complete the Mon-Sun matrix grid
    const endLimit = new Date(today);
    const endDOfWeek = endLimit.getDay(); 
    const diffToSunday = endDOfWeek === 0 ? 0 : 7 - endDOfWeek;
    endLimit.setDate(endLimit.getDate() + diffToSunday);
    
    while (current <= endLimit) {
      const dateStr = current.toISOString().split('T')[0];
      const match = data.find(item => item.date === dateStr);
      
      grid.push({
        dateStr,
        dayOfMonth: current.getDate(),
        monthName: current.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short' }),
        isToday: dateStr === today.toISOString().split('T')[0],
        isFuture: current > today,
        dayOfWeek: current.getDay(),
        match
      });
      
      current.setDate(current.getDate() + 1);
    }
    
    return grid;
  }, [data, lang]);

  // Auto-select lowest attendance day initially for instant problematic diagnosis
  useEffect(() => {
    if (data && data.length > 0 && heatmapGrid && heatmapGrid.length > 0) {
      const lowestRateItem = [...data].sort((a, b) => a.attendanceRate - b.attendanceRate)[0];
      if (lowestRateItem) {
        const matchInGrid = heatmapGrid.find(day => day.dateStr === lowestRateItem.date);
        if (matchInGrid) {
          setSelectedDay(matchInGrid);
        }
      }
    }
  }, [data, heatmapGrid]);

  useEffect(() => {
    let active = true;
    const fetchSummary = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/classes/${classId}/attendance-summary`);
        if (!res.ok) {
          throw new Error(`Error: ${res.status} ${res.statusText}`);
        }
        const json = await res.json();
        if (active) {
          setData(json);
        }
      } catch (err: any) {
        if (active) {
          setError(err.message || 'Failed to loaded attendance summary');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    fetchSummary();
    return () => {
      active = false;
    };
  }, [classId]);

  // Compute aggregate stats across the last 30 days
  const stats = useMemo(() => {
    if (data.length === 0) return { avgRate: 0, totalPresent: 0, totalLate: 0, totalAbsent: 0, totalSchedules: 0 };
    
    let sumRates = 0;
    let totalPresent = 0;
    let totalLate = 0;
    let totalAbsent = 0;
    
    data.forEach(item => {
      sumRates += item.attendanceRate;
      totalPresent += item.present;
      totalLate += item.late;
      totalAbsent += item.absent;
    });

    return {
      avgRate: Math.round(sumRates / data.length),
      totalPresent,
      totalLate,
      totalAbsent,
      totalSchedules: data.length
    };
  }, [data]);

  if (loading) {
    return (
      <div className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm flex flex-col items-center justify-center min-h-[220px]">
        <Loader2 className="animate-spin text-indigo-500 mb-2" size={24} />
        <span className="text-xs text-gray-400 font-sans">
          {lang === 'zh' ? '正在加载出勤分析数据...' : 'Loading attendance analytics...'}
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white border border-red-100 rounded-xl p-6 shadow-sm flex flex-col items-center justify-center min-h-[220px]">
        <AlertCircle className="text-red-500 mb-2" size={24} />
        <span className="text-xs text-red-600 font-sans text-center">
          {lang === 'zh' ? `无法加载出勤分析: ${error}` : `Failed to load attendance analysis: ${error}`}
        </span>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm flex flex-col items-center justify-center min-h-[220px] select-none text-center">
        <Calendar className="text-gray-300 mb-2" size={28} />
        <span className="text-xs font-semibold text-gray-500 font-sans block mb-1">
          {lang === 'zh' ? '近30天内没有出勤记录' : 'No Attendance Records in Last 30 Days'}
        </span>
        <span className="text-[10px] text-gray-400 max-w-sm">
          {lang === 'zh' ? '在新日程安排中为学生记录出勤后，统计数据将自动在此处生成。' : 'Attendance stats will generate automatically once you schedule lessons and register student statuses.'}
        </span>
      </div>
    );
  }

  // Format date labels (e.g. "Jun 08")
  const formattedData = data.map(item => {
    try {
      const dateObj = new Date(item.date);
      if (isNaN(dateObj.getTime())) return { ...item, displayDate: item.date };
      
      const day = dateObj.getDate();
      const month = dateObj.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short' });
      return {
        ...item,
        displayDate: lang === 'zh' ? `${month}${day}日` : `${month} ${day}`
      };
    } catch {
      return { ...item, displayDate: item.date };
    }
  });

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm flex flex-col gap-4 font-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-gray-100 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
            <CheckCircle2 size={16} />
          </div>
          <div>
            <h4 className="text-sm font-bold text-gray-800">
              {lang === 'zh' ? '近30天班级出勤率分析' : '30-Day Class Attendance Rates'}
            </h4>
            <p className="text-[10px] text-gray-400">
              {lang === 'zh' ? '基于最近30天内的课程日程和已记录的出勤状态' : 'Based on scheduled lessons and submitted attendance records'}
            </p>
          </div>
        </div>
        
        {/* Aggregated Stats Row */}
        <div className="flex items-center gap-4 bg-gray-50/50 p-1.5 px-3 rounded-lg border border-gray-100/60 text-xs text-gray-600">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">
              {lang === 'zh' ? '平均率' : 'Avg Rate'}:
            </span>
            <span className={`font-black ${stats.avgRate >= 90 ? 'text-green-600' : stats.avgRate >= 75 ? 'text-amber-500' : 'text-red-500'}`}>
              {stats.avgRate}%
            </span>
          </div>
          <div className="h-3 w-[1px] bg-gray-200" />
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">
              {lang === 'zh' ? '总课时' : 'Schedules'}:
            </span>
            <span className="font-extrabold text-slate-800">
              {stats.totalSchedules}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 bg-gray-50/50 p-2 rounded-lg border border-gray-100/50 text-center text-xs">
        <div className="flex flex-col items-center py-1">
          <div className="flex items-center gap-1.5 text-green-600 mb-0.5">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-ping" />
            <span className="font-semibold text-[10px]">{lang === 'zh' ? '已到' : 'Present'}</span>
          </div>
          <div className="text-sm font-bold text-gray-800">{stats.totalPresent}</div>
        </div>
        <div className="flex flex-col items-center py-1 border-x border-gray-100">
          <div className="flex items-center gap-1.5 text-amber-500 mb-0.5">
            <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" />
            <span className="font-semibold text-[10px]">{lang === 'zh' ? '迟到' : 'Late'}</span>
          </div>
          <div className="text-sm font-bold text-gray-800">{stats.totalLate}</div>
        </div>
        <div className="flex flex-col items-center py-1">
          <div className="flex items-center gap-1.5 text-red-500 mb-0.5">
            <span className="w-1.5 h-1.5 bg-red-400 rounded-full" />
            <span className="font-semibold text-[10px]">{lang === 'zh' ? '缺勤' : 'Absent'}</span>
          </div>
          <div className="text-sm font-bold text-gray-800">{stats.totalAbsent}</div>
        </div>
      </div>

      {/* Segmented Controls for Switching Perspectives */}
      <div className="flex bg-slate-100 p-0.5 rounded-lg self-start shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('heatmap')}
          className={`px-3 py-1.5 text-xs font-black rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'heatmap'
              ? 'bg-white text-indigo-700 shadow-md font-bold'
              : 'text-gray-500 hover:text-gray-850'
          }`}
        >
          <Calendar size={13} />
          {lang === 'zh' ? '出勤日历热力图' : 'Calendar Heatmap'}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('chart')}
          className={`px-3 py-1.5 text-xs font-black rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'chart'
              ? 'bg-white text-indigo-700 shadow-md font-bold'
              : 'text-gray-500 hover:text-gray-850'
          }`}
        >
          <TrendingUp size={13} />
          {lang === 'zh' ? '到课趋势柱状图' : 'Trend Chart'}
        </button>
      </div>

      {activeTab === 'heatmap' ? (
        <div className="flex flex-col gap-4 animate-fade-in text-gray-800">
          {/* Low Attendance Problematic Period Highlight Alert */}
          {lowestAttendanceDay && lowestAttendanceDay.attendanceRate < 80 && (
            <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl flex items-start gap-2.5 text-xs text-rose-850">
              <AlertCircle size={16} className="text-rose-500 mt-0.5 shrink-0 animate-bounce" />
              <div className="text-left">
                <span className="font-extrabold block">
                  {lang === 'zh' ? '检测到低出勤率周期预警' : 'Problematic Low Attendance Period Detected'}
                </span>
                <p className="mt-0.5 text-[11px] text-rose-700/90 leading-relaxed">
                  {lang === 'zh' 
                    ? `班级在 ${lowestAttendanceDay.date}（课程: 《${lowestAttendanceDay.lessonTitle}》）到课率处于低谷（仅为 ${lowestAttendanceDay.attendanceRate}%）。请留意可能存在影响出勤的外部因素或教学周期瓶颈。`
                    : `Check-in density dropped to a critical low of ${lowestAttendanceDay.attendanceRate}% on ${lowestAttendanceDay.date} for lesson: "${lowestAttendanceDay.lessonTitle}". Keep track of potential class milestones or periodic patterns.`
                  }
                </p>
              </div>
            </div>
          )}

          {/* Core Legend Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-[10px] text-gray-500 bg-slate-50/50 px-3 py-2 rounded-lg border border-gray-100/50">
            <span className="font-semibold">{lang === 'zh' ? '出勤率梯度图例:' : 'Attendance Rate Intensity:'}</span>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-emerald-500 block" />
                <span>{lang === 'zh' ? '极佳 (≥90%)' : 'Excellent (≥90%)'}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-amber-500 block" />
                <span>{lang === 'zh' ? '黄牌警告 (75%-89%)' : 'Warning (75%-89%)'}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-rose-500 block" />
                <span>{lang === 'zh' ? '严重偏低 (<75%)' : 'Critical (<75%)'}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-slate-100 border border-slate-200 block" />
                <span>{lang === 'zh' ? '未排课' : 'No Class'}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
            {/* Left Heatmap Grid (Mon-Sun columns) */}
            <div className="md:col-span-7 bg-white border border-gray-100 p-4 rounded-xl shadow-2xs">
              <div className="flex items-center justify-between mb-3 border-b border-gray-50 pb-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
                  {lang === 'zh' ? '35天教学周期考勤热度' : '5-Week Sequential Heatmap'}
                </span>
                <span className="text-[9.5px] text-gray-400 font-mono">Mon-Sun Matrix</span>
              </div>
              
              <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                {(lang === 'zh' 
                  ? ['一', '二', '三', '四', '五', '六', '日']
                  : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
                ).map(label => (
                  <div key={label} className="text-center text-[10px] font-black text-slate-400 py-1 uppercase tracking-wider font-sans">
                    {label}
                  </div>
                ))}
                
                {heatmapGrid.map((day) => {
                  let cellBg = "bg-slate-50 border border-slate-150 text-gray-400 cursor-default hover:bg-slate-100/50";
                  let ratePercent = null;
                  
                  if (day.isFuture) {
                    cellBg = "bg-slate-50/20 text-slate-300 opacity-40 border border-dashed border-slate-100 cursor-not-allowed";
                  } else if (day.match) {
                    ratePercent = day.match.attendanceRate;
                    if (ratePercent >= 90) {
                      cellBg = "bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold cursor-pointer border border-transparent";
                    } else if (ratePercent >= 75) {
                      cellBg = "bg-amber-500 hover:bg-amber-600 text-white font-extrabold cursor-pointer border border-transparent";
                    } else {
                      cellBg = "bg-rose-500 hover:bg-rose-600 text-white font-extrabold cursor-pointer border border-transparent";
                    }
                  }

                  const isSelected = selectedDay && selectedDay.dateStr === day.dateStr;
                  const borderHighlight = isSelected 
                    ? "ring-2 ring-indigo-600 ring-offset-2 scale-105 z-10 shadow-md" 
                    : day.isToday 
                      ? "ring-2 ring-slate-800 ring-offset-1 z-10" 
                      : "";

                  return (
                    <button
                      type="button"
                      key={day.dateStr}
                      onClick={() => {
                        if (!day.isFuture) {
                          setSelectedDay(day);
                        }
                      }}
                      disabled={day.isFuture}
                      className={`relative aspect-square rounded-lg flex flex-col items-center justify-center p-1 transition-all group shrink-0 ${cellBg} ${borderHighlight}`}
                      title={day.match ? `${day.dateStr}: ${day.match.lessonTitle} (${ratePercent}%)` : `${day.dateStr}`}
                    >
                      {/* Day count */}
                      <span className="text-[11px] font-bold select-none">{day.dayOfMonth}</span>

                      {/* Accent first of month */}
                      {day.dayOfMonth === 1 && (
                        <span className="absolute -top-1.5 -right-1 bg-indigo-700 text-white text-[7px] font-black tracking-widest uppercase px-1 rounded shadow-xs scale-90">
                          {day.monthName}
                        </span>
                      )}

                      {/* Desktop Hover Tooltip Box */}
                      {day.match && (
                        <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-slate-950 text-white p-2 text-[9.5px] leading-relaxed rounded-xl shadow-2xl opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 group-hover:-translate-y-0.5 transition-all duration-150 z-50 block">
                          <div className="font-extrabold border-b border-slate-850 pb-1 mb-1 truncate text-left">
                            {day.match.lessonTitle}
                          </div>
                          <div className="flex justify-between font-mono gap-1 text-[8.5px]">
                            <span className="text-slate-400">{lang === 'zh' ? '日期' : 'Date'}:</span>
                            <span className="font-bold">{day.dateStr}</span>
                          </div>
                          <div className="flex justify-between font-mono gap-1 text-[8.5px]">
                            <span className="text-slate-400">{lang === 'zh' ? '实到人数' : 'Present'}:</span>
                            <span className="font-extrabold text-emerald-300">{day.match.present}</span>
                          </div>
                          <div className="flex justify-between font-mono gap-1 text-[8.5px]">
                            <span className="text-slate-400">{lang === 'zh' ? '迟到人数' : 'Late'}:</span>
                            <span className="font-extrabold text-amber-300">{day.match.late}</span>
                          </div>
                          <div className="flex justify-between font-mono gap-1 text-[8.5px]">
                            <span className="text-slate-400">{lang === 'zh' ? '未到人数' : 'Absent'}:</span>
                            <span className="font-extrabold text-rose-300">{day.match.absent}</span>
                          </div>
                          <div className="text-center font-bold font-mono text-[11px] text-indigo-300 pt-1 border-t border-slate-800 mt-1">
                            {lang === 'zh' ? '到课比率:' : 'Access density:'} {ratePercent}%
                          </div>
                          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-[4px] border-transparent border-t-slate-950" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right Diagnostic Inspector Panel */}
            <div className="md:col-span-5 bg-slate-50 border border-gray-200 p-4 rounded-xl min-h-[210px] flex flex-col justify-between">
              {selectedDay ? (
                <div className="text-left flex-1 flex flex-col justify-between h-full space-y-3">
                  <div>
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                      {lang === 'zh' ? '日期考勤指数详情' : 'Acreage Diagnostic Center'}
                    </span>
                    <h5 className="text-xs font-black text-gray-800 flex items-center gap-1.5 justify-start">
                      <Calendar size={13} className="text-indigo-650" />
                      {selectedDay.dateStr} {selectedDay.isToday ? `(${lang === 'zh' ? '今天' : 'Today'})` : ''}
                    </h5>
                  </div>

                  {selectedDay.match ? (
                    <div className="space-y-3 flex-1 flex flex-col justify-between">
                      {/* Lesson title */}
                      <div className="bg-white border border-gray-150 p-2.5 rounded-lg text-left">
                        <span className="text-[8.5px] font-bold text-gray-400 block uppercase">{lang === 'zh' ? '讲授课目' : 'Subject of Instruction'}</span>
                        <p className="text-xs font-extrabold text-indigo-900 line-clamp-2 mt-0.5" title={selectedDay.match.lessonTitle}>
                          {selectedDay.match.lessonTitle}
                        </p>
                      </div>

                      {/* Performance rate radial chart */}
                      <div className="flex items-center gap-4 py-1.5">
                        <div className="relative flex items-center justify-center shrink-0">
                          <svg className="w-14 h-14 transform -rotate-90">
                            <circle cx="28" cy="28" r="23" className="stroke-gray-200 fill-none" strokeWidth="3.5" />
                            <circle 
                              cx="28" 
                              cy="28" 
                              r="23" 
                              className={`fill-none transition-all duration-300 ${
                                selectedDay.match.attendanceRate >= 90
                                  ? 'stroke-emerald-500'
                                  : selectedDay.match.attendanceRate >= 75
                                    ? 'stroke-amber-500'
                                    : 'stroke-rose-500'
                              }`} 
                              strokeWidth="4" 
                              strokeDasharray={`${2 * Math.PI * 23}`}
                              strokeDashoffset={`${2 * Math.PI * 23 * (1 - selectedDay.match.attendanceRate / 100)}`}
                              strokeLinecap="round"
                            />
                          </svg>
                          <span className="absolute text-xs font-black font-mono text-gray-800">
                            {selectedDay.match.attendanceRate}%
                          </span>
                        </div>

                        <div className="text-left space-y-0.5">
                          <span className="text-[10px] font-bold text-gray-400 block uppercase">
                            {lang === 'zh' ? '考勤宏观评估' : 'Check-in Diagnostics'}
                          </span>
                          <span className={`text-xs font-extrabold block ${
                            selectedDay.match.attendanceRate >= 90 
                              ? 'text-emerald-600' 
                              : selectedDay.match.attendanceRate >= 75 
                                ? 'text-amber-500' 
                                : 'text-rose-600'
                          }`}>
                            {selectedDay.match.attendanceRate >= 90 
                              ? (lang === 'zh' ? '出勤情况极好' : 'Excellent Check-in') 
                              : selectedDay.match.attendanceRate >= 75 
                                ? (lang === 'zh' ? '出勤尚可但有波动' : 'Moderate Attendance') 
                                : (lang === 'zh' ? '出勤率严重偏低' : 'Low Attendance Alert')
                            }
                          </span>
                        </div>
                      </div>

                      {/* Breakdown Status Badges Grid */}
                      <div className="grid grid-cols-3 gap-1.5 text-center">
                        <div className="bg-white border border-gray-150 p-1.5 rounded-lg">
                          <span className="text-[8px] font-bold text-emerald-600 block uppercase">{lang === 'zh' ? '到席' : 'In Class'}</span>
                          <span className="text-xs font-mono font-extrabold text-slate-800">{selectedDay.match.present}</span>
                        </div>
                        <div className="bg-white border border-gray-150 p-1.5 rounded-lg">
                          <span className="text-[8px] font-bold text-amber-500 block uppercase">{lang === 'zh' ? '迟到' : 'Late'}</span>
                          <span className="text-xs font-mono font-extrabold text-slate-800">{selectedDay.match.late}</span>
                        </div>
                        <div className="bg-white border border-gray-150 p-1.5 rounded-lg">
                          <span className="text-[8px] font-bold text-rose-500 block uppercase">{lang === 'zh' ? '缺席' : 'Absent'}</span>
                          <span className="text-xs font-mono font-extrabold text-slate-800">{selectedDay.match.absent}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center py-6 text-slate-400 text-center gap-1 select-none font-sans">
                      <AlertCircle size={24} className="text-slate-300" />
                      <span className="font-bold text-slate-500 text-[11px]">{lang === 'zh' ? '当天没有排课计划' : 'No Lesson Scheduled'}</span>
                      <span className="text-[9px] max-w-[180px] text-gray-400">
                        {lang === 'zh' ? '本日期无分配的课程安排及签到表。' : 'No instruction maps were recorded on this period.'}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-slate-400 text-center h-full select-none gap-2 font-sans">
                  <Calendar size={28} className="text-indigo-400 animate-pulse" />
                  <span className="font-bold text-slate-600 text-xs">
                    {lang === 'zh' ? '请点击考勤方块' : 'Select a Cell to Inspect'}
                  </span>
                  <span className="text-[9.5px] text-gray-400 max-w-[180px] leading-relaxed">
                    {lang === 'zh' ? '在左侧历史视窗中轻点日期，可瞬间深度解读班级应出席名册及课题明细。' : 'Click any of the heat blocks to audit lesson stats and classroom ratios.'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Legacy Trend Bar Chart Perspective Wrap */
        <div className="h-44 w-full font-sans select-none animate-fade-in">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={formattedData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis 
                dataKey="displayDate" 
                tick={{ fontSize: 9, fill: '#9ca3af' }}
                axisLine={{ stroke: '#e5e7eb' }}
                tickLine={false}
              />
              <YAxis 
                domain={[0, 100]} 
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 9, fill: '#9ca3af' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: '#f3f4f6', opacity: 0.6 }}
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const item = payload[0].payload as AttendanceSummaryItem;
                    return (
                      <div className="bg-white border border-gray-150 p-2.5 rounded-xl shadow-xl font-sans text-xs flex flex-col gap-1.5">
                        <div className="font-bold text-gray-800 border-b border-gray-150 pb-1 mb-1 flex items-center justify-between gap-4">
                          <span className="max-w-[130px] truncate" title={item.lessonTitle}>{item.lessonTitle}</span>
                          <span className="text-[10px] text-gray-400 font-mono normal-case">{item.date}</span>
                        </div>
                        <div className="flex justify-between gap-4 text-gray-600">
                          <span className="flex items-center gap-1 text-gray-400"><Users size={11} /> {lang === 'zh' ? '总注册学生' : 'Total Students'}:</span>
                          <span className="font-bold text-slate-700">{item.total}</span>
                        </div>
                        <div className="flex justify-between gap-4 text-emerald-600">
                          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500" /> {lang === 'zh' ? '实到人数' : 'Present'}:</span>
                          <span className="font-semibold">{item.present}</span>
                        </div>
                        <div className="flex justify-between gap-4 text-amber-500">
                          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> {lang === 'zh' ? '迟到人数' : 'Late'}:</span>
                          <span className="font-semibold">{item.late}</span>
                        </div>
                        <div className="flex justify-between gap-4 text-red-500">
                          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-400" /> {lang === 'zh' ? '未到人数' : 'Absent'}:</span>
                          <span className="font-semibold">{item.absent}</span>
                        </div>
                        <div className="flex justify-between gap-4 text-indigo-600 border-t border-gray-100 pt-1.5 mt-1 font-bold">
                          <span>{lang === 'zh' ? '单次出勤率' : 'Attendance Rate'}:</span>
                          <span>{item.attendanceRate}%</span>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar 
                dataKey="attendanceRate" 
                fill="#6366f1" 
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
