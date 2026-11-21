import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { CONTRIBUTES_SLOT_KEYS } from '../../esm-loader/manifest-schema.js';
import {
  ALL_EXTENSION_POINTS,
  assertExtensionPointsAligned,
  assertSlotExists,
  getUnknownExtensionSlots,
  isExtensionPointId,
  resolveExtensionSlotMode,
} from '../extension-points.js';

const ALL_SLOTS = Object.keys(ALL_EXTENSION_POINTS);

describe('extension point alignment (Phase 1.4 / 2.0)', () => {
  beforeEach(() => {
    delete process.env.OPENLEARN_EXTENSION_STRICT_SLOTS;
    assertExtensionPointsAligned([], CONTRIBUTES_SLOT_KEYS, 'lenient');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ALL_EXTENSION_POINTS 与 manifest schema 的 slot 键完全一致（排除 locales）', () => {
    const canonical = [...ALL_SLOTS].sort();
    const manifest = CONTRIBUTES_SLOT_KEYS.filter((key) => key !== 'locales').sort();
    expect(canonical).toEqual(manifest);
  });

  it('registry 与 manifest 对齐时通过', () => {
    expect(() => assertExtensionPointsAligned(ALL_SLOTS, CONTRIBUTES_SLOT_KEYS, 'strict')).not.toThrow();
  });

  it('默认模式为 warn', () => {
    expect(resolveExtensionSlotMode()).toBe('warn');
  });

  it('strict：未知 slot 抛错（保持 Phase 1 行为）', () => {
    expect(() => assertExtensionPointsAligned(['not.a.slot'], CONTRIBUTES_SLOT_KEYS, 'strict')).toThrow(
      /registry 注册了未知 slot: not\.a\.slot/,
    );
  });

  it('warn：未知 slot 不抛错，返回 unknown 并记录供健康接口读取', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = assertExtensionPointsAligned(['not.a.slot'], CONTRIBUTES_SLOT_KEYS, 'warn');

    expect(result).toEqual({ ok: true, unknown: ['not.a.slot'] });
    expect(getUnknownExtensionSlots()).toEqual(['not.a.slot']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not.a.slot'));
  });

  it('lenient：未知 slot 静默忽略', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = assertExtensionPointsAligned(['not.a.slot'], CONTRIBUTES_SLOT_KEYS, 'lenient');

    expect(result).toEqual({ ok: true, unknown: [] });
    expect(getUnknownExtensionSlots()).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('manifest 自身缺失 slot 时，任何 mode 都 fail-fast', () => {
    const missing = CONTRIBUTES_SLOT_KEYS.filter((key) => key !== 'classroom.tool');
    expect(() => assertExtensionPointsAligned([], missing, 'lenient')).toThrow(/manifest 缺少 slot: classroom\.tool/);
  });

  it('isExtensionPointId 只认 canonical 名单', () => {
    expect(isExtensionPointId('teacher.tab')).toBe(true);
    expect(isExtensionPointId('not.a.slot')).toBe(false);
  });

  it('assertSlotExists：已知 slot 通过，未知 slot 在 warn 下只告警', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(assertSlotExists('teacher.tab')).toBe(true);
    expect(assertSlotExists('anchor:whiteboard-toolbar:rollcall')).toBe(true);
    expect(assertSlotExists('not.a.slot')).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not.a.slot'));
  });

  it('assertSlotExists：strict 下拒绝未知 slot', () => {
    process.env.OPENLEARN_EXTENSION_STRICT_SLOTS = 'strict';
    try {
      expect(() => assertSlotExists('not.a.slot')).toThrow(/未知 slot/);
    } finally {
      delete process.env.OPENLEARN_EXTENSION_STRICT_SLOTS;
    }
  });

  it('assertSlotExists：lenient 下静默返回 false', () => {
    process.env.OPENLEARN_EXTENSION_STRICT_SLOTS = 'lenient';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(assertSlotExists('not.a.slot')).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      delete process.env.OPENLEARN_EXTENSION_STRICT_SLOTS;
    }
  });
});
