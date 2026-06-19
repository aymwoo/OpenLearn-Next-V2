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
import { Loader2 } from 'lucide-react';
import { usePluginHost } from './plugin-host-context';
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
class ExtensionErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
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
  /** The extension slot to render (e.g. 'teacher.tab', 'student.view') */
  slot: ExtensionSlot | string;
  /** Optional custom fallback shown during loading (replaces LoadingSkeleton) */
  fallback?: React.ReactNode;
  /** Optional language code for internationalized error messages */
  lang?: string;
}

/**
 * Renders all registered extension point components for a given slot.
 *
 * Each extension point is rendered via React.lazy inside a Suspense boundary
 * with a LoadingSkeleton fallback, wrapped in an individual ErrorBoundary.
 *
 * Returns null if no extensions are registered for the slot.
 */
export function ExtensionPointRenderer({
  slot,
  fallback,
  lang,
}: ExtensionPointRendererProps) {
  const host = usePluginHost();
  const extensions = host.getExtensions(slot);

  if (extensions.length === 0) return null;

  return (
    <>
      {extensions.map((ext) => (
        <ExtensionErrorBoundary
          key={ext.id}
          fallback={
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
              <p>
                {lang === 'zh'
                  ? '扩展组件加载失败'
                  : 'Extension failed to load'}
              </p>
            </div>
          }
        >
          <Suspense fallback={fallback ?? <LoadingSkeleton />}>
            {React.createElement(React.lazy(ext.component))}
          </Suspense>
        </ExtensionErrorBoundary>
      ))}
    </>
  );
}
