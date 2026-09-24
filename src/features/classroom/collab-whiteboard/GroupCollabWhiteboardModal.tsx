/**
 * GroupCollabWhiteboardModal — 小组协作白板（in-class）
 *
 * 上课流程扩展 #4：从 ClassroomInteractiveCockpit 工具栏打开。
 * 教师端为每个小组提供独立画布（mock 实现），可创建/分配/切换查看。
 * 实时同步（socket.io 多客户端写入）作为未来扩展点：
 * 当前实现仅前端 in-memory state + 注释说明；
 * 持久化与广播由 extension slot `classroom.collab.canvas` 接入。
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
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';

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

interface Group {
  id: string;
  name: string;
  memberIds: string[];
  color: string;
}

export interface GroupCollabWhiteboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  lessonId: string | null;
  classId: string | null;
  availableStudents: Array<{ id: string; name: string }>;
  addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  lang?: 'zh' | 'en';
}

// ── 工具与颜色 ──────────────────────────────────────────────────────

const COLORS = ['#4f46e5', '#06b6d4', '#a855f7', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#1e293b'];
const GROUP_COLORS = ['bg-indigo-500', 'bg-cyan-500', 'bg-purple-500', 'bg-pink-500', 'bg-amber-500', 'bg-emerald-500'];

// ── 主组件 ──────────────────────────────────────────────────────────

export const GroupCollabWhiteboardModal: React.FC<GroupCollabWhiteboardModalProps> = ({
  isOpen,
  onClose,
  lessonId,
  classId,
  availableStudents,
  addToast,
  lang = 'zh',
}) => {
  const [groups, setGroups] = useState<Group[]>([]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activeColor, setActiveColor] = useState<string>(COLORS[0]);
  const [activeWidth, setActiveWidth] = useState<number>(3);
  const [activeTool, setActiveTool] = useState<'pen' | 'rect' | 'circle' | 'eraser'>('pen');
  const [showAllGroups, setShowAllGroups] = useState(false);
  const [showAssignmentPanel, setShowAssignmentPanel] = useState(true);
  const canvasRef = useRef<SVGSVGElement | null>(null);

  // 初始化默认 4 个小组
  useEffect(() => {
    if (isOpen && groups.length === 0) {
      const initialGroups: Group[] = [1, 2, 3, 4].map((i) => ({
        id: `group-${i}`,
        name: lang === 'zh' ? `第 ${i} 小组` : `Group ${i}`,
        memberIds: [],
        color: GROUP_COLORS[(i - 1) % GROUP_COLORS.length],
      }));
      setGroups(initialGroups);
      setActiveGroupId(initialGroups[0].id);
    }
    if (!isOpen) {
      // 关闭时清空（避免下次打开时残留）
      setGroups([]);
      setStrokes([]);
      setActiveGroupId(null);
    }
  }, [isOpen, lang, groups.length]);

  // 自动分配学生到各组（按顺序均分）
  const autoAssign = useCallback(() => {
    if (groups.length === 0) return;
    const shuffled = [...availableStudents].sort(() => Math.random() - 0.5);
    const newGroups = groups.map((g, i) => ({
      ...g,
      memberIds: shuffled.filter((_, idx) => idx % groups.length === i).map((s) => s.id),
    }));
    setGroups(newGroups);
    addToast(
      lang === 'zh' ? '✅ 已自动分配' : '✅ Auto-assigned',
      lang === 'zh' ? `${shuffled.length} 位学生` : `${shuffled.length} students`,
      'success',
    );
  }, [groups, availableStudents, addToast, lang]);

  const addGroup = useCallback(() => {
    const newGroup: Group = {
      id: `group-${Date.now()}`,
      name: lang === 'zh' ? `第 ${groups.length + 1} 小组` : `Group ${groups.length + 1}`,
      memberIds: [],
      color: GROUP_COLORS[groups.length % GROUP_COLORS.length],
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

  const assignMember = useCallback(
    (groupId: string, studentId: string, member: boolean) => {
      setGroups((prev) =>
        prev.map((g) => {
          if (g.id !== groupId) return g;
          const memberIds = member
            ? [...g.memberIds, studentId]
            : g.memberIds.filter((id) => id !== studentId);
          return { ...g, memberIds };
        }),
      );
    },
    [],
  );

  const clearGroupStrokes = useCallback((groupId: string) => {
    setStrokes((prev) => prev.filter((s) => s.groupId !== groupId));
  }, []);

  // 画布交互：鼠标拖动绘制
  const drawingState = useRef<{
    active: boolean;
    start: Point;
    currentStroke?: Stroke;
  }>({ active: false, start: { x: 0, y: 0 } });

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!activeGroupId || !canvasRef.current) return;
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
    [activeGroupId, activeTool, activeColor, activeWidth],
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

  // 渲染当前查看的笔画（active 或全部）
  const visibleStrokes = useMemo(() => {
    if (showAllGroups) return strokes;
    return strokes.filter((s) => s.groupId === activeGroupId);
  }, [strokes, activeGroupId, showAllGroups]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[118] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-surface border border-theme rounded-2xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col overflow-hidden">
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="bg-surface-secondary px-6 py-4 border-b border-theme flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <Users size={20} className="text-emerald-600" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-main">
                {lang === 'zh' ? '小组协作白板' : 'Group Collaborative Whiteboard'}
              </h2>
              <p className="text-xs text-muted mt-0.5">
                {lessonId ? `${lang === 'zh' ? '课节' : 'Lesson'}: ${lessonId}` : '—'} ·{' '}
                {groups.length} {lang === 'zh' ? '个小组' : 'groups'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface text-muted hover:text-main transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Main Layout ──────────────────────────────────── */}
        <div className="flex-1 min-h-0 flex">
          {/* 左侧：小组列表 + 分配面板 */}
          {showAssignmentPanel && (
            <div className="w-72 shrink-0 border-r border-theme bg-surface-secondary overflow-y-auto scrollbar-thin">
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-extrabold text-main uppercase tracking-wider">
                    {lang === 'zh' ? '小组' : 'Groups'}
                  </h3>
                  <button
                    onClick={addGroup}
                    className="p-1 rounded hover:bg-surface text-primary-theme"
                    title={lang === 'zh' ? '新建小组' : 'New group'}
                  >
                    <Plus size={14} />
                  </button>
                </div>

                <button
                  onClick={autoAssign}
                  className="w-full mb-3 px-3 py-1.5 text-xs font-bold rounded-lg bg-primary-theme text-white hover:bg-primary-theme-hover transition-colors flex items-center justify-center gap-1.5"
                >
                  <Users size={12} />
                  {lang === 'zh' ? '一键自动分配' : 'Auto-assign'}
                </button>

                <div className="space-y-2">
                  {groups.map((g) => (
                    <div
                      key={g.id}
                      onClick={() => setActiveGroupId(g.id)}
                      className={`p-2.5 rounded-lg border-2 cursor-pointer transition-all ${
                        activeGroupId === g.id
                          ? 'border-primary-theme bg-surface shadow-sm'
                          : 'border-transparent hover:bg-surface'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full ${g.color}`} />
                          <span className="text-xs font-bold text-main truncate">{g.name}</span>
                        </div>
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
                      <div className="text-[10px] text-muted">
                        {g.memberIds.length === 0
                          ? lang === 'zh'
                            ? '未分配成员'
                            : 'No members'
                          : g.memberIds
                              .map(
                                (id) =>
                                  availableStudents.find((s) => s.id === id)?.name ?? id.slice(0, 6),
                              )
                              .join(', ')}
                      </div>
                    </div>
                  ))}
                </div>

                <h3 className="text-xs font-extrabold text-main uppercase tracking-wider mt-4 mb-2">
                  {lang === 'zh' ? '可用学生' : 'Available'}
                </h3>
                <div className="space-y-1 max-h-64 overflow-y-auto scrollbar-thin">
                  {availableStudents.map((s) => {
                    const inSomeGroup = groups.some((g) => g.memberIds.includes(s.id));
                    return (
                      <div key={s.id} className="flex items-center justify-between px-2 py-1 rounded text-[11px] hover:bg-surface">
                        <span className={inSomeGroup ? 'text-muted line-through' : 'text-main'}>
                          {s.name}
                        </span>
                        {activeGroupId && (
                          <button
                            onClick={() => assignMember(activeGroupId, s.id, !inSomeGroup)}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-primary-theme hover:bg-primary-theme/10 transition-colors"
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

          {/* 中央：白板画布 + 工具栏 */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* 工具栏 */}
            <div className="px-4 py-2 border-b border-theme flex items-center gap-2 shrink-0">
              <button
                onClick={() => setShowAssignmentPanel(!showAssignmentPanel)}
                className="p-1.5 rounded hover:bg-surface-secondary text-muted"
                title={lang === 'zh' ? '切换侧栏' : 'Toggle sidebar'}
              >
                <Users size={14} />
              </button>
              <div className="h-4 w-px bg-theme mx-1" />

              <ToolButton active={activeTool === 'pen'} onClick={() => setActiveTool('pen')} icon={<Brush size={14} />} label={lang === 'zh' ? '笔' : 'Pen'} />
              <ToolButton active={activeTool === 'rect'} onClick={() => setActiveTool('rect')} icon={<SquareIcon size={14} />} label={lang === 'zh' ? '矩形' : 'Rect'} />
              <ToolButton active={activeTool === 'circle'} onClick={() => setActiveTool('circle')} icon={<CircleIcon size={14} />} label={lang === 'zh' ? '圆形' : 'Circle'} />
              <ToolButton active={activeTool === 'eraser'} onClick={() => setActiveTool('eraser')} icon={<Eraser size={14} />} label={lang === 'zh' ? '橡皮' : 'Eraser'} />

              <div className="h-4 w-px bg-theme mx-1" />

              <Palette size={14} className="text-muted" />
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setActiveColor(c)}
                  className={`w-5 h-5 rounded-full border-2 transition-all ${
                    activeColor === c ? 'border-main scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}

              <div className="h-4 w-px bg-theme mx-1" />

              <input
                type="range"
                min="1"
                max="12"
                value={activeWidth}
                onChange={(e) => setActiveWidth(parseInt(e.target.value))}
                className="w-20"
                title={lang === 'zh' ? '笔触粗细' : 'Brush width'}
              />
              <span className="text-xs text-muted w-6">{activeWidth}</span>

              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => setShowAllGroups(!showAllGroups)}
                  className={`px-2 py-1 text-xs font-bold rounded flex items-center gap-1 ${
                    showAllGroups ? 'bg-primary-theme text-white' : 'bg-surface-secondary text-main'
                  }`}
                >
                  {showAllGroups ? <Eye size={12} /> : <EyeOff size={12} />}
                  {showAllGroups
                    ? lang === 'zh'
                      ? '查看全部'
                      : 'All groups'
                    : lang === 'zh'
                    ? '仅当前'
                    : 'Current only'}
                </button>
                <button
                  onClick={() => activeGroupId && clearGroupStrokes(activeGroupId)}
                  className="px-2 py-1 text-xs font-bold rounded border border-rose-500 text-rose-600 hover:bg-rose-50 flex items-center gap-1"
                >
                  <Trash2 size={12} />
                  {lang === 'zh' ? '清空本组' : 'Clear'}
                </button>
                <button
                  onClick={downloadCurrentGroupSVG}
                  className="px-2 py-1 text-xs font-bold rounded bg-surface-secondary text-main hover:bg-surface flex items-center gap-1"
                >
                  <Download size={12} />
                  SVG
                </button>
                <ExtensionPointRenderer slot="classroom.collab.canvas" />
              </div>
            </div>

            {/* 画布 */}
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
                {/* 网格背景 */}
                <defs>
                  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#f1f5f9" strokeWidth="1" />
                  </pattern>
                </defs>
                <rect width="1200" height="800" fill="url(#grid)" />

                {/* 笔画 */}
                {visibleStrokes.map((s) => {
                  if (s.tool === 'pen' || s.tool === 'eraser') {
                    const pathD = s.points
                      .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
                      .join(' ');
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

              {/* 当前小组浮标 */}
              <div className="absolute top-3 left-3 px-2.5 py-1 bg-surface/95 border border-theme rounded-lg text-xs font-bold text-main shadow-sm backdrop-blur-sm">
                {groups.find((g) => g.id === activeGroupId)?.name ?? lang === 'zh' ? '未选小组' : 'No group'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── 子组件 ──────────────────────────────────────────────────────────

const ToolButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={`p-1.5 rounded flex items-center gap-1 transition-colors ${
      active ? 'bg-primary-theme text-white' : 'bg-surface-secondary text-main hover:bg-surface'
    }`}
    title={label}
  >
    {icon}
  </button>
);