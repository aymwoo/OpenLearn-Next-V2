import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Minimize2, X } from 'lucide-react';
import Markdown from 'react-markdown';

export type FullscreenRendererProps = {
  elementType: string;
  data: Record<string, any>;
  onClose: () => void;
  containerSize: { width: number; height: number };
  lessonId: string;
};

export type FullscreenRenderer = React.FC<FullscreenRendererProps>;

class FullscreenRendererRegistry {
  private renderers = new Map<string, { impl: FullscreenRenderer; pluginId?: string }>();

  register(type: string, renderer: FullscreenRenderer, pluginId?: string): void {
    this.renderers.set(type, { impl: renderer, pluginId });
  }

  get(type: string): FullscreenRenderer | undefined {
    return this.renderers.get(type)?.impl;
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
}> = ({ type, title, data, containerSize, onClose, lessonId }) => {
  React.useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const Renderer = fullscreenRendererRegistry.get(type);

  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const handleResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const overlay = (
    <div className="fixed inset-0 z-[99999] bg-black/60 flex items-center justify-center" style={{ pointerEvents: 'auto' }}>
      <div className="relative bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col" style={{ width: Math.max(400, viewport.width - 32), height: Math.max(300, viewport.height - 32) }}>
        <div className="bg-indigo-50 text-indigo-700 px-4 py-2 flex justify-between items-center text-sm font-semibold border-b border-indigo-100 shrink-0">
          <span className="truncate">{title}</span>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-indigo-200/50 rounded-lg text-indigo-600 hover:text-indigo-900 transition-colors cursor-pointer flex items-center gap-1 text-xs"
          >
            <Minimize2 size={14} /> 退出全屏
          </button>
        </div>
        <div className="absolute top-3 right-3 z-10">
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-black/20 hover:bg-black/40 text-white transition-colors cursor-pointer"
            title="关闭 (ESC)"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-6">
          {Renderer ? (
            <Renderer elementType={type} data={data} onClose={onClose} containerSize={viewport} lessonId={lessonId} />
          ) : (
            <DefaultFullscreenRenderer elementType={type} data={data} onClose={onClose} containerSize={viewport} lessonId={lessonId} />
          )}
        </div>
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

function DefaultFullscreenRenderer({ data }: FullscreenRendererProps) {
  const matched = PRIORITY_FIELDS.find(f => data[f.field] !== undefined && data[f.field] !== null && data[f.field] !== '');

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
        <a href={String(data.url)} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline text-lg">
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
      <iframe
        src={`/runtime/${data.coursewareUuid}/`}
        sandbox="allow-scripts allow-forms allow-downloads"
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
