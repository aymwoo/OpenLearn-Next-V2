/**
 * LegacyPluginBadge — amber badge for legacy-format plugins.
 *
 * D-12: Old-format plugins marked execution_mode = 'legacy' show a yellow
 *       "migratable" badge in the plugin center UI.
 *
 * Visual (per UI-SPEC):
 *   Inline flex badge with amber background/border/icon:
 *   bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold
 *   px-2 py-1 rounded uppercase tracking-wider
 *   AlertTriangle icon (size 10) from lucide-react
 *
 * States:
 *   Visible — when plugin.execution_mode === 'legacy'
 *   Hidden  — badge not rendered (caller conditional)
 */

import { AlertTriangle } from 'lucide-react';

export interface LegacyPluginBadgeProps {
  /** Language code for tooltip text */
  lang?: 'zh' | 'en';
}

export function LegacyPluginBadge({ lang }: LegacyPluginBadgeProps) {
  return (
    <span
      className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold px-2 py-1 rounded uppercase tracking-wider"
      title={
        lang === 'zh'
          ? '该插件使用旧执行格式运行。新格式版本可能可用。'
          : 'This plugin uses the old execution format. A new-format version may be available.'
      }
    >
      <AlertTriangle size={10} />
      {lang === 'zh' ? '可迁移' : 'Migratable'}
    </span>
  );
}
