/**
 * Mode Pack 灰度开关（P0）。
 *
 * 默认关闭 → 宿主走既有白板中栏 / 学生平行 tab，行为与 main 一致。
 * 开启方式（任一即可）：
 *   - 构建期：`VITE_OPENLEARN_MODE_PACKS=1`
 *   - 运行时：`window.__OPENLEARN_MODE_PACKS__ = true`（调试）
 *   - 单测：`setModePacksEnabledForTests(true)`
 */

declare global {
  interface Window {
    __OPENLEARN_MODE_PACKS__?: boolean;
  }
}

let testOverride: boolean | null = null;

/** 仅测试使用：覆盖开关；传 null 清除。 */
export function setModePacksEnabledForTests(value: boolean | null): void {
  testOverride = value;
}

export function isModePacksEnabled(): boolean {
  if (testOverride !== null) return testOverride;

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
