/**
 * MfeLoadingFallback — Centered spinner shown while remote module is loading.
 *
 * D-15: Loading state displays a centered spinner animation.
 * Per UI-SPEC "Loading State" section:
 *   - Loader2 icon (size 24, text-indigo-600, animate-spin)
 *   - Optional label (hardcoded inline per lang prop, no new i18n keys)
 *   - Centered flex column layout, p-12 vertical padding
 *   - role="status" for accessibility
 *
 * Usage:
 *   <MfeLoadingFallback lang="zh" />
 *   <MfeLoadingFallback className="h-64" />
 */

import React from 'react';
import { Loader2 } from 'lucide-react';
import type { Language } from '../i18n';

export interface MfeLoadingFallbackProps {
  /** Optional className override for custom sizing */
  className?: string;
  /** Language for loading text. Default: 'zh'. */
  lang?: Language;
}

/**
 * Default loading spinner for MFE loading state.
 *
 * Shows a centered indigo spinner with optional text label.
 * Accepts className prop for dimension/flex overrides.
 */
export default function MfeLoadingFallback({
  className,
  lang = 'zh',
}: MfeLoadingFallbackProps) {
  const loadingText =
    lang === 'en'
      ? 'Loading remote component...'
      : '正在加载远程组件...';

  return (
    <div
      className={`flex flex-col items-center justify-center p-12 ${className ?? ''}`}
      role="status"
      aria-label="Loading remote component"
    >
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={24} className="text-indigo-600 animate-spin" />
        <span className="text-sm text-gray-500 font-medium">
          {loadingText}
        </span>
      </div>
    </div>
  );
}
