/**
 * MfeErrorFallback — Error UI shown when remote module load fails or crashes.
 *
 * D-16: Error state shows XCircle icon, error heading, body, retry and dismiss buttons.
 * Per UI-SPEC "Error State" section:
 *   - XCircle icon (size 32, text-indigo-600, bg-indigo-50 circle)
 *   - Error heading using existing extensionLoadError i18n key
 *   - Error body (hardcoded inline per lang prop, no new i18n keys)
 *   - Timeout variant appends "(Loading timed out)" / "（加载超时）"
 *   - Retry button (bg-indigo-600 text-white) and Dismiss button (bg-white border)
 *   - role="alertdialog" with aria-labelledby for accessibility
 *
 * Usage:
 *   <MfeErrorFallback
 *     error={error}
 *     name="mfe_whiteboard"
 *     onRetry={() => ...}
 *     onDismiss={() => ...}
 *   />
 */

import React, { useId } from 'react';
import { XCircle } from 'lucide-react';
import { translations } from '../i18n';
import type { Language } from '../i18n';

export interface MfeErrorFallbackProps {
  /** The error that caused the load failure */
  error: Error;
  /** Name of the remote module that failed */
  name: string;
  /** Callback for retry button click */
  onRetry: () => void;
  /** Callback for dismiss button click */
  onDismiss: () => void;
  /** Language for error text. Default: 'zh'. */
  lang?: Language;
}

/**
 * Default error fallback for MFE load failure state.
 *
 * Shows error icon, heading, descriptive body, and retry/dismiss buttons.
 * Catches timeout errors and appends timeout indicator to body text.
 */
export default function MfeErrorFallback({
  error,
  name,
  onRetry,
  onDismiss,
  lang = 'zh',
}: MfeErrorFallbackProps) {
  const headingId = useId();
  const T = translations[lang];

  const errorBodyText =
    lang === 'en'
      ? 'An error occurred while loading a remote component. Check your connection and try again.'
      : '远程组件加载过程中出现错误。请检查网络连接后重试。';

  // Append timeout indicator per UI-SPEC when error.message contains "timeout"
  const isTimeout =
    typeof error.message === 'string' &&
    error.message.toLowerCase().includes('timeout');

  const displayText = isTimeout
    ? lang === 'en'
      ? `${errorBodyText} (Loading timed out)`
      : `${errorBodyText}（加载超时）`
    : errorBodyText;

  return (
    <div
      className="flex flex-col items-center justify-center p-8"
      role="alertdialog"
      aria-labelledby={headingId}
    >
      <div className="flex flex-col items-center gap-4 max-w-md text-center">
        {/* Error icon */}
        <div className="bg-indigo-50 rounded-full p-3">
          <XCircle size={32} className="text-indigo-600" aria-hidden="true" />
        </div>

        {/* Error heading */}
        <p
          id={headingId}
          className="text-base font-semibold text-gray-800"
          role="alert"
        >
          {T.extensionLoadError}
        </p>

        {/* Error body */}
        <p className="text-sm text-gray-500 leading-5">
          {displayText}
        </p>

        {/* Buttons */}
        <div className="flex items-center gap-3 mt-1">
          <button
            onClick={onRetry}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold tracking-wide shadow-sm hover:bg-indigo-700 hover:shadow-md transition-all"
            aria-label="Retry loading remote component"
          >
            {T.retry}
          </button>
          <button
            onClick={onDismiss}
            className="px-4 py-1.5 rounded-lg bg-white text-gray-600 text-xs font-semibold tracking-wide border border-gray-200 shadow-sm hover:text-gray-900 hover:border-gray-300 hover:shadow-md transition-all"
            aria-label="Dismiss error and show placeholder"
          >
            {lang === 'en' ? 'Dismiss' : '忽略'}
          </button>
        </div>
      </div>
    </div>
  );
}
