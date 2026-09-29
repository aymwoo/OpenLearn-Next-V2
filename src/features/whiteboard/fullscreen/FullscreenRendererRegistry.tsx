import React, { useState, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Minimize2 } from 'lucide-react';
import Markdown from 'react-markdown';
import { HtmlAppletFrame } from '../components/HtmlAppletFrame';

export type FullscreenRendererProps = {
  elementType: string;
  data: Record<string, any>;
  onClose: () => void;
  containerSize: { width: number; height: number };
  lessonId: string;
  /** 白板元素 id（可选，供事件关联使用） */
  elementId?: string;
};

export type FullscreenRenderer = React.FC<FullscreenRendererProps>;

class FullscreenRendererRegistry {
  private renderers = new Map<string, { impl: FullscreenRenderer; pluginId?: string; hostBuiltin?: boolean }>();

  register(type: string, renderer: FullscreenRenderer, pluginId?: string): void {
    this.renderers.set(type, { impl: renderer, pluginId });
  }

  /**
   * 注册**宿主内置**的专用全屏渲染器。
   *
   * 与 `register`（插件通道）的区别：宿主内置渲染器是逐类型手写的第二套实现，
   * 天然会与画布内的真实组件漂移，因此只在「该实现确实是完整版、不是简化版」时
   * 才用它（目前仅 quiz）。其余类型应让宿主的 renderContent 注入真实组件。
   */
  registerHostBuiltin(type: string, renderer: FullscreenRenderer): void {
    this.renderers.set(type, { impl: renderer, hostBuiltin: true });
  }

  get(type: string): FullscreenRenderer | undefined {
    return this.renderers.get(type)?.impl;
  }

  /**
   * 取应当生效的全屏渲染器：**插件注册的** 或 **明确标记为宿主内置的**。
   *
   * 早期用 `register` 无 pluginId 注册的那批（assignment / rollcall / timer /
   * html-applet）不生效 —— 它们是简化实现，与画布内漂移（assignment 全屏版的
   * 「Upload File」按钮没有任何 handler）。它们已改由 renderContent 渲染真实组件。
   */
  getEffectiveRenderer(type: string): FullscreenRenderer | undefined {
    const entry = this.renderers.get(type);
    if (!entry) return undefined;
    return entry.pluginId || entry.hostBuiltin ? entry.impl : undefined;
  }

  has(type: string): boolean {
    return this.renderers.has(type);
  }

  /**
   * Remove a renderer by type. When `pluginId` is provided, the entry is only
   * removed if it is owned by that plugin — prevents a plugin from evicting
   * host built-in renderers or another plugin's renderer.
   */
  unregister(type: string, pluginId?: string): void {
    const entry = this.renderers.get(type);
    if (!entry) return;
    if (pluginId && entry.pluginId !== pluginId) return;
    this.renderers.delete(type);
  }

  /** Remove all renderers registered by the given plugin (lifecycle cleanup). */
  unregisterPlugin(pluginId: string): void {
    for (const [type, entry] of this.renderers) {
      if (entry.pluginId === pluginId) this.renderers.delete(type);
    }
  }
}

export const fullscreenRendererRegistry = new FullscreenRendererRegistry();

// ── 全屏容器（通用 chrome：关闭按钮 + ESC）───────────────────────────────

export const FullscreenOverlay: React.FC<{
  type: string;
  title: string;
  data: Record<string, any>;
  containerSize: { width: number; height: number };
  onClose: () => void;
  lessonId: string;
  /** 白板元素 id（透传到渲染器） */
  elementId?: string;
  /**
   * 是否允许本地关闭。教师端同步过来的最大化视图为 false：
   * 不渲染关闭按钮、ESC 不生效、下发给渲染器的 onClose 也为空操作，
   * 保证「教师退出最大化之前，学生的屏幕保持同一视图」。
   */
  dismissible?: boolean;
  /**
   * 只读跟随模式（全班专注锁定）：阻断全屏内容交互，展示只读演示视图徽标
   */
  readOnly?: boolean;
  /**
   * 由宿主注入「真实组件」渲染。
   *
   * 优先级高于注册表里的**宿主内置**渲染器：那批渲染器是逐类型手写的第二套实现，
   * 必然与画布内漂移 —— 最直接的例子是 assignment 的全屏版渲染出一个
   * 「Upload File」假按钮（点了没有任何 handler），而画布内真实组件是「提交作业」
   * 且绑定提交逻辑。rollcall / timer 同理，丢掉了操作能力。
   *
   * 插件通过 register 注册的渲染器仍然优先（那是插件自定义视图的正式通道）。
   *
   * 传入的节点是 konva 节点，调用方需自行套一层 <Stage>（WidgetFullscreenStage）。
   *
   * @param size 内容区可用尺寸（已扣除内边距）—— 供调用方设定 Stage 宽高
   */
  renderContent?: (size: { width: number; height: number }) => React.ReactNode;
}> = ({
  type,
  title,
  data,
  containerSize,
  onClose,
  lessonId,
  elementId,
  dismissible = true,
  readOnly = false,
  renderContent,
}) => {
  React.useEffect(() => {
    if (!dismissible) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose, dismissible]);

  // 不可关闭时，即便插件自定义渲染器主动调用 onClose 也不生效
  const handleClose = dismissible ? onClose : () => {};

  // 插件注册的 或 明确标记为宿主内置的渲染器；其余走 renderContent 注入真实组件
  const Renderer = fullscreenRendererRegistry.getEffectiveRenderer(type);

  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const handleResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 内容区实测尺寸：konva Stage 需要数值宽高，而容器高度还受顶部标题栏、
  // p-6 内边距与 flex 分配影响，用测量而非算式才能始终贴合。
  //
  // ref 回调只负责挂上观察者（内容经 createPortal 渲染，与本组件 effect 不同步，
  // effect 里首次读取可能拿到 null）；尺寸在 layout 阶段同步读取一次，
  // 这样首帧就有正确尺寸 —— 否则 konva Stage 会因 0 尺寸先渲染空内容再跳变。
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 });
  const contentRO = React.useRef<ResizeObserver | null>(null);
  const readContentSize = React.useCallback(() => {
    const node = contentRef.current;
    if (!node) return;
    const style = window.getComputedStyle(node);
    const w = node.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    const h = node.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
    setContentSize({ width: Math.max(0, w), height: Math.max(0, h) });
  }, []);
  const attachContent = React.useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node;
      // 换节点 / 卸载时断开上一个观察者，否则每次重挂都留下一个孤儿 observer
      contentRO.current?.disconnect();
      contentRO.current = null;
      if (!node) return;
      if (typeof ResizeObserver !== 'undefined') {
        contentRO.current = new ResizeObserver(readContentSize);
        contentRO.current.observe(node);
      }
    },
    [readContentSize],
  );

  // layout 阶段读一次，保证首帧即有尺寸（否则内容先空白一帧再出现）
  useLayoutEffect(() => {
    readContentSize();
  }, [readContentSize]);

  const overlay = (
    <div
      className="fixed inset-0 z-[99999] bg-black/60 flex items-center justify-center"
      style={{ pointerEvents: 'auto' }}
    >
      <div
        className="relative bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col"
        style={{ width: Math.max(400, viewport.width - 32), height: Math.max(300, viewport.height - 32) }}
      >
        <div className="bg-indigo-50 text-indigo-700 px-4 py-2 flex justify-between items-center text-sm font-semibold border-b border-indigo-100 shrink-0">
          <span className="truncate">{title}</span>
          {dismissible ? (
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-indigo-200/50 rounded-lg text-indigo-600 hover:text-indigo-900 transition-colors cursor-pointer flex items-center gap-1 text-xs"
            >
              <Minimize2 size={14} /> 退出全屏
            </button>
          ) : (
            <span
              className={`px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 select-none ${
                readOnly ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-indigo-100 text-indigo-600'
              }`}
              title={readOnly ? '教师已开启全班专注锁定，当前为只读演示视图' : '由教师端控制，无法在本地退出'}
            >
              {readOnly ? (
                '🔒 全班专注锁定中 · 演示视图'
              ) : (
                <>
                  <Minimize2 size={12} /> 教师同步视图
                </>
              )}
            </span>
          )}
        </div>
        {/* 原先此处还有一个右上角悬浮 X 关闭按钮，与标题栏的「退出全屏」功能完全
            重复（两者都调用同一个 onClose），已移除。ESC 退出仍然有效。 */}
        {(() => {
          const isInteractiveWidget = type === 'quiz' || type === 'assignment';
          return (
            <div
              ref={attachContent}
              data-testid="fullscreen-content"
              className="flex-1 overflow-auto p-6 relative"
              style={{ pointerEvents: readOnly && !isInteractiveWidget ? 'none' : 'auto' }}
            >
              {/* 插件注册的自定义全屏视图 > 宿主注入的真实组件 > 字段预览兜底 */}
              {Renderer ? (
                <Renderer
                  elementType={type}
                  data={data}
                  onClose={handleClose}
                  containerSize={viewport}
                  lessonId={lessonId}
                  elementId={elementId}
                />
              ) : renderContent ? (
                renderContent(contentSize)
              ) : (
                <DefaultFullscreenRenderer
                  elementType={type}
                  data={data}
                  onClose={handleClose}
                  containerSize={viewport}
                  lessonId={lessonId}
                />
              )}
              {readOnly && !isInteractiveWidget && (
                <div
                  data-testid="fullscreen-readonly-lock-cover"
                  className="absolute inset-0 z-50 cursor-not-allowed bg-transparent select-none"
                  style={{ pointerEvents: 'auto' }}
                  title="🔒 全班专注锁定中：组件为只读跟随模式"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                />
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
};

// ── 默认智能渲染器（兜底）───────────────────────────────────────────────

const PRIORITY_FIELDS = [
  { field: 'text', icon: '📝', label: '文本' },
  { field: 'markdown', icon: '📄', label: 'Markdown' },
  { field: 'code', icon: '💻', label: '代码' },
  { field: 'question', icon: '❓', label: '测验', extra: ['options'] },
  { field: 'equation', icon: '📐', label: '公式' },
  { field: 'url', icon: '🔗', label: '链接' },
  { field: 'src', icon: '🖼', label: '图片' },
  { field: 'coursewareUuid', icon: '📚', label: '课件' },
];

function DefaultFullscreenRenderer({ data, lessonId }: FullscreenRendererProps) {
  const matched = PRIORITY_FIELDS.find(
    (f) => data[f.field] !== undefined && data[f.field] !== null && data[f.field] !== '',
  );

  if (!matched) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-500">
        <BookOpen size={48} className="opacity-30" />
        <div className="text-sm font-medium">自动识别渲染</div>
        <pre className="text-xs text-left bg-gray-50 border rounded-lg p-4 max-w-full max-h-80 overflow-auto font-mono">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    );
  }

  const { field, icon, label, extra } = matched;

  if (field === 'markdown') {
    return (
      <div className="prose prose-sm max-w-none">
        <Markdown>{String(data.markdown)}</Markdown>
      </div>
    );
  }

  if (field === 'code') {
    return (
      <textarea
        value={String(data.code)}
        readOnly
        className="w-full h-full p-4 bg-gray-900 text-green-400 font-mono text-sm rounded-xl resize-none"
      />
    );
  }

  if (field === 'text') {
    return (
      <div className="flex items-start h-full">
        <div className="text-lg whitespace-pre-wrap leading-relaxed">{String(data.text)}</div>
      </div>
    );
  }

  if (field === 'question') {
    const options = Array.isArray(data.options) ? data.options : [];
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <h3 className="text-xl font-bold text-gray-800">{data.question}</h3>
        <div className="flex flex-col gap-3">
          {options.map((opt: string, i: number) => (
            <div key={i} className="px-5 py-4 text-left bg-gray-50 border-2 border-gray-200 rounded-xl text-base">
              <span className="font-bold text-indigo-600 mr-3">{'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i]}.</span>
              {opt}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (field === 'url') {
    return (
      <div className="flex items-center justify-center h-full">
        <a
          href={String(data.url)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-600 underline text-lg"
        >
          {String(data.url)}
        </a>
      </div>
    );
  }

  if (field === 'src') {
    return (
      <div className="flex items-center justify-center h-full">
        <img src={String(data.src)} alt="" className="max-w-full max-h-full object-contain rounded-lg" />
      </div>
    );
  }

  if (field === 'coursewareUuid') {
    return (
      <HtmlAppletFrame
        data={{ coursewareUuid: String(data.coursewareUuid) }}
        lessonId={lessonId}
        className="w-full h-full rounded-xl border"
      />
    );
  }

  if (field === 'equation') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-2xl font-mono text-gray-800 bg-gray-50 px-8 py-4 rounded-xl border">
          {String(data.equation)}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="text-4xl mb-2">{icon}</div>
        <div className="text-lg font-semibold text-gray-800">{label}</div>
        <pre className="mt-4 text-xs text-gray-500 max-w-md overflow-auto">{JSON.stringify(data, null, 2)}</pre>
      </div>
    </div>
  );
}
