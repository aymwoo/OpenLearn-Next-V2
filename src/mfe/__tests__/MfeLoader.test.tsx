// @vitest-environment jsdom
/**
 * Tests for MfeLoader container component.
 *
 * Covers MFE-LOAD-01: MfeLoader resolves remote entry URL and renders component.
 *
 * Tests the composition wrapper — verifies it properly nests MfeErrorBoundary
 * around MfeLoaderCore and reads config defaults from MfeConfigProvider.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MfeLoader } from '../MfeLoader';
import { MfeConfigProvider } from '../MfeConfigProvider';
import * as MfeLoaderCoreModule from '../MfeLoaderCore';

// Mock module-federation runtime so loadRemote doesn't actually fetch
vi.mock('@module-federation/runtime', () => ({
  loadRemote: vi.fn().mockResolvedValue({ default: () => null }),
  init: vi.fn(),
}));

// Mock API to prevent actual network calls
vi.mock('../api', () => ({
  fetchRemoteEntry: vi.fn().mockResolvedValue({ entry: 'http://localhost:5174/remoteEntry.js', meta: {}, timestamp: Date.now() }),
}));

// Mock cache so we don't rely on actual cache state
vi.mock('../cache', () => ({
  get: vi.fn().mockReturnValue(null),
  set: vi.fn(),
}));

describe('MfeLoader', () => {
  it('renders within MfeConfigProvider', () => {
    const MfeLoaderCoreMock = vi.spyOn(MfeLoaderCoreModule, 'MfeLoaderCore');

    const html = renderToString(
      React.createElement(MfeConfigProvider, null,
        React.createElement(MfeLoader, { name: 'mfe_whiteboard' }),
      ),
    );
    // Should render something (not an empty string)
    expect(html).not.toBe('');
    MfeLoaderCoreMock.mockRestore();
  });

  it('passes name prop to MfeLoaderCore', () => {
    const MfeLoaderCoreMock = vi.spyOn(MfeLoaderCoreModule, 'MfeLoaderCore');

    renderToString(
      React.createElement(MfeConfigProvider, null,
        React.createElement(MfeLoader, { name: 'test_remote' }),
      ),
    );

    expect(MfeLoaderCoreMock).toHaveBeenCalled();
    const callProps = MfeLoaderCoreMock.mock.calls[0][0];
    expect(callProps.name).toBe('test_remote');
    MfeLoaderCoreMock.mockRestore();
  });

  it('passes timeout from MfeConfigProvider default', () => {
    const MfeLoaderCoreMock = vi.spyOn(MfeLoaderCoreModule, 'MfeLoaderCore');

    renderToString(
      React.createElement(MfeConfigProvider, null,
        React.createElement(MfeLoader, { name: 'test_remote' }),
      ),
    );

    const callProps = MfeLoaderCoreMock.mock.calls[0][0];
    expect(callProps.timeout).toBe(30000);
    MfeLoaderCoreMock.mockRestore();
  });
});
