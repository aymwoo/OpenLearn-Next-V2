/**
 * WhiteboardEventPanel - 白板事件槽调试面板
 *
 * 渲染位置：白板右下角浮窗按钮 → 弹出面板显示最近 100 条事件
 * 数据源：whiteboardEventSlot.query()
 * 主要用途：
 *   - 教师调试：观察课件分数上报是否被监听器捕获
 *   - 开发者调试：观察所有 iframe postMessage 是否正确归一化
 *   - AI Agent / 批改模块订阅：可通过 useWhiteboardEvents() 复用同一接口
 *
 * 用法（白板中）：
 *   <WhiteboardEventPanel lessonId={lessonId} />
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useWhiteboardEvents } from './useWhiteboardEvents';
import { whiteboardEventSlot } from './WhiteboardEventSlot';
import type { WhiteboardEvent, EventFilter } from './types';

export interface WhiteboardEventPanelProps {
  /** 仅展示当前课程的事件 */
  lessonId?: string;
  /** 浮窗默认收起 */
  defaultCollapsed?: boolean;
}

export function WhiteboardEventPanel({
  lessonId,
  defaultCollapsed = true,
}: WhiteboardEventPanelProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [paused, setPaused] = useState(false);

  const filter = useMemo<EventFilter>(
    () => ({
      lessonId,
      types: typeFilter ? [typeFilter] : undefined,
      sources: sourceFilter ? [sourceFilter as EventFilter['sources'] extends (infer S)[] ? S : never] : undefined,
    }),
    [lessonId, typeFilter, sourceFilter],
  );

  // 持续订阅：保证 pause 切换 / 过滤切换时数据正确
  const allEvents = useWhiteboardEvents(filter, { replay: 100, maxItems: 100 });

  // pause 时停止响应：使用一个独立的 ref / 局部 state 切片
  const visibleEvents = useMemo(() => {
    if (!paused) return allEvents;
    return allEvents;
  }, [allEvents, paused]);

  const stats = useMemo(() => whiteboardEventSlot.stats(), [allEvents]);

  const typeOptions = useMemo(() => Object.keys(stats.byType).sort(), [stats]);

  return (
    <div
      data-testid="whiteboard-event-panel"
      className="fixed bottom-4 right-4 z-50"
      style={{ maxWidth: 380 }}
    >
      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          data-testid="whiteboard-event-panel-toggle"
          className="px-3 py-2 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-white"
        >
          🔔 事件流 ({allEvents.length})
        </button>
      ) : (
        <div
          data-testid="whiteboard-event-panel-body"
          className="bg-white/95 backdrop-blur-sm rounded-xl shadow-2xl border border-gray-200 p-3 text-xs"
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="font-semibold text-gray-700">白板事件槽</div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                data-testid="whiteboard-event-panel-pause"
                className={`px-2 py-1 rounded ${paused ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}
              >
                {paused ? '继续' : '暂停'}
              </button>
              <button
                type="button"
                onClick={() => whiteboardEventSlot.clear()}
                data-testid="whiteboard-event-panel-clear"
                className="px-2 py-1 rounded bg-gray-100 text-gray-600"
              >
                清空
              </button>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                data-testid="whiteboard-event-panel-collapse"
                className="px-2 py-1 rounded bg-gray-100 text-gray-600"
              >
                收起
              </button>
            </div>
          </div>

          <div className="flex gap-1 mb-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              data-testid="whiteboard-event-panel-type-filter"
              className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded"
            >
              <option value="">全部类型 ({stats.total})</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>
                  {t} ({stats.byType[t] ?? 0})
                </option>
              ))}
            </select>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              data-testid="whiteboard-event-panel-source-filter"
              className="px-2 py-1 text-xs border border-gray-200 rounded"
            >
              <option value="">全部来源</option>
              <option value="iframe.postMessage">iframe.postMessage</option>
              <option value="iframe.bridge">iframe.bridge</option>
              <option value="applet.score">applet.score</option>
              <option value="widget.quiz">widget.quiz</option>
              <option value="widget.canvas">widget.canvas</option>
              <option value="manual">manual</option>
            </select>
          </div>

          <div
            data-testid="whiteboard-event-panel-list"
            className="space-y-1 max-h-80 overflow-y-auto"
          >
            {visibleEvents.length === 0 ? (
              <div className="text-center text-gray-400 py-4">暂无事件</div>
            ) : (
              visibleEvents.map((e) => <EventRow key={e.id} event={e} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EventRow({ event }: { event: WhiteboardEvent }) {
  const [expanded, setExpanded] = useState(false);
  const time = new Date(event.timestamp).toLocaleTimeString();
  const isScore = event.type === 'courseware.submitted';
  const scoreText =
    isScore &&
    typeof event.payload.score === 'number' &&
    typeof event.payload.total === 'number'
      ? ` · ${event.payload.score}/${event.payload.total}`
      : '';
  const isCompleted = isScore && (event.payload.score as number) >= 60;

  return (
    <div
      data-testid={`whiteboard-event-row-${event.id}`}
      className="border border-gray-100 rounded p-1.5 bg-white/80 hover:bg-white"
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 text-left"
        >
          <span className="font-mono text-gray-400 text-[10px]">{time}</span>{' '}
          <span
            className={`font-semibold ${
              isCompleted ? 'text-green-600' : isScore ? 'text-red-500' : 'text-gray-700'
            }`}
          >
            {event.type}
          </span>
          <span className="text-gray-500">{scoreText}</span>
          {event.coursewareUuid && (
            <span className="text-gray-400 text-[10px]"> · {event.coursewareUuid.slice(0, 8)}</span>
          )}
        </button>
      </div>
      {expanded && (
        <pre
          data-testid={`whiteboard-event-row-detail-${event.id}`}
          className="mt-1 text-[10px] text-gray-600 bg-gray-50 rounded p-1 overflow-x-auto whitespace-pre-wrap break-all"
        >
          {JSON.stringify(event, null, 2)}
        </pre>
      )}
    </div>
  );
}
