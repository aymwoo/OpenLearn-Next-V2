/**
 * ExtensionPointRenderer — React.lazy + Suspense rendering for extension points.
 *
 * D-05: Extension Point components render using React.lazy with Suspense fallback.
 *       Plugins provide a `component` factory function (`() => Promise<{default: ComponentType}>`),
 *       and this renderer lazy-loads them on first render.
 *
 * T-09-05: Each extension point is wrapped in its own ErrorBoundary so that
 *          one crashing extension doesn't take down all others (DoS mitigation).
 *
 * States:
 *   Loading — <LoadingSkeleton /> pulsing gray placeholder
 *   Loaded  — Rendered plugin component
 *   Error   — Red error boundary fallback with retry message
 *   Empty   — Nothing rendered (no extensions for the slot)
 */

import React, { Suspense } from 'react';
import { Loader2, Puzzle } from 'lucide-react';
import { usePluginHost, useOptionalPluginHost } from './plugin-host-context';
import { usePluginHostStore } from './plugin-host-store';
import { useAppStore } from '../store/appStore';
import { PluginIconRenderer } from '../components/PluginIconRenderer';
import type { ExtensionSlot } from './types';

// ── LoadingSkeleton ──────────────────────────────────────────────────────────

/**
 * Co-located LoadingSkeleton shown while extension components load.
 *
 * Visual: pulsing gray rectangular placeholder (`w-full h-32 bg-gray-100
 *         rounded-xl animate-pulse`) with a centered spinner and "Loading..." label.
 *
 * Per UI-SPEC spec:
 *   - Loader2 icon (size 24, text-gray-400, animate-spin)
 *   - Label (text-xs text-gray-400)
 */
function LoadingSkeleton() {
  return (
    <div className="w-full h-32 bg-gray-100 rounded-xl animate-pulse flex items-center justify-center">
      <div className="flex flex-col items-center gap-2">
        <Loader2 size={24} className="text-gray-400 animate-spin" />
        <span className="text-xs text-gray-400">Loading...</span>
      </div>
    </div>
  );
}

// ── ErrorBoundary ────────────────────────────────────────────────────────────

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  /** React 在调用方通过 key 区分多个错误边界实例（JSX 属性，运行时由 React 消费） */
  key?: React.Key;
  /** P2 熔断器：所属插件 ID（存在时启用连续崩溃计数与自动停用） */
  pluginId?: string;
  /** 熔断触发回调（达到阈值时调用一次 —— 宿主应停用插件并上报健康状态） */
  onBreakerTrip?: (pluginId: string) => void;
}

// ── P2 插件前端熔断器 ────────────────────────────────────────────────
// 同一插件连续崩溃达到阈值后自动停用（降级），防止坏插件反复崩溃拖垮宿主。
// 窗口内成功渲染（hasError 复位）会清零计数。

const CRASH_BREAKER_THRESHOLD = 3;
const CRASH_BREAKER_WINDOW_MS = 5 * 60 * 1000;

interface CrashRecord {
  count: number;
  lastAt: number;
  blown: boolean;
}

/** pluginId → 熔断记录（模块级，跨渲染周期持久） */
const pluginCrashRegistry = new Map<string, CrashRecord>();

/** 记录一次插件前端崩溃；达到阈值返回 true（调用方应停用该插件） */
function recordPluginCrash(pluginId: string): { shouldBreak: boolean; count: number } {
  const now = Date.now();
  const rec = pluginCrashRegistry.get(pluginId);
  if (!rec || now - rec.lastAt > CRASH_BREAKER_WINDOW_MS) {
    pluginCrashRegistry.set(pluginId, { count: 1, lastAt: now, blown: false });
    return { shouldBreak: false, count: 1 };
  }
  rec.count += 1;
  rec.lastAt = now;
  const shouldBreak = rec.count >= CRASH_BREAKER_THRESHOLD;
  if (shouldBreak) rec.blown = true;
  return { shouldBreak, count: rec.count };
}

/** 渲染成功（子组件正常挂载）时清零该插件的连续崩溃计数 */
function resetPluginCrash(pluginId: string): void {
  pluginCrashRegistry.delete(pluginId);
}

/** 查询某插件是否已被熔断（停用降级中） */
export function isPluginBlown(pluginId: string): boolean {
  return pluginCrashRegistry.get(pluginId)?.blown ?? false;
}

/** 清除熔断状态（插件重激活/手动恢复时调用） */
export function resetPluginBreaker(pluginId: string): void {
  pluginCrashRegistry.delete(pluginId);
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * React error boundary that catches render errors in extension point components.
 *
 * T-09-05: Each extension component is wrapped in its own ErrorBoundary instance,
 *          isolating crashes so one failed extension doesn't take down others.
 */
class ExtensionErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };
  props: ErrorBoundaryProps;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.props = props;
  }

  componentDidCatch(error: Error): void {
    const pluginId = this.props.pluginId;
    if (!pluginId) return;
    const { shouldBreak, count } = recordPluginCrash(pluginId);
    console.error(
      `[ExtensionBreaker] Plugin "${pluginId}" frontend crash #${count}/${CRASH_BREAKER_THRESHOLD}` +
        (shouldBreak ? ' — 达到熔断阈值，自动停用' : ''),
      error?.message?.slice(0, 120),
    );
    if (shouldBreak) {
      try {
        this.props.onBreakerTrip?.(pluginId);
      } catch (e) {
        console.error('[ExtensionBreaker] breaker trip callback failed:', e);
      }
    }
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidMount(): void {
    // 渲染成功清零连续崩溃计数（窗口语义：仅在连续失败时累积）
    if (this.props.pluginId) resetPluginCrash(this.props.pluginId);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}

// ── ExtensionPointRenderer ───────────────────────────────────────────────────

export interface ExtensionPointRendererProps {
  /** The extension slot to render (e.g. 'teacher.tab', 'student.view', or an `anchor:*` slot) */
  slot: ExtensionSlot | string;
  /** Optional custom fallback shown during loading (replaces LoadingSkeleton) */
  fallback?: React.ReactNode;
  /** Optional language code for internationalized error messages */
  lang?: string;
  /** v5.1: 可选子路由，传递给插件组件 */
  route?: string;
  /** v5.1: 额外传递给插件的渲染属性 (如 renderType) */
  slotProps?: Record<string, any>;
  /**
   * v0.2.6: 锚点槽位渲染侧。仅对 `anchor:*` 槽位生效：
   * - 'before'：只渲染 `placement === 'before'` 的扩展
   * - 'after'：只渲染 `placement === 'after'` 或未声明 placement（默认）的扩展
   * 不传时渲染该槽位全部扩展（兼容固定槽位行为）。
   */
  placement?: 'before' | 'after';
}

/**
 * Wrapper component to support plugins using traditional DOM render function.
 */
export function DOMExtensionWrapper({
  ext,
  route,
  slotProps,
  slot,
}: {
  ext: any;
  route?: string;
  slotProps?: any;
  slot: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const serializedProps = JSON.stringify(slotProps || {});

  React.useEffect(() => {
    if (containerRef.current && typeof ext.render === 'function') {
      containerRef.current.innerHTML = '';
      Promise.resolve(ext.render(containerRef.current, { route, ...slotProps })).catch(console.error);
    }
  }, [ext, route, serializedProps]);

  // If slot is dashboard widget, use h-auto to prevent vertical overlaps,
  // otherwise use h-full for full-page panels.
  const isWidget = slot === 'teacher.dashboard.widget';
  const heightClass = isWidget ? 'h-auto' : 'h-full min-h-0';

  return <div ref={containerRef} className={`w-full ${heightClass}`} />;
}

/**
 * Renders all registered extension point components for a given slot.
 *
 * Each extension point is rendered via React.lazy inside a Suspense boundary
 * with a LoadingSkeleton fallback, wrapped in an individual ErrorBoundary.
 *
 * Returns null if no extensions are registered for the slot.
 */
// ── Stable component resolution cache ────────────────────────────────────────
//
// ext.component can be either:
//   (a) A React component function  (props) => JSX   → use directly
//   (b) A lazy factory  () => Promise<{default: Component}>  → wrap with React.lazy
//
// We must NOT call ext.component() during render to "probe" its return type,
// because if it's a real React component, that invokes its hooks as side-effects,
// causing React's "Rendered more/fewer hooks" error.
//
// Instead, we resolve once per ext.component reference and cache the result.
const resolvedComponentCache = new WeakMap<Function, React.ComponentType<any>>();

function resolveExtensionComponent(ext: any): React.ComponentType<any> {
  const fn = ext.component as Function;
  const cached = resolvedComponentCache.get(fn);
  if (cached) return cached;

  // Heuristic: lazy factories are typically arrow functions with 0-length
  // that return a Promise. Real React components accept (props) and return JSX.
  // We check if the function is marked as a React component or has hooks-like
  // characteristics by checking its .length (props arg) and name patterns.
  //
  // Safest approach: if the function's source contains "createElement" or
  // "use" calls, treat it as a direct component. But we can't inspect source
  // reliably. Instead, we check: if calling it with no args returns a thenable,
  // it's a lazy factory. BUT we can't call it during render.
  //
  // Final approach: treat it as a direct component by default. If the plugin
  // registered it as a lazy factory (returns Promise), it should have been
  // wrapped at registration time. The current codebase registers direct
  // components, so this is safe.
  //
  // We use a marker property `__isLazyFactory` that can be set at registration.
  if ((fn as any).__isLazyFactory === true) {
    const lazy = React.lazy(fn as () => Promise<{ default: React.ComponentType<any> }>);
    resolvedComponentCache.set(fn, lazy);
    return lazy;
  }

  // Default: treat as direct React component
  resolvedComponentCache.set(fn, fn as React.ComponentType<any>);
  return fn as React.ComponentType<any>;
}

/**
 * Renders all registered extension point components for a given slot.
 *
 * Returns null if no extensions are registered for the slot.
 */
function getExtensionDispatcher(host: any, pluginId: string, customDispatcher?: any) {
  if (customDispatcher) return customDispatcher;
  if (!host || typeof host.getDispatcher !== 'function') return undefined;
  const disp = host.getDispatcher();
  return typeof disp?.createScopedDispatcher === 'function' ? disp.createScopedDispatcher(pluginId) : disp;
}

export function ExtensionPointRenderer({
  slot,
  fallback,
  lang,
  route,
  slotProps,
  placement,
}: ExtensionPointRendererProps) {
  // 熔断降级告警去重（每个组件实例只告警一次/插件）
  const warnedPluginsRef = React.useRef<Set<string>>(new Set());
  // Hooks 顺序红线：全部无条件调用后再走早退分支（此前早退先于 hooks，
  // 触发 rules-of-hooks 存量违规）
  const host = useOptionalPluginHost();
  const activePlugins = usePluginHostStore((s) => s.activePlugins);
  const visibility = usePluginHostStore((s) => s.dashboardVisibility);
  const selectedLesson = useAppStore((s) => s.selectedLesson);
  const liveClassSelectedClassId = useAppStore((s) => s.liveClassSelectedClassId);

  if (!host) return fallback ?? null;
  let extensions = host.getExtensions(slot as ExtensionSlot);

  // v0.2.6: anchor slot placement filtering —— 宿主在锚点按钮前后各渲染一次，
  // 本侧只渲染与 placement 匹配的扩展（未声明的默认视为 'after'）。
  if (placement) {
    extensions = extensions.filter((ext) => (ext.placement ?? 'after') === placement);
  }

  if (extensions.length === 0) return null;

  // class.tab with renderType 'button' — render compact tab buttons from
  // extension metadata (same metadata-driven pattern as teacher.tab, but
  // styled as class-detail tabs). Content is rendered separately by
  // ClassesView via the same slot with renderType 'panel'.
  if (slot === 'class.tab' && slotProps?.renderType === 'button') {
    return (
      <>
        {extensions.map((ext) => {
          const tabValue = `plugin:${ext.pluginId}/${ext.id}`;
          const isActive = slotProps?.classActiveTab === tabValue;
          const label = (ext as any).title || ext.label || ext.id;
          const pluginInfo = activePlugins.find((p) => p.id === ext.pluginId);
          const icon = ext.icon || pluginInfo?.icon;
          return (
            <button
              key={`${ext.pluginId}/${ext.id}`}
              onClick={(e) => {
                e.stopPropagation();
                slotProps?.setClassActiveTab?.(tabValue);
              }}
              className={`py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer ${
                isActive
                  ? 'bg-white text-indigo-600 shadow-xs font-bold border border-slate-200/50'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
              }`}
              title={label}
            >
              <PluginIconRenderer icon={icon} size={12} className="shrink-0" alt={label} />
              <span>{label}</span>
            </button>
          );
        })}
      </>
    );
  }

  // class.tab with renderType 'panel' — render the active plugin tab's panel.
  // Renders NOTHING unless this class has the corresponding plugin tab active.
  if (slot === 'class.tab' && slotProps?.renderType === 'panel') {
    const expected = slotProps?.classActiveTab as string | undefined;
    const activeExt = extensions.find((ext) => `plugin:${ext.pluginId}/${ext.id}` === expected);
    if (!activeExt) return null;
    return (
      <ExtensionErrorBoundary
        key={`${activeExt.pluginId}/${activeExt.id}`}
        pluginId={activeExt.pluginId}
        fallback={
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">扩展 Tab 加载失败</div>
        }
      >
        <Suspense fallback={<LoadingSkeleton />}>
          {React.createElement(resolveExtensionComponent(activeExt), {
            classId: slotProps?.classId,
            students: slotProps?.students,
            lang: slotProps?.lang,
            dispatcher: getExtensionDispatcher(host, activeExt.pluginId, slotProps?.dispatcher),
            ...activeExt.slotProps,
          })}
        </Suspense>
      </ExtensionErrorBoundary>
    );
  }

  // timetable.tab with renderType 'button' — render segmented buttons
  if (slot === 'timetable.tab' && slotProps?.renderType === 'button') {
    return (
      <>
        {extensions.map((ext) => {
          const tabValue = `plugin:${ext.pluginId}/${ext.id}`;
          const isActive = slotProps?.timetableActiveTab === tabValue;
          const label = (ext as any).title || ext.label || ext.id;
          const pluginInfo = activePlugins.find((p) => p.id === ext.pluginId);
          const icon = ext.icon || pluginInfo?.icon;
          return (
            <button
              key={`${ext.pluginId}/${ext.id}`}
              onClick={(e) => {
                e.stopPropagation();
                slotProps?.setTimetableActiveTab?.(tabValue);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all cursor-pointer flex items-center gap-1.5 ${
                isActive
                  ? 'bg-white text-indigo-700 shadow-sm font-bold'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
              title={label}
            >
              <PluginIconRenderer icon={icon} size={14} className="shrink-0" alt={label} />
              <span>{label}</span>
            </button>
          );
        })}
      </>
    );
  }

  // timetable.tab with renderType 'panel' — render active plugin tab panel
  if (slot === 'timetable.tab' && slotProps?.renderType === 'panel') {
    const expected = slotProps?.timetableActiveTab as string | undefined;
    const activeExt = extensions.find((ext) => `plugin:${ext.pluginId}/${ext.id}` === expected);
    if (!activeExt) return null;
    return (
      <ExtensionErrorBoundary
        key={`${activeExt.pluginId}/${activeExt.id}`}
        pluginId={activeExt.pluginId}
        fallback={
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">课表扩展 Tab 加载失败</div>
        }
      >
        <Suspense fallback={<LoadingSkeleton />}>
          {React.createElement(resolveExtensionComponent(activeExt), {
            classes: slotProps?.classes,
            lessons: slotProps?.lessons,
            lang: slotProps?.lang,
            onSchedulesUpdated: slotProps?.onSchedulesUpdated,
            onClassesUpdated: slotProps?.onClassesUpdated,
            dispatcher: getExtensionDispatcher(host, activeExt.pluginId, slotProps?.dispatcher),
            ...activeExt.slotProps,
          })}
        </Suspense>
      </ExtensionErrorBoundary>
    );
  }

  // admin.tab with renderType 'button' — render segmented buttons
  if (slot === 'admin.tab' && slotProps?.renderType === 'button') {
    return (
      <>
        {extensions.map((ext) => {
          const tabValue = `plugin:${ext.pluginId}/${ext.id}`;
          const isActive = slotProps?.adminActiveTab === tabValue;
          const label = (ext as any).title || ext.label || ext.id;
          const pluginInfo = activePlugins.find((p) => p.id === ext.pluginId);
          const icon = ext.icon || pluginInfo?.icon;
          return (
            <button
              key={`${ext.pluginId}/${ext.id}`}
              onClick={(e) => {
                e.stopPropagation();
                slotProps?.setAdminActiveTab?.(tabValue);
              }}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                isActive
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
              title={label}
            >
              <PluginIconRenderer icon={icon} size={14} className="shrink-0" alt={label} />
              <span>{label}</span>
            </button>
          );
        })}
      </>
    );
  }

  // admin.tab with renderType 'panel' — render active plugin tab panel
  if (slot === 'admin.tab' && slotProps?.renderType === 'panel') {
    const expected = slotProps?.adminActiveTab as string | undefined;
    const activeExt = extensions.find((ext) => `plugin:${ext.pluginId}/${ext.id}` === expected);
    if (!activeExt) return null;
    return (
      <ExtensionErrorBoundary
        key={`${activeExt.pluginId}/${activeExt.id}`}
        pluginId={activeExt.pluginId}
        fallback={
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">管理后台扩展 Tab 加载失败</div>
        }
      >
        <Suspense fallback={<LoadingSkeleton />}>
          {React.createElement(resolveExtensionComponent(activeExt), {
            currentUserId: slotProps?.currentUserId,
            currentUserRole: slotProps?.currentUserRole,
            lang: slotProps?.lang,
            siteInfo: slotProps?.siteInfo,
            aiProviders: slotProps?.aiProviders,
            dispatcher: getExtensionDispatcher(host, activeExt.pluginId, slotProps?.dispatcher),
            ...activeExt.slotProps,
          })}
        </Suspense>
      </ExtensionErrorBoundary>
    );
  }

  // student.profile.tab with renderType 'button' — render segmented buttons
  if (slot === 'student.profile.tab' && slotProps?.renderType === 'button') {
    return (
      <>
        {extensions.map((ext) => {
          const tabValue = `plugin:${ext.pluginId}/${ext.id}`;
          const isActive = slotProps?.studentActiveTab === tabValue;
          const label = (ext as any).title || ext.label || ext.id;
          const pluginInfo = activePlugins.find((p) => p.id === ext.pluginId);
          const icon = ext.icon || pluginInfo?.icon;
          return (
            <button
              key={`${ext.pluginId}/${ext.id}`}
              onClick={(e) => {
                e.stopPropagation();
                slotProps?.setStudentActiveTab?.(tabValue);
              }}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                isActive
                  ? 'bg-surface text-primary-theme shadow-xs border border-theme/60'
                  : 'text-muted hover:text-main'
              }`}
              title={label}
            >
              <PluginIconRenderer icon={icon} size={14} className="shrink-0" alt={label} />
              <span>{label}</span>
            </button>
          );
        })}
      </>
    );
  }

  // student.profile.tab with renderType 'panel' — render active plugin tab panel
  if (slot === 'student.profile.tab' && slotProps?.renderType === 'panel') {
    const expected = slotProps?.studentActiveTab as string | undefined;
    const activeExt = extensions.find((ext) => `plugin:${ext.pluginId}/${ext.id}` === expected);
    if (!activeExt) return null;
    return (
      <ExtensionErrorBoundary
        key={`${activeExt.pluginId}/${activeExt.id}`}
        pluginId={activeExt.pluginId}
        fallback={
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            学生画像扩展 Tab 加载失败
          </div>
        }
      >
        <Suspense fallback={<LoadingSkeleton />}>
          {React.createElement(resolveExtensionComponent(activeExt), {
            student: slotProps?.student,
            lessonId: slotProps?.lessonId,
            classId: slotProps?.classId,
            lang: slotProps?.lang,
            progressHistory: slotProps?.progressHistory,
            dispatcher: getExtensionDispatcher(host, activeExt.pluginId, slotProps?.dispatcher),
            ...activeExt.slotProps,
          })}
        </Suspense>
      </ExtensionErrorBoundary>
    );
  }

  // teacher.tab with renderType 'button' — render NavButton-style buttons
  // directly from extension metadata, bypassing plugin components entirely.
  // This guarantees pixel-perfect styling consistency with system NavButton.
  if (slot === 'teacher.tab' && slotProps?.renderType === 'button') {
    const sortedExtensions = [...extensions].sort((a, b) => (a.position ?? 100) - (b.position ?? 100));
    return (
      <>
        {sortedExtensions.map((ext) => {
          const tabValue = `${ext.pluginId}/${ext.id}`;
          const isActive = slotProps?.teacherTab === tabValue;
          const label = (ext as any).title || ext.label || ext.id;
          const pluginInfo = activePlugins.find((p) => p.id === ext.pluginId);
          const icon = ext.icon || pluginInfo?.icon;
          return (
            <button
              key={`${ext.pluginId}/${ext.id}`}
              onClick={() => slotProps?.setTeacherTab?.(tabValue)}
              id={`nav_btn_${tabValue.replace(/[^a-zA-Z0-9_-]/g, '_')}`}
              className={`flex items-center gap-2.5 px-2.5 py-2 transition-colors text-sm font-medium rounded-xl cursor-pointer ${
                isActive
                  ? 'bg-primary-theme-light text-primary-theme font-bold'
                  : 'text-muted hover:bg-surface-secondary hover:text-main'
              } ${slotProps?.mainNavCollapsed ? 'justify-center px-2' : ''}`}
              title={label}
            >
              <PluginIconRenderer icon={icon} size={18} className="shrink-0" alt={label} />
              <span className={slotProps?.mainNavCollapsed ? 'hidden' : 'hidden md:block truncate'}>{label}</span>
            </button>
          );
        })}
      </>
    );
  }

  return (
    <>
      {extensions.map((ext) => {
        const isReact = typeof ext.component === 'function';
        const isDOM = typeof ext.render === 'function';
        if (slot === 'teacher.dashboard.widget' && visibility.get(ext.pluginId) === false) return null;
        if (!isReact && !isDOM) return null;

        if (isPluginBlown(ext.pluginId)) {
          if (!warnedPluginsRef.current.has(ext.pluginId)) {
            warnedPluginsRef.current.add(ext.pluginId);
            console.warn(
              `[ExtensionBreaker] Plugin "${ext.pluginId}" 已熔断（连续崩溃 ≥3 次），跳过渲染。重新激活插件可恢复。`,
            );
          }
          return null;
        }
        return (
          <ExtensionErrorBoundary
            key={`${ext.pluginId}/${ext.id}`}
            pluginId={ext.pluginId}
            onBreakerTrip={(pid) => {
              void host
                .deactivatePlugin(pid)
                .catch((e) => console.error(`[ExtensionBreaker] auto-deactivate "${pid}" failed:`, e));
            }}
            fallback={
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
                <p>{lang === 'zh' ? '扩展组件加载失败' : 'Extension failed to load'}</p>
              </div>
            }
          >
            <Suspense fallback={fallback ?? <LoadingSkeleton />}>
              {isReact ? (
                React.createElement(resolveExtensionComponent(ext), {
                  route: ext.route || route,
                  lessonId: selectedLesson,
                  classId: liveClassSelectedClassId,
                  dispatcher: getExtensionDispatcher(host, ext.pluginId, slotProps?.dispatcher),
                  ...ext.slotProps,
                  ...slotProps,
                })
              ) : (
                <DOMExtensionWrapper
                  ext={ext}
                  route={ext.route || route}
                  slotProps={{
                    lessonId: selectedLesson,
                    classId: liveClassSelectedClassId,
                    dispatcher: getExtensionDispatcher(host, ext.pluginId, slotProps?.dispatcher),
                    ...ext.slotProps,
                    ...slotProps,
                  }}
                  slot={slot}
                />
              )}
            </Suspense>
          </ExtensionErrorBoundary>
        );
      })}
    </>
  );
}
