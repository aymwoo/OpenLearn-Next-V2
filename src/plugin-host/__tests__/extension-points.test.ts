/**
 * Tests for ExtensionPointRegistry.
 *
 * Covers:
 * - register: adds config to slot, sorted by position
 * - Dedup: throws on duplicate id for same slot (T-09-04, Pitfall 3)
 * - getExtensions: returns sorted configs, empty array for unknown slot
 * - unregister: removes by slot+id, no-op for missing id
 * - unregisterByPlugin: removes all configs for a given pluginId across slots
 * - dispose: clears all slots
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExtensionPointRegistry } from '../extension-points';
import type { ExtensionPointConfig } from '../types';

function makeConfig(
  id: string,
  pluginId: string = 'test-plugin',
  position?: number,
): ExtensionPointConfig {
  return {
    id,
    label: `Extension ${id}`,
    component: () => Promise.resolve({ default: (() => null) as any }),
    pluginId,
    position,
  };
}

describe('ExtensionPointRegistry', () => {
  let registry: ExtensionPointRegistry;

  beforeEach(() => {
    registry = new ExtensionPointRegistry();
  });

  // ── register ──────────────────────────────────────────────────────────────

  it('register adds config to a slot', () => {
    registry.register('teacher.tab', makeConfig('ext-1'));
    const exts = registry.getExtensions('teacher.tab');
    expect(exts).toHaveLength(1);
    expect(exts[0].id).toBe('ext-1');
  });

  it('register sorts configs by position (ascending, default 100)', () => {
    registry.register('teacher.tab', makeConfig('ext-a', 'p1', 200));
    registry.register('teacher.tab', makeConfig('ext-b', 'p2', 10));
    registry.register('teacher.tab', makeConfig('ext-c', 'p3', 50));

    const exts = registry.getExtensions('teacher.tab');
    expect(exts).toHaveLength(3);
    expect(exts[0].id).toBe('ext-b'); // position 10
    expect(exts[1].id).toBe('ext-c'); // position 50
    expect(exts[2].id).toBe('ext-a'); // position 200
  });

  it('register throws on duplicate id for the same slot', () => {
    registry.register('teacher.tab', makeConfig('ext-1'));

    expect(() => {
      registry.register('teacher.tab', makeConfig('ext-1'));
    }).toThrow(/already registered.*teacher\.tab.*ext-1/);
  });

  it('register allows same id in different slots', () => {
    registry.register('teacher.tab', makeConfig('ext-1'));
    expect(() => {
      registry.register('student.view', makeConfig('ext-1'));
    }).not.toThrow();

    expect(registry.getExtensions('teacher.tab')).toHaveLength(1);
    expect(registry.getExtensions('student.view')).toHaveLength(1);
  });

  // ── getExtensions ─────────────────────────────────────────────────────────

  it('getExtensions returns empty array for unknown slot', () => {
    expect(registry.getExtensions('teacher.tab')).toEqual([]);
  });

  it('getExtensions returns empty array for slot with no registrations', () => {
    expect(registry.getExtensions('classroom.tool')).toEqual([]);
  });

  it('getExtensions returns configs in insertion+sort order', () => {
    registry.register('classroom.tool', makeConfig('tool-a', 'p1', 50));
    registry.register('classroom.tool', makeConfig('tool-b', 'p2'));

    const exts = registry.getExtensions('classroom.tool');
    expect(exts).toHaveLength(2);
    // tool-b has default position 100, tool-a has 50
    expect(exts[0].id).toBe('tool-a');
    expect(exts[1].id).toBe('tool-b');
  });

  // ── unregister ────────────────────────────────────────────────────────────

  it('unregister removes extension by slot and id', () => {
    registry.register('teacher.tab', makeConfig('ext-1'));
    registry.register('teacher.tab', makeConfig('ext-2'));

    registry.unregister('teacher.tab', 'ext-1');
    const exts = registry.getExtensions('teacher.tab');
    expect(exts).toHaveLength(1);
    expect(exts[0].id).toBe('ext-2');
  });

  it('unregister is no-op for unknown id', () => {
    registry.register('teacher.tab', makeConfig('ext-1'));
    registry.unregister('teacher.tab', 'nonexistent');

    expect(registry.getExtensions('teacher.tab')).toHaveLength(1);
  });

  it('unregister is no-op for unknown slot', () => {
    expect(() => {
      registry.unregister('unknown.slot', 'ext-1');
    }).not.toThrow();
  });

  it('unregister deletes slot when last extension removed', () => {
    registry.register('teacher.tab', makeConfig('ext-1'));
    registry.unregister('teacher.tab', 'ext-1');

    // Should be empty, but the slot key may still exist internally
    expect(registry.getExtensions('teacher.tab')).toEqual([]);
  });

  // ── unregisterByPlugin ────────────────────────────────────────────────────

  it('unregisterByPlugin removes all extensions for a plugin across slots', () => {
    registry.register('teacher.tab', makeConfig('ext-1', 'plugin-a'));
    registry.register('teacher.tab', makeConfig('ext-2', 'plugin-b'));
    registry.register('classroom.tool', makeConfig('tool-1', 'plugin-a'));
    registry.register('student.view', makeConfig('view-1', 'plugin-c'));

    registry.unregisterByPlugin('plugin-a');

    expect(registry.getExtensions('teacher.tab')).toHaveLength(1);
    expect(registry.getExtensions('teacher.tab')[0].id).toBe('ext-2');
    expect(registry.getExtensions('classroom.tool')).toEqual([]);
    expect(registry.getExtensions('student.view')).toHaveLength(1);
  });

  it('unregisterByPlugin is no-op when plugin has no extensions', () => {
    registry.register('teacher.tab', makeConfig('ext-1', 'plugin-a'));

    expect(() => {
      registry.unregisterByPlugin('nonexistent-plugin');
    }).not.toThrow();

    expect(registry.getExtensions('teacher.tab')).toHaveLength(1);
  });

  // ── dispose ───────────────────────────────────────────────────────────────

  it('dispose clears all slots', () => {
    registry.register('teacher.tab', makeConfig('ext-1'));
    registry.register('classroom.tool', makeConfig('tool-1'));
    registry.register('student.view', makeConfig('view-1'));

    registry.dispose();

    expect(registry.getExtensions('teacher.tab')).toEqual([]);
    expect(registry.getExtensions('classroom.tool')).toEqual([]);
    expect(registry.getExtensions('student.view')).toEqual([]);
  });

  it('dispose allows re-registration after clear', () => {
    registry.register('teacher.tab', makeConfig('ext-1'));
    registry.dispose();

    registry.register('teacher.tab', makeConfig('ext-2'));
    expect(registry.getExtensions('teacher.tab')).toHaveLength(1);
    expect(registry.getExtensions('teacher.tab')[0].id).toBe('ext-2');
  });
});
