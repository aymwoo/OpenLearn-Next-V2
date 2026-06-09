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

      {/* Bar Chart Section */}
      <div className="h-44 w-full font-sans select-none">
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
    </div>
  );
}
