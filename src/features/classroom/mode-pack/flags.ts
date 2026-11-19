/**
 * Mode Pack 引擎是否对该课生效。
 *
 * - 当前选中课程的交付模式是学案：始终走 Mode Pack（学案向导与学案课中），
 *   不依赖全局 `VITE_OPENLEARN_MODE_PACKS` / `window.__OPENLEARN_MODE_PACKS__`。
 * - 白板或未设置：仍看全局灰度开关。关闭时宿主走既有白板中栏。
 * - 单测：`setModePacksEnabledForTests` 优先于课程模式。
 */
import { isXueanDeliveryMode } from '../../../../packages/core/plugin-host/course-delivery-mode';

declare global {
  interface Window {
    __OPENLEARN_MODE_PACKS__?: boolean;
    /** P4：Mode Pack 开启时临时恢复学生平行学案 tab（调试） */
    __OPENLEARN_DEBUG_XUEAN_TAB__?: boolean;
  }
}

let testOverride: boolean | null = null;
let activeDeliveryMode: unknown = null;

/** 由应用根在渲染时写入当前课的 delivery_mode。传 null 表示没有选中课。 */
export function setActiveCourseDeliveryMode(mode: unknown): void {
  activeDeliveryMode = mode ?? null;
}

export function getActiveCourseDeliveryMode(): unknown {
  return activeDeliveryMode;
}

/** 仅测试使用：覆盖全局开关；传 null 清除。不影响课程模式，除非覆盖值非 null。 */
export function setModePacksEnabledForTests(value: boolean | null): void {
  testOverride = value;
}

function readGlobalModePackFlag(): boolean {
  if (typeof window !== 'undefined' && typeof window.__OPENLEARN_MODE_PACKS__ === 'boolean') {
    return window.__OPENLEARN_MODE_PACKS__;
  }

  try {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    const raw = env?.VITE_OPENLEARN_MODE_PACKS;
    return raw === '1' || raw === 'true';
  } catch {
    return false;
  }
}

export function isModePacksEnabled(): boolean {
  if (testOverride !== null) return testOverride;
  if (isXueanDeliveryMode(activeDeliveryMode)) return true;
  return readGlobalModePackFlag();
}
