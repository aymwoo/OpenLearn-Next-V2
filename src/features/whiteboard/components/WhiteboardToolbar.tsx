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
  RotateCcw
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
  handleClearBoard: () => Promise<void>;
  handleResetBoard: () => Promise<void>;
  handleElementDelete: (id: string) => Promise<void>;
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
  onRefresh
}) => {
  return (
    <div className="flex items-center justify-start gap-1.5 px-3 py-1.5 bg-white border-b border-slate-200 shrink-0 font-sans select-none">
      {/* Group 1: Selection */}
      <button
        onClick={() => { setTool('cursor'); setSelectedShapeId(null); }}
        className={`p-1.5 rounded-xl transition-all cursor-pointer ${tool === 'cursor' ? 'bg-indigo-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'}`}
        title="选择工具 (Pointer / Selector)"
      >
        <MousePointer2 size={16} />
      </button>

      <div className="w-px h-4 bg-slate-200/80 mx-0.5" />

      {/* Group 2: Draw & Annotate */}
      <button
        onClick={() => setTool('pen')}
        className={`p-1.5 rounded-xl transition-all cursor-pointer ${tool === 'pen' ? 'bg-indigo-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'}`}
        title="画笔工具 (Pen)"
      >
        <PenTool size={16} />
      </button>
      <button
        onClick={() => setTool('highlighter')}
        className={`p-1.5 rounded-xl transition-all cursor-pointer ${tool === 'highlighter' ? 'bg-amber-500 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'}`}
        title="荧光高亮笔 (Highlighter)"
      >
        <Highlighter size={16} />
      </button>
      {tool === 'highlighter' && (
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 animate-in zoom-in-95 duration-150">
          {[
            { hex: '#facc15', label: 'Yellow' },
            { hex: '#4ade80', label: 'Green' },
            { hex: '#f472b6', label: 'Pink' },
            { hex: '#60a5fa', label: 'Blue' }
          ].map((col) => (
            <button
              key={col.hex}
              onClick={() => setHighlighterColor(col.hex)}
              className={`w-3.5 h-3.5 rounded-full border transition-all ${highlighterColor === col.hex ? 'ring-2 ring-indigo-500 scale-110 border-white' : 'border-transparent'}`}
              style={{ backgroundColor: col.hex }}
              title={col.label}
            />
          ))}
        </div>
      )}

      <div className="w-px h-4 bg-slate-200/80 mx-0.5" />

      {/* Group 3: Shapes & Text */}
      <button
        onClick={() => setTool('rect')}
        className={`p-1.5 rounded-xl transition-all cursor-pointer ${tool === 'rect' ? 'bg-indigo-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'}`}
        title="矩形工具 (Rectangle)"
      >
        <Square size={16} />
      </button>
      <button
        onClick={() => setTool('circle')}
        className={`p-1.5 rounded-xl transition-all cursor-pointer ${tool === 'circle' ? 'bg-indigo-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'}`}
        title="圆形工具 (Circle)"
      >
        <CircleIcon size={16} />
      </button>
      <button
        onClick={() => setTool('text')}
        className={`p-1.5 rounded-xl transition-all cursor-pointer ${tool === 'text' ? 'bg-indigo-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'}`}
        title="文本工具 (Text)"
      >
        <Type size={16} />
      </button>

      <div className="w-px h-4 bg-slate-200/80 mx-0.5" />

      {/* Group 4: Media & Applets */}
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
                        segmentId: activeSegmentId
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
              }
           });
        }} 
        className="p-1.5 rounded-xl text-slate-600 hover:bg-slate-100 transition-all cursor-pointer"
        title="插入演示幻灯片 (Presentation)"
      >
        <Presentation size={16} />
      </button>
      <button
        onClick={async () => {
           setIsSyncing(true);
           try {
              await onElementAdd('code-sandbox', {
                  code: "console.log('Hello Sandbox!');",
                  x: 100,
                  y: 100,
                  page: currentPage,
                  segmentId: activeSegmentId
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
        className="p-1.5 rounded-xl text-slate-600 hover:bg-slate-100 transition-all cursor-pointer"
        title="插入代码沙箱 (Code Sandbox)"
      >
        <Terminal size={16} />
      </button>
      <button
        onClick={async () => {
           setIsSyncing(true);
           try {
              await onElementAdd('math-graph', {
                  equation: "Math.sin(x)",
                  x: 100,
                  y: 150,
                  page: currentPage,
                  segmentId: activeSegmentId
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
        className="p-1.5 rounded-xl text-slate-600 hover:bg-slate-100 transition-all cursor-pointer"
        title="插入数学函数图表 (Math Graph)"
      >
        <Activity size={16} />
      </button>

      <button
        onClick={async () => {
           setIsSyncing(true);
           try {
              await onElementAdd('html-applet', {
                  code: `<!-- Interactive Web Courseware -->\n<div style='padding:20px; text-align:center;'>\n  <h2>Interactive Web Courseware</h2>\n  <p>可在右侧属性栏中选择本地 ZIP/HTML 部署包。</p>\n</div>`,
                  x: 100,
                  y: 150,
                  page: currentPage,
                  segmentId: activeSegmentId
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
        className="p-1.5 rounded-xl text-slate-600 hover:bg-slate-100 transition-all cursor-pointer"
        title="插入交互网页课件 (Interactive Courseware)"
      >
        <Globe size={16} />
      </button>

      <div className="w-px h-4 bg-slate-200/80 mx-0.5" />

      {/* Group 5: Teaching & AI */}
      <button
        onClick={async () => {
           setIsSyncing(true);
           try {
              await onElementAdd('rollcall', {
                  title: "随机点名助手",
                  x: 120,
                  y: 120,
                  page: currentPage,
                  segmentId: activeSegmentId
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
        className="p-1.5 rounded-xl text-indigo-600 hover:bg-indigo-50 transition-all cursor-pointer flex items-center gap-1 text-xs font-semibold"
        title="插入随机点名组件 (Roll Call)"
      >
        <UserCheck size={15} />
      </button>

      <div className="w-px h-4 bg-slate-200/80 mx-0.5" />

      {/* Group 6: Plugin Classroom Tools */}
      <ExtensionPointRenderer slot="classroom.tool" />

      <button
        onClick={async () => {
           setIsSyncing(true);
           try {
              const res = await fetch(`/api/lessons/${lessonId}/ai-tutor`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ elements: safeElements.map(e => ({ type: e.type, data: JSON.parse(e.data) })) })
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
                    onConfirm: () => setDialog(null)
                  });
              }
           } finally {
              setIsSyncing(false);
           }
        }}
        className="p-1.5 rounded-xl text-purple-600 hover:bg-purple-50 transition-all cursor-pointer"
        title="请求 AI 助教建议 (Ask AI Tutor)"
      >
        <Wand2 size={16} />
      </button>

      <div className="w-px h-4 bg-slate-200/80 mx-0.5" />

      {/* Group 7: Canvas Controls & More */}
      <button
        onClick={() => setShowGrid((g) => !g)}
        className={`p-1.5 rounded-xl transition-all cursor-pointer ${showGrid ? 'text-indigo-600 bg-indigo-50/80' : 'text-slate-400 hover:bg-slate-100'}`}
        title={showGrid ? '关闭网格背景' : '开启网格背景'}
      >
        <Grid size={16} />
      </button>

      {selectedShapeId && (
        <button
          onClick={() => {
            handleElementDelete(selectedShapeId);
            setSelectedShapeId(null);
          }}
          className="px-2 py-1 rounded-xl text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200/80 shadow-2xs font-semibold flex items-center gap-1 text-xs transition-all cursor-pointer"
          title="删除选中图形"
        >
          <Trash2 size={13} /> 删除
        </button>
      )}

      {userRole !== 'student' ? (
        <button
          onClick={handleClearBoard}
          className="p-1.5 rounded-xl text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-all cursor-pointer"
          title="清空白板 (Clear Board)"
        >
          <Eraser size={16} />
        </button>
      ) : (
        <button
          onClick={handleResetBoard}
          className="p-1.5 rounded-xl text-slate-500 hover:text-amber-600 hover:bg-amber-50 transition-all cursor-pointer"
          title="重置白板 (Reset Board)"
        >
          <RotateCcw size={16} />
        </button>
      )}
      {isSyncing && <Loader2 size={15} className="text-indigo-500 animate-spin ml-1" />}
    </div>
  );
};
