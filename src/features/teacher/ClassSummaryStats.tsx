import React, { useMemo } from 'react';
import { BarChart3, Users, Radio, GraduationCap } from 'lucide-react';
import type { ClassType } from '../../store/appStore';

interface ClassSummaryStatsProps {
  classDashboardMap: Record<string, any>;
  classes: ClassType[];
  lang: 'zh' | 'en';
}

export function ClassSummaryStats({ classDashboardMap, classes, lang }: ClassSummaryStatsProps) {
  const zh = lang === 'zh';

  const stats = useMemo(() => {
    const classIds = Object.keys(classDashboardMap);
    if (classIds.length === 0) return null;

    let totalScoreSum = 0;
    let totalScoreCount = 0;
    let totalStudents = 0;
    let totalSubmittedStudents = 0;
    let totalRollcallSum = 0;
    let totalRollcallStudents = 0;

    for (const classId of classIds) {
      const dashboard = classDashboardMap[classId];
      if (!dashboard) continue;

      const performance: any[] = dashboard.performance ?? [];
      const rollcallStats: any[] = dashboard.rollcallStats ?? [];

      for (const row of performance) {
        if (row.score != null && !isNaN(Number(row.score))) {
          totalScoreSum += Number(row.score);
          totalScoreCount++;
        }
      }

      const submissionByStudent = new Map<string, boolean>();
      for (const row of performance) {
        if (row.submission_status === 'submitted' || row.score != null) {
          submissionByStudent.set(row.student_id, true);
        }
      }
      totalStudents += rollcallStats.length || 0;
      totalSubmittedStudents += submissionByStudent.size;

      for (const rc of rollcallStats) {
        totalRollcallSum += rc.count ?? 0;
        totalRollcallStudents++;
      }
    }

    const avgGrade = totalScoreCount > 0 ? Math.round(totalScoreSum / totalScoreCount) : null;
    const attendanceRate =
      totalStudents > 0 ? Math.round((totalSubmittedStudents / totalStudents) * 100) : null;
    const participationScore =
      totalRollcallStudents > 0 ? (totalRollcallSum / totalRollcallStudents).toFixed(1) : null;

    return { avgGrade, attendanceRate, participationScore, classCount: classIds.length };
  }, [classDashboardMap]);

  if (!stats) {
    return (
      <div className="bg-surface border border-theme rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 size={16} className="text-primary-theme" />
          <h3 className="text-sm font-black text-main">
            {zh ? '班级综合数据概览' : 'Class Summary Stats'}
          </h3>
        </div>
        <p className="text-xs text-muted text-center py-6">
          {zh ? '暂无班级数据，展开班级卡片后将自动加载' : 'No class data yet — expand a class card to load data'}
        </p>
      </div>
    );
  }

  const cards = [
    {
      icon: GraduationCap,
      label: zh ? '平均成绩' : 'Average Grade',
      value: stats.avgGrade != null ? `${stats.avgGrade}` : '—',
      suffix: stats.avgGrade != null ? (zh ? '分' : 'pts') : '',
      hint: zh ? '基于已评分作业' : 'Based on graded assignments',
      tone: 'text-emerald-700 bg-emerald-50 border-emerald-200/80 dark:bg-emerald-950/40 dark:border-emerald-800/70 dark:text-emerald-300',
      iconBg: 'bg-emerald-100 dark:bg-emerald-900/50',
    },
    {
      icon: Users,
      label: zh ? '出勤提交率' : 'Submission Rate',
      value: stats.attendanceRate != null ? `${stats.attendanceRate}` : '—',
      suffix: stats.attendanceRate != null ? '%' : '',
      hint: zh ? '至少提交过一次作业的学生占比' : 'Students with at least one submission',
      tone: 'text-blue-700 bg-blue-50 border-blue-200/80 dark:bg-blue-950/40 dark:border-blue-800/70 dark:text-blue-300',
      iconBg: 'bg-blue-100 dark:bg-blue-900/50',
    },
    {
      icon: Radio,
      label: zh ? '课堂参与频次' : 'Participation Freq.',
      value: stats.participationScore ?? '—',
      suffix: stats.participationScore != null ? (zh ? '次/人' : '/student') : '',
      hint: zh ? '平均点名回答次数' : 'Average rollcall picks per student',
      tone: 'text-amber-700 bg-amber-50 border-amber-200/80 dark:bg-amber-950/40 dark:border-amber-800/70 dark:text-amber-300',
      iconBg: 'bg-amber-100 dark:bg-amber-900/50',
    },
  ];

  return (
    <div className="bg-surface border border-theme rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} className="text-primary-theme" />
          <h3 className="text-sm font-black text-main">
            {zh ? '班级综合数据概览' : 'Class Summary Stats'}
          </h3>
        </div>
        <span className="text-2xs font-semibold text-muted px-2 py-0.5 rounded-lg bg-surface-secondary border border-theme">
          {zh ? `已加载 ${stats.classCount} 个班级` : `${stats.classCount} class(es) loaded`}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="rounded-xl border border-theme bg-surface-secondary p-4 flex items-start gap-3"
            >
              <div
                className={`w-9 h-9 rounded-lg ${card.iconBg} border border-theme flex items-center justify-center shrink-0`}
              >
                <Icon size={16} className={card.tone.split(' ')[0]} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-2xs text-muted font-medium truncate">{card.label}</div>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className={`text-lg font-black font-mono leading-none ${card.tone.split(' ')[0]}`}>
                    {card.value}
                  </span>
                  {card.suffix && (
                    <span className="text-2xs text-muted font-medium">{card.suffix}</span>
                  )}
                </div>
                <div className="text-2xs text-subtle mt-1 truncate">{card.hint}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
