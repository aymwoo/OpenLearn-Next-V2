// @vitest-environment jsdom
/**
 * Shared test utilities for MFE test files.
 *
 * Provides mock factories for MfeContext, remote modules, and DOM containers.
 * Follows the mock pattern from src/plugin-host/__tests__/plugin-host.test.ts.
 */

import { vi } from 'vitest';
import type { MfeContext, MfeAppLifecycle, MfeAppInstance } from '../types';

/**
 * Create a mock MfeContext object with vi.fn() eventBus.
 * Useful for testing createMfeApp factory functions that receive a context.
 */
export function createMockMfeContext(): MfeContext {
  return {
    eventBus: {
      subscribe: vi.fn().mockReturnValue(() => {}),
      publish: vi.fn(),
    },
    serviceRegistry: {},
    store: {},
  };
}

/**
 * Create a mock remote module for testing lifecycle contracts.
 *
 * @param factory - The export format to simulate:
 *   - 'createMfeApp' (default): exports a createMfeApp factory function
 *   - 'default': exports a default React component (backward compat)
 */
export function createMockRemoteModule(
  factory: 'createMfeApp' | 'default' = 'createMfeApp',
): Record<string, any> {
  if (factory === 'default') {
    const MockComponent = () => null;
    return { default: MockComponent };
  }

  const mockInstance: MfeAppInstance = {
    unmount: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  };

  const mockLifecycle: MfeAppLifecycle = {
    mount: vi.fn().mockResolvedValue(mockInstance),
    unmount: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    styles: [],
  };

  return {
    createMfeApp: vi.fn().mockReturnValue(mockLifecycle),
  };
}

/**
 * Create a mock DOM container element for mount testing.
 */
export function createMockContainer(): HTMLElement {
  return document.createElement('div');
}
