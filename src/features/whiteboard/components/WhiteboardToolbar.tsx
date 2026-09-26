import React from 'react';
import {
  MousePointer2,
  Square,
  Circle as CircleIcon,
  PenTool,
  Type,
  Eraser,
  Loader2,
  Presentation,
  Terminal,
  Activity,
  Globe,
  Trash2,
  Highlighter,
  Wand2,
  UserCheck,
  Grid,
  RotateCcw,
} from 'lucide-react';
import { v7 as uuidv7 } from 'uuid';
import { frontendEventBus } from '../../../services/event-bus';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';

export interface WhiteboardToolbarProps {
  tool: 'cursor' | 'rect' | 'circle' | 'pen' | 'text' | 'presentation' | 'highlighter';
  setTool: (tool: 'cursor' | 'rect' | 'circle' | 'pen' | 'text' | 'presentation' | 'highlighter') => void;
  setSelectedShapeId: (id: string | null) => void;
  highlighterColor: string;
  setHighlighterColor: (col: string) => void;
  onElementAdd: (type: string, data: any) => Promise<void>;
  currentPage: number;
  activeSegmentId?: string | null;
  lessonId: string;
  safeElements: any[];
  selectedShapeId: string | null;
  showGrid: boolean;
  setShowGrid: React.Dispatch<React.SetStateAction<boolean>>;
  userRole?: 'teacher' | 'student';
  isSyncing: boolean;
  setIsSyncing: (syncing: boolean) => void;
  handleClearBoard: () => void | Promise<void>;
  handleResetBoard: () => void | Promise<void>;
  handleElementDelete: (id: string) => void | Promise<void>;
  setDialog: (dialog: any) => void;
  setDialogInput: (input: string) => void;
  onRefresh?: () => void;
}

export const WhiteboardToolbar: React.FC<WhiteboardToolbarProps> = ({
  tool,
  setTool,
  setSelectedShapeId,
  highlighterColor,
  setHighlighterColor,
  onElementAdd,
  currentPage,
  activeSegmentId,
  lessonId,
  safeElements,
  selectedShapeId,
  showGrid,
  setShowGrid,
  userRole = 'teacher',
  isSyncing,
  setIsSyncing,
  handleClearBoard,
  handleResetBoard,
  handleElementDelete,
  setDialog,
  setDialogInput,
  onRefresh,
}) => {
  return (
    <div className="flex items-center justify-between gap-1.5 px-2 py-1 bg-surface/95 backdrop-blur-md border-b border-theme/80 shrink-0 font-sans select-none text-main min-h-[38px] overflow-x-auto no-scrollbar">
      {/* 左侧及中间主要工具集合 */}
      <div className="flex items-center gap-1.5 min-w-0">
        {/* Group 1 & 2 & 3: 核心画笔与几何文字工具胶囊 */}
        <div className="flex items-center gap-0.5 bg-surface-secondary/70 p-0.5 rounded-xl border border-theme/60 shrink-0">
          {/* 选择工具 */}
          <button
            onClick={() => {
              setTool('cursor');
              setSelectedShapeId(null);
            }}
            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all cursor-pointer ${
              tool === 'cursor'
                ? 'bg-primary-theme text-white shadow-2xs'
                : 'text-muted hover:bg-surface hover:text-main'
            }`}
            title="选择工具 (Pointer / Selector)"
          >
            <MousePointer2 size={14} />
          </button>

          <div className="w-px h-3.5 bg-border-theme/60 mx-0.5" />

          {/* 画笔工具 */}
          <button
            onClick={() => setTool('pen')}
            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all cursor-pointer ${
              tool === 'pen'
                ? 'bg-primary-theme text-white shadow-2xs'
                : 'text-muted hover:bg-surface hover:text-main'
            }`}
            title="画笔工具 (Pen)"
          >
            <PenTool size={14} />
          </button>

          {/* 荧光高亮笔 */}
          <button
            onClick={() => setTool('highlighter')}
            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all cursor-pointer ${
              tool === 'highlighter'
                ? 'bg-amber-500 text-white shadow-2xs'
                : 'text-muted hover:bg-surface hover:text-main'
            }`}
            title="荧光高亮笔 (Highlighter)"
          >
            <Highlighter size={14} />
          </button>
          {tool === 'highlighter' && (
            <div className="flex items-center gap-1 bg-surface px-1 py-0.5 rounded-lg border border-theme animate-in zoom-in-95 duration-150">
              {[
                { hex: '#facc15', label: 'Yellow' },
                { hex: '#4ade80', label: 'Green' },
                { hex: '#f472b6', label: 'Pink' },
                { hex: '#60a5fa', label: 'Blue' },
              ].map((col) => (
                <button
                  key={col.hex}
                  onClick={() => setHighlighterColor(col.hex)}
                  className={`w-3 h-3 rounded-full border transition-all ${
                    highlighterColor === col.hex
                      ? 'ring-2 ring-primary-theme scale-110 border-white'
                      : 'border-transparent'
                  }`}
                  style={{ backgroundColor: col.hex }}
                  title={col.label}
                />
              ))}
            </div>
          )}

          <div className="w-px h-3.5 bg-border-theme/60 mx-0.5" />

          {/* 几何形状与文本 */}
          <button
            onClick={() => setTool('rect')}
            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all cursor-pointer ${
              tool === 'rect'
                ? 'bg-primary-theme text-white shadow-2xs'
                : 'text-muted hover:bg-surface hover:text-main'
            }`}
            title="矩形工具 (Rectangle)"
          >
            <Square size={14} />
          </button>
          <button
            onClick={() => setTool('circle')}
            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all cursor-pointer ${
              tool === 'circle'
                ? 'bg-primary-theme text-white shadow-2xs'
                : 'text-muted hover:bg-surface hover:text-main'
            }`}
            title="圆形工具 (Circle)"
          >
            <CircleIcon size={14} />
          </button>
          <button
            onClick={() => setTool('text')}
            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all cursor-pointer ${
              tool === 'text'
                ? 'bg-primary-theme text-white shadow-2xs'
                : 'text-muted hover:bg-surface hover:text-main'
            }`}
            title="文本工具 (Text)"
          >
            <Type size={14} />
          </button>
        </div>

        {/* Group 4 & 5: 课件微组件插入区 */}
        <div className="flex items-center gap-0.5 bg-surface-secondary/70 p-0.5 rounded-xl border border-theme/60 shrink-0">
          <ExtensionPointRenderer slot="anchor:whiteboard-toolbar:presentation" placement="before" />
          <button
            onClick={() => {
              setDialogInput('# Title Slide\n---\n## Slide 2');
              setDialog({
                type: 'prompt',
                title: '添加演示文稿',
                message: '请输入演示文稿的 Markdown 内容 (使用 --- 拆分新幻灯片):',
                placeholder: '# Title Slide\n---\n## Slide 2',
                onConfirm: async (inputValue: string) => {
                  const md = inputValue || '# Title Slide\n---\n## Slide 2';
                  setIsSyncing(true);
                  try {
                    await onElementAdd('presentation', {
                      markdown: md,
                      x: 50,
                      y: 50,
                      width: 600,
                      height: 400,
                      slideX: 0,
                      slideY: 0,
                      page: currentPage,
                      segmentId: activeSegmentId,
                    });
                    frontendEventBus.publish({
                      id: uuidv7(),
                      type: 'whiteboard.element_updated',
                      source: 'whiteboard',
                      payload: { lessonId },
                      timestamp: Date.now(),
                      correlationId: lessonId,
                    });
                  } finally {
                    setIsSyncing(false);
                    setDialog(null);
                  }
                },
              });
            }}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-main transition-all cursor-pointer"
            title="插入演示幻灯片 (Presentation)"
          >
            <Presentation size={14} />
          </button>
          <ExtensionPointRenderer slot="anchor:whiteboard-toolbar:presentation" placement="after" />

          <ExtensionPointRenderer slot="anchor:whiteboard-toolbar:code-sandbox" placement="before" />
          <button
            onClick={async () => {
              setIsSyncing(true);
              try {
                await onElementAdd('code-sandbox', {
                  code: "console.log('Hello Sandbox!');",
                  x: 100,
                  y: 100,
                  page: currentPage,
                  segmentId: activeSegmentId,
                });
                frontendEventBus.publish({
                  id: uuidv7(),
                  type: 'whiteboard.element_updated',
                  source: 'whiteboard',
                  payload: { lessonId },
                  timestamp: Date.now(),
                  correlationId: lessonId,
                });
              } finally {
                setIsSyncing(false);
              }
            }}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-main transition-all cursor-pointer"
            title="插入代码沙箱 (Code Sandbox)"
          >
            <Terminal size={14} />
          </button>
          <ExtensionPointRenderer slot="anchor:whiteboard-toolbar:code-sandbox" placement="after" />

          <ExtensionPointRenderer slot="anchor:whiteboard-toolbar:math-graph" placement="before" />
          <button
            onClick={async () => {
              setIsSyncing(true);
              try {
                await onElementAdd('math-graph', {
                  equation: 'Math.sin(x)',
                  x: 100,
                  y: 150,
                  page: currentPage,
                  segmentId: activeSegmentId,
                });
                frontendEventBus.publish({
                  id: uuidv7(),
                  type: 'whiteboard.element_updated',
                  source: 'whiteboard',
                  payload: { lessonId },
                  timestamp: Date.now(),
                  correlationId: lessonId,
                });
              } finally {
                setIsSyncing(false);
              }
            }}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-main transition-all cursor-pointer"
            title="插入数学函数图表 (Math Graph)"
          >
            <Activity size={14} />
          </button>
          <ExtensionPointRenderer slot="anchor:whiteboard-toolbar:math-graph" placement="after" />

          <ExtensionPointRenderer slot="anchor:whiteboard-toolbar:courseware" placement="before" />
          <button
            onClick={async () => {
              setIsSyncing(true);
              try {
                await onElementAdd('html-applet', {
                  code: `<!-- Interactive Web Courseware -->\n<div style='padding:20px; text-align:center;'>\n  <h2>Interactive Web Courseware</h2>\n  <p>可在右侧属性栏中选择本地 ZIP/HTML 部署包。</p>\n</div>`,
                  x: 100,
                  y: 150,
                  page: currentPage,
                  segmentId: activeSegmentId,
                });
                frontendEventBus.publish({
                  id: uuidv7(),
                  type: 'whiteboard.element_updated',
                  source: 'whiteboard',
                  payload: { lessonId },
                  timestamp: Date.now(),
                  correlationId: lessonId,
                });
              } finally {
                setIsSyncing(false);
              }
            }}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-main transition-all cursor-pointer"
            title="插入交互网页课件 (Interactive Courseware)"
          >
            <Globe size={14} />
          </button>
          <ExtensionPointRenderer slot="anchor:whiteboard-toolbar:courseware" placement="after" />

          <div className="w-px h-3.5 bg-border-theme/60 mx-0.5" />

          <ExtensionPointRenderer slot="anchor:whiteboard-toolbar:rollcall" placement="before" />
          <button
            onClick={async () => {
              setIsSyncing(true);
              try {
                await onElementAdd('rollcall', {
                  title: '随机点名助手',
                  x: 120,
                  y: 120,
                  page: currentPage,
                  segmentId: activeSegmentId,
                });
                frontendEventBus.publish({
                  id: uuidv7(),
                  type: 'whiteboard.element_updated',
                  source: 'whiteboard',
                  payload: { lessonId },
                  timestamp: Date.now(),
                  correlationId: lessonId,
                });
              } finally {
                setIsSyncing(false);
              }
            }}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-primary-theme hover:bg-primary-theme-light transition-all cursor-pointer"
            title="插入随机点名组件 (Roll Call)"
          >
            <UserCheck size={14} />
          </button>
          <ExtensionPointRenderer slot="anchor:whiteboard-toolbar:rollcall" placement="after" />
        </div>

        {/* Group 6: 课堂插件与 AI 助教 */}
        <ExtensionPointRenderer slot="classroom.tool" />

        <ExtensionPointRenderer slot="anchor:whiteboard-toolbar:ai-tutor" placement="before" />
        <button
          onClick={async () => {
            setIsSyncing(true);
            try {
              const res = await fetch(`/api/lessons/${lessonId}/ai-tutor`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  elements: safeElements.map((e) => ({ type: e.type, data: JSON.parse(e.data) })),
                }),
              });
              if (res.ok) {
                frontendEventBus.publish({
                  id: uuidv7(),
                  type: 'whiteboard.element_updated',
                  source: 'whiteboard',
                  payload: { lessonId },
                  timestamp: Date.now(),
                  correlationId: lessonId,
                });
                if (onRefresh) onRefresh();
              } else {
                setDialog({
                  type: 'alert',
                  title: 'AI 辅导提示',
                  message: '无法获取 AI 授课助手的帮助，请稍后再试。',
                  onConfirm: () => setDialog(null),
                });
              }
            } finally {
              setIsSyncing(false);
            }
          }}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-purple-600 hover:bg-purple-500/10 transition-all cursor-pointer shrink-0"
          title="请求 AI 助教建议 (Ask AI Tutor)"
        >
          <Wand2 size={14} />
        </button>
        <ExtensionPointRenderer slot="anchor:whiteboard-toolbar:ai-tutor" placement="after" />
      </div>

      {/* 右侧画布控制与状态 */}
      <div className="flex items-center gap-1 shrink-0 ml-auto">
        <ExtensionPointRenderer slot="anchor:whiteboard-toolbar:grid" placement="before" />
        <button
          onClick={() => setShowGrid((g) => !g)}
          className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all cursor-pointer ${
            showGrid
              ? 'text-primary-theme bg-primary-theme-light'
              : 'text-muted hover:bg-surface-secondary hover:text-main'
          }`}
          title={showGrid ? '关闭网格背景' : '开启网格背景'}
        >
          <Grid size={14} />
        </button>
        <ExtensionPointRenderer slot="anchor:whiteboard-toolbar:grid" placement="after" />

        {selectedShapeId && (
          <button
            onClick={() => {
              handleElementDelete(selectedShapeId);
              setSelectedShapeId(null);
            }}
            className="px-2 py-0.5 rounded-lg text-rose-500 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
            title="删除选中图形"
          >
            <Trash2 size={12} />
            <span className="hidden sm:inline">删除</span>
          </button>
        )}

        {userRole !== 'student' ? (
          <button
            onClick={handleClearBoard}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-rose-500 hover:bg-rose-500/10 transition-all cursor-pointer"
            title="清空白板 (Clear Board)"
          >
            <Eraser size={14} />
          </button>
        ) : (
          <button
            onClick={handleResetBoard}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-amber-500 hover:bg-amber-500/10 transition-all cursor-pointer"
            title="重置白板 (Reset Board)"
          >
            <RotateCcw size={14} />
          </button>
        )}

        {isSyncing && <Loader2 size={13} className="text-primary-theme animate-spin ml-0.5" />}
      </div>
    </div>
  );
};
