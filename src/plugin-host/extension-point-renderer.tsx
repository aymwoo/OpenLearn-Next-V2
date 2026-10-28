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
import { Loader2, Puzzle, ExternalLink, AlertTriangle, RefreshCw } from 'lucide-react';
import { usePluginHost, useOptionalPluginHost } from './plugin-host-context';
import { usePluginHostStore } from './plugin-host-store';
import { useAppStore } from '../store/appStore';
import { PluginIconRenderer } from '../components/PluginIconRenderer';
import { openTeacherTabInNewTab } from '../utils/teacherTabHash';
import { translations, resolveLabel, type Language } from '../i18n';
import {
  recordPluginCrash,
  resetPluginCrash,
  isPluginBlown,
  resetPluginBreaker,
  CRASH_BREAKER_THRESHOLD,
} from './extension-breaker';
import type { ExtensionSlot } from './types';
import { matchesDeclaredExtension } from '../../packages/core/assignment/file-preview-policy.js';
import { NullExtensionComponent } from './plugin-host';
import { PluginSandboxIframeView } from '../components/PluginSandboxIframeView';

// 兼容再导出（历史上从本模块导出；状态已迁移至 ./extension-breaker）
export { isPluginBlown, resetPluginBreaker };

/**
 * 熔断触发的统一降级（v0.6.1 审计 C-2）：
 * 1. 摘除该插件**运行时**注册的扩展点 —— 脱离生命周期的直注册插件（如内置包）
 *    也能被降级；
 * 2. 内置包同步写入停用表 —— 管理卡片如实显示「已停用」，重新启用时经
 *    装配模块的重注册 → resetPluginBreaker 恢复；
 * 3. 生命周期内插件再走宿主 suspendPlugin（失败仅记日志）。
 *
 * v0.7.0 熔断越权修复：第 1 步此前调用 `unregisterPluginExtensionPoints`
 * **连同 manifest 声明式贡献一起摘掉** —— 声明式贡献（Tab / 命令面板项 /
 * 画布调色板项）由服务端插件宿主执行，与前端 bundle 无关，前端崩溃不该让
 * 它们凭空消失。实测表现为失败插件的 Tab「闪现后消失」（单跑出现、全跑消失，
 * 取决于渲染时序）。现在只摘运行时扩展点，声明式贡献保留，由错误态面板
 * 显式告知用户「插件加载失败 + 重试」。
 */
function handleBreakerTrip(
  pid: string,
  host: { suspendPlugin?: (id: string) => Promise<void>; deactivatePlugin: (id: string) => Promise<void> } | null,
): void {
  const store = usePluginHostStore.getState();
  store.unregisterPluginRuntimeExtensionPoints(pid);
  const suspend = host?.suspendPlugin ? host.suspendPlugin(pid) : host?.deactivatePlugin(pid);
  void suspend?.catch((e) => console.error(`[ExtensionBreaker] auto-deactivate "${pid}" failed:`, e));
}

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

// ── PluginErrorState ────────────────────────────────────────────────────────

/**
 * 插件前端的**显式错误态**（v0.7.0）。
 *
 * 此前插件前端加载失败 / 被熔断时，扩展点区域要么整包被摘除（Tab 闪现后
 * 消失），要么 `isPluginBlown` 直接 return null（留白）—— 用户既看不到
 * 任何提示，也无从判断是「插件没装」还是「插件挂了」。这里给出可操作的
 * 错误面板：说明发生了什么 + 提供重试入口。
 */
export function PluginErrorState({
  pluginId,
  message,
  lang = 'zh',
  compact = false,
}: {
  pluginId: string;
  message: string;
  lang?: 'zh' | 'en';
  compact?: boolean;
}) {
  const host = useOptionalPluginHost();
  const [retrying, setRetrying] = React.useState(false);
  const isZh = lang === 'zh';

  const handleRetry = React.useCallback(() => {
    if (!host || retrying) return;
    setRetrying(true);
    void host
      .retryPlugin(pluginId)
      .catch(() => false)
      .finally(() => setRetrying(false));
  }, [host, pluginId, retrying]);

  const title = isZh ? '插件加载失败' : 'Plugin failed to load';
  const retryLabel = isZh ? '重试' : 'Retry';

  return (
    <div
      role="alert"
      data-testid={`plugin-error-state-${pluginId}`}
      className={`flex flex-col items-center justify-center text-center ${compact ? 'py-4 px-3' : 'py-10 px-6'}`}
    >
      <AlertTriangle size={compact ? 20 : 32} className="text-amber-500 mb-2" aria-hidden="true" />
      <p className={`font-semibold text-amber-800 ${compact ? 'text-xs' : 'text-sm'}`}>{title}</p>
      <p className="text-xs text-muted mt-1 max-w-md break-words">{message}</p>
      <button
        type="button"
        onClick={handleRetry}
        disabled={retrying || !host}
        data-testid={`plugin-retry-btn-${pluginId}`}
        // amber-700 + 白字 = 5.02:1（AA 要求 4.5:1）—— amber-600 只有 3.19:1，
        // 会踩 a11y-gate 的对比度门禁（v0.7.0 与 PR #291 同类修复）
        className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {retrying ? (
          <Loader2 size={13} className="animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw size={13} aria-hidden="true" />
        )}
        {retrying ? (isZh ? '重试中…' : 'Retrying…') : retryLabel}
      </button>
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
// 状态与阈值常量在 ./extension-breaker（独立模块）—— 激活路径
// （plugin-host.ts）要在插件成功激活时复位熔断，而 renderer 与 plugin-host
// 不能互相导入，熔断状态必须落在共同下游（v0.6.1 审计 C-2）。

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

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    // 注意：CrashResetProbe 不在这里包裹 —— 它必须位于调用点 <Suspense>
    // **之内**（见各调用点）：否则 lazy 加载期间的 fallback 提交即触发探针
    // useEffect 清零计数，熔断阈值被稀释（v0.6.1 审计 R-4）。
    return this.props.children;
  }
}

/**
 * 子树成功提交后清零该插件连续崩溃计数。
 *
 * 不能放在边界自身的 componentDidMount 里：子组件在**首次挂载**期间抛错时，
 * 边界以 fallback 形态完成挂载，componentDidMount 照样执行，会在 componentDidCatch
 * 累计之后立刻清零 —— 阈值永远达不到，熔断器失效（v0.6.0 审计 R-5）。
 * 探针只在子树真正渲染成功时挂载/提交，错误路径探针不存在，计数得以累积。
 */
function CrashResetProbe({ pluginId, children }: { pluginId?: string; children: React.ReactNode }) {
  React.useEffect(() => {
    if (pluginId) resetPluginCrash(pluginId);
  });
  return <>{children}</>;
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
  const fn = ext?.component as Function | undefined;
  if (typeof fn !== 'function') {
    return () => null;
  }
  const cached = resolvedComponentCache.get(fn);
  if (cached) return cached;

  // 打标工厂（显式约定）：包 React.lazy 并缓存。
  if ((fn as any).__isLazyFactory === true) {
    const lazy = React.lazy(fn as () => Promise<{ default: React.ComponentType<any> }>);
    resolvedComponentCache.set(fn, lazy);
    return lazy;
  }

  // v0.6.1 审计 R-1 收口 —— 未打标 lazy 工厂的**自愈探针 + 开发期告警**。
  //
  // 此前的假设「当前代码库只注册直接组件，所以默认当直组件是安全的」已被
  // 两次事故证伪（v0.6.0 smart-edu 全量渲染失败 / 第三方经
  // ctx.ui.registerExtensionPoint 注入未打标工厂）：未打标的
  // `() => Promise.resolve({default: Comp})` 被当作直组件渲染时，返回的
  // Promise 会让最近的 Suspense **永久悬挂且不抛错**，ErrorBoundary 与
  // 熔断器全程失效。
  //
  // 探针：在缓存阶段（每函数仅一次、不在渲染路径上）以无参调用一次，
  // 返回 thenable 即判定为漏打标的 lazy 工厂 —— 自愈为 React.lazy（不再
  // 悬挂），并打 console.error 提示作者打标或改直组件。误判面分析：
  // - 直接组件被调用会走函数体 —— 使用 hooks/Context 的会同步抛错（捕获，
  //   按直组件处理）；返回 JSX 元素（非 thenable）→ 按直组件处理；
  // - 类组件无 new 调用直接抛错（捕获）→ 按直组件处理；
  // - memo/forwardRef/lazy 产物是对象而非函数 → 不进探针。
  if (typeof fn === 'function' && !(fn as any).prototype?.isReactComponent) {
    let looksLikeFactory = false;
    // React 19 使用 __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H，
    // React 18 使用 __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current。
    const internals =
      (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE ||
      (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
    const prevDispatcher = internals?.H ?? internals?.ReactCurrentDispatcher?.current;
    try {
      // 隔离当前渲染上下文：若 fn 为直接函数组件（使用 hooks），
      // 必须阻止其 hooks 挂载到外层 ExtensionPointRenderer 的 Fiber 上，
      // 否则外层组件在后续重渲染时因缓存跳过 probe 导致 hooks 数量不一致，
      // 触发 React error #300 (Rendered fewer hooks than expected)。
      if (internals) {
        if ('H' in internals) internals.H = null;
        if (internals.ReactCurrentDispatcher) internals.ReactCurrentDispatcher.current = null;
      }
      const probe = (fn as any)();
      if (probe && typeof probe.then === 'function') {
        looksLikeFactory = true;
      }
    } catch {
      // 直接组件的无参调用（hooks/类组件/必选 props 解构）会抛错 —— 按直组件处理
    } finally {
      if (internals) {
        if ('H' in internals) internals.H = prevDispatcher;
        if (internals.ReactCurrentDispatcher) internals.ReactCurrentDispatcher.current = prevDispatcher;
      }
    }
    if (looksLikeFactory) {
      console.error(
        '[ExtensionPoint] Detected an UNMARKED lazy factory (function returned a Promise). ' +
          'React would suspend forever without throwing. Auto-wrapping with React.lazy; ' +
          'please set `__isLazyFactory = true` on the factory or register the component directly. ' +
          `Offending function: ${fn.name || '(anonymous)'}`,
      );
      const lazy = React.lazy(fn as () => Promise<{ default: React.ComponentType<any> }>);
      resolvedComponentCache.set(fn, lazy);
      return lazy;
    }
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
  const pluginErrors = usePluginHostStore((s) => s.pluginErrors);
  const selectedLesson = useAppStore((s) => s.selectedLesson);
  const liveClassSelectedClassId = useAppStore((s) => s.liveClassSelectedClassId);

  if (!host) return fallback ?? null;
  let extensions = host.getExtensions(slot as ExtensionSlot);

  // v0.2.6: anchor slot placement filtering —— 宿主在锚点按钮前后各渲染一次，
  // 本侧只渲染与 placement 匹配的扩展（未声明的默认视为 'after'）。
  if (placement) {
    extensions = extensions.filter((ext) => (ext.placement ?? 'after') === placement);
  }

  // assignment.file.preview —— 作业附件预览插槽：只渲染「声明能处理当前文件类型」的贡献。
  //
  // 与 whiteboard.renderer 的 targetType 匹配同构：插槽是**按文件类型**分发的，
  // 一个只会处理 .docx 的预览器不该出现在 .png 的预览对话框里。
  // 声明字段：extensions（扩展名数组）+ mimeTypes（MIME 数组），两者命中其一即可。
  if (slot === 'assignment.file.preview') {
    const fileExtension = String(slotProps?.fileExtension ?? '').toLowerCase();
    if (!fileExtension) return null;
    extensions = extensions.filter((ext) => {
      const cfg = (ext.slotProps ?? {}) as Record<string, unknown>;
      const declaredExtensions = Array.isArray(cfg.extensions) ? cfg.extensions : [];
      if (matchesDeclaredExtension(declaredExtensions, fileExtension)) return true;
      const declaredMimes = Array.isArray(cfg.mimeTypes)
        ? cfg.mimeTypes.filter((m): m is string => typeof m === 'string').map((m) => m.toLowerCase())
        : [];
      const currentMime = String(slotProps?.file?.mime ?? '').toLowerCase();
      return currentMime !== '' && declaredMimes.includes(currentMime);
    });
  }

  if (extensions.length === 0) return null;

  const renderTabPanelContent = (activeExt: any, extraProps: Record<string, any>, fallbackText: string) => {
    // v0.7.0：显式错误态优先 —— 插件前端失败/被熔断时给出「错误 + 重试」，
    // 而不是静默留白（此前 isPluginBlown 直接 return null）。
    const pluginError = pluginErrors.get(activeExt.pluginId);
    if (pluginError) {
      return <PluginErrorState pluginId={activeExt.pluginId} message={pluginError} />;
    }
    if (isPluginBlown(activeExt.pluginId)) {
      if (!warnedPluginsRef.current.has(activeExt.pluginId)) {
        warnedPluginsRef.current.add(activeExt.pluginId);
        console.warn(
          `[ExtensionBreaker] Plugin "${activeExt.pluginId}" 已熔断（连续崩溃 ≥3 次），跳过渲染。重新激活插件可恢复。`,
        );
      }
      return (
        <PluginErrorState
          pluginId={activeExt.pluginId}
          message={
            lang === 'en'
              ? 'The plugin frontend crashed repeatedly and was suspended.'
              : '插件前端连续崩溃，已自动降级。'
          }
          lang={lang === 'en' ? 'en' : 'zh'}
        />
      );
    }
    const isReact = typeof activeExt.component === 'function' && activeExt.component !== NullExtensionComponent;
    const isDOM = typeof activeExt.render === 'function';
    const hasView = Boolean(activeExt.slotProps?.view || activeExt.view);
    if (!isReact && !isDOM && !hasView) return null;

    const mergedProps = {
      ...activeExt.slotProps,
      ...extraProps,
      dispatcher: getExtensionDispatcher(host, activeExt.pluginId, slotProps?.dispatcher),
    };

    return (
      <ExtensionErrorBoundary
        key={`${activeExt.pluginId}/${activeExt.id}`}
        pluginId={activeExt.pluginId}
        onBreakerTrip={(pid) => handleBreakerTrip(pid, host)}
        fallback={
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{fallbackText}</div>
        }
      >
        <Suspense fallback={<LoadingSkeleton />}>
          <CrashResetProbe pluginId={activeExt.pluginId}>
            {isReact ? (
              React.createElement(resolveExtensionComponent(activeExt), mergedProps)
            ) : isDOM ? (
              <DOMExtensionWrapper
                ext={activeExt}
                route={activeExt.route || route}
                slotProps={mergedProps}
                slot={slot}
              />
            ) : (
              <PluginSandboxIframeView
                pluginId={activeExt.pluginId}
                view={String(activeExt.slotProps?.view || activeExt.view)}
                label={activeExt.label}
                slot={slot}
                lessonId={selectedLesson}
                classId={liveClassSelectedClassId}
              />
            )}
          </CrashResetProbe>
        </Suspense>
      </ExtensionErrorBoundary>
    );
  };

  // class.tab with renderType 'button' — render compact tab buttons from
  // extension metadata (same metadata-driven pattern as teacher.tab, but
  // styled as class-detail tabs). Content is rendered separately by
  // ClassesView via the same slot with renderType 'panel'.
  if (slot === 'class.tab' && slotProps?.renderType === 'button') {
    const currentLang = (slotProps?.lang as Language) || 'zh';
    return (
      <>
        {extensions.map((ext) => {
          const tabValue = `plugin:${ext.pluginId}/${ext.id}`;
          const isActive = slotProps?.classActiveTab === tabValue;
          const rawLabel = (ext as any).title || ext.label || ext.id;
          const label = resolveLabel(rawLabel, ext.pluginId, currentLang);
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
    return renderTabPanelContent(
      activeExt,
      {
        classId: slotProps?.classId,
        students: slotProps?.students,
        lang: slotProps?.lang,
      },
      '扩展 Tab 加载失败',
    );
  }

  // timetable.tab with renderType 'button' — render segmented buttons
  if (slot === 'timetable.tab' && slotProps?.renderType === 'button') {
    const currentLang = (slotProps?.lang as Language) || 'zh';
    return (
      <>
        {extensions.map((ext) => {
          const tabValue = `plugin:${ext.pluginId}/${ext.id}`;
          const isActive = slotProps?.timetableActiveTab === tabValue;
          const rawLabel = (ext as any).title || ext.label || ext.id;
          const label = resolveLabel(rawLabel, ext.pluginId, currentLang);
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
                isActive ? 'bg-white text-indigo-700 shadow-sm font-bold' : 'text-gray-500 hover:text-gray-800'
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
    return renderTabPanelContent(
      activeExt,
      {
        classes: slotProps?.classes,
        lessons: slotProps?.lessons,
        lang: slotProps?.lang,
        onSchedulesUpdated: slotProps?.onSchedulesUpdated,
        onClassesUpdated: slotProps?.onClassesUpdated,
      },
      '课表扩展 Tab 加载失败',
    );
  }

  // ai_sidebar.tab with renderType 'button' — render compact tab buttons in the
  // right-sidebar tab strip (Agent / Shell 同排)。此前无分支：button 态把插件完整
  // 组件内联进 tab 条、panel 态不做 activeTab 过滤（v0.6.0 审计 E-1）。
  if (slot === 'ai_sidebar.tab' && slotProps?.renderType === 'button') {
    const currentLang = (slotProps?.lang as Language) || 'zh';
    return (
      <>
        {extensions.map((ext) => {
          const tabValue = `plugin:${ext.pluginId}/${ext.id}`;
          const isActive = slotProps?.activeTab === tabValue;
          const rawLabel = (ext as any).title || ext.label || ext.id;
          const label = resolveLabel(rawLabel, ext.pluginId, currentLang);
          const pluginInfo = activePlugins.find((p) => p.id === ext.pluginId);
          const icon = ext.icon || pluginInfo?.icon;
          return (
            <button
              key={`${ext.pluginId}/${ext.id}`}
              onClick={(e) => {
                e.stopPropagation();
                slotProps?.setActiveTab?.(tabValue);
              }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1 min-w-0 cursor-pointer ${
                isActive ? 'bg-white shadow text-indigo-600' : 'text-gray-500 hover:text-gray-700'
              }`}
              title={label}
            >
              <PluginIconRenderer icon={icon} size={14} className="shrink-0" alt={label} />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </>
    );
  }

  // ai_sidebar.tab with renderType 'panel' — render ONLY the active plugin tab's
  // panel（与 class.tab / timetable.tab 的 panel 语义一致）。
  if (slot === 'ai_sidebar.tab' && slotProps?.renderType === 'panel') {
    const expected = slotProps?.activeTab as string | undefined;
    const activeExt = extensions.find((ext) => `plugin:${ext.pluginId}/${ext.id}` === expected);
    if (!activeExt) return null;
    return renderTabPanelContent(
      activeExt,
      {
        activeTab: slotProps?.activeTab,
        lang: slotProps?.lang,
      },
      '扩展面板加载失败',
    );
  }

  // admin.tab with renderType 'button' — render segmented buttons
  if (slot === 'admin.tab' && slotProps?.renderType === 'button') {
    const currentLang = (slotProps?.lang as Language) || 'zh';
    return (
      <>
        {extensions.map((ext) => {
          const tabValue = `plugin:${ext.pluginId}/${ext.id}`;
          const isActive = slotProps?.adminActiveTab === tabValue;
          const rawLabel = (ext as any).title || ext.label || ext.id;
          const label = resolveLabel(rawLabel, ext.pluginId, currentLang);
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
                isActive ? 'bg-white text-indigo-700 shadow-xs' : 'text-gray-500 hover:text-gray-800'
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
    return renderTabPanelContent(
      activeExt,
      {
        currentUserId: slotProps?.currentUserId,
        currentUserRole: slotProps?.currentUserRole,
        lang: slotProps?.lang,
        siteInfo: slotProps?.siteInfo,
        aiProviders: slotProps?.aiProviders,
      },
      '管理后台扩展 Tab 加载失败',
    );
  }

  // student.profile.tab with renderType 'button' — render segmented buttons
  if (slot === 'student.profile.tab' && slotProps?.renderType === 'button') {
    const currentLang = (slotProps?.lang as Language) || 'zh';
    return (
      <>
        {extensions.map((ext) => {
          const tabValue = `plugin:${ext.pluginId}/${ext.id}`;
          const isActive = slotProps?.studentActiveTab === tabValue;
          const rawLabel = (ext as any).title || ext.label || ext.id;
          const label = resolveLabel(rawLabel, ext.pluginId, currentLang);
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
    return renderTabPanelContent(
      activeExt,
      {
        student: slotProps?.student,
        lessonId: slotProps?.lessonId,
        classId: slotProps?.classId,
        lang: slotProps?.lang,
        progressHistory: slotProps?.progressHistory,
      },
      '学生画像扩展 Tab 加载失败',
    );
  }

  // teacher.tab with renderType 'button' — render NavButton-style buttons
  // directly from extension metadata, bypassing plugin components entirely.
  // This guarantees pixel-perfect styling consistency with system NavButton.
  if (slot === 'teacher.tab' && slotProps?.renderType === 'button') {
    const sortedExtensions = [...extensions].sort((a, b) => (a.position ?? 100) - (b.position ?? 100));
    const lang: 'zh' | 'en' = (slotProps?.lang as 'zh' | 'en') ?? 'zh';
    const t = translations[lang];
    return (
      <>
        {sortedExtensions.map((ext) => {
          const tabValue = `${ext.pluginId}/${ext.id}`;
          const isActive = slotProps?.teacherTab === tabValue;
          const rawLabel = (ext as any).title || ext.label || ext.id;
          const label = resolveLabel(rawLabel, ext.pluginId, lang);
          const pluginInfo = activePlugins.find((p) => p.id === ext.pluginId);
          const icon = ext.icon || pluginInfo?.icon;
          // v0.7.0：插件前端出错时给 Tab 一个轻量视觉标记（不改文案，避免
          // 影响依赖标签文本的断言）；详细错误与重试在面板区。
          const hasError = pluginErrors.has(ext.pluginId);
          const ariaNewTab = lang === 'zh' ? `在新标签页打开"${label}"` : `Open "${label}" in a new tab`;
          const sanitizedId = tabValue.replace(/[^a-zA-Z0-9_-]/g, '_');
          return (
            <div
              key={`${ext.pluginId}/${ext.id}`}
              className={`group relative flex items-center rounded-xl transition-all duration-150 ${
                isActive
                  ? 'bg-primary-theme-light text-primary-theme font-bold border border-primary-theme/25 shadow-3xs'
                  : 'border border-transparent text-muted hover:bg-surface-secondary hover:text-main'
              } ${hasError ? 'ring-1 ring-amber-400/70' : ''} ${slotProps?.mainNavCollapsed ? 'justify-center' : ''}`}
              title={label}
            >
              <button
                type="button"
                onClick={() => slotProps?.setTeacherTab?.(tabValue)}
                id={`nav_btn_${sanitizedId}`}
                className={`flex items-center gap-2.5 py-2 flex-1 min-w-0 text-sm font-medium focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-theme/50 rounded-lg ${
                  isActive ? 'font-bold' : ''
                } ${slotProps?.mainNavCollapsed ? 'justify-center px-2' : 'pl-2.5 pr-8'}`}
              >
                <PluginIconRenderer icon={icon} size={18} className="shrink-0" alt={label} />
                <span className={slotProps?.mainNavCollapsed ? 'hidden' : 'block truncate'}>{label}</span>
              </button>
              {!slotProps?.mainNavCollapsed && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openTeacherTabInNewTab(tabValue);
                  }}
                  id={`nav_btn_${sanitizedId}_newtab`}
                  aria-label={ariaNewTab}
                  title={t.openInNewTab}
                  data-testid={`nav_newtab_${sanitizedId}`}
                  className="absolute right-1.5 p-1 rounded-md opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/10 dark:hover:bg-white/15 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-theme/50 transition-opacity text-current"
                >
                  <ExternalLink size={12} className="shrink-0" />
                </button>
              )}
            </div>
          );
        })}
      </>
    );
  }

  // whiteboard.renderer — renders custom graphical object component matching elementType
  if (slot === 'whiteboard.renderer') {
    const targetType = slotProps?.elementType;
    if (!targetType) return null;
    const activeExt = extensions.find((ext) => {
      const et = ext as any;
      return (
        et.targetType === targetType ||
        ext.id === targetType ||
        ext.route === targetType ||
        `${ext.pluginId}/${ext.id}` === targetType ||
        et.slotProps?.elementType === targetType ||
        et.slotProps?.targetType === targetType
      );
    });
    if (!activeExt) return null;

    // v0.7.0：显式错误态优先（与其他渲染路径一致）
    const rendererError = pluginErrors.get(activeExt.pluginId);
    if (rendererError) {
      return <PluginErrorState pluginId={activeExt.pluginId} message={rendererError} compact />;
    }
    if (isPluginBlown(activeExt.pluginId)) {
      if (!warnedPluginsRef.current.has(activeExt.pluginId)) {
        warnedPluginsRef.current.add(activeExt.pluginId);
        console.warn(
          `[ExtensionBreaker] Plugin "${activeExt.pluginId}" 已熔断（连续崩溃 ≥3 次），跳过渲染。重新激活插件可恢复。`,
        );
      }
      return (
        <PluginErrorState
          pluginId={activeExt.pluginId}
          message={
            lang === 'en'
              ? 'The plugin frontend crashed repeatedly and was suspended.'
              : '插件前端连续崩溃，已自动降级。'
          }
          lang={lang === 'en' ? 'en' : 'zh'}
          compact
        />
      );
    }

    const isReact = typeof activeExt.component === 'function';
    const isDOM = typeof (activeExt as any).render === 'function';
    if (!isReact && !isDOM) return null;

    return (
      <ExtensionErrorBoundary
        key={`${activeExt.pluginId}/${activeExt.id}`}
        pluginId={activeExt.pluginId}
        onBreakerTrip={(pid) => handleBreakerTrip(pid, host)}
        fallback={
          fallback ?? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-600 flex items-center justify-center">
              <span>{lang === 'zh' ? '自定义图元加载失败' : 'Custom object failed to load'}</span>
            </div>
          )
        }
      >
        <Suspense fallback={fallback ?? <LoadingSkeleton />}>
          <CrashResetProbe pluginId={activeExt.pluginId}>
            {isReact ? (
              React.createElement(resolveExtensionComponent(activeExt), {
                ...activeExt.slotProps,
                ...slotProps,
                dispatcher: getExtensionDispatcher(host, activeExt.pluginId, slotProps?.dispatcher),
              })
            ) : (
              <DOMExtensionWrapper
                ext={activeExt}
                route={activeExt.route || route}
                slotProps={{
                  ...activeExt.slotProps,
                  ...slotProps,
                  dispatcher: getExtensionDispatcher(host, activeExt.pluginId, slotProps?.dispatcher),
                }}
                slot={slot}
              />
            )}
          </CrashResetProbe>
        </Suspense>
      </ExtensionErrorBoundary>
    );
  }

  return (
    <>
      {extensions.map((ext) => {
        const isReact = typeof ext.component === 'function' && ext.component !== NullExtensionComponent;
        const isDOM = typeof ext.render === 'function';
        const hasView = Boolean(ext.slotProps?.view || ext.view);
        if (slot === 'teacher.dashboard.widget' && visibility.get(ext.pluginId) === false) return null;
        if (!isReact && !isDOM && !hasView) return null;

        // v0.7.0：显式错误态优先 —— 插件前端失败/被熔断时给出「错误 + 重试」
        const extError = pluginErrors.get(ext.pluginId);
        if (extError) {
          return <PluginErrorState key={`${ext.pluginId}/${ext.id}`} pluginId={ext.pluginId} message={extError} />;
        }
        if (isPluginBlown(ext.pluginId)) {
          if (!warnedPluginsRef.current.has(ext.pluginId)) {
            warnedPluginsRef.current.add(ext.pluginId);
            console.warn(
              `[ExtensionBreaker] Plugin "${ext.pluginId}" 已熔断（连续崩溃 ≥3 次），跳过渲染。重新激活插件可恢复。`,
            );
          }
          return (
            <PluginErrorState
              key={`${ext.pluginId}/${ext.id}`}
              pluginId={ext.pluginId}
              message={
                lang === 'en'
                  ? 'The plugin frontend crashed repeatedly and was suspended.'
                  : '插件前端连续崩溃，已自动降级。'
              }
              lang={lang === 'en' ? 'en' : 'zh'}
            />
          );
        }
        return (
          <ExtensionErrorBoundary
            key={`${ext.pluginId}/${ext.id}`}
            pluginId={ext.pluginId}
            onBreakerTrip={(pid) => handleBreakerTrip(pid, host)}
            fallback={
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
                <p>{lang === 'zh' ? '扩展组件加载失败' : 'Extension failed to load'}</p>
              </div>
            }
          >
            <Suspense fallback={fallback ?? <LoadingSkeleton />}>
              <CrashResetProbe pluginId={ext.pluginId}>
                {isReact ? (
                  React.createElement(resolveExtensionComponent(ext), {
                    route: ext.route || route,
                    lessonId: selectedLesson,
                    classId: liveClassSelectedClassId,
                    dispatcher: getExtensionDispatcher(host, ext.pluginId, slotProps?.dispatcher),
                    ...ext.slotProps,
                    ...slotProps,
                  })
                ) : isDOM ? (
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
                ) : (
                  <PluginSandboxIframeView
                    pluginId={ext.pluginId}
                    view={String(ext.slotProps?.view || ext.view)}
                    label={ext.label}
                    slot={slot}
                    lessonId={selectedLesson}
                    classId={liveClassSelectedClassId}
                  />
                )}
              </CrashResetProbe>
            </Suspense>
          </ExtensionErrorBoundary>
        );
      })}
    </>
  );
}
