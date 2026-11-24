/**
 * Mode Pack 与学生平行学案页的运行时开关。
 *
 * 全局开关的唯一来源是设置（`GET /api/feature-flags`，管理员在「站点信息设置 → 运行时策略」写入）。
 * 未拉到设置、或设置未配置时：Mode Pack 关闭，平行学案页隐藏。
 * 当前课的交付模式是学案时，本课始终走 Mode Pack，不依赖这个全局开关；
 * 当前课绑定了非内置模式包（第三方插件贡献）时同样自动启用。
 * 单测用 `setModePacksEnabledForTests` / `setModePackShowXueanTabForTests` 覆盖，优先于课程模式和设置。
 */
import { useSyncExternalStore } from 'react';
import {
  isXueanDeliveryMode,
  resolveLessonModePackDeliveryMode,
} from '../../../../packages/core/plugin-host/course-delivery-mode';
import { BUILTIN_WHITEBOARD_MODE_PACK_ID } from '../../../../packages/core/plugin-host/mode-pack';

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
let activeDeliveryMode: unknown = null;
let activeModePackId: string | null = null;
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

/** 由应用根在渲染时写入当前课的模式（`mode_pack_id` 优先，其次 `delivery_mode`）。 */
export function setActiveCourseDeliveryMode(mode: unknown, modePackId?: unknown): void {
  // 两者都为空 = 没选中任何课，保留 null 语义（测试与旧调用方依赖）。
  const rawPackId = typeof modePackId === 'string' && modePackId.trim() ? modePackId.trim() : null;
  const next = mode == null && rawPackId == null ? null : resolveLessonModePackDeliveryMode(rawPackId, mode);
  if (next === activeDeliveryMode && rawPackId === activeModePackId) return;
  activeDeliveryMode = next;
  activeModePackId = rawPackId;
  emit();
}

export function getActiveCourseDeliveryMode(): unknown {
  return activeDeliveryMode;
}

/** 当前课绑定的模式包 id；未绑定或旧课为 null。 */
export function getActiveModePackId(): string | null {
  return activeModePackId;
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
  activeDeliveryMode = null;
  activeModePackId = null;
  emit();
}

export function isModePacksEnabled(): boolean {
  if (modePackTestOverride !== null) return modePackTestOverride;
  // 非内置包（第三方插件）没有旧白板页面可回落，绑定即启用；内置白板仍受全局开关控制。
  if (activeModePackId && activeModePackId !== BUILTIN_WHITEBOARD_MODE_PACK_ID) return true;
  if (isXueanDeliveryMode(activeDeliveryMode)) return true;
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
