/**
 * GroupCollabWhiteboardModal — 随堂小组协作白板与拼板互评展台（in-class）
 *
 * 核心特性：
 * 1. 智能动态分组决策：同质分层探讨 (Homogeneous) / 异质互助拼板 (Heterogeneous) / 随机均分 (Random)
 * 2. 随堂探究驱动任务下发 (Mission Prompt)
 * 3. 组间成果画廊互评展台 (Gallery Walk): 4~6 组多屏并览投屏、送花点赞 (🌸)、思辨提问与高光置顶
 */

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  X,
  Plus,
  Users,
  Trash2,
  Brush,
  Eraser,
  Circle as CircleIcon,
  Square as SquareIcon,
  Eye,
  EyeOff,
  Download,
  Palette,
  Sparkles,
  LayoutGrid,
  Heart,
  MessageSquare,
  Award,
  HelpCircle,
  Edit3,
} from 'lucide-react';
import {
  executeGrouping,
  type GroupingStrategy,
  type BreakoutGroup,
  type StudentCandidate,
} from './breakout-engine';

// ── 类型 ────────────────────────────────────────────────────────────

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  id: string;
  groupId: string;
  tool: 'pen' | 'rect' | 'circle' | 'eraser';
  color: string;
  width: number;
  points: Point[];
  rect?: { x: number; y: number; w: number; h: number };
  circle?: { cx: number; cy: number; r: number };
}

export interface GroupCollabWhiteboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  lessonId: string | null;
  classId: string | null;
  availableStudents: Array<{ id: string; name: string; tier?: 'basic' | 'intermediate' | 'advanced' }>;
  addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  lang?: 'zh' | 'en';
}

const COLORS = ['#4f46e5', '#06b6d4', '#a855f7', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#1e293b'];
const PRESET_INQUIRY_TAGS = ['思路新颖', '极值合理', '受力严谨', '需补充推导'];

export const GroupCollabWhiteboardModal: React.FC<GroupCollabWhiteboardModalProps> = ({
  isOpen,
  onClose,
  lessonId,
  classId,
  availableStudents,
  addToast,
  lang = 'zh',
}) => {
  const [groups, setGroups] = useState<BreakoutGroup[]>([]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activeColor, setActiveColor] = useState<string>(COLORS[0]);
  const [activeWidth, setActiveWidth] = useState<number>(3);
  const [activeTool, setActiveTool] = useState<'pen' | 'rect' | 'circle' | 'eraser'>('pen');
  const [showAllGroups, setShowAllGroups] = useState(false);
  const [showAssignmentPanel, setShowAssignmentPanel] = useState(true);

  // 随堂探究与画廊互评扩展状态
  const [groupingStrategy, setGroupingStrategy] = useState<GroupingStrategy>('heterogeneous');
  const [isGalleryMode, setIsGalleryMode] = useState<boolean>(false);
  const [missionPrompt, setMissionPrompt] = useState<string>(
    lang === 'zh'
      ? '随堂探究驱动题：请各小组针对本题受力与运动过程进行受力拆解绘图，并标出关键守恒量。'
      : 'In-class Jigsaw Task: Collaborate to draw the state diagram and identify conserved quantities.',
  );
  const [groupLikes, setGroupLikes] = useState<Record<string, number>>({});
  const [groupInquiries, setGroupInquiries] = useState<Record<string, string[]>>({});
  const [spotlightGroupId, setSpotlightGroupId] = useState<string | null>(null);

  const canvasRef = useRef<SVGSVGElement | null>(null);

  // 初始化默认 4 个小组
  useEffect(() => {
    if (isOpen && groups.length === 0) {
      const defaultColors = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500'];
      const initialGroups: BreakoutGroup[] = Array.from({ length: 4 }).map((_, i) => ({
        id: `group-${i + 1}`,
        name: lang === 'zh' ? `第 ${i + 1} 小组` : `Group ${i + 1}`,
        memberIds: [],
        color: defaultColors[i % defaultColors.length],
        focusTier: 'balanced',
        likesCount: 0,
        inquiryTags: [],
        isSpotlight: false,
      }));
      setGroups(initialGroups);
      setActiveGroupId(initialGroups[0].id);
    }
    if (!isOpen) {
      setGroups([]);
      setStrokes([]);
      setActiveGroupId(null);
      setIsGalleryMode(false);
    }
  }, [isOpen, lang]);

  // 智能一键自动分配
  const autoAssign = useCallback(() => {
    if (groups.length === 0) return;
    const candidates: StudentCandidate[] = availableStudents.map((s, idx) => ({
      id: s.id,
      name: s.name,
      tier: s.tier || (idx % 3 === 0 ? 'advanced' : idx % 3 === 1 ? 'intermediate' : 'basic'),
    }));
    const newGroups = executeGrouping(candidates, groups.length, groupingStrategy);
    setGroups(newGroups);

    const strategyLabel =
      groupingStrategy === 'heterogeneous'
        ? lang === 'zh'
          ? '异质拼板互助（以优带新）'
          : 'Heterogeneous Jigsaw'
        : groupingStrategy === 'homogeneous'
          ? lang === 'zh'
            ? '同质分层探讨'
            : 'Homogeneous Tiered'
          : lang === 'zh'
            ? '随机均分'
            : 'Random';

    addToast(
      lang === 'zh' ? '✅ 自动分配完成' : '✅ Auto-assigned',
      lang === 'zh' ? `已按「${strategyLabel}」将 ${candidates.length} 名学生自动分配完毕。` : `Assigned by ${strategyLabel}.`,
      'success',
    );
  }, [groups.length, availableStudents, groupingStrategy, addToast, lang]);

  const addGroup = useCallback(() => {
    const newGroup: BreakoutGroup = {
      id: `group-${Date.now()}`,
      name: lang === 'zh' ? `第 ${groups.length + 1} 小组` : `Group ${groups.length + 1}`,
      memberIds: [],
      color: 'bg-indigo-500',
      focusTier: 'balanced',
      likesCount: 0,
      inquiryTags: [],
      isSpotlight: false,
    };
    setGroups((prev) => [...prev, newGroup]);
    setActiveGroupId(newGroup.id);
  }, [groups.length, lang]);

  const removeGroup = useCallback(
    (id: string) => {
      setGroups((prev) => prev.filter((g) => g.id !== id));
      setStrokes((prev) => prev.filter((s) => s.groupId !== id));
      if (activeGroupId === id) {
        setActiveGroupId((prev) => {
          const remaining = groups.filter((g) => g.id !== id);
          return remaining[0]?.id ?? null;
        });
      }
    },
    [activeGroupId, groups],
  );

  const assignMember = useCallback((groupId: string, studentId: string, member: boolean) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        const memberIds = member ? [...g.memberIds, studentId] : g.memberIds.filter((id) => id !== studentId);
        return { ...g, memberIds };
      }),
    );
  }, []);

  const clearGroupStrokes = useCallback((groupId: string) => {
    setStrokes((prev) => prev.filter((s) => s.groupId !== groupId));
  }, []);

  // 送花点赞交互
  const handleLikeGroup = (groupId: string, groupName: string) => {
    setGroupLikes((prev) => ({
      ...prev,
      [groupId]: (prev[groupId] || 0) + 1,
    }));
    addToast(
      lang === 'zh' ? '🌸 送花点赞成功' : '🌸 Flower Awarded',
      lang === 'zh' ? `已为「${groupName}」送出一朵协作探究鲜花！` : `Awarded flower to ${groupName}!`,
      'success',
    );
  };

  // 增加思辨标签
  const handleAddInquiryTag = (groupId: string, tag: string) => {
    setGroupInquiries((prev) => {
      const current = prev[groupId] || [];
      if (current.includes(tag)) return prev;
      return { ...prev, [groupId]: [...current, tag] };
    });
  };

  // 画布交互：鼠标拖动绘制
  const drawingState = useRef<{
    active: boolean;
    start: Point;
    currentStroke?: Stroke;
  }>({ active: false, start: { x: 0, y: 0 } });

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!activeGroupId || !canvasRef.current || isGalleryMode) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const start: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      drawingState.current = {
        active: true,
        start,
        currentStroke: {
          id: `s-${Date.now()}-${Math.random()}`,
          groupId: activeGroupId,
          tool: activeTool,
          color: activeTool === 'eraser' ? '#ffffff' : activeColor,
          width: activeWidth,
          points: [start],
        },
      };
    },
    [activeGroupId, activeTool, activeColor, activeWidth, isGalleryMode],
  );

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const ds = drawingState.current;
    if (!ds.active || !ds.currentStroke || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const point: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (ds.currentStroke.tool === 'pen' || ds.currentStroke.tool === 'eraser') {
      ds.currentStroke.points = [...ds.currentStroke.points, point];
    } else if (ds.currentStroke.tool === 'rect') {
      ds.currentStroke.rect = {
        x: Math.min(ds.start.x, point.x),
        y: Math.min(ds.start.y, point.y),
        w: Math.abs(point.x - ds.start.x),
        h: Math.abs(point.y - ds.start.y),
      };
    } else if (ds.currentStroke.tool === 'circle') {
      const dx = point.x - ds.start.x;
      const dy = point.y - ds.start.y;
      ds.currentStroke.circle = {
        cx: ds.start.x + dx / 2,
        cy: ds.start.y + dy / 2,
        r: Math.sqrt(dx * dx + dy * dy) / 2,
      };
    }
    setStrokes((prev) => [...prev.filter((s) => s.id !== ds.currentStroke!.id), ds.currentStroke!]);
  }, []);

  const handleCanvasMouseUp = useCallback(() => {
    drawingState.current = { active: false, start: { x: 0, y: 0 } };
  }, []);

  const downloadCurrentGroupSVG = useCallback(() => {
    if (!activeGroupId || !canvasRef.current) return;
    const svg = canvasRef.current.outerHTML;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeGroupId}-${new Date().toISOString().slice(0, 10)}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeGroupId]);

  const visibleStrokes = useMemo(() => {
    if (showAllGroups) return strokes;
    return strokes.filter((s) => s.groupId === activeGroupId);
  }, [strokes, activeGroupId, showAllGroups]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[118] bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-surface border border-theme rounded-2xl shadow-2xl w-full max-w-7xl h-[92vh] flex flex-col overflow-hidden text-main">
        {/* ── 顶部导航栏 ─────────────────────────────────────────── */}
        <div className="bg-surface-secondary px-5 py-3 border-b border-theme flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 flex items-center justify-center">
              <Users size={18} className="text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-extrabold text-main">
                  {lang === 'zh' ? '随堂小组协作与画廊互评' : 'Group Collaboration & Gallery Walk'}
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-mono">
                  Jigsaw & Battle
                </span>
              </div>
              <p className="text-2xs text-muted mt-0.5">
                {groups.length} {lang === 'zh' ? '个探究小组' : 'groups'} ·{' '}
                {isGalleryMode ? (lang === 'zh' ? '当前处于画廊大屏互评并览' : 'Gallery Walk Active') : (lang === 'zh' ? '当前处于组内精修' : 'Single Canvas Active')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Gallery Walk Toggle */}
            <button
              onClick={() => setIsGalleryMode(!isGalleryMode)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs ${
                isGalleryMode
                  ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/20'
                  : 'bg-surface hover:bg-surface-secondary border border-theme text-main'
              }`}
            >
              <LayoutGrid size={13} />
              <span>{isGalleryMode ? (lang === 'zh' ? '返回单组画布' : 'Exit Gallery') : (lang === 'zh' ? '画廊互评大屏并览 (Gallery Walk)' : 'Gallery Walk')}</span>
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

        {/* ── 探究任务驱动题横幅 ──────────────────────────────────── */}
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-5 py-2 flex items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Sparkles size={14} className="text-amber-500 shrink-0" />
            <span className="font-bold text-amber-700 dark:text-amber-400 shrink-0">
              {lang === 'zh' ? '探究任务：' : 'Mission: '}
            </span>
            <input
              type="text"
              value={missionPrompt}
              onChange={(e) => setMissionPrompt(e.target.value)}
              className="bg-transparent border-none text-main focus:outline-hidden text-xs flex-1 truncate font-medium"
              placeholder={lang === 'zh' ? '输入或调整小组驱动探究任务...' : 'Enter collaboration mission...'}
            />
          </div>
          <span className="text-3xs text-muted font-mono shrink-0 flex items-center gap-1">
            <Edit3 size={10} />
            {lang === 'zh' ? '各组画布实时同步' : 'Synced to all canvases'}
          </span>
        </div>

        {/* ── 主体区域 ────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 flex">
          {/* 左侧：小组策略与花名册分配面板 */}
          {showAssignmentPanel && !isGalleryMode && (
            <div className="w-72 shrink-0 border-r border-theme bg-surface-secondary/50 overflow-y-auto scrollbar-thin flex flex-col p-3.5 gap-3">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-extrabold text-main uppercase tracking-wider">
                    {lang === 'zh' ? '分组策略' : 'Strategy'}
                  </h3>
                  <button
                    onClick={addGroup}
                    className="p-1 rounded hover:bg-surface text-primary-theme cursor-pointer"
                    title={lang === 'zh' ? '新建小组' : 'New group'}
                  >
                    <Plus size={14} />
                  </button>
                </div>

                {/* 策略切换 */}
                <div className="grid grid-cols-3 gap-1 p-0.5 bg-surface rounded-lg border border-theme mb-2.5">
                  <button
                    onClick={() => setGroupingStrategy('heterogeneous')}
                    className={`py-1 text-2xs font-bold rounded transition-colors ${
                      groupingStrategy === 'heterogeneous' ? 'bg-primary-theme text-white' : 'text-muted hover:text-main'
                    }`}
                    title={lang === 'zh' ? '拼板互助（1优+2中+1潜）' : 'Heterogeneous'}
                  >
                    拼板互助
                  </button>
                  <button
                    onClick={() => setGroupingStrategy('homogeneous')}
                    className={`py-1 text-2xs font-bold rounded transition-colors ${
                      groupingStrategy === 'homogeneous' ? 'bg-primary-theme text-white' : 'text-muted hover:text-main'
                    }`}
                    title={lang === 'zh' ? '同质分层探讨' : 'Homogeneous'}
                  >
                    同质分层
                  </button>
                  <button
                    onClick={() => setGroupingStrategy('random')}
                    className={`py-1 text-2xs font-bold rounded transition-colors ${
                      groupingStrategy === 'random' ? 'bg-primary-theme text-white' : 'text-muted hover:text-main'
                    }`}
                    title={lang === 'zh' ? '随机均分' : 'Random'}
                  >
                    随机均分
                  </button>
                </div>

                <button
                  onClick={autoAssign}
                  className="w-full px-3 py-1.5 text-xs font-bold rounded-xl bg-primary-theme hover:bg-primary-theme-hover text-white transition-colors flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
                >
                  <Users size={12} />
                  <span>{lang === 'zh' ? '一键自动分配' : 'Auto-assign'}</span>
                </button>
              </div>

              {/* 小组列表 */}
              <div className="space-y-1.5 flex-1 min-h-[160px]">
                <h4 className="text-2xs font-bold text-muted uppercase tracking-wider">
                  {lang === 'zh' ? '小组列表' : 'Groups'}
                </h4>
                {groups.map((g) => (
                  <div
                    key={g.id}
                    onClick={() => setActiveGroupId(g.id)}
                    className={`p-2 rounded-xl border transition-all cursor-pointer ${
                      activeGroupId === g.id
                        ? 'border-primary-theme bg-surface shadow-2xs font-semibold'
                        : 'border-theme/40 hover:bg-surface'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className={`w-2 h-2 rounded-full ${g.color}`} />
                        <span className="text-xs font-bold text-main truncate">{g.name}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {groupLikes[g.id] > 0 && (
                          <span className="text-2xs text-rose-500 font-mono flex items-center gap-0.5">
                            🌸{groupLikes[g.id]}
                          </span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeGroup(g.id);
                          }}
                          className="p-0.5 rounded text-muted hover:text-rose-600 hover:bg-rose-50 transition-colors"
                          title={lang === 'zh' ? '删除' : 'Remove'}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                    <div className="text-[10px] text-muted truncate">
                      {g.memberIds.length === 0
                        ? lang === 'zh'
                          ? '未分配成员'
                          : 'No members'
                        : g.memberIds
                            .map((id) => availableStudents.find((s) => s.id === id)?.name ?? id.slice(0, 6))
                            .join(', ')}
                    </div>
                  </div>
                ))}
              </div>

              {/* 学生花名册 */}
              <div className="pt-2 border-t border-theme/60">
                <h4 className="text-2xs font-bold text-muted uppercase tracking-wider mb-1.5">
                  {lang === 'zh' ? '班级学生库' : 'Roster'}
                </h4>
                <div className="space-y-1 max-h-48 overflow-y-auto scrollbar-thin">
                  {availableStudents.map((s) => {
                    const inSomeGroup = groups.some((g) => g.memberIds.includes(s.id));
                    return (
                      <div
                        key={s.id}
                        className="flex items-center justify-between p-1 rounded hover:bg-surface text-2xs"
                      >
                        <span className={inSomeGroup ? 'text-muted line-through' : 'text-main font-medium'}>
                          {s.name}
                        </span>
                        {activeGroupId && (
                          <button
                            onClick={() => assignMember(activeGroupId, s.id, !inSomeGroup)}
                            className={`px-1.5 py-0.5 rounded text-3xs font-bold ${
                              inSomeGroup
                                ? 'bg-surface-secondary text-muted hover:text-rose-600'
                                : 'bg-primary-theme/10 text-primary-theme hover:bg-primary-theme hover:text-white'
                            }`}
                          >
                            {inSomeGroup ? '−' : '+'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* 右侧主绘图区 或 画廊互评展台 */}
          <div className="flex-1 min-w-0 flex flex-col bg-surface">
            {isGalleryMode ? (
              /* ── 组间画廊互评展台 (Gallery Walk) ── */
              <div className="flex-1 p-5 overflow-y-auto bg-surface-secondary/30">
                <div className="max-w-6xl mx-auto space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-extrabold text-sm text-main flex items-center gap-1.5">
                        <LayoutGrid size={16} className="text-amber-500" />
                        <span>{lang === 'zh' ? '全班小组探究画廊展台' : 'Classroom Gallery Walk Showcase'}</span>
                      </h3>
                      <p className="text-2xs text-muted">
                        {lang === 'zh'
                          ? '多组画布并排投屏，支持师生端送花点赞、思辨发问与成果置顶评选'
                          : 'Side-by-side presentation, like and praise student submissions.'}
                      </p>
                    </div>

                    <div className="text-xs font-mono font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-3 py-1 rounded-xl border border-amber-500/30">
                      🌸 协作热度总计: {Object.values(groupLikes).reduce((a, b) => a + b, 0)} 朵鲜花
                    </div>
                  </div>

                  {/* 2x2 / 2x3 网格卡片 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {groups.map((g) => {
                      const groupStrokes = strokes.filter((s) => s.groupId === g.id);
                      const likes = groupLikes[g.id] || 0;
                      const inquiries = groupInquiries[g.id] || [];
                      const isSpotlight = spotlightGroupId === g.id;

                      return (
                        <div
                          key={g.id}
                          className={`bg-surface border rounded-2xl p-3.5 shadow-sm flex flex-col gap-2.5 transition-all ${
                            isSpotlight
                              ? 'border-amber-400 ring-2 ring-amber-400/40 shadow-amber-500/10'
                              : 'border-theme hover:border-primary-theme/60'
                          }`}
                        >
                          <div className="flex items-center justify-between border-b border-theme/50 pb-2">
                            <div className="flex items-center gap-2">
                              <div className={`w-2.5 h-2.5 rounded-full ${g.color}`} />
                              <span className="font-bold text-xs text-main">{g.name}</span>
                              {isSpotlight && (
                                <span className="px-1.5 py-0.2 rounded-md bg-amber-500 text-white text-[9px] font-bold">
                                  🌟 置顶高光
                                </span>
                              )}
                            </div>
                            <span className="text-2xs text-muted font-mono">{g.memberIds.length} 成员</span>
                          </div>

                          {/* 画布微型预览 */}
                          <div
                            onClick={() => {
                              setActiveGroupId(g.id);
                              setIsGalleryMode(false);
                            }}
                            className="w-full h-44 bg-white rounded-xl border border-theme/60 overflow-hidden relative cursor-pointer group"
                            title={lang === 'zh' ? '点击切入单组精修' : 'Click to edit canvas'}
                          >
                            <svg className="w-full h-full" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid meet">
                              <rect width="1200" height="800" fill="#ffffff" />
                              {groupStrokes.map((s) => {
                                if (s.tool === 'pen' || s.tool === 'eraser') {
                                  const pathD = s.points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
                                  return (
                                    <path
                                      key={s.id}
                                      d={pathD}
                                      stroke={s.color}
                                      strokeWidth={s.width * 1.5}
                                      fill="none"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  );
                                }
                                return null;
                              })}
                            </svg>

                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                              <span className="opacity-0 group-hover:opacity-100 bg-surface/90 text-main text-2xs font-bold px-2 py-1 rounded-lg shadow-sm transition-opacity">
                                🔍 点击切入画布
                              </span>
                            </div>
                          </div>

                          {/* 互动控制区：送花与思辨标签 */}
                          <div className="space-y-2 pt-1">
                            <div className="flex items-center justify-between gap-1.5">
                              <button
                                onClick={() => handleLikeGroup(g.id, g.name)}
                                className="flex-1 py-1 px-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                              >
                                <span>🌸 送花赞赏</span>
                                <span className="font-mono text-2xs">({likes})</span>
                              </button>

                              <button
                                onClick={() => setSpotlightGroupId(isSpotlight ? null : g.id)}
                                className={`py-1 px-2 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                                  isSpotlight
                                    ? 'bg-amber-500 text-white'
                                    : 'bg-surface-secondary text-muted hover:text-main'
                                }`}
                                title={lang === 'zh' ? '设为全班高光' : 'Spotlight'}
                              >
                                <Award size={12} />
                                <span>{isSpotlight ? '取消高光' : '高光'}</span>
                              </button>
                            </div>

                            {/* 思辨标签池 */}
                            <div className="flex flex-wrap gap-1">
                              {PRESET_INQUIRY_TAGS.map((tag) => {
                                const hasTag = inquiries.includes(tag);
                                return (
                                  <button
                                    key={tag}
                                    onClick={() => handleAddInquiryTag(g.id, tag)}
                                    className={`px-1.5 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
                                      hasTag
                                        ? 'bg-indigo-600 text-white font-bold'
                                        : 'bg-surface-secondary text-muted hover:text-main'
                                    }`}
                                  >
                                    {hasTag ? `✓ ${tag}` : `+ ${tag}`}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              /* ── 单组精修模式 ── */
              <>
                {/* 绘图工具栏 */}
                <div className="bg-surface-secondary/40 px-4 py-2 border-b border-theme flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-1.5">
                    <ToolButton
                      active={activeTool === 'pen'}
                      onClick={() => setActiveTool('pen')}
                      icon={<Brush size={14} />}
                      label={lang === 'zh' ? '笔' : 'Pen'}
                    />
                    <ToolButton
                      active={activeTool === 'rect'}
                      onClick={() => setActiveTool('rect')}
                      icon={<SquareIcon size={14} />}
                      label={lang === 'zh' ? '矩形' : 'Rectangle'}
                    />
                    <ToolButton
                      active={activeTool === 'circle'}
                      onClick={() => setActiveTool('circle')}
                      icon={<CircleIcon size={14} />}
                      label={lang === 'zh' ? '圆形' : 'Circle'}
                    />
                    <ToolButton
                      active={activeTool === 'eraser'}
                      onClick={() => setActiveTool('eraser')}
                      icon={<Eraser size={14} />}
                      label={lang === 'zh' ? '橡皮' : 'Eraser'}
                    />

                    <div className="h-4 w-px bg-theme mx-1" />

                    <div className="flex items-center gap-1">
                      {COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => setActiveColor(c)}
                          style={{ backgroundColor: c }}
                          className={`w-5 h-5 rounded-full transition-transform ${
                            activeColor === c ? 'scale-125 ring-2 ring-primary-theme' : 'hover:scale-110'
                          }`}
                        />
                      ))}
                    </div>

                    <div className="h-4 w-px bg-theme mx-1" />

                    <div className="flex items-center gap-1 text-xs">
                      {[1, 3, 5, 8].map((w) => (
                        <button
                          key={w}
                          onClick={() => setActiveWidth(w)}
                          className={`px-2 py-0.5 rounded text-2xs font-mono font-bold ${
                            activeWidth === w ? 'bg-primary-theme text-white' : 'hover:bg-surface'
                          }`}
                        >
                          {w}px
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setShowAllGroups(!showAllGroups)}
                      className={`px-2.5 py-1 text-xs font-bold rounded-lg flex items-center gap-1 transition-colors cursor-pointer ${
                        showAllGroups ? 'bg-primary-theme text-white' : 'bg-surface-secondary text-main'
                      }`}
                    >
                      {showAllGroups ? <Eye size={12} /> : <EyeOff size={12} />}
                      <span>{showAllGroups ? (lang === 'zh' ? '查看全部' : 'All groups') : (lang === 'zh' ? '仅当前' : 'Single')}</span>
                    </button>

                    <button
                      onClick={() => activeGroupId && clearGroupStrokes(activeGroupId)}
                      className="px-2.5 py-1 text-xs font-bold rounded-lg bg-surface-secondary hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer"
                    >
                      {lang === 'zh' ? '清空本组' : 'Clear'}
                    </button>

                    <button
                      onClick={downloadCurrentGroupSVG}
                      className="px-2.5 py-1 text-xs font-bold rounded-lg bg-surface-secondary hover:bg-surface transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Download size={12} />
                      <span>SVG</span>
                    </button>
                  </div>
                </div>

                {/* 独立子画布 */}
                <div className="flex-1 min-h-0 bg-white relative">
                  <svg
                    ref={canvasRef}
                    className="w-full h-full"
                    viewBox="0 0 1200 800"
                    preserveAspectRatio="xMidYMid meet"
                    onMouseDown={handleCanvasMouseDown}
                    onMouseMove={handleCanvasMouseMove}
                    onMouseUp={handleCanvasMouseUp}
                    onMouseLeave={handleCanvasMouseUp}
                    style={{ cursor: 'crosshair' }}
                  >
                    <defs>
                      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#f1f5f9" strokeWidth="1" />
                      </pattern>
                    </defs>
                    <rect width="1200" height="800" fill="url(#grid)" />

                    {visibleStrokes.map((s) => {
                      if (s.tool === 'pen' || s.tool === 'eraser') {
                        const pathD = s.points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
                        return (
                          <path
                            key={s.id}
                            d={pathD}
                            stroke={s.color}
                            strokeWidth={s.width}
                            fill="none"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            opacity={s.tool === 'eraser' ? 0.4 : 1}
                          />
                        );
                      } else if (s.tool === 'rect' && s.rect) {
                        return (
                          <rect
                            key={s.id}
                            x={s.rect.x}
                            y={s.rect.y}
                            width={s.rect.w}
                            height={s.rect.h}
                            stroke={s.color}
                            strokeWidth={s.width}
                            fill="none"
                          />
                        );
                      } else if (s.tool === 'circle' && s.circle) {
                        return (
                          <circle
                            key={s.id}
                            cx={s.circle.cx}
                            cy={s.circle.cy}
                            r={s.circle.r}
                            stroke={s.color}
                            strokeWidth={s.width}
                            fill="none"
                          />
                        );
                      }
                      return null;
                    })}
                  </svg>

                  {/* 悬浮组名与送花热度 */}
                  <div className="absolute top-3 left-3 px-3 py-1.5 bg-surface/95 border border-theme rounded-xl text-xs font-bold text-main shadow-sm backdrop-blur-xs flex items-center gap-2">
                    <span>
                      {lang === 'zh' ? '当前画布：' : 'Canvas: '}
                      {groups.find((g) => g.id === activeGroupId)?.name ?? (lang === 'zh' ? '未选小组' : 'No group')}
                    </span>
                    {activeGroupId && groupLikes[activeGroupId] > 0 && (
                      <span className="text-2xs text-rose-500 font-mono flex items-center gap-0.5">
                        🌸 {groupLikes[activeGroupId]}
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const ToolButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={`p-1.5 rounded-lg flex items-center gap-1 transition-colors cursor-pointer ${
      active ? 'bg-primary-theme text-white' : 'bg-surface-secondary text-main hover:bg-surface'
    }`}
    title={label}
  >
    {icon}
  </button>
);