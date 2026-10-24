import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  AlertCircle,
  BookOpen,
  Award,
  BarChart2,
  Loader2,
  RefreshCw,
  Info,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getStudentAcademicYearComparison } from '../../services/dashboardService';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import type {
  AcademicYearComparisonResult,
  AcademicYearMetrics,
  AcademicYearComparisonDelta,
} from './types/comparison';

export interface StudentAcademicYearComparisonProps {
  studentId: string;
  lang?: 'zh' | 'en';
  onRefresh?: () => void;
}

const YEAR_COLORS = [
  {
    bg: 'bg-indigo-50 dark:bg-indigo-950/40',
    border: 'border-indigo-200 dark:border-indigo-800',
    bar: '#6366f1',
    text: 'text-indigo-600 dark:text-indigo-400',
  },
  {
    bg: 'bg-teal-50 dark:bg-teal-950/40',
    border: 'border-teal-200 dark:border-teal-800',
    bar: '#14b8a6',
    text: 'text-teal-600 dark:text-teal-400',
  },
  {
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    border: 'border-amber-200 dark:border-amber-800',
    bar: '#f59e0b',
    text: 'text-amber-600 dark:text-amber-400',
  },
  {
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    border: 'border-rose-200 dark:border-rose-800',
    bar: '#f43f5e',
    text: 'text-rose-600 dark:text-rose-400',
  },
];

export function StudentAcademicYearComparison({ studentId, lang = 'zh' }: StudentAcademicYearComparisonProps) {
  const [data, setData] = useState<AcademicYearComparisonResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedYears, setSelectedYears] = useState<string[]>([]);
  const [activeMetricTab, setActiveMetricTab] = useState<'submissionRate' | 'averageScore' | 'enrolledCourses'>(
    'submissionRate',
  );

  const fetchData = useCallback(
    async (years?: string[]) => {
      if (!studentId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await getStudentAcademicYearComparison(studentId, years);
        if (res.ok && res.data) {
          setData(res.data);
          setSelectedYears(res.data.selectedYears || []);
        } else {
          setError(res.error || (lang === 'zh' ? '加载学年对比数据失败' : 'Failed to load comparison data'));
        }
      } catch (err: any) {
        setError(err.message || (lang === 'zh' ? '网络请求异常' : 'Network error'));
      } finally {
        setLoading(false);
      }
    },
    [studentId, lang],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggleYear = (year: string) => {
    let nextYears: string[];
    if (selectedYears.includes(year)) {
      if (selectedYears.length <= 1) {
        return; // 至少保留一个学年
      }
      nextYears = selectedYears.filter((y) => y !== year);
    } else {
      nextYears = [...selectedYears, year].sort((a, b) => a.localeCompare(b));
    }
    setSelectedYears(nextYears);
    fetchData(nextYears);
  };

  const renderDeltaBadge = (delta: { diff: number; direction: 'up' | 'down' | 'flat' }, suffix = '') => {
    if (delta.direction === 'up') {
      return (
        <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-1.5 py-0.5 rounded-full">
          <TrendingUp size={12} />+{delta.diff}
          {suffix}
        </span>
      );
    }
    if (delta.direction === 'down') {
      return (
        <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 px-1.5 py-0.5 rounded-full">
          <TrendingDown size={12} />
          {delta.diff}
          {suffix}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-full">
        <Minus size={12} />0{suffix}
      </span>
    );
  };

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center p-12 space-y-3 bg-surface border border-theme rounded-xl">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        <span className="text-sm font-medium text-muted">
          {lang === 'zh' ? '正在聚合多学年学业数据...' : 'Aggregating academic data...'}
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-xl flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <h4 className="text-sm font-semibold text-rose-900 dark:text-rose-200">
            {lang === 'zh' ? '无法获取学年对比' : 'Failed to retrieve comparison'}
          </h4>
          <p className="text-xs text-rose-700 dark:text-rose-400 mt-1">{error}</p>
        </div>
        <button
          onClick={() => fetchData(selectedYears)}
          className="text-xs px-3 py-1.5 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition"
        >
          {lang === 'zh' ? '重试' : 'Retry'}
        </button>
      </div>
    );
  }

  if (!data || data.metricsByYear.length === 0) {
    return (
      <div className="p-12 text-center bg-surface border border-theme rounded-xl text-muted">
        <Info className="w-10 h-10 mx-auto text-muted/50 mb-3" />
        <p className="text-sm">{lang === 'zh' ? '暂无可对比的学年数据' : 'No academic comparison data available'}</p>
      </div>
    );
  }

  const { availableYears, metricsByYear, deltas } = data;

  // 获取各学年对应 Delta
  const getDeltaForYear = (year: string) => {
    return deltas.find((d) => d.toYear === year);
  };

  // 计算最大指标值用于图表柱高百分比
  const maxMetricVal = Math.max(
    ...metricsByYear.map((m) => {
      if (activeMetricTab === 'submissionRate') return m.submissionRate;
      if (activeMetricTab === 'averageScore') return m.averageScore;
      return m.enrolledCoursesCount;
    }),
    activeMetricTab === 'enrolledCourses' ? 5 : 100,
  );

  return (
    <div className="space-y-6">
      {/* 顶部学年选择器与操作栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface p-4 border border-theme rounded-xl shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-base font-bold text-main">
              {lang === 'zh' ? '跨学年对比' : 'Academic Year Comparison'}
            </h3>
            <span className="text-xs px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-full font-medium">
              {metricsByYear.length} {lang === 'zh' ? '个学年已选' : 'Years Selected'}
            </span>
          </div>
          <p className="text-xs text-muted mt-1">
            {lang === 'zh'
              ? '选择多个学年横向对比学业表现与成长轨迹'
              : 'Select multiple academic years to compare performance & progression'}
          </p>
        </div>

        {/* 年份 Chips */}
        <div className="flex flex-wrap items-center gap-2">
          {availableYears.map((year) => {
            const isSelected = selectedYears.includes(year);
            const yearMetric = metricsByYear.find((m) => m.academicYear === year);
            const hasData = yearMetric ? yearMetric.hasData : true;

            return (
              <button
                key={year}
                data-testid={`year-chip-${year}`}
                aria-label={`切换学年 ${year}`}
                onClick={() => handleToggleYear(year)}
                className={`group relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                  isSelected
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs'
                    : 'bg-surface border-theme text-muted hover:border-indigo-400 hover:text-main'
                }`}
                title={!hasData ? (lang === 'zh' ? '该学年暂无学业数据' : 'No data in this year') : undefined}
              >
                {isSelected && <CheckCircle2 size={13} className="shrink-0" />}
                <span>{year}</span>
                {!hasData && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSelected ? 'bg-amber-300' : 'bg-amber-500'}`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 无历史数据学年提示条 */}
      {metricsByYear.some((m) => !m.hasData) && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl flex items-center gap-2.5 text-xs text-amber-800 dark:text-amber-300">
          <Info size={16} className="shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            {lang === 'zh'
              ? '提示：部分选中的历史学年暂无排课或作业提交记录，指标以 0 显示。'
              : 'Notice: Some selected years have no historical records and display zero metrics.'}
          </span>
        </div>
      )}

      {/* 核心指标概览卡片网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 作业提交率卡片 */}
        <div className="bg-surface p-4 border border-theme rounded-xl shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">{lang === 'zh' ? '作业提交率' : 'Submission Rate'}</span>
            <Award className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="space-y-2">
            {metricsByYear.map((m, idx) => {
              const delta = getDeltaForYear(m.academicYear)?.submissionRateDelta;
              return (
                <div key={m.academicYear} className="flex items-center justify-between text-xs">
                  <span className="text-muted font-medium flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: YEAR_COLORS[idx % YEAR_COLORS.length].bar }}
                    />
                    {m.academicYear}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-main">{m.submissionRate}%</span>
                    {delta && renderDeltaBadge(delta, '%')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 按时提交率卡片 */}
        <div className="bg-surface p-4 border border-theme rounded-xl shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">{lang === 'zh' ? '按时提交率' : 'On-time Rate'}</span>
            <TrendingUp className="w-4 h-4 text-teal-500" />
          </div>
          <div className="space-y-2">
            {metricsByYear.map((m, idx) => {
              const delta = getDeltaForYear(m.academicYear)?.onTimeRateDelta;
              return (
                <div key={m.academicYear} className="flex items-center justify-between text-xs">
                  <span className="text-muted font-medium flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: YEAR_COLORS[idx % YEAR_COLORS.length].bar }}
                    />
                    {m.academicYear}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-main">{m.onTimeRate}%</span>
                    {delta && renderDeltaBadge(delta, '%')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 作业平均分卡片 */}
        <div className="bg-surface p-4 border border-theme rounded-xl shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">{lang === 'zh' ? '作业平均分' : 'Average Score'}</span>
            <BarChart2 className="w-4 h-4 text-amber-500" />
          </div>
          <div className="space-y-2">
            {metricsByYear.map((m, idx) => {
              const delta = getDeltaForYear(m.academicYear)?.averageScoreDelta;
              return (
                <div key={m.academicYear} className="flex items-center justify-between text-xs">
                  <span className="text-muted font-medium flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: YEAR_COLORS[idx % YEAR_COLORS.length].bar }}
                    />
                    {m.academicYear}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-main">{m.averageScore}</span>
                    {delta && renderDeltaBadge(delta)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 选修课程与完成数 */}
        <div className="bg-surface p-4 border border-theme rounded-xl shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">
              {lang === 'zh' ? '在读 / 已完成课程' : 'Enrolled / Completed'}
            </span>
            <BookOpen className="w-4 h-4 text-purple-500" />
          </div>
          <div className="space-y-2">
            {metricsByYear.map((m, idx) => {
              const delta = getDeltaForYear(m.academicYear)?.enrolledCoursesDelta;
              return (
                <div key={m.academicYear} className="flex items-center justify-between text-xs">
                  <span className="text-muted font-medium flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: YEAR_COLORS[idx % YEAR_COLORS.length].bar }}
                    />
                    {m.academicYear}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-main">
                      {m.enrolledCoursesCount}{' '}
                      <span className="font-normal text-muted">
                        ({lang === 'zh' ? '完成' : 'done'}: {m.completedCoursesCount})
                      </span>
                    </span>
                    {delta && renderDeltaBadge(delta)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 扩展插槽：学年维度自定义指标卡 */}
        <ExtensionPointRenderer
          slot="student.academic_year.metric_card"
          slotProps={{
            studentId,
            comparisonData: data,
            selectedYears,
            lang,
          }}
        />
      </div>

      {/* 学年对比可视化图表 */}
      <div className="bg-surface p-5 border border-theme rounded-xl shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-theme pb-3">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-indigo-500" />
            <h4 className="text-sm font-bold text-main">
              {lang === 'zh' ? '学年指标对比走势' : 'Year-over-Year Indicator Comparison'}
            </h4>
          </div>

          {/* 指标切换 Tabs */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-xs font-medium">
            <button
              onClick={() => setActiveMetricTab('submissionRate')}
              className={`px-3 py-1 rounded-md transition ${
                activeMetricTab === 'submissionRate'
                  ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-muted hover:text-main'
              }`}
            >
              {lang === 'zh' ? '作业提交率' : 'Submission %'}
            </button>
            <button
              onClick={() => setActiveMetricTab('averageScore')}
              className={`px-3 py-1 rounded-md transition ${
                activeMetricTab === 'averageScore'
                  ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-muted hover:text-main'
              }`}
            >
              {lang === 'zh' ? '平均成绩' : 'Avg Score'}
            </button>
            <button
              onClick={() => setActiveMetricTab('enrolledCourses')}
              className={`px-3 py-1 rounded-md transition ${
                activeMetricTab === 'enrolledCourses'
                  ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-muted hover:text-main'
              }`}
            >
              {lang === 'zh' ? '在读课程数' : 'Courses'}
            </button>
          </div>
        </div>

        {/* SVG 对比柱状图 */}
        <div className="pt-2 pb-1">
          <div className="h-48 w-full flex items-end gap-6 sm:gap-12 justify-center px-4">
            {metricsByYear.map((m, idx) => {
              const val =
                activeMetricTab === 'submissionRate'
                  ? m.submissionRate
                  : activeMetricTab === 'averageScore'
                    ? m.averageScore
                    : m.enrolledCoursesCount;

              const percentHeight = Math.max(8, Math.round((val / maxMetricVal) * 100));
              const colorTheme = YEAR_COLORS[idx % YEAR_COLORS.length];

              return (
                <div key={m.academicYear} className="flex-1 max-w-[120px] flex flex-col items-center gap-2 group">
                  <span className="text-xs font-bold text-main transition group-hover:scale-110">
                    {val}
                    {activeMetricTab === 'submissionRate' ? '%' : ''}
                  </span>
                  <div className="w-full bg-slate-100 dark:bg-slate-800/80 rounded-t-lg h-36 flex items-end p-1">
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${percentHeight}%` }}
                      transition={{ duration: 0.6, delay: idx * 0.1, ease: 'easeOut' }}
                      className="w-full rounded-md shadow-xs transition hover:brightness-110"
                      style={{ backgroundColor: colorTheme.bar }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-muted text-center truncate w-full">{m.academicYear}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 按课程成绩分布明细 */}
      <div className="bg-surface p-5 border border-theme rounded-xl shadow-xs space-y-4">
        <div className="flex items-center gap-2 border-b border-theme pb-3">
          <BookOpen className="w-4 h-4 text-indigo-500" />
          <h4 className="text-sm font-bold text-main">
            {lang === 'zh' ? '课程维度跨学年成绩与作业详情' : 'Course-Level Academic Performance Across Years'}
          </h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {metricsByYear.map((m, idx) => {
            const colorTheme = YEAR_COLORS[idx % YEAR_COLORS.length];
            return (
              <div
                key={m.academicYear}
                className={`p-4 rounded-xl border ${colorTheme.border} ${colorTheme.bg} space-y-3`}
              >
                <div className="flex items-center justify-between border-b border-black/5 dark:border-white/5 pb-2">
                  <span className={`text-xs font-bold ${colorTheme.text}`}>{m.academicYear}</span>
                  <span className="text-xs text-muted">
                    {m.courseScores.length} {lang === 'zh' ? '门相关课程' : 'courses'}
                  </span>
                </div>

                {m.courseScores.length === 0 ? (
                  <div className="text-xs text-muted text-center py-4">
                    {lang === 'zh' ? '该学年暂无课程成绩记录' : 'No recorded course grades in this year'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {m.courseScores.map((c) => (
                      <div
                        key={c.courseId}
                        className="flex items-center justify-between bg-white/70 dark:bg-slate-900/60 p-2.5 rounded-lg border border-black/5 dark:border-white/5 text-xs"
                      >
                        <div className="truncate pr-2">
                          <p className="font-semibold text-main truncate">{c.courseTitle}</p>
                          <p className="text-[11px] text-muted">
                            {lang === 'zh'
                              ? `作业数: ${c.gradedAssignmentCount}/${c.totalAssignmentCount}`
                              : `Assignments: ${c.gradedAssignmentCount}/${c.totalAssignmentCount}`}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-bold text-indigo-600 dark:text-indigo-400 text-sm">
                            {c.averageScore}
                          </span>
                          <span className="text-[10px] text-muted block">{lang === 'zh' ? '均分' : 'avg'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
