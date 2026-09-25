/**
 * ShowcaseDiffModal — 优秀作业 / 屏幕一键多屏对比投屏批注（Showcase & Dual-Screen Diff）
 *
 * 核心特性：
 * 1. 2~4 屏自适应对比（Dual 50/50, Triple 33/33/33, Quad 2x2）
 * 2. 候选池抽屉：从随堂作答/机房监控中勾选 2~4 位学生进行解题过程并排对比
 * 3. 教师激光笔与多色覆盖批注：透明图层、激光笔光晕、荧光笔半透明差异标记、思维死角印章
 * 4. 匿名脱敏保护与全班大屏广播
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  X,
  GitCompare,
  LayoutGrid,
  Columns2,
  Columns3,
  Eye,
  EyeOff,
  Share2,
  RotateCcw,
  Trash2,
  Sparkles,
  Highlighter,
  Brush,
  Radio,
  Eraser,
  Stamp,
  Users,
  CheckSquare,
  Square,
  Clock,
  CheckCircle,
  AlertTriangle,
} from 'lucide-react';
import type {
  DiffScreenLayout,
  DiffStudentWork,
  DiffToolType,
  DiffAnnotationStroke,
  DiffStamp,
  DiffStampType,
} from './types';
import {
  DIFF_STAMP_PRESETS,
  HIGHLIGHTER_COLORS,
  PEN_COLORS,
} from './diff-presets';
import { DiffAnnotationCanvas } from './DiffAnnotationCanvas';

export interface ShowcaseDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  lessonTitle?: string;
  availableStudents?: Array<{ id: string; name: string; studentNumber?: string; seatNumber?: string }>;
  candidateWorks?: DiffStudentWork[];
  addToast?: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  lang?: 'zh' | 'en';
  onSyncToClass?: (data: { selectedIds: string[]; layout: DiffScreenLayout }) => void;
}

export const ShowcaseDiffModal: React.FC<ShowcaseDiffModalProps> = ({
  isOpen,
  onClose,
  lessonTitle = '随堂探究与物理规律推导',
  availableStudents = [],
  candidateWorks: propWorks,
  addToast,
  lang = 'zh',
  onSyncToClass,
}) => {
  // 生成候选池数据（如果未从外部传入真实作答数据，则依据现有学生生成启发式解题样本）
  const worksPool = useMemo<DiffStudentWork[]>(() => {
    if (propWorks && propWorks.length > 0) return propWorks;

    const baseStudents = availableStudents.length > 0
      ? availableStudents
      : [
          { id: 'stu-1', name: '张子豪', seatNumber: 'A-01' },
          { id: 'stu-2', name: '李晓彤', seatNumber: 'A-02' },
          { id: 'stu-3', name: '王一诺', seatNumber: 'B-03' },
          { id: 'stu-4', name: '赵梓涵', seatNumber: 'B-04' },
        ];

    const templates = [
      {
        title: '微元累加与动能定理联立',
        source: 'code' as const,
        content: `// 思路 A：基于动能定理与变力做功微元积分
const W_gravity = m * g * h;
const W_friction = -mu * m * g * s;
// 求解末速度方程:
const E_k = 0.5 * m * (v ** 2);
v = Math.sqrt(2 * g * h - 2 * mu * g * s);
console.log("终端速度:", v.toFixed(2), "m/s");`,
        tags: ['经典解法', '极值严密', '步骤规范'],
        durationSec: 195,
        category: 'exemplary' as const,
        accuracyScore: 100,
      },
      {
        title: '动量守恒与临界碰撞解法',
        source: 'code' as const,
        content: `// 思路 B：直接运用能量守恒定律进行代数化简
// 注意：未对沿斜面下滑过程的静摩擦力突变进行临界判断！
const delta_E = m * g * (h1 - h2);
// 错误点：忽略了动摩擦因数随压力的非线性衰减
v_end = Math.sqrt(2 * delta_E / m);`,
        tags: ['典型死角', '漏临界条件', '待补充受力'],
        durationSec: 142,
        category: 'typical_error' as const,
        accuracyScore: 68,
      },
      {
        title: '几何相交法与向量三角形',
        source: 'whiteboard' as const,
        content: `// 思路 C：基于向量合成与正弦定理求解
tan(theta) = F_electric / (m * g);
F_resultant = sqrt( (m*g)^2 + F_electric^2 );
// 极值判断: 当垂直于重力与电场力合力方向时加速度取得极大值`,
        tags: ['妙解法', '几何直观', '图象法'],
        durationSec: 210,
        category: 'alternative' as const,
        accuracyScore: 95,
      },
      {
        title: '拉格朗日乘子约束方程',
        source: 'code' as const,
        content: `// 思路 D：广义坐标与约束极值
const L = T - V; // 拉格朗日量
// d/dt(dL/dq_dot) - dL/dq = 0
// 规范矩阵化求解，推导过程工整`,
        tags: ['大学先修', '严密推演', '拔高拓展'],
        durationSec: 280,
        category: 'exemplary' as const,
        accuracyScore: 100,
      },
    ];

    return baseStudents.slice(0, 4).map((s, idx) => ({
      studentId: s.id,
      studentName: s.name,
      studentNumber: s.studentNumber,
      seatNumber: s.seatNumber ?? `机位-${idx + 1}`,
      source: templates[idx % templates.length].source,
      title: templates[idx % templates.length].title,
      content: templates[idx % templates.length].content,
      tags: templates[idx % templates.length].tags,
      durationSec: templates[idx % templates.length].durationSec,
      category: templates[idx % templates.length].category,
      accuracyScore: templates[idx % templates.length].accuracyScore,
    }));
  }, [propWorks, availableStudents]);

  // 默认选择前 2 名学生开启双屏对比
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    return worksPool.slice(0, 2).map((w) => w.studentId);
  });

  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isOverlayActive, setIsOverlayActive] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // 批注工具与色彩状态
  const [activeTool, setActiveTool] = useState<DiffToolType>('highlighter');
  const [activeColor, setActiveColor] = useState<string>(HIGHLIGHTER_COLORS[0].strokeHex);
  const [activeStampType, setActiveStampType] = useState<DiffStampType>('pitfall');
  const [strokes, setStrokes] = useState<DiffAnnotationStroke[]>([]);
  const [stamps, setStamps] = useState<DiffStamp[]>([]);

  // 布局计算：依据勾选学生数量或手动切换
  const layout = useMemo<DiffScreenLayout>(() => {
    if (selectedIds.length <= 2) return 'dual';
    if (selectedIds.length === 3) return 'triple';
    return 'quad';
  }, [selectedIds.length]);

  const activeWorks = useMemo(() => {
    return selectedIds
      .map((id) => worksPool.find((w) => w.studentId === id))
      .filter((w): w is DiffStudentWork => Boolean(w));
  }, [selectedIds, worksPool]);

  // 选人复选切换
  const toggleStudentSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 2) {
          addToast?.('提示', '对比屏幕至少保留 2 位学生', 'info');
          return prev;
        }
        return prev.filter((item) => item !== id);
      } else {
        if (prev.length >= 4) {
          addToast?.('提示', '多屏对比最多支持 4 位学生同时投屏', 'warning');
          return prev;
        }
        return [...prev, id];
      }
    });
  }, [addToast]);

  // 快速对比预设快捷切换
  const applyPresetCompare = (type: 'typical_error_diff' | 'all_top') => {
    if (worksPool.length < 2) return;
    if (type === 'typical_error_diff') {
      // 挑选 1 个典范 + 1 个典型死角
      const good = worksPool.find((w) => w.category === 'exemplary') ?? worksPool[0];
      const bad = worksPool.find((w) => w.category === 'typical_error') ?? worksPool[1];
      setSelectedIds([good.studentId, bad.studentId]);
      addToast?.('对比模式更新', '已切换至「规范典范 vs 典型思维死角」对比', 'success');
    } else {
      setSelectedIds(worksPool.slice(0, Math.min(4, worksPool.length)).map((w) => w.studentId));
      addToast?.('对比模式更新', `已载入 ${Math.min(4, worksPool.length)} 种代表性解题过程`, 'success');
    }
  };

  // 撤销上一笔
  const handleUndo = () => {
    if (strokes.length > 0) {
      setStrokes((prev) => prev.slice(0, -1));
    } else if (stamps.length > 0) {
      setStamps((prev) => prev.slice(0, -1));
    }
  };

  // 清空所有批注
  const handleClearAnnotations = () => {
    setStrokes([]);
    setStamps([]);
    addToast?.('清空完毕', '已清除所有覆盖批注与印章', 'info');
  };

  // 广播推流到学生端大屏
  const handleBroadcastSync = () => {
    onSyncToClass?.({ selectedIds, layout });
    addToast?.(
      lang === 'zh' ? '📡 大屏同步已下发' : '📡 Broadcast Sent',
      lang === 'zh' ? '已将当前多屏对比与教师实时批注图层推送到全班学生机' : 'Synced diff viewport to students.',
      'success',
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-md flex items-center justify-center p-3 md:p-6 animate-fade-in select-none">
      <div className="bg-surface border border-theme rounded-2xl shadow-2xl w-full max-w-[96vw] h-[94vh] flex flex-col overflow-hidden text-main">
        {/* ── 顶部主控导航栏 ────────────────────────────────────────── */}
        <div className="bg-surface-secondary/80 px-5 py-3 border-b border-theme flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-600 dark:text-purple-400 border border-purple-500/20">
              <GitCompare size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black text-main tracking-tight">
                  {lang === 'zh' ? '优秀作业 / 屏幕一键多屏对比投屏批注' : 'Showcase & Multi-Screen Diff'}
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 font-mono">
                  {layout === 'dual' ? '2-Screen Dual' : layout === 'triple' ? '3-Screen Triple' : '4-Screen Quad'}
                </span>
              </div>
              <p className="text-2xs text-muted mt-0.5">
                {lessonTitle} · {activeWorks.length} {lang === 'zh' ? '位学生对比中' : 'works compared'}
              </p>
            </div>
          </div>

          {/* 右侧动作与关闭 */}
          <div className="flex items-center gap-2">
            {/* 选人抽屉开关 */}
            <button
              onClick={() => setIsDrawerOpen(!isDrawerOpen)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs border ${
                isDrawerOpen
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'bg-surface hover:bg-surface-secondary border-theme text-main'
              }`}
            >
              <Users size={13} />
              <span>{lang === 'zh' ? `勾选对比 (${selectedIds.length}/4)` : `Select (${selectedIds.length}/4)`}</span>
            </button>

            {/* 匿名模式开关 */}
            <button
              onClick={() => setIsAnonymous(!isAnonymous)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition-all cursor-pointer border ${
                isAnonymous
                  ? 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                  : 'bg-surface border-theme text-muted hover:text-main'
              }`}
              title={lang === 'zh' ? '匿名脱敏模式（保护学生隐私）' : 'Anonymous Mode'}
            >
              {isAnonymous ? <EyeOff size={13} /> : <Eye size={13} />}
              <span>{isAnonymous ? (lang === 'zh' ? '盲评匿名中' : 'Anonymous') : (lang === 'zh' ? '实名显示' : 'Real Name')}</span>
            </button>

            {/* 广播推流 */}
            <button
              onClick={handleBroadcastSync}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
            >
              <Share2 size={13} />
              <span>{lang === 'zh' ? '同步广播至全班' : 'Broadcast to Class'}</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-surface text-muted hover:text-main transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── 教师高光批注与思维剖析工具栏 ─────────────────────────── */}
        <div className="bg-surface px-5 py-2 border-b border-theme flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-2xs font-extrabold text-muted uppercase tracking-wider">
              {lang === 'zh' ? '批注图层' : 'Overlay'}:
            </span>

            {/* 激光笔 */}
            <button
              onClick={() => {
                setActiveTool('laser');
                setIsOverlayActive(true);
              }}
              className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                activeTool === 'laser' && isOverlayActive
                  ? 'bg-red-500 text-white shadow-xs'
                  : 'bg-surface-secondary text-main hover:bg-surface'
              }`}
              title={lang === 'zh' ? '动态激光笔（光晕聚焦点）' : 'Laser Pointer'}
            >
              <Radio size={13} />
              <span>{lang === 'zh' ? '激光笔' : 'Laser'}</span>
            </button>

            {/* 荧光笔 */}
            <button
              onClick={() => {
                setActiveTool('highlighter');
                setIsOverlayActive(true);
                setActiveColor(HIGHLIGHTER_COLORS[0].strokeHex);
              }}
              className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                activeTool === 'highlighter' && isOverlayActive
                  ? 'bg-amber-400 text-black shadow-xs font-black'
                  : 'bg-surface-secondary text-main hover:bg-surface'
              }`}
              title={lang === 'zh' ? '荧光笔（半透明高亮差异）' : 'Highlighter'}
            >
              <Highlighter size={13} />
              <span>{lang === 'zh' ? '荧光笔' : 'Highlighter'}</span>
            </button>

            {/* 细线红笔 */}
            <button
              onClick={() => {
                setActiveTool('pen');
                setIsOverlayActive(true);
                setActiveColor(PEN_COLORS[0].hex);
              }}
              className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                activeTool === 'pen' && isOverlayActive
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-surface-secondary text-main hover:bg-surface'
              }`}
              title={lang === 'zh' ? '细线批注笔（公式推导/画箭头）' : 'Pen'}
            >
              <Brush size={13} />
              <span>{lang === 'zh' ? '批注笔' : 'Pen'}</span>
            </button>

            {/* 橡皮擦 */}
            <button
              onClick={() => {
                setActiveTool('eraser');
                setIsOverlayActive(true);
              }}
              className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                activeTool === 'eraser' && isOverlayActive
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'bg-surface-secondary text-main hover:bg-surface'
              }`}
              title={lang === 'zh' ? '橡皮擦' : 'Eraser'}
            >
              <Eraser size={13} />
              <span>{lang === 'zh' ? '橡皮' : 'Eraser'}</span>
            </button>

            <div className="h-4 w-px bg-theme mx-1" />

            {/* 思维印章池 */}
            <div className="flex items-center gap-1">
              {DIFF_STAMP_PRESETS.map((p) => (
                <button
                  key={p.type}
                  onClick={() => {
                    setActiveTool('stamp');
                    setActiveStampType(p.type);
                    setIsOverlayActive(true);
                  }}
                  className={`px-2 py-0.5 rounded-lg text-2xs font-bold transition-all cursor-pointer border ${
                    activeTool === 'stamp' && activeStampType === p.type && isOverlayActive
                      ? 'scale-105 ring-2 ring-purple-500 shadow-xs'
                      : 'hover:bg-surface-secondary'
                  } ${p.bgColor} ${p.borderColor} ${p.textColor}`}
                  title={`点击后在画布上盖章：${p.label}`}
                >
                  <span>{p.icon}</span>
                  <span className="ml-1">{p.shortLabel}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 撤销与清空 */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setIsOverlayActive(!isOverlayActive)}
              className={`px-2 py-1 rounded-lg text-2xs font-bold transition-colors cursor-pointer ${
                isOverlayActive ? 'text-purple-600 bg-purple-50 dark:bg-purple-950/40' : 'text-muted hover:text-main'
              }`}
            >
              {isOverlayActive ? '图层已启用' : '图层已隐藏'}
            </button>

            <button
              onClick={handleUndo}
              className="p-1.5 rounded-lg bg-surface-secondary hover:bg-surface text-muted hover:text-main transition-colors cursor-pointer"
              title={lang === 'zh' ? '撤销上一笔' : 'Undo'}
            >
              <RotateCcw size={13} />
            </button>

            <button
              onClick={handleClearAnnotations}
              className="px-2 py-1 rounded-lg bg-surface-secondary hover:bg-rose-50 hover:text-rose-600 transition-colors text-2xs font-bold cursor-pointer flex items-center gap-1"
            >
              <Trash2 size={12} />
              <span>{lang === 'zh' ? '清空批注' : 'Clear'}</span>
            </button>
          </div>
        </div>

        {/* ── 主体多屏展示视窗与候选抽屉 ───────────────────────────── */}
        <div className="flex-1 min-h-0 relative flex overflow-hidden bg-app">
          {/* 侧边选人抽屉 */}
          {isDrawerOpen && (
            <div
              data-testid="student-candidate-drawer"
              className="w-80 shrink-0 border-r border-theme bg-surface-secondary/70 backdrop-blur-md p-4 flex flex-col gap-3 overflow-y-auto animate-slide-right z-30"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black text-main uppercase tracking-wider">
                  {lang === 'zh' ? '学生作答候选池' : 'Candidate Works'}
                </h3>
                <span className="text-2xs font-mono text-muted">{worksPool.length} 份作答</span>
              </div>

              {/* 预设方案 */}
              <div className="flex flex-col gap-1.5 pt-1 border-t border-theme/60">
                <span className="text-3xs font-extrabold text-muted uppercase">快捷场景预设:</span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => applyPresetCompare('typical_error_diff')}
                    className="p-1.5 rounded-lg bg-surface hover:bg-purple-50 hover:text-purple-600 dark:hover:bg-purple-950/40 border border-theme text-2xs font-bold text-left transition-colors"
                  >
                    🎯 典范 vs 错解
                  </button>
                  <button
                    onClick={() => applyPresetCompare('all_top')}
                    className="p-1.5 rounded-lg bg-surface hover:bg-purple-50 hover:text-purple-600 dark:hover:bg-purple-950/40 border border-theme text-2xs font-bold text-left transition-colors"
                  >
                    💡 四路并行对比
                  </button>
                </div>
              </div>

              {/* 学生列表 */}
              <div className="space-y-2 flex-1 pt-1">
                <span className="text-3xs font-extrabold text-muted uppercase">选择 2~4 位学生:</span>
                {worksPool.map((work) => {
                  const isChecked = selectedIds.includes(work.studentId);
                  return (
                    <div
                      key={work.studentId}
                      onClick={() => toggleStudentSelection(work.studentId)}
                      className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                        isChecked
                          ? 'border-purple-500 bg-purple-50/40 dark:bg-purple-950/30 shadow-2xs font-semibold'
                          : 'border-theme/60 hover:bg-surface'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          {isChecked ? (
                            <CheckSquare size={14} className="text-purple-600" />
                          ) : (
                            <Square size={14} className="text-muted" />
                          )}
                          <span className="text-xs font-bold text-main">{work.studentName}</span>
                          <span className="text-3xs font-mono px-1 rounded bg-surface border border-theme text-muted">
                            {work.seatNumber}
                          </span>
                        </div>
                        <span className={`text-3xs font-mono font-bold px-1.5 py-0.5 rounded ${
                          work.category === 'exemplary'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                            : work.category === 'typical_error'
                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                        }`}>
                          {work.category === 'exemplary' ? '示范' : work.category === 'typical_error' ? '典型错误' : '创新'}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted truncate pl-6 font-medium">{work.title}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── 核心并排视窗区域 ───────────────────────────────────── */}
          <div className="flex-1 min-w-0 h-full relative overflow-hidden flex flex-col p-4">
            {/* 覆盖批注画布 */}
            <DiffAnnotationCanvas
              activeTool={activeTool}
              activeColor={activeColor}
              activeStampType={activeStampType}
              strokes={strokes}
              setStrokes={setStrokes}
              stamps={stamps}
              setStamps={setStamps}
              isOverlayActive={isOverlayActive}
            />

            {/* 多屏网格卡片容器 */}
            <div
              data-testid="showcase-diff-grid"
              className={`w-full h-full grid gap-4 ${
                layout === 'dual'
                  ? 'grid-cols-1 md:grid-cols-2'
                  : layout === 'triple'
                    ? 'grid-cols-1 md:grid-cols-3'
                    : 'grid-cols-1 md:grid-cols-2 grid-rows-2'
              }`}
            >
              {activeWorks.map((work, idx) => {
                const displayName = isAnonymous
                  ? `作答方案 ${String.fromCharCode(65 + idx)}`
                  : work.studentName;

                return (
                  <div
                    key={work.studentId}
                    className="bg-surface border border-theme rounded-2xl shadow-sm flex flex-col overflow-hidden transition-all hover:border-purple-500/50"
                  >
                    {/* 卡片顶部标头 */}
                    <div className="bg-surface-secondary/60 px-4 py-2.5 border-b border-theme flex items-center justify-between shrink-0">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-purple-600 text-white flex items-center justify-center font-bold text-xs shadow-2xs">
                          {String.fromCharCode(65 + idx)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-xs text-main">{displayName}</span>
                            {!isAnonymous && work.seatNumber && (
                              <span className="text-3xs text-muted font-mono bg-surface px-1.5 py-0.5 rounded border border-theme">
                                {work.seatNumber}
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-muted truncate block">{work.title}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {work.durationSec && (
                          <span className="text-2xs font-mono text-muted flex items-center gap-0.5">
                            <Clock size={11} />
                            {Math.floor(work.durationSec / 60)}分{work.durationSec % 60}秒
                          </span>
                        )}
                        <span className={`px-2 py-0.5 rounded-full text-2xs font-bold font-mono ${
                          (work.accuracyScore ?? 0) >= 90
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                        }`}>
                          {work.accuracyScore}%
                        </span>
                      </div>
                    </div>

                    {/* 卡片作答与解题展示主体 */}
                    <div className="flex-1 p-4 overflow-y-auto font-mono text-xs leading-relaxed bg-surface/40">
                      <div className="flex flex-wrap gap-1 mb-2.5">
                        {work.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-2 py-0.5 rounded-md text-3xs font-bold bg-surface-secondary border border-theme text-main"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>

                      {/* 代码/演算展示区块 */}
                      <pre className="p-3.5 rounded-xl bg-slate-950 text-slate-100 dark:bg-black/90 font-mono text-2xs overflow-x-auto border border-slate-800 shadow-inner">
                        <code>{work.content}</code>
                      </pre>
                    </div>

                    {/* 卡片底部简析 */}
                    <div className="px-4 py-2 bg-surface-secondary/40 border-t border-theme flex items-center justify-between text-2xs text-muted">
                      <span>
                        {work.category === 'exemplary'
                          ? '🌟 步骤严谨规范，适合作为全班示范'
                          : work.category === 'typical_error'
                            ? '⚠️ 存在临界条件缺失，建议重点剖析'
                            : '💡 包含创新视角，可启发多元思维'}
                      </span>
                      <span className="font-mono text-3xs">{work.source}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
