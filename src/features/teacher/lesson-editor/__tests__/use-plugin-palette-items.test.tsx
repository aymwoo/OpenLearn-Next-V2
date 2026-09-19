import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { usePluginPaletteItems, paletteItemRegistry } from '../palette-item-registry';
import type { PaletteItemConfig } from '../paletteConfig';

/**
 * 回归测试：`usePluginPaletteItems` 的选择器必须返回**引用稳定**的结果。
 *
 * 背景（真实缺陷）：选择器体 `Array.from(state.items.values()).map(...)`
 * 每次调用都会分配一个新数组。`useStore` 底层是 `useSyncExternalStore`，
 * 它用 `Object.is` 比较连续两次 `getSnapshot()`，于是永远判定“快照已变化”
 * → 每次提交都强制重渲染 → React 抛
 * `Maximum update depth exceeded`，整个课程编辑器不可用。
 *
 * 该测试就是缺陷的最小复现：一个组件 + 一个 Hook + 一个 Store，无任何写入。
 */

let renders = 0;

function Probe() {
  renders += 1;
  const items = usePluginPaletteItems();
  return <div data-testid="probe">{items.length}</div>;
}

beforeEach(() => {
  renders = 0;
});

afterEach(() => {
  cleanup();
  // 隔离：清掉本测试注册过的组件，避免影响其它用例
  for (const item of paletteItemRegistry.getAll()) {
    paletteItemRegistry.unregister(item.type);
  }
});

describe('usePluginPaletteItems', () => {
  it('does not loop forever on an empty registry (renders once)', () => {
    render(<Probe />);

    expect(screen.getByTestId('probe').textContent).toBe('0');
    // 引用不稳定的选择器会在这里飙到 React 的嵌套更新上限（>50）
    expect(renders).toBeLessThanOrEqual(5);
  });

  it('returns the registered plugin palette items', () => {
    paletteItemRegistry.register({ type: 'ext-demo-widget', labelZh: '示例组件' } as PaletteItemConfig, 'prov_demo');

    render(<Probe />);

    expect(screen.getByTestId('probe').textContent).toBe('1');
    expect(renders).toBeLessThanOrEqual(5);
  });

  it('keeps a stable snapshot between renders so consumers do not re-render needlessly', () => {
    paletteItemRegistry.register({ type: 'ext-demo-widget', labelZh: '示例组件' } as PaletteItemConfig, 'prov_demo');

    const store = paletteItemRegistry.getStore();
    const selector = (state: ReturnType<typeof store.getState>) =>
      Array.from(state.items.values()).map((e) => e.config);

    // 直接验证缺陷机理：未修复时两次 getSnapshot 结果永不相等
    const first = selector(store.getState());
    const second = selector(store.getState());
    expect(first).not.toBe(second); // 选择器本身确实每次都是新数组

    // 而 Hook 必须把这个不稳定结果收敛成稳定引用（useShallow）
    render(<Probe />);
    const afterOneRender = renders;
    render(<Probe />);
    expect(renders - afterOneRender).toBeLessThanOrEqual(2);
  });
});
