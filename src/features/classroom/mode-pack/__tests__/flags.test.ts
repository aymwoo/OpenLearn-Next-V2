// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyClientFeatureFlags,
  isModePackShowXueanTab,
  isModePacksEnabled,
  refreshClientFeatureFlags,
  resetClientFeatureFlagsForTests,
  setModePackShowXueanTabForTests,
  setModePacksEnabledForTests,
} from '../flags';

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
});
