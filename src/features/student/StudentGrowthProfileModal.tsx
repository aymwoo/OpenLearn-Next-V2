import React, { useState, useMemo } from 'react';
import {
  Trophy,
  Lightbulb,
  ShieldCheck,
  Users,
  Award,
  Sparkles,
  ArrowLeft,
  Code2,
  Download,
  MonitorPlay,
  TrendingUp,
  FileText,
  X,
  Plus,
  Minus,
  CheckCircle2,
  Clock,
  ExternalLink,
  Flame,
  Bot,
  Zap,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';

export interface StudentProfileData {
  id: string;
  name: string;
  student_number?: string;
  role?: string;
  group_name?: string;
  groupId?: string;
  class_id?: string;
  className?: string;
  avatar?: string;
  points?: number;
  deltaPoints?: number;
  focusPercentage?: number;
  accuracyPercentage?: number;
  helpCount?: number;
  isOnline?: boolean;
  competencyScores?: {
    logic?: number;
    engineering?: number;
    creativity?: number;
    collaboration?: number;
    focus?: number;
    [key: string]: number | undefined;
  };
  timeline?: Array<{
    id: string;
    time: string;
    type: 'poll' | 'attribution' | 'submission' | 'buzzer' | 'custom';
    title: string;
    description: string;
    points?: number;
    status?: 'passed' | 'failed' | 'active' | 'info';
    details?: string;
    submissionId?: string;
  }>;
}

export interface StudentGrowthProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  student: StudentProfileData | null;
  lessonId?: string | null;
  classId?: string | null;
  lang?: 'zh' | 'en';
  addToast?: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onInspectSandbox?: (studentId: string, submissionId?: string) => void;
  onCastStudentScreen?: (studentId: string) => void;
  onAwardPoints?: (studentId: string, delta: number, reason?: string) => void;
}

export function StudentGrowthProfileModal({
  isOpen,
  onClose,
  student,
  lessonId,
  classId,
  lang = 'zh',
  addToast,
  onInspectSandbox,
  onCastStudentScreen,
  onAwardPoints,
}: StudentGrowthProfileModalProps) {
  const [activeTab, setActiveTab] = useState<'profile' | 'timeline' | 'submissions'>('profile');
  const [commentText, setCommentText] = useState('');
  const [awardingPoints, setAwardingPoints] = useState(false);

  // 五维计算思维与综合素养雷达图数据
  const competencyScores = student?.competencyScores;
  const defaultDimensions = useMemo(
    () => [
      { key: 'logic', label: lang === 'zh' ? '算法逻辑' : 'Logic', score: competencyScores?.logic ?? 95 },
      { key: 'engineering', label: lang === 'zh' ? '代码工程' : 'Engineering', score: competencyScores?.engineering ?? 90 },
      { key: 'creativity', label: lang === 'zh' ? '创新思维' : 'Creativity', score: competencyScores?.creativity ?? 88 },
      { key: 'collaboration', label: lang === 'zh' ? '团队协作' : 'Collaboration', score: competencyScores?.collaboration ?? 96 },
      { key: 'focus', label: lang === 'zh' ? '课堂专注' : 'Focus', score: competencyScores?.focus ?? 98 },
    ],
    [competencyScores, lang],
  );

  // SVG 五维雷达图几何点位计算 (viewBox 0 0 200 200, 中心 100, 100, 半径 75)
  const radarGeometry = useMemo(() => {
    const center = 100;
    const maxRadius = 75;
    const count = 5;

    const getCoord = (radius: number, index: number) => {
      const angle = -Math.PI / 2 + (2 * Math.PI / count) * index;
      return {
        x: center + radius * Math.cos(angle),
        y: center + radius * Math.sin(angle),
      };
    };

    // 背景五边形网格 (100%, 66%, 33%)
    const gridLevels = [1, 0.66, 0.33].map((ratio) => {
      const r = maxRadius * ratio;
      const points = Array.from({ length: count }, (_, i) => {
        const { x, y } = getCoord(r, i);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      return points;
    });

    // 轴线点
    const axes = Array.from({ length: count }, (_, i) => {
      const { x, y } = getCoord(maxRadius, i);
      return { x1: center, y1: center, x2: x, y2: y };
    });

    // 数据填充多边形
    const dataPoints = defaultDimensions.map((dim, i) => {
      const r = maxRadius * Math.min(Math.max(dim.score / 100, 0.1), 1);
      return getCoord(r, i);
    });

    const dataPolygonString = dataPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

    return { gridLevels, axes, dataPoints, dataPolygonString };
  }, [defaultDimensions]);

  if (!isOpen || !student) return null;

  // Safe defaults and metrics
  const studentPoints = student.points ?? 28;
  const studentDelta = student.deltaPoints ?? 4;
  const focusRate = student.focusPercentage ?? 98;
  const accuracyRate = student.accuracyPercentage ?? 100;
  const helpCount = student.helpCount ?? 3;
  const roleName = student.role || (lang === 'zh' ? '组长' : 'Leader');
  const groupName = student.group_name || (lang === 'zh' ? '飞鹰极客队' : 'Eagle Geek Squad');
  const studentNo = student.student_number || `240${student.id.replace(/\D/g, '').padStart(3, '1').slice(-3)}`;

  // 默认本堂答题与互动轨迹
  const timelineEvents = student.timeline || [
    {
      id: 'evt-1',
      time: '06:45 PM',
      type: 'poll' as const,
      title: lang === 'zh' ? '极速投票 · 循环嵌套条件判断' : 'Quick Poll · Nested Loop Conditions',
      description: lang === 'zh' ? '选择 [A] 首发提交通过，全班第 2 个作答完成' : 'Option [A] Selected, 2nd submission',
      points: 2,
      status: 'passed' as const,
      details: lang === 'zh' ? '准确判断出内层循环变量的递增边界' : 'Accurately evaluated inner loop bounds',
    },
    {
      id: 'evt-2',
      time: '06:32 PM',
      type: 'attribution' as const,
      title: lang === 'zh' ? '随堂抽问发言 · 多维归因表彰' : 'Roll Call · Attribution Award',
      description: lang === 'zh' ? '获得「💡 逻辑清晰」教学归因激励' : 'Earned "💡 Clear Logic" award',
      points: 2,
      status: 'passed' as const,
      details: lang === 'zh' ? '教师评语：双重循环步长分析逻辑严谨，表达条理清晰' : 'Teacher Remark: Rigorous loop step logic analysis',
    },
    {
      id: 'evt-3',
      time: '06:20 PM',
      type: 'submission' as const,
      title: lang === 'zh' ? '编程沙箱实操 · 螺旋彩虹绘制程序' : 'Sandbox Submission · Rainbow Spiral',
      description: lang === 'zh' ? '单元测试用例 5/5 全部通过 (耗时 3m12s)' : 'Test Cases 5/5 passed (3m12s)',
      points: 3,
      status: 'passed' as const,
      submissionId: 'sub-2401',
      details: lang === 'zh' ? '采用双变量联动优化步长，代码结构优于标准题解' : 'Optimized step with dual variable linkage',
    },
    {
      id: 'evt-4',
      time: '06:05 PM',
      type: 'buzzer' as const,
      title: lang === 'zh' ? '毫秒级抢答夺魁' : 'Buzzer Champion',
      description: lang === 'zh' ? '全班第 1 名抢得回答权 (反应时 342ms)' : '1st to buzz in (342ms)',
      points: 2,
      status: 'passed' as const,
      details: lang === 'zh' ? '快速温习上一讲条件判断核心语法' : 'Recalled conditional syntax accurately',
    },
  ];

  // 快捷加分触发
  const handleAward = async (delta: number, reason: string) => {
    setAwardingPoints(true);
    try {
      if (onAwardPoints) {
        onAwardPoints(student.id, delta, reason);
      } else {
        await fetch(`/api/students/${student.id}/points`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            delta,
            dimension: 'attribution',
            reason,
            classId,
            lessonId,
          }),
        });
      }
      addToast?.(
        lang === 'zh' ? '成长积分已发放' : 'Points Awarded',
        lang === 'zh' ? `已为学生 [${student.name}] ${delta >= 0 ? '+' : ''}${delta} 分（${reason}）` : `Awarded ${delta} pts to [${student.name}]`,
        'success',
      );
    } catch (err: any) {
      addToast?.('Error', err.message, 'error');
    } finally {
      setAwardingPoints(false);
    }
  };

  // 导出个人学情 Markdown 档案
  const handleExportMarkdownReport = () => {
    const reportMd = `# 学生个人全景学情与成长档案 (${student.name})
- **学生姓名**: ${student.name}
- **学号**: ${studentNo}
- **所属班级**: ${student.className || classId || '默认班级'}
- **小组归属**: ${groupName} (${roleName})
- **生成时间**: ${new Date().toLocaleString()}

## 1. 课堂核心素养与成长指标
- **总积分**: ${studentPoints} 分 (本节新增: +${studentDelta})
- **专注度**: ${focusRate}%
- **答题正确率**: ${accuracyRate}%
- **互助答疑频次**: ${helpCount} 次

## 2. 五维计算思维雷达评级
${defaultDimensions.map((d) => `- **${d.label}**: ${d.score} / 100`).join('\n')}

## 3. 本堂答题与互动轨迹
${timelineEvents.map((e) => `- [${e.time}] ${e.title} (${e.points ? '+' + e.points + '分' : ''}) - ${e.description}`).join('\n')}

---
*OpenLearn Next 过程性评价系统自动生成*
`;

    try {
      const blob = new Blob([reportMd], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `学生学情档案_${student.name}_${studentNo}.md`;
      a.click();
      URL.revokeObjectURL(url);

      addToast?.(
        lang === 'zh' ? '学情档案导出成功' : 'Report Exported',
        lang === 'zh' ? `已生成 [${student.name}] 个人学情 Markdown 档案` : 'Exported student report',
        'success',
      );
    } catch {
      navigator.clipboard?.writeText(reportMd);
      addToast?.(
        lang === 'zh' ? '已复制至剪贴板' : 'Copied to Clipboard',
        lang === 'zh' ? '学情报告内容已复制' : 'Report copied',
        'info',
      );
    }
  };

  return (
    <div
      id="student-growth-profile-modal-backdrop"
      className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 select-none animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-4xl bg-surface border border-border/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] text-foreground animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-profile-title"
      >
        {/* ── 1. Modal Top Bar (Stitch Screen 07fd3861) ── */}
        <header className="px-5 py-3.5 bg-gradient-to-r from-indigo-50/70 via-surface to-amber-50/40 dark:from-indigo-950/30 dark:via-surface dark:to-amber-950/20 border-b border-border/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-xl bg-surface hover:bg-surface-secondary text-foreground flex items-center justify-center transition border border-border shadow-3xs cursor-pointer"
              title={lang === 'zh' ? '返回全班列表' : 'Back'}
            >
              <ArrowLeft size={16} />
            </button>

            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow-3xs">
                  {student.avatar ? (
                    <img src={student.avatar} alt={student.name} className="w-full h-full object-cover rounded-xl" />
                  ) : (
                    <span>{student.name.slice(0, 1)}</span>
                  )}
                </div>
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-surface" />
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <h3 id="student-profile-title" className="text-sm font-bold text-foreground tracking-tight">
                    {student.name}
                  </h3>
                  <span className="px-1.5 py-0.2 rounded bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold">
                    {roleName}
                  </span>
                  <span className="px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 text-[10px] font-semibold flex items-center gap-1">
                    <Trophy size={11} className="text-amber-600 dark:text-amber-400" />
                    <span>{groupName}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.2 rounded-full font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>{focusRate}% {lang === 'zh' ? '专注在线' : 'Focus'}</span>
                  </span>
                </div>

                <div className="text-[11px] text-muted flex items-center gap-2 mt-0.5">
                  <span>
                    {lang === 'zh' ? '学号: ' : 'ID: '}
                    <strong className="font-mono font-normal text-foreground">{studentNo}</strong>
                  </span>
                  <span className="text-border">|</span>
                  <span>{student.className || (lang === 'zh' ? '示范班级' : 'Class')}</span>
                  <span className="text-border">|</span>
                  <span className="text-primary-theme font-medium">{lang === 'zh' ? '个人综合成长档案' : 'Growth Profile'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* 投屏其工作台 */}
            {onCastStudentScreen && (
              <button
                onClick={() => onCastStudentScreen(student.id)}
                className="px-2.5 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-xs font-semibold flex items-center gap-1.5 transition shadow-3xs cursor-pointer"
                title={lang === 'zh' ? '将该生操作白板/代码投屏至大屏幕' : 'Cast Student Screen'}
              >
                <MonitorPlay size={13} className="text-indigo-600 dark:text-indigo-400" />
                <span>{lang === 'zh' ? '投屏其工作台' : 'Cast Screen'}</span>
              </button>
            )}

            {/* Plugin Extension: student.profile.action */}
            <ExtensionPointRenderer
              slot="student.profile.action"
              slotProps={{ student, lessonId, classId }}
            />

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-surface-secondary text-muted hover:text-foreground transition cursor-pointer"
              title={lang === 'zh' ? '关闭弹窗' : 'Close'}
            >
              <X size={16} />
            </button>
          </div>
        </header>

        {/* ── 2. Top Summary Metric Cards Strip (4 Metrics) ── */}
        <section className="px-5 py-3 bg-surface-secondary/40 border-b border-border/70 grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
          {/* Card 1: Points */}
          <div className="bg-surface p-2.5 rounded-xl border border-border/80 shadow-3xs flex items-center justify-between">
            <div>
              <div className="text-[11px] text-muted font-medium">{lang === 'zh' ? '本节总积分' : 'Total Points'}</div>
              <div className="text-lg font-extrabold text-indigo-700 dark:text-indigo-300 font-mono flex items-baseline gap-1">
                {studentPoints} <span className="text-[10px] text-muted font-normal">{lang === 'zh' ? '分' : 'pts'}</span>
                <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950/40 px-1 py-0.2 rounded ml-0.5">
                  +{studentDelta}
                </span>
              </div>
              <div className="text-[10px] text-muted mt-0.5">
                {lang === 'zh' ? '组内贡献率: ' : 'Team Share: '}
                <strong className="text-primary-theme font-semibold">26%</strong>
              </div>
            </div>
            <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 flex items-center justify-center text-lg shadow-3xs">
              <Trophy size={18} />
            </div>
          </div>

          {/* Card 2: Focus */}
          <div className="bg-surface p-2.5 rounded-xl border border-border/80 shadow-3xs flex items-center justify-between">
            <div>
              <div className="text-[11px] text-muted font-medium">{lang === 'zh' ? '本堂专注度' : 'Focus Rate'}</div>
              <div className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400 font-mono flex items-baseline gap-1">
                {focusRate}% <span className="text-[10px] text-muted font-normal font-sans">{lang === 'zh' ? '优良' : 'Good'}</span>
              </div>
              <div className="text-[10px] text-muted mt-0.5">
                {lang === 'zh' ? '击败全班 ' : 'Top '}
                <strong className="text-emerald-600 dark:text-emerald-400 font-semibold">96%</strong> {lang === 'zh' ? '同学' : 'students'}
              </div>
            </div>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-lg shadow-3xs">
              <Lightbulb size={18} />
            </div>
          </div>

          {/* Card 3: Accuracy */}
          <div className="bg-surface p-2.5 rounded-xl border border-border/80 shadow-3xs flex items-center justify-between">
            <div>
              <div className="text-[11px] text-muted font-medium">{lang === 'zh' ? '答题正确率' : 'Accuracy'}</div>
              <div className="text-lg font-extrabold text-foreground font-mono flex items-baseline gap-1">
                {accuracyRate}% <span className="text-[10px] text-muted font-normal">{lang === 'zh' ? '全通关' : 'Pass'}</span>
              </div>
              <div className="text-[10px] text-muted mt-0.5">
                {lang === 'zh' ? '共 2 次提交 · 2 次首发通过' : '2 Submissions · 100% 1st pass'}
              </div>
            </div>
            <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center text-lg shadow-3xs">
              <ShieldCheck size={18} />
            </div>
          </div>

          {/* Card 4: Peer Assistance */}
          <div className="bg-surface p-2.5 rounded-xl border border-border/80 shadow-3xs flex items-center justify-between">
            <div>
              <div className="text-[11px] text-muted font-medium">{lang === 'zh' ? '互助答疑频次' : 'Collaboration'}</div>
              <div className="text-lg font-extrabold text-sky-600 dark:text-sky-400 font-mono flex items-baseline gap-1">
                {helpCount} <span className="text-[10px] text-muted font-normal">{lang === 'zh' ? '次' : 'times'}</span>
              </div>
              <div className="text-[10px] text-muted mt-0.5">
                {lang === 'zh' ? '协助解决嵌套语法障碍' : 'Resolved loop syntax obstacles'}
              </div>
            </div>
            <div className="w-9 h-9 rounded-xl bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 flex items-center justify-center text-lg shadow-3xs">
              <Users size={18} />
            </div>
          </div>
        </section>

        {/* ── 3. Main Split Body: Left 5 cols (Radar + AI Review), Right 7 cols (Live Timeline) ── */}
        <div className="p-4 flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-12 gap-4 bg-surface-secondary/20">
          {/* Left Column: Pentagon Competency Radar & AI Pedagogical Review (5 Cols) */}
          <div className="md:col-span-5 flex flex-col gap-3">
            {/* Competency Radar Card */}
            <div className="bg-surface rounded-xl border border-border/80 p-3.5 shadow-3xs">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <TrendingUp size={15} className="text-primary-theme" />
                  <h4 className="text-xs font-bold text-foreground">
                    {lang === 'zh' ? '多维素养与计算思维雷达' : 'Competency Radar'}
                  </h4>
                </div>
                <span className="text-[10px] font-mono font-bold text-primary-theme bg-primary-theme/10 px-2 py-0.5 rounded-lg border border-primary-theme/20">
                  {lang === 'zh' ? '综合评级 A+' : 'Rating A+'}
                </span>
              </div>

              {/* Native SVG Pentagon Radar */}
              <div className="flex items-center justify-center py-1">
                <svg className="w-52 h-52 select-none" viewBox="0 0 200 200" aria-label="Competency Radar Chart">
                  {/* Concentric grid pentagons */}
                  {radarGeometry.gridLevels.map((pts, idx) => (
                    <polygon
                      key={idx}
                      points={pts}
                      fill="none"
                      stroke="currentColor"
                      className="text-border/60"
                      strokeWidth="1"
                    />
                  ))}

                  {/* Radial axes */}
                  {radarGeometry.axes.map((ax, idx) => (
                    <line
                      key={idx}
                      x1={ax.x1}
                      y1={ax.y1}
                      x2={ax.x2}
                      y2={ax.y2}
                      stroke="currentColor"
                      className="text-border/50"
                      strokeWidth="1"
                    />
                  ))}

                  {/* Data filled polygon */}
                  <polygon
                    points={radarGeometry.dataPolygonString}
                    fill="rgba(99, 102, 241, 0.25)"
                    stroke="#6366f1"
                    strokeWidth="2"
                  />

                  {/* Data vertices */}
                  {radarGeometry.dataPoints.map((pt, idx) => (
                    <circle key={idx} cx={pt.x} cy={pt.y} r="3" fill="#6366f1" />
                  ))}

                  {/* Dimension text labels */}
                  <text x="100" y="14" textAnchor="middle" fill="#6366f1" fontSize="9" fontWeight="bold">
                    {defaultDimensions[0].label} {defaultDimensions[0].score}
                  </text>
                  <text x="180" y="80" textAnchor="start" fill="currentColor" fontSize="9" fontWeight="bold">
                    {defaultDimensions[1].label} {defaultDimensions[1].score}
                  </text>
                  <text x="145" y="180" textAnchor="start" fill="currentColor" fontSize="9" fontWeight="bold">
                    {defaultDimensions[2].label} {defaultDimensions[2].score}
                  </text>
                  <text x="55" y="180" textAnchor="end" fill="currentColor" fontSize="9" fontWeight="bold">
                    {defaultDimensions[3].label} {defaultDimensions[3].score}
                  </text>
                  <text x="20" y="80" textAnchor="end" fill="#10b981" fontSize="9" fontWeight="bold">
                    {defaultDimensions[4].label} {defaultDimensions[4].score}
                  </text>
                </svg>
              </div>

              {/* Dimension Score Progress Bars */}
              <div className="space-y-1.5 pt-2 border-t border-border/70 text-xs">
                {defaultDimensions.slice(0, 3).map((dim) => (
                  <div key={dim.key} className="flex items-center justify-between text-[11px]">
                    <span className="text-muted">{dim.label}</span>
                    <div className="flex items-center gap-1.5">
                      <div className="w-24 bg-surface-secondary h-1.5 rounded-full overflow-hidden border border-border/40">
                        <div
                          className="bg-primary-theme h-1.5 rounded-full transition-all duration-300"
                          style={{ width: `${dim.score}%` }}
                        />
                      </div>
                      <span className="font-mono font-bold text-foreground text-[10px] w-7 text-right">
                        {dim.score}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Plugin Slot: student.profile.dimension */}
              <ExtensionPointRenderer
                slot="student.profile.dimension"
                slotProps={{ student, dimensions: defaultDimensions }}
              />
            </div>

            {/* AI Pedagogical Review & Growth Recommendations */}
            <div className="bg-surface rounded-xl border border-border/80 p-3.5 shadow-3xs flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Bot size={15} className="text-amber-500" />
                  <h4 className="text-xs font-bold text-foreground">
                    {lang === 'zh' ? 'AI 导师学情评语与成长潜质' : 'AI Pedagogical Insights'}
                  </h4>
                </div>
                <p className="text-[11px] text-muted leading-relaxed bg-amber-500/10 p-2.5 rounded-xl border border-amber-500/20 mb-2">
                  {lang === 'zh'
                    ? `${student.name}在循环变量步长与嵌套边界控制方面表现出超前理解力。多次主动协助组员排查代码错误，展现出优秀的组长统筹与协作意识。建议后续进阶尝试更复杂的二维矩阵与自定义算法函数。`
                    : `${student.name} demonstrates advanced computational thinking in loop boundaries and peer debugging. Highly recommended for algorithmic challenge tracks.`}
                </p>
              </div>

              <div className="flex items-center justify-between text-[10px] text-muted pt-1">
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                  <CheckCircle2 size={12} />
                  <span>{lang === 'zh' ? '推荐进入算法创新挑战营' : 'Recommended for Advanced Camp'}</span>
                </span>
                <span className="text-primary-theme font-semibold cursor-pointer hover:underline">
                  {lang === 'zh' ? '历次报告' : 'History'}
                </span>
              </div>
            </div>

            {/* Plugin Slot: student.profile.card */}
            <ExtensionPointRenderer
              slot="student.profile.card"
              slotProps={{ student, lessonId, classId }}
            />
          </div>

          {/* Right Column: Live Timeline & Submissions (7 Cols) */}
          <div className="md:col-span-7 flex flex-col gap-3">
            <div className="bg-surface rounded-xl border border-border/80 p-4 shadow-3xs flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <Clock size={15} className="text-primary-theme" />
                  <h4 className="text-xs font-bold text-foreground">
                    {lang === 'zh' ? '本堂答题与互动轨迹 (Live Timeline)' : 'Live Interactive Timeline'}
                  </h4>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>{lang === 'zh' ? '实时追踪中' : 'Tracking'}</span>
                </div>
              </div>

              {/* Chronological Timeline */}
              <div className="space-y-3 relative before:absolute before:inset-0 before:left-3 before:w-0.5 before:bg-border text-xs pl-0.5 flex-1">
                {timelineEvents.map((evt) => (
                  <div key={evt.id} className="relative flex items-start gap-3 pl-6">
                    <span className="absolute left-1.5 top-1 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-primary-theme text-white flex items-center justify-center text-[8px] ring-4 ring-surface">
                      <CheckCircle2 size={10} />
                    </span>

                    <div className="flex-1 bg-surface-secondary/40 rounded-xl p-2.5 border border-border/80 hover:border-primary-theme/40 transition">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-primary-theme text-[10px]">
                            {evt.time}
                          </span>
                          <span className="font-bold text-foreground text-xs">{evt.title}</span>
                        </div>
                        {evt.points !== undefined && (
                          <span className="text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded-md">
                            +{evt.points}
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-muted mb-1.5">{evt.description}</p>
                      {evt.details && (
                        <div className="text-[10px] text-foreground/80 bg-surface p-1.5 rounded-lg border border-border/60">
                          {evt.details}
                        </div>
                      )}

                      {evt.submissionId && (
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            onClick={() => onInspectSandbox?.(student.id, evt.submissionId)}
                            className="px-2 py-1 bg-primary-theme text-white rounded-lg text-[10px] font-bold flex items-center gap-1 shadow-3xs cursor-pointer hover:bg-primary-theme/90"
                          >
                            <Code2 size={11} />
                            <span>{lang === 'zh' ? '查验代码沙箱' : 'Inspect Sandbox'}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* Plugin Slot: student.profile.timeline_item */}
                <ExtensionPointRenderer
                  slot="student.profile.timeline_item"
                  slotProps={{ student, lessonId, classId }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── 4. Modal Footer: Attribution Award & Export Actions ── */}
        <footer className="px-5 py-3 bg-surface border-t border-border/80 flex flex-wrap items-center justify-between gap-3 shrink-0">
          {/* Quick Attribution Points Micro-Adjustment Bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted font-medium">
              {lang === 'zh' ? '快速表现激励:' : 'Quick Award:'}
            </span>
            <button
              onClick={() => handleAward(1, lang === 'zh' ? '勇于发言' : 'Active Speaking')}
              disabled={awardingPoints}
              className="px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300/40 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
            >
              <span>👏 +1 {lang === 'zh' ? '发言' : 'Speaking'}</span>
            </button>
            <button
              onClick={() => handleAward(2, lang === 'zh' ? '逻辑清晰' : 'Logical Thinking')}
              disabled={awardingPoints}
              className="px-2 py-1 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-300/40 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
            >
              <span>💡 +2 {lang === 'zh' ? '逻辑' : 'Logic'}</span>
            </button>
            <button
              onClick={() => handleAward(2, lang === 'zh' ? '互助示范' : 'Peer Assistance')}
              disabled={awardingPoints}
              className="px-2 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-300/40 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
            >
              <span>🌟 +2 {lang === 'zh' ? '互助' : 'Helper'}</span>
            </button>
            <button
              onClick={() => handleAward(3, lang === 'zh' ? '创意满分' : 'Creative Thinking')}
              disabled={awardingPoints}
              className="px-2 py-1 bg-purple-500/10 hover:bg-purple-500/20 text-purple-700 dark:text-purple-300 border border-purple-300/40 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
            >
              <span>🚀 +3 {lang === 'zh' ? '创意' : 'Creative'}</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportMarkdownReport}
              className="px-3 py-1.5 border border-border/80 hover:bg-surface-secondary text-foreground rounded-xl text-xs font-medium transition flex items-center gap-1.5 cursor-pointer shadow-3xs"
              title={lang === 'zh' ? '导出个人 Markdown 学情报告' : 'Export Report'}
            >
              <Download size={13} />
              <span>{lang === 'zh' ? '导出学情报告' : 'Export'}</span>
            </button>

            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-primary-theme hover:bg-primary-theme/90 text-white rounded-xl text-xs font-bold transition shadow-3xs cursor-pointer"
            >
              {lang === 'zh' ? '完成并返回' : 'Done'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
