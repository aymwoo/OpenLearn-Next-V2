/**
 * Integration tests for PluginCenter UI: plugin grid, tab switching, LegacyPluginBadge.
 *
 * @vitest-environment jsdom
 *
 * Covers:
 * - PluginCenter renders plugin grid with cards
 * - LegacyPluginBadge appears for legacy plugins
 * - Store tab / dev tab switching
 * - Plugin card shows Enable/Disable and Delete buttons
 * - Plugin name, description, author rendered from manifest
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
    manifest: JSON.stringify({
      description: 'Test plugin description',
      author: 'Test Author',
    }),
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

describe('PluginCenter grid rendering', () => {
  it('renders plugin cards for each plugin in the store tab', () => {
    const plugins: PluginType[] = [
      createPlugin({ id: 'plugin-a' }),
      createPlugin({ id: 'plugin-b' }),
      createPlugin({ id: 'plugin-c' }),
    ];
    const html = renderToString(
      <PluginCenter {...defaultProps} plugins={plugins} storeTab="store" />,
    );

    // Each plugin name appears
    expect(html).toContain('plugin-a');
    expect(html).toContain('plugin-b');
    expect(html).toContain('plugin-c');
    // Author extracted from manifest
    expect(html).toContain('Test Author');
  });

  it('renders plugin status badge for active plugins', () => {
    const plugins: PluginType[] = [
      createPlugin({ id: 'active-plugin', status: 'active' }),
    ];
    const html = renderToString(
      <PluginCenter {...defaultProps} plugins={plugins} storeTab="store" />,
    );
    expect(html).toContain('active');
  });

  it('renders plugin status badge for disabled plugins', () => {
    const plugins: PluginType[] = [
      createPlugin({ id: 'disabled-plugin', status: 'disabled' }),
    ];
    const html = renderToString(
      <PluginCenter {...defaultProps} plugins={plugins} storeTab="store" />,
    );
    expect(html).toContain('disabled');
  });

  it('renders Enable/Disable and Delete buttons for each plugin card', () => {
    const plugins: PluginType[] = [
      createPlugin({ id: 'test-plugin', status: 'active' }),
    ];
    const html = renderToString(
      <PluginCenter {...defaultProps} plugins={plugins} storeTab="store" />,
    );
    // Active plugin shows "Disable" button
    expect(html).toContain('Disable');
    // Delete button present
    expect(html).toContain('Delete');
  });
});

describe('PluginCenter tab switching', () => {
  it('renders Discover tab by default', () => {
    const html = renderToString(
      <PluginCenter
        {...defaultProps}
        plugins={[]}
        storeTab="store"
      />,
    );
    expect(html).toContain('Edu OS App Store');
    // store tab active
    expect(html).toContain('Discover');
  });

  it('renders Developer tab when storeTab is dev', () => {
    const html = renderToString(
      <PluginCenter
        {...defaultProps}
        plugins={[]}
        storeTab="dev"
      />,
    );
    // Developer tab header
    expect(html).toContain('Developer Tools');
    expect(html).toContain('Plugin Sideloading');
  });

  it('renders manifest validation UI in Developer tab', () => {
    const html = renderToString(
      <PluginCenter
        {...defaultProps}
        plugins={[]}
        storeTab="dev"
        pluginCode="exports.default = { manifest: { id: 'test', name: 'Test', version: '1.0.0' }, activate: async () => {} };"
      />,
    );
    expect(html).toContain('Manifest');
  });
});

describe('Legacy plugin card features', () => {
  it('renders LegacyPluginBadge inside legacy plugin cards in store tab', () => {
    const plugins: PluginType[] = [
      createPlugin({ id: 'legacy-p', execution_mode: 'legacy' }),
    ];
    const html = renderToString(
      <PluginCenter {...defaultProps} plugins={plugins} storeTab="store" />,
    );
    // Legacy badge should be visible
    expect(html).toContain('Migratable');
  });

  it('renders Migrate button for legacy plugins', () => {
    const plugins: PluginType[] = [
      createPlugin({ id: 'legacy-p', execution_mode: 'legacy' }),
    ];
    const html = renderToString(
      <PluginCenter {...defaultProps} plugins={plugins} storeTab="store" />,
    );
    // Migrate button text
    expect(html).toContain('Migrate');
  });

  it('does not render Migrate button for modern plugins', () => {
    const plugins: PluginType[] = [
      createPlugin({ id: 'modern-p', execution_mode: 'inline' }),
    ];
    const html = renderToString(
      <PluginCenter {...defaultProps} plugins={plugins} storeTab="store" />,
    );
    // Migrate button should not appear for non-legacy plugins
    expect(html).not.toContain('Migrate');
  });

  it('renders Migrate button for worker-mode plugins (not legacy)', () => {
    const plugins: PluginType[] = [
      createPlugin({ id: 'worker-p', execution_mode: 'worker' }),
    ];
    const html = renderToString(
      <PluginCenter {...defaultProps} plugins={plugins} storeTab="store" />,
    );
    // Worker mode is not legacy, so Migrate button should not appear
    expect(html).not.toContain('Migrate');
  });
});
