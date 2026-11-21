import { describe, it, expect } from 'vitest';
import { CONTRIBUTES_SLOT_KEYS } from '../../esm-loader/manifest-schema.js';
import { ALL_EXTENSION_POINTS, assertExtensionPointsAligned, isExtensionPointId } from '../extension-points.js';

describe('extension point alignment (Phase 1.4)', () => {
  it('ALL_EXTENSION_POINTS 与 manifest schema 的 slot 键完全一致（排除 locales）', () => {
    const canonical = Object.keys(ALL_EXTENSION_POINTS).sort();
    const manifest = CONTRIBUTES_SLOT_KEYS.filter((key) => key !== 'locales').sort();
    expect(canonical).toEqual(manifest);
  });

  it('registry 与 manifest 对齐时通过', () => {
    const slots = Object.keys(ALL_EXTENSION_POINTS);
    expect(() => assertExtensionPointsAligned(slots, CONTRIBUTES_SLOT_KEYS)).not.toThrow();
  });

  it('registry 出现未知 slot 时 fail-fast 并列出差异', () => {
    expect(() => assertExtensionPointsAligned(['not.a.slot'], CONTRIBUTES_SLOT_KEYS)).toThrow(
      /registry 注册了未知 slot: not\.a\.slot/,
    );
  });

  it('manifest 缺少 canonical slot 时 fail-fast', () => {
    const missing = CONTRIBUTES_SLOT_KEYS.filter((key) => key !== 'classroom.tool');
    expect(() => assertExtensionPointsAligned([], missing)).toThrow(/manifest 缺少 slot: classroom\.tool/);
  });

  it('isExtensionPointId 只认 canonical 名单', () => {
    expect(isExtensionPointId('teacher.tab')).toBe(true);
    expect(isExtensionPointId('not.a.slot')).toBe(false);
  });
});
