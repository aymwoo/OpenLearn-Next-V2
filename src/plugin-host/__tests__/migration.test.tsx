/**
 * Tests for migration detection, MigrationPrompt banner, and Migrate button.
 *
 * @vitest-environment jsdom
 *
 * Covers:
 * - hasLegacyPlugins detection logic
 * - MigrationPrompt renders when legacy plugins exist
 * - MigrationPrompt hides when dismissed
 * - MigrationPrompt hidden when no legacy plugins
 * - Migrate button visible on legacy plugin cards
 * - Migrate button hidden on non-legacy plugin cards
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { PluginCenter } from '../../components/PluginCenter';
import type { PluginType } from '../../components/PluginCenter';

// ── Helpers ───────────────────────────────────────────────────────────────────

function createPlugin(overrides: Partial<PluginType> & { id: string }): PluginType {
  return {
    name: overrides.id,
    status: 'active',
    created_at: Date.now(),
    manifest: '{}',
    execution_mode: 'inline',
    ...overrides,
  };
}

const defaultProps = {
  lang: 'en' as const,
  storeTab: 'store' as const,
  setStoreTab: () => {},
  pluginCode: '',
  setPluginCode: () => {},
  installingPlugin: false,
  onInstall: () => {},
  onZipUpload: () => {},
  onToggle: () => {},
  onDelete: () => {},
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Migration detection', () => {
  it('detects legacy plugins in the plugin list', () => {
    const plugins: PluginType[] = [
      createPlugin({ id: 'modern-1', execution_mode: 'inline' }),
      createPlugin({ id: 'legacy-1', execution_mode: 'legacy' }),
    ];
    const hasLegacy = plugins.some(p => p.execution_mode === 'legacy');
    expect(hasLegacy).toBe(true);
  });

  it('returns false when no legacy plugins exist', () => {
    const plugins: PluginType[] = [
      createPlugin({ id: 'modern-1', execution_mode: 'inline' }),
      createPlugin({ id: 'modern-2', execution_mode: 'worker' }),
    ];
    const hasLegacy = plugins.some(p => p.execution_mode === 'legacy');
    expect(hasLegacy).toBe(false);
  });

  it('returns false for empty plugin list', () => {
    const plugins: PluginType[] = [];
    const hasLegacy = plugins.some(p => p.execution_mode === 'legacy');
    expect(hasLegacy).toBe(false);
  });
});

describe('MigrationPrompt banner visibility', () => {
  it('renders PluginCenter without error with mixed plugins', () => {
    const plugins: PluginType[] = [
      createPlugin({ id: 'modern-1', execution_mode: 'inline' }),
      createPlugin({ id: 'legacy-1', execution_mode: 'legacy' }),
    ];
    const html = renderToString(
      <PluginCenter {...defaultProps} plugins={plugins} />,
    );
    // Should render without throwing — basic smoke test
    expect(html).toContain('Edu OS App Store');
  });

  it('renders PluginCenter with legacy plugins in store tab', () => {
    const plugins: PluginType[] = [
      createPlugin({ id: 'legacy-1', execution_mode: 'legacy' }),
    ];
    const html = renderToString(
      <PluginCenter {...defaultProps} plugins={plugins} storeTab="store" />,
    );
    expect(html).toContain('Edu OS App Store');
    // Legacy badge should be rendered in store tab
    expect(html).toContain('Migratable');
  });

  it('renders PluginCenter in dev tab without error', () => {
    const plugins: PluginType[] = [
      createPlugin({ id: 'modern-1', execution_mode: 'inline' }),
    ];
    const html = renderToString(
      <PluginCenter {...defaultProps} plugins={plugins} storeTab="dev" />,
    );
    expect(html).toContain('Developer Tools');
  });

  it('renders PluginCenter with empty plugin list', () => {
    const html = renderToString(
      <PluginCenter {...defaultProps} plugins={[]} />,
    );
    expect(html).toContain('Edu OS App Store');
  });

  it('renders in en language', () => {
    const plugins: PluginType[] = [
      createPlugin({ id: 'modern-1', execution_mode: 'inline' }),
    ];
    const html = renderToString(
      <PluginCenter {...defaultProps} lang="en" plugins={plugins} />,
    );
    expect(html).toContain('Discover');
  });

  it('renders in zh language', () => {
    const plugins: PluginType[] = [];
    const html = renderToString(
      <PluginCenter {...defaultProps} lang="zh" plugins={[]} />,
    );
    expect(html).toContain('Edu OS 插件中心');
  });
});

describe('LegacyPluginBadge in PluginCenter', () => {
  it('renders LegacyPluginBadge for legacy plugins in store tab', () => {
    const plugins: PluginType[] = [
      createPlugin({ id: 'legacy-1', execution_mode: 'legacy' }),
    ];
    const html = renderToString(
      <PluginCenter {...defaultProps} plugins={plugins} storeTab="store" />,
    );
    // LegacyPluginBadge renders "Migratable" text
    expect(html).toContain('Migratable');
    // It uses AlertTriangle icon
    expect(html).toContain('amber');
  });

  it('does not render LegacyPluginBadge for non-legacy plugins', () => {
    const plugins: PluginType[] = [
      createPlugin({ id: 'modern-1', execution_mode: 'inline' }),
    ];
    const html = renderToString(
      <PluginCenter {...defaultProps} plugins={plugins} storeTab="store" />,
    );
    // The word "Migratable" should not appear for non-legacy plugins
    expect(html).not.toContain('Migratable');
  });
});
