/**
 * Tests for PluginHostProvider and usePluginHost hook.
 *
 * Covers:
 * - PluginHostProvider renders children
 * - usePluginHost returns the provided FrontendPluginHost instance
 * - usePluginHost throws when called outside PluginHostProvider
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { PluginHostProvider, usePluginHost } from '../plugin-host-context';
import { FrontendPluginHost } from '../plugin-host';

describe('PluginHostProvider', () => {
  it('renders children inside the provider', () => {
    const host = new FrontendPluginHost();
    const html = renderToString(
      <PluginHostProvider host={host}>
        <div data-testid="child">Hello World</div>
      </PluginHostProvider>,
    );
    expect(html).toContain('Hello World');
  });
});

describe('usePluginHost', () => {
  it('returns the host instance from context', () => {
    const host = new FrontendPluginHost();
    let capturedHost: FrontendPluginHost | null = null;

    function CaptureHost() {
      capturedHost = usePluginHost();
      return null;
    }

    renderToString(
      <PluginHostProvider host={host}>
        <CaptureHost />
      </PluginHostProvider>,
    );

    expect(capturedHost).toBe(host);
  });

  it('throws when called outside PluginHostProvider', () => {
    function BadComponent() {
      usePluginHost();
      return null;
    }

    expect(() => {
      renderToString(<BadComponent />);
    }).toThrow('usePluginHost must be used within PluginHostProvider');
  });
});
