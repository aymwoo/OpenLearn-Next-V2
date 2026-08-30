/**
 * ExtensionPointRenderer — 锚点槽位（anchor:*）placement 过滤渲染测试。
 *
 * v0.2.6: 宿主在锚点按钮前后各渲染一次
 *   <ExtensionPointRenderer slot="anchor:x" placement="before|after" />
 * 本测试验证：
 * - placement="before" 只渲染 placement === 'before' 的扩展
 * - placement="after"  只渲染 placement === 'after' 及未声明（默认）的扩展
 * - 不传 placement 时渲染该槽位全部扩展（向后兼容固定槽位行为）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ExtensionPointRenderer } from '../extension-point-renderer';
import { PluginHostProvider } from '../plugin-host-context';
import { FrontendPluginHost } from '../plugin-host';
import { usePluginHostStore } from '../plugin-host-store';

/**
 * Build a lazy component factory in the exact shape the renderer expects:
 *   () => Promise<{ default: ComponentType }>
 * with the `__isLazyFactory` marker so `resolveExtensionComponent` wraps it in
 * React.lazy (mirrors src/features/activity-ecosystem/registerTeacherExtension.tsx).
 */
function lazyComponent(el: ReactElement) {
  const factory = () => Promise.resolve({ default: () => el });
  (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
  return factory;
}

function renderWithHost(ui: ReactElement) {
  const host = new FrontendPluginHost();
  return render(<PluginHostProvider host={host}>{ui}</PluginHostProvider>);
}

beforeEach(() => {
  usePluginHostStore.setState({ extensionPoints: new Map() });
});

afterEach(() => {
  cleanup();
});

describe('ExtensionPointRenderer — anchor slot placement filtering (v0.2.6)', () => {
  it('placement="before" 只渲染 before 扩展', async () => {
    usePluginHostStore.getState().registerExtensionPoint('anchor:test:btn', {
      id: 'before-btn',
      label: 'Before',
      pluginId: 'p1',
      placement: 'before',
      component: lazyComponent(<span data-testid="before">Before Btn</span>),
    });
    usePluginHostStore.getState().registerExtensionPoint('anchor:test:btn', {
      id: 'after-btn',
      label: 'After',
      pluginId: 'p1',
      placement: 'after',
      component: lazyComponent(<span data-testid="after">After Btn</span>),
    });

    renderWithHost(<ExtensionPointRenderer slot="anchor:test:btn" placement="before" />);

    expect(await screen.findByTestId('before')).toBeTruthy();
    expect(screen.queryByTestId('after')).toBeNull();
  });

  it('placement="after" 渲染 after 及未声明 placement（默认）的扩展', async () => {
    usePluginHostStore.getState().registerExtensionPoint('anchor:test:btn', {
      id: 'before-btn',
      label: 'Before',
      pluginId: 'p1',
      placement: 'before',
      component: lazyComponent(<span data-testid="before">Before Btn</span>),
    });
    usePluginHostStore.getState().registerExtensionPoint('anchor:test:btn', {
      id: 'after-btn',
      label: 'After',
      pluginId: 'p1',
      placement: 'after',
      component: lazyComponent(<span data-testid="after">After Btn</span>),
    });
    usePluginHostStore.getState().registerExtensionPoint('anchor:test:btn', {
      id: 'default-btn',
      label: 'Default',
      pluginId: 'p1',
      component: lazyComponent(<span data-testid="default">Default Btn</span>),
    });

    renderWithHost(<ExtensionPointRenderer slot="anchor:test:btn" placement="after" />);

    expect(await screen.findByTestId('after')).toBeTruthy();
    expect(screen.getByTestId('default')).toBeTruthy(); // 未声明 placement 默认视为 'after'
    expect(screen.queryByTestId('before')).toBeNull();
  });

  it('不传 placement 时渲染该槽位全部扩展（向后兼容）', async () => {
    usePluginHostStore.getState().registerExtensionPoint('anchor:test:btn', {
      id: 'before-btn',
      label: 'Before',
      pluginId: 'p1',
      placement: 'before',
      component: lazyComponent(<span data-testid="before">Before Btn</span>),
    });
    usePluginHostStore.getState().registerExtensionPoint('anchor:test:btn', {
      id: 'after-btn',
      label: 'After',
      pluginId: 'p1',
      placement: 'after',
      component: lazyComponent(<span data-testid="after">After Btn</span>),
    });

    renderWithHost(<ExtensionPointRenderer slot="anchor:test:btn" />);

    expect(await screen.findByTestId('before')).toBeTruthy();
    expect(screen.getByTestId('after')).toBeTruthy();
  });

  it('getExtensions 按 position 升序返回（同槽位跨插件排序，缺省 100）', () => {
    const register = usePluginHostStore.getState().registerExtensionPoint;
    const comp = lazyComponent(<span />);

    // 乱序注册：position 90、10、缺省（默认 100）
    register('anchor:test:btn', {
      id: 'b', label: 'B', pluginId: 'p1', placement: 'before', position: 90, component: comp,
    });
    register('anchor:test:btn', {
      id: 'a', label: 'A', pluginId: 'p2', placement: 'before', position: 10, component: comp,
    });
    register('anchor:test:btn', {
      id: 'c', label: 'C', pluginId: 'p3', placement: 'before', component: comp,
    });

    const sorted = usePluginHostStore.getState().getExtensions('anchor:test:btn');
    expect(sorted.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});
