// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyClientFeatureFlags,
  getActiveModePackId,
  isModePackShowXueanTab,
  isModePacksEnabled,
  refreshClientFeatureFlags,
  resetClientFeatureFlagsForTests,
  setActiveCourseDeliveryMode,
  setModePackShowXueanTabForTests,
  setModePacksEnabledForTests,
} from '../flags';
import {
  BUILTIN_WHITEBOARD_MODE_PACK_ID,
  BUILTIN_XUEAN_MODE_PACK_ID,
} from '../../../../../packages/core/plugin-host/mode-pack';

afterEach(() => {
  resetClientFeatureFlagsForTests();
  vi.unstubAllGlobals();
});

describe('Mode Pack 设置开关', () => {
  it('未配置时默认关闭，构建期变量和 window 旗标都不能打开', () => {
    (window as Window & { __OPENLEARN_MODE_PACKS__?: boolean }).__OPENLEARN_MODE_PACKS__ = true;
    (window as Window & { __OPENLEARN_DEBUG_XUEAN_TAB__?: boolean }).__OPENLEARN_DEBUG_XUEAN_TAB__ = true;
    expect(isModePacksEnabled()).toBe(false);
    expect(isModePackShowXueanTab()).toBe(false);
  });

  it('只接受运行时设置，测试覆盖优先', () => {
    applyClientFeatureFlags({ modePacksEnabled: true, modePackShowXueanTab: true });
    expect(isModePacksEnabled()).toBe(true);
    expect(isModePackShowXueanTab()).toBe(true);
    setModePacksEnabledForTests(false);
    setModePackShowXueanTabForTests(false);
    expect(isModePacksEnabled()).toBe(false);
    expect(isModePackShowXueanTab()).toBe(false);
  });

  it('刷新时读取 /api/feature-flags，失败则保持默认关闭', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ modePacksEnabled: true, modePackShowXueanTab: false }),
      })),
    );
    await refreshClientFeatureFlags();
    expect(isModePacksEnabled()).toBe(true);
    expect(isModePackShowXueanTab()).toBe(false);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    await refreshClientFeatureFlags();
    expect(isModePacksEnabled()).toBe(true);
  });

  it('绑定非内置模式包时自动启用，内置白板仍受全局开关控制', () => {
    // 全局开关关闭：内置白板包不启用
    setActiveCourseDeliveryMode('whiteboard', BUILTIN_WHITEBOARD_MODE_PACK_ID);
    expect(getActiveModePackId()).toBe(BUILTIN_WHITEBOARD_MODE_PACK_ID);
    expect(isModePacksEnabled()).toBe(false);

    // 内置学案包沿用既有行为
    setActiveCourseDeliveryMode('xuean', BUILTIN_XUEAN_MODE_PACK_ID);
    expect(isModePacksEnabled()).toBe(true);

    // 第三方包：无旧页面可回落，绑定即启用
    setActiveCourseDeliveryMode('whiteboard', 'ext-lab:mode-inquiry');
    expect(getActiveModePackId()).toBe('ext-lab:mode-inquiry');
    expect(isModePacksEnabled()).toBe(true);

    // 清空当前课
    setActiveCourseDeliveryMode(null);
    expect(getActiveModePackId()).toBeNull();
    expect(isModePacksEnabled()).toBe(false);
  });
});
