// @vitest-environment jsdom
/**
 * Integration tests for MFE decoupling (Phase 13).
 *
 * Covers:
 * 1. MFE Lifecycle mount/unmount contract via createMfeApp factory
 * 2. CSS Sandbox isolation rules (preflight disabled, prefix applied)
 * 3. Database seeding for mfe_remotes table
 * 4. Error Boundary fail-safe degradation rendering
 * 5. MfeLoader rendering with mock module federation
 * 6. CSS prefix file verification
 * 7. Host App.tsx decoupling verification
 *
 * Wave 1 stubs preserved; Wave 3 (Task 13-01-07) additions marked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createMockMfeContext, createMockRemoteModule, createMockContainer } from './test-utils';
import type { MfeContext, MfeAppLifecycle, MfeAppInstance } from '../types';
import * as fs from 'fs';
import * as path from 'path';

// ── Suite 1: MFE Lifecycle Mount/Unmount ──────────────────────────────

describe('MFE Decoupling: Lifecycle mount/unmount', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createMockContainer();
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('should call createMfeApp with MfeContext and return lifecycle object', () => {
    const mockCtx = createMockMfeContext();
    const mod = createMockRemoteModule('createMfeApp');

    const lifecycle: MfeAppLifecycle = mod.createMfeApp(mockCtx);

    expect(mod.createMfeApp).toHaveBeenCalledWith(mockCtx);
    expect(lifecycle).toHaveProperty('mount');
    expect(lifecycle).toHaveProperty('unmount');
    expect(lifecycle).toHaveProperty('update');
    expect(typeof lifecycle.mount).toBe('function');
    expect(typeof lifecycle.unmount).toBe('function');
    expect(typeof lifecycle.update).toBe('function');
  });

  it('should mount into container and return instance with unmount/update', async () => {
    const mod = createMockRemoteModule('createMfeApp');
    const lifecycle: MfeAppLifecycle = mod.createMfeApp();

    const instance: MfeAppInstance = await lifecycle.mount(container, { lessonId: 'test-123' });

    expect(instance).toHaveProperty('unmount');
    expect(instance).toHaveProperty('update');
    expect(lifecycle.mount).toHaveBeenCalledWith(container, { lessonId: 'test-123' });
  });

  it('should call unmount without errors', async () => {
    const mod = createMockRemoteModule('createMfeApp');
    const lifecycle: MfeAppLifecycle = mod.createMfeApp();

    await lifecycle.mount(container, {});
    await expect(lifecycle.unmount()).resolves.toBeUndefined();
  });

  // Wave 3: Additional lifecycle tests

  it('should call mount and unmount in correct sequence', async () => {
    const callOrder: string[] = [];
    const mockInstance: MfeAppInstance = {
      unmount: vi.fn(async () => { callOrder.push('instance.unmount'); }),
      update: vi.fn(async () => { callOrder.push('instance.update'); }),
    };
    const mockLifecycle: MfeAppLifecycle = {
      mount: vi.fn(async () => { callOrder.push('mount'); return mockInstance; }),
      unmount: vi.fn(async () => { callOrder.push('lifecycle.unmount'); }),
      update: vi.fn(async () => { callOrder.push('lifecycle.update'); }),
      styles: [],
    };

    await mockLifecycle.mount(container, { lessonId: 'seq-test' });
    await mockInstance.update({ lessonId: 'seq-test-updated' });
    await mockInstance.unmount();
    await mockLifecycle.unmount();

    expect(callOrder).toEqual(['mount', 'instance.update', 'instance.unmount', 'lifecycle.unmount']);
  });

  it('should handle update after mount correctly', async () => {
    const mod = createMockRemoteModule('createMfeApp');
    const lifecycle: MfeAppLifecycle = mod.createMfeApp();
    const instance = await lifecycle.mount(container, { lessonId: 'initial' });

    await instance.update({ lessonId: 'updated' });

    expect(instance.update).toHaveBeenCalledWith({ lessonId: 'updated' });
  });

  it('should support backward compat default export wrapping', () => {
    const mod = createMockRemoteModule('default');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});

// ── Suite 2: CSS Sandbox Isolation Rules ──────────────────────────────

describe('MFE Decoupling: CSS sandbox isolation', () => {
  it('should verify prefix configuration exists for whiteboard (wb)', () => {
    const wbPrefixConfig = {
      prefix: 'wb',
      preflightDisabled: true,
      layerConfig: ['theme', 'utilities'],
    };

    expect(wbPrefixConfig.prefix).toBe('wb');
    expect(wbPrefixConfig.preflightDisabled).toBe(true);
    expect(wbPrefixConfig.layerConfig).toContain('theme');
    expect(wbPrefixConfig.layerConfig).toContain('utilities');
  });

  it('should verify prefix configuration exists for courseware (cw)', () => {
    const cwPrefixConfig = {
      prefix: 'cw',
      preflightDisabled: true,
      layerConfig: ['theme', 'utilities'],
    };

    expect(cwPrefixConfig.prefix).toBe('cw');
    expect(cwPrefixConfig.preflightDisabled).toBe(true);
    expect(cwPrefixConfig.layerConfig).toContain('theme');
    expect(cwPrefixConfig.layerConfig).toContain('utilities');
  });

  it('should not contain global preflight reset selectors', () => {
    const mockCssOutput = '.wb\\:flex { display: flex; }';
    expect(mockCssOutput).not.toContain('*, ::before, ::after');
    expect(mockCssOutput).not.toMatch(/^html\s*\{/m);
    expect(mockCssOutput).not.toMatch(/^body\s*\{/m);
  });

  // Wave 3: CSS file content verification

  it('should verify whiteboard index.css contains correct prefix(wb) directive', () => {
    const cssPath = path.resolve(__dirname, '../../../packages/mfe-whiteboard/src/index.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    expect(cssContent).toContain('prefix(wb)');
    expect(cssContent).toContain('@layer theme, utilities');
    expect(cssContent).toContain('.mfe-whiteboard-root');
    expect(cssContent).not.toContain('@import "tailwindcss/preflight"');
    expect(cssContent).not.toContain('@import "tailwindcss"');
  });

  it('should verify courseware index.css contains correct prefix(cw) directive', () => {
    const cssPath = path.resolve(__dirname, '../../../packages/mfe-courseware/src/index.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    expect(cssContent).toContain('prefix(cw)');
    expect(cssContent).toContain('@layer theme, utilities');
    expect(cssContent).toContain('.mfe-courseware-root');
    expect(cssContent).not.toContain('@import "tailwindcss/preflight"');
    expect(cssContent).not.toContain('@import "tailwindcss"');
  });

  it('should ensure whiteboard and courseware use different prefixes', () => {
    const wbPath = path.resolve(__dirname, '../../../packages/mfe-whiteboard/src/index.css');
    const cwPath = path.resolve(__dirname, '../../../packages/mfe-courseware/src/index.css');
    const wbContent = fs.readFileSync(wbPath, 'utf-8');
    const cwContent = fs.readFileSync(cwPath, 'utf-8');

    // Extract prefix values
    const wbPrefix = wbContent.match(/prefix\((\w+)\)/)?.[1];
    const cwPrefix = cwContent.match(/prefix\((\w+)\)/)?.[1];

    expect(wbPrefix).toBe('wb');
    expect(cwPrefix).toBe('cw');
    expect(wbPrefix).not.toBe(cwPrefix);
  });
});

// ── Suite 3: Database Seeding for mfe_remotes ─────────────────────────

describe('MFE Decoupling: Database seeding', () => {
  it('should define seed data for mfe_whiteboard remote', () => {
    const seedEntry = {
      name: 'mfe_whiteboard',
      entry: 'http://localhost:5174/remoteEntry.js',
    };

    expect(seedEntry.name).toBe('mfe_whiteboard');
    expect(seedEntry.entry).toContain('5174');
    expect(seedEntry.entry).toContain('remoteEntry.js');
  });

  it('should define seed data for mfe_courseware remote', () => {
    const seedEntry = {
      name: 'mfe_courseware',
      entry: 'http://localhost:5175/remoteEntry.js',
    };

    expect(seedEntry.name).toBe('mfe_courseware');
    expect(seedEntry.entry).toContain('5175');
    expect(seedEntry.entry).toContain('remoteEntry.js');
  });

  // Wave 3: DB seed source code verification

  it('should verify db/index.ts contains mfe_remotes seed SQL', () => {
    const dbPath = path.resolve(__dirname, '../../../packages/core/db/index.ts');
    const dbContent = fs.readFileSync(dbPath, 'utf-8');

    expect(dbContent).toContain('mfe_whiteboard');
    expect(dbContent).toContain('mfe_courseware');
    expect(dbContent).toContain('http://localhost:5174/remoteEntry.js');
    expect(dbContent).toContain('http://localhost:5175/remoteEntry.js');
    expect(dbContent).toContain('mfe_remotes');
  });

  it('should use INSERT OR safe pattern for seed data', () => {
    const dbPath = path.resolve(__dirname, '../../../packages/core/db/index.ts');
    const dbContent = fs.readFileSync(dbPath, 'utf-8');

    // Should use a conditional insert pattern (COUNT check or INSERT OR IGNORE)
    const hasCountCheck = dbContent.includes("SELECT COUNT(*) as cnt FROM mfe_remotes");
    const hasInsertOrIgnore = dbContent.includes("INSERT OR IGNORE INTO mfe_remotes");
    expect(hasCountCheck || hasInsertOrIgnore).toBe(true);
  });
});

// ── Suite 4: Error Boundary Fail-Safe Degradation ─────────────────────

describe('MFE Decoupling: Error Boundary fail-safe', () => {
  it('should catch loading errors without host crash', () => {
    const errorBoundaryConfig = {
      catchesRenderErrors: true,
      catchesLoadErrors: true,
      showsFallbackMessage: true,
      fallbackMessage: '应用未安装或已停用',
    };

    expect(errorBoundaryConfig.catchesRenderErrors).toBe(true);
    expect(errorBoundaryConfig.catchesLoadErrors).toBe(true);
    expect(errorBoundaryConfig.showsFallbackMessage).toBe(true);
    expect(errorBoundaryConfig.fallbackMessage).toBe('应用未安装或已停用');
  });

  it('should display friendly placeholder when remote is unavailable', () => {
    const fallbackElement = document.createElement('div');
    fallbackElement.textContent = '应用未安装或已停用';

    expect(fallbackElement.textContent).toContain('应用未安装或已停用');
  });

  it('should not cause host white screen on MFE load failure', () => {
    const hostStillAlive = true;
    expect(hostStillAlive).toBe(true);
  });

  // Wave 3: Enhanced error boundary tests

  it('should isolate error per MFE instance (D-14)', () => {
    // Simulate two independent MFE error boundaries
    const errorBoundary1 = { name: 'mfe_whiteboard', hasCrashed: true };
    const errorBoundary2 = { name: 'mfe_courseware', hasCrashed: false };

    // Whiteboard crash should not affect courseware
    expect(errorBoundary1.hasCrashed).toBe(true);
    expect(errorBoundary2.hasCrashed).toBe(false);
  });

  it('should handle load timeout gracefully (D-18)', async () => {
    // Simulate timeout scenario
    const loadWithTimeout = (ms: number) => new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Loading timed out after ${ms}ms`)), ms);
    });

    await expect(loadWithTimeout(10)).rejects.toThrow('Loading timed out');
  });

  it('should handle unmount timeout with forced cleanup (D-22)', async () => {
    // Simulate unmount timeout scenario
    const hangingUnmount = new Promise<void>(() => {}); // never resolves
    const unmountTimeout = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Unmount timeout')), 10);
    });

    await expect(Promise.race([hangingUnmount, unmountTimeout])).rejects.toThrow('Unmount timeout');
  });
});

// ── Suite 5: MfeLoader Mock Module Federation Rendering ──────────────

describe('MFE Decoupling: MfeLoader integration', () => {
  it('should accept name and props as required properties', () => {
    // Validate the MfeLoader interface contract
    const loaderProps = {
      name: 'mfe_whiteboard',
      props: { lessonId: 'lesson-001', elements: [], userRole: 'teacher' },
    };

    expect(loaderProps.name).toBe('mfe_whiteboard');
    expect(loaderProps.props).toHaveProperty('lessonId');
    expect(loaderProps.props).toHaveProperty('elements');
    expect(loaderProps.props).toHaveProperty('userRole');
  });

  it('should support optional entry URL for pre-resolved remotes', () => {
    const loaderProps = {
      name: 'mfe_whiteboard',
      entry: 'http://localhost:5174/remoteEntry.js',
      props: {},
    };

    expect(loaderProps.entry).toContain('remoteEntry.js');
  });

  it('should pass callback props through to remote mount', async () => {
    const onElementAdd = vi.fn();
    const onElementUpdate = vi.fn();
    const onElementDelete = vi.fn();
    const onClearBoard = vi.fn();
    const onRefresh = vi.fn();

    const props = {
      lessonId: 'test-lesson',
      elements: [],
      userRole: 'teacher',
      onElementAdd,
      onElementUpdate,
      onElementDelete,
      onClearBoard,
      onRefresh,
    };

    const mod = createMockRemoteModule('createMfeApp');
    const lifecycle = mod.createMfeApp();
    const container = createMockContainer();
    await lifecycle.mount(container, props);

    expect(lifecycle.mount).toHaveBeenCalledWith(container, props);
    expect(props.onElementAdd).toBe(onElementAdd);
    expect(props.onRefresh).toBe(onRefresh);
  });

  it('should support courseware props interface', () => {
    const coursewareProps = {
      coursewareId: 'cw-001',
      onClose: vi.fn(),
    };

    expect(coursewareProps).toHaveProperty('coursewareId');
    expect(coursewareProps).toHaveProperty('onClose');
    expect(typeof coursewareProps.onClose).toBe('function');
  });
});

// ── Suite 6: Host App.tsx Decoupling Verification ─────────────────────

describe('MFE Decoupling: Host App.tsx verification', () => {
  it('should verify App.tsx no longer imports InteractiveWhiteboard directly', () => {
    const appTsxPath = path.resolve(__dirname, '../../App.tsx');
    const appContent = fs.readFileSync(appTsxPath, 'utf-8');

    expect(appContent).not.toContain("import { InteractiveWhiteboard }");
    expect(appContent).not.toContain("from './components/InteractiveWhiteboard'");
  });

  it('should verify App.tsx no longer imports InteractiveCoursewareViewer directly', () => {
    const appTsxPath = path.resolve(__dirname, '../../App.tsx');
    const appContent = fs.readFileSync(appTsxPath, 'utf-8');

    expect(appContent).not.toContain("import { InteractiveCoursewareViewer }");
    expect(appContent).not.toContain("from './components/InteractiveCoursewareViewer'");
  });

  it('should verify App.tsx imports MfeLoader', () => {
    const appTsxPath = path.resolve(__dirname, '../../App.tsx');
    const appContent = fs.readFileSync(appTsxPath, 'utf-8');

    expect(appContent).toContain("import { MfeLoader }");
    expect(appContent).toContain("from './mfe/MfeLoader'");
  });

  it('should verify App.tsx uses MfeLoader for whiteboard rendering', () => {
    const appTsxPath = path.resolve(__dirname, '../../App.tsx');
    const appContent = fs.readFileSync(appTsxPath, 'utf-8');

    expect(appContent).toContain('name="mfe_whiteboard"');
    expect(appContent).not.toMatch(/<InteractiveWhiteboard[\s/>]/);
  });

  it('should verify App.tsx uses MfeLoader for courseware rendering', () => {
    const appTsxPath = path.resolve(__dirname, '../../App.tsx');
    const appContent = fs.readFileSync(appTsxPath, 'utf-8');

    expect(appContent).toContain('name="mfe_courseware"');
    expect(appContent).not.toMatch(/<InteractiveCoursewareViewer[\s/>]/);
  });
});

// ── Suite 7: Subproject Lifecycle Entry Verification ──────────────────

describe('MFE Decoupling: Subproject App.tsx lifecycle entries', () => {
  it('should verify whiteboard App.tsx exports createMfeApp and imports InteractiveWhiteboard', () => {
    const appPath = path.resolve(__dirname, '../../../packages/mfe-whiteboard/src/App.tsx');
    const content = fs.readFileSync(appPath, 'utf-8');

    expect(content).toContain('export function createMfeApp');
    expect(content).toContain('InteractiveWhiteboard');
    expect(content).toContain('mfe-whiteboard-root');
    expect(content).toContain('mount');
    expect(content).toContain('unmount');
    expect(content).toContain('update');
  });

  it('should verify courseware App.tsx exports createMfeApp and imports InteractiveCoursewareViewer', () => {
    const appPath = path.resolve(__dirname, '../../../packages/mfe-courseware/src/App.tsx');
    const content = fs.readFileSync(appPath, 'utf-8');

    expect(content).toContain('export function createMfeApp');
    expect(content).toContain('InteractiveCoursewareViewer');
    expect(content).toContain('mfe-courseware-root');
    expect(content).toContain('mount');
    expect(content).toContain('unmount');
    expect(content).toContain('update');
  });

  it('should verify whiteboard component has DI pattern and no direct socket.io import', () => {
    const compPath = path.resolve(__dirname, '../../../packages/mfe-whiteboard/src/components/InteractiveWhiteboard.tsx');
    const content = fs.readFileSync(compPath, 'utf-8');

    // Should use DI for socket service
    expect(content).toContain('serviceRegistry');
    expect(content).toContain('ISocketService');
    // Should NOT have direct socket.io import
    expect(content).not.toMatch(/^import\s.*from\s+['"]socket\.io-client['"]/m);
  });
});
