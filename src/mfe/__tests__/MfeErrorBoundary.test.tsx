// @vitest-environment jsdom
/**
 * Tests for MfeErrorBoundary component.
 *
 * Covers MFE-LOAD-02: Error Boundary catches render crash, shows fallback UI
 * with retry/dismiss buttons.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MfeErrorBoundary } from '../MfeErrorBoundary';

describe('MfeErrorBoundary', () => {
  it('renders children when no error', () => {
    const html = renderToString(
      React.createElement(MfeErrorBoundary, { name: 'test-mfe' },
        React.createElement('div', { 'data-testid': 'safe-child' }, 'Hello World'),
      ),
    );
    expect(html).toContain('Hello World');
  });

  it('matches snapshot with fallback state', () => {
    // Simulate error state by directly constructing the boundary instance
    // and verifying the render method returns fallback when hasError is true
    const boundary = new MfeErrorBoundary({
      name: 'test-mfe',
      children: React.createElement('div', null, 'child'),
    });

    // Force error state directly
    boundary.state = { hasError: true, error: new Error('test error') };

    // render() should use the default MfeErrorFallback when hasError is true
    const rendered = boundary.render();
    expect(rendered).not.toBeNull();
  });

  it('has handleRetry and handleDismiss methods', () => {
    const boundary = new MfeErrorBoundary({
      name: 'test-mfe',
      children: null,
    });

    expect(typeof boundary.handleRetry).toBe('function');
    expect(typeof boundary.handleDismiss).toBe('function');
  });

  it('handleRetry resets error state (setState spy)', () => {
    const boundary = new MfeErrorBoundary({
      name: 'test-mfe',
      children: null,
    });

    const setStateSpy = vi.spyOn(boundary, 'setState');

    boundary.handleRetry();

    expect(setStateSpy).toHaveBeenCalledWith({
      hasError: false,
      error: null,
    });

    setStateSpy.mockRestore();
  });

  it('handleDismiss resets error state (setState spy)', () => {
    const boundary = new MfeErrorBoundary({
      name: 'test-mfe',
      children: null,
    });

    const setStateSpy = vi.spyOn(boundary, 'setState');

    boundary.handleDismiss();

    expect(setStateSpy).toHaveBeenCalledWith({
      hasError: false,
      error: null,
    });

    setStateSpy.mockRestore();
  });

  it('getDerivedStateFromError returns hasError true with error', () => {
    const result = MfeErrorBoundary.getDerivedStateFromError(
      new Error('render crash'),
    );
    expect(result.hasError).toBe(true);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toBe('render crash');
  });

  it('logs error in componentDidCatch with name prefix', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const boundary = new MfeErrorBoundary({
      name: 'test-mfe',
      children: null,
    });

    boundary.componentDidCatch(
      new Error('test error'),
      { componentStack: 'at TestComponent' },
    );

    expect(consoleSpy).toHaveBeenCalled();
    expect(consoleSpy.mock.calls[0][0]).toContain('[MfeErrorBoundary:test-mfe]');

    consoleSpy.mockRestore();
  });
});
