/**
 * Mode Pack 与学生平行学案页的运行时开关。
 *
 * 设置是唯一来源（`GET /api/feature-flags`，由管理员在「站点信息设置 → 运行时策略」写入）。
 * 未拉到设置、或设置未配置时：Mode Pack 关闭，平行学案页隐藏（与原先未设置构建期/调试旗标时一致）。
 * 单测用 `setModePacksEnabledForTests` / `setModePackShowXueanTabForTests` 覆盖。
 */
import { useSyncExternalStore } from 'react';

export interface ClientFeatureFlags {
  modePacksEnabled: boolean;
  modePackShowXueanTab: boolean;
}

const DEFAULT_FLAGS: ClientFeatureFlags = {
  modePacksEnabled: false,
  modePackShowXueanTab: false,
};

let current: ClientFeatureFlags = { ...DEFAULT_FLAGS };
let revision = 0;
let modePackTestOverride: boolean | null = null;
let xueanTabTestOverride: boolean | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  revision += 1;
  listeners.forEach((listener) => listener());
}

export function subscribeClientFeatureFlags(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getClientFeatureFlagVersion(): number {
  return revision;
}

/** 仅测试使用：覆盖 Mode Pack；传 null 清除。 */
export function setModePacksEnabledForTests(value: boolean | null): void {
  modePackTestOverride = value;
  emit();
}

/** 仅测试使用：覆盖「Mode Pack 开启时显示平行学案页」；传 null 清除。 */
export function setModePackShowXueanTabForTests(value: boolean | null): void {
  xueanTabTestOverride = value;
  emit();
}

export function resetClientFeatureFlagsForTests(): void {
  current = { ...DEFAULT_FLAGS };
  modePackTestOverride = null;
  xueanTabTestOverride = null;
  emit();
}

export function isModePacksEnabled(): boolean {
  if (modePackTestOverride !== null) return modePackTestOverride;
  return current.modePacksEnabled;
}

export function isModePackShowXueanTab(): boolean {
  if (xueanTabTestOverride !== null) return xueanTabTestOverride;
  return current.modePackShowXueanTab;
}

export function applyClientFeatureFlags(flags: Partial<ClientFeatureFlags>): void {
  const next: ClientFeatureFlags = {
    modePacksEnabled: flags.modePacksEnabled === true,
    modePackShowXueanTab: flags.modePackShowXueanTab === true,
  };
  if (
    next.modePacksEnabled === current.modePacksEnabled &&
    next.modePackShowXueanTab === current.modePackShowXueanTab
  ) {
    return;
  }
  current = next;
  emit();
}

export async function refreshClientFeatureFlags(): Promise<void> {
  if (typeof fetch !== 'function') return;
  try {
    const res = await fetch('/api/feature-flags');
    if (!res?.ok) return;
    const body = (await res.json()) as Partial<ClientFeatureFlags> | null;
    if (!body || typeof body !== 'object') return;
    applyClientFeatureFlags({
      modePacksEnabled: body.modePacksEnabled === true,
      modePackShowXueanTab: body.modePackShowXueanTab === true,
    });
  } catch {
    // 保留上一次成功值；首次失败维持默认关闭。
  }
}

export function useModePacksEnabled(): boolean {
  useSyncExternalStore(subscribeClientFeatureFlags, getClientFeatureFlagVersion, getClientFeatureFlagVersion);
  return isModePacksEnabled();
}

export function useModePackShowXueanTab(): boolean {
  useSyncExternalStore(subscribeClientFeatureFlags, getClientFeatureFlagVersion, getClientFeatureFlagVersion);
  return isModePackShowXueanTab();
}
