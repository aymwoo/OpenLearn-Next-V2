/**
 * Hash-based teacher tab routing.
 *
 * The teacher workspace uses hash-based routing (e.g. `#/courses`,
 * `#/openlearn-courseware-hub/courseware-hub-teacher-tab`) so the URL
 * survives page reload, works under any deployment base path, and
 * cooperates with the existing Express SPA fallback without a server-side
 * rewrite.
 *
 * `tabToHash` / `hashToTab` were originally defined inside `useSessionSlice.ts`;
 * they were extracted to this module so that other components — the
 * NavigationSidebar's "open in new tab" affordance, the plugin
 * extension-point renderer for `teacher.tab` slots — can use the same
 * canonical encoding.
 *
 * @see src/hooks/useSessionSlice.ts for the only call site that reflects
 *      state ↔ URL. Components that need to construct a URL for a tab
 *      (for example, opening it in a new tab) should use the helpers
 *      here instead of duplicating the encoding.
 */

/** Encode a teacher tab id into a URL hash fragment. */
export function tabToHash(tab: string): string {
  return '#/' + tab;
}

/**
 * 旧的「备课」路由已下线：课程编辑改为在「课程管理」页内展开。
 * 旧书签 / 历史 hash 仍可能带着这两个值，统一回落课程管理，避免重新打开已移除的备课页。
 */
const LEGACY_PREP_TABS = new Set(['lesson_editor', 'xuean_editor']);

/**
 * Decode a URL hash back to a teacher tab id.
 * Returns `null` if the hash is empty or just the root `/`.
 */
export function hashToTab(hash: string): string | null {
  const raw = hash.replace(/^#/, '');
  if (!raw || raw === '/') return null;
  const tab = raw.replace(/^\//, '');
  return LEGACY_PREP_TABS.has(tab) ? 'courses' : tab;
}

/**
 * Build the full in-page URL for a teacher tab, preserving the current
 * pathname and query string so deployments that mount the app under a
 * sub-path (`/lms/...`) and any active query params are not lost.
 */
export function buildTeacherTabUrl(tab: string): string {
  return window.location.pathname + window.location.search + tabToHash(tab);
}

/**
 * Open a teacher tab in a new browser tab.
 *
 * Uses `noopener,noreferrer` for security: the new tab cannot read
 * `window.opener` and no Referer header is sent. The source tab is
 * unaffected — we do not switch focus.
 *
 * This is used by the NavigationSidebar's "↗" affordance on every
 * built-in nav item and by the plugin `teacher.tab` renderer so users
 * can split the teacher workspace across multiple tabs (for example,
 * monitor a live class in one tab while editing course content in
 * another). The new tab boots into the requested tab because
 * `useSessionSlice` reads the hash on mount.
 */
export function openTeacherTabInNewTab(tab: string): void {
  const url = buildTeacherTabUrl(tab);
  window.open(url, '_blank', 'noopener,noreferrer');
}
