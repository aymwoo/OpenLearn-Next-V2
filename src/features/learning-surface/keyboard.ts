/**
 * LearningSurface 键盘与焦点约定（阶段 9.1）。
 *
 * 目标：同一页多个 Surface 各自独立——方向键只驱动「焦点所在」的 Surface；
 * 输入框 / contentEditable 内不抢键；白板内旧组件保持原有全局方向键行为。
 */

const NAVIGATION_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

/** 当前焦点是否在可编辑控件内（输入框、下拉、contentEditable、textbox 角色）。 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const element = target as HTMLElement;
  const tag = element.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (element.isContentEditable) return true;
  return Boolean(
    element.closest(
      '[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"]',
    ),
  );
}

export interface SurfaceShortcutInput {
  key: string;
  /** true = LearningSurface 内；false = 白板内旧组件（保持全局行为）。 */
  isSurface: boolean;
  /** Surface 的 hostId，对应容器上的 `data-surface-scope`。 */
  scopeId?: string | null;
  activeElement: Element | null;
}

/**
 * 是否应由本 Surface 处理该按键。
 *
 * - 非导航键一律返回 false；
 * - 输入目标一律不抢键；
 * - 非 Surface（白板旧组件）保持全局行为；
 * - Surface 必须要求焦点落在自己的 scope 容器内。
 */
export function shouldHandleSurfaceShortcut(input: SurfaceShortcutInput): boolean {
  if (!NAVIGATION_KEYS.has(input.key)) return false;
  if (isTypingTarget(input.activeElement)) return false;
  if (!input.isSurface) return true;

  const scopeId = input.scopeId?.trim();
  if (!scopeId || !input.activeElement) return false;
  const holder = input.activeElement.closest?.('[data-surface-scope]');
  return holder?.getAttribute('data-surface-scope') === scopeId;
}
