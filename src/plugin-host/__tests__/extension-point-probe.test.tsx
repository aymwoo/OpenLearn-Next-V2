/**
 * ExtensionPointRenderer — 直组件「探针」隔离回归测试。
 *
 * 背景：`resolveExtensionComponent` 为了识别漏打标的 lazy 工厂，会在**渲染路径上**
 * 无参调用一次 `ext.component()`。如果该 component 是使用 hooks 的普通函数组件，
 * 这次调用会把它的 hooks 挂到 `ExtensionPointRenderer` 自己的 fiber 上；而结果被
 * WeakMap 缓存，第二次渲染会跳过探针 —— 于是同一个 fiber 上的 hooks 数量前后不一致，
 * React 抛 error #300（Rendered fewer hooks than expected）。
 *
 * 实测事故形态：第三方插件经 `ctx.ui.registerExtensionPoint` 注册的
 * `CoursewareGradePanel`（十几个 `useState`）首屏能画出来，任何一次重渲染即整块崩溃。
 *
 * 修法：探针期间把 React 的 current dispatcher 置 null，hooks 立即抛错 →
 * 归入「直组件」分支，`finally` 还原。本文件钉住「跨重渲染不抛」这一行为。
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ExtensionPointRenderer } from '../extension-point-renderer';
import { PluginHostProvider } from '../plugin-host-context';
import { FrontendPluginHost } from '../plugin-host';
import { usePluginHostStore } from '../plugin-host-store';

const SLOT = 'anchor:probe:regression';

/** 使用 hooks 的直接组件（与第三方插件注册的形态一致）。 */
function HooksPanel() {
  const [count] = React.useState(7);
  const [label] = React.useState('hooks-panel');
  return <span data-testid={label}>{count}</span>;
}

/** 未打标的 lazy 工厂 —— 探针必须仍然识别出来并自愈成 React.lazy。 */
function unmarkedFactory() {
  return Promise.resolve({ default: () => <span data-testid="lazy-panel">lazy</span> });
}

/**
 * 强制重渲染的宿主。
 *
 * RTL 的 `rerender(同一个 element 引用)` 会被 React 的 identical-element 优化短路，
 * 子组件根本不重渲染 —— 那样就测不到 hooks 数量比对。用 tick 驱动父组件重渲染。
 */
function Harness({ tick }: { tick: number }) {
  return (
    <>
      <span data-testid="tick">{tick}</span>
      <ExtensionPointRenderer slot={SLOT as never} />
    </>
  );
}

beforeEach(() => {
  usePluginHostStore.setState({ extensionPoints: new Map(), activePlugins: [], pluginErrors: new Map() });
});

afterEach(() => {
  cleanup();
});

describe('ExtensionPointRenderer — 直组件探针隔离', () => {
  it('使用 hooks 的直接组件跨重渲染不触发 hooks 数量不一致', async () => {
    usePluginHostStore.getState().registerExtensionPoint(SLOT as never, {
      id: 'hooks-direct',
      label: 'Hooks Direct',
      pluginId: 'p-hooks',
      component: HooksPanel as never,
    });

    const host = new FrontendPluginHost();
    const tree = (tick: number) => (
      <PluginHostProvider host={host}>
        <Harness tick={tick} />
      </PluginHostProvider>
    );

    const { rerender } = render(tree(0));
    expect(await screen.findByTestId('hooks-panel')).toBeTruthy();

    // 第二次渲染：resolvedComponentCache 命中 → 跳过探针。
    // 若探针没有隔离 dispatcher，这里会抛 React #300。
    expect(() => rerender(tree(1))).not.toThrow();
    expect(screen.getByTestId('tick').textContent).toBe('1');
    expect(await screen.findByTestId('hooks-panel')).toBeTruthy();
    expect(screen.getByTestId('hooks-panel').textContent).toBe('7');

    // 再来一次，确保不是「第二次侥幸通过」
    expect(() => rerender(tree(2))).not.toThrow();
    expect(screen.getByTestId('tick').textContent).toBe('2');
    expect(await screen.findByTestId('hooks-panel')).toBeTruthy();
  });

  it('探针隔离后，未打标的 lazy 工厂仍然被识别并自愈为 React.lazy', async () => {
    usePluginHostStore.getState().registerExtensionPoint(SLOT as never, {
      id: 'unmarked-lazy',
      label: 'Unmarked Lazy',
      pluginId: 'p-lazy',
      component: unmarkedFactory as never,
    });

    const host = new FrontendPluginHost();
    render(
      <PluginHostProvider host={host}>
        <ExtensionPointRenderer slot={SLOT as never} />
      </PluginHostProvider>,
    );

    // 若探针因 dispatcher 置 null 而误判为直组件，Promise 会让 Suspense 永久悬挂，
    // 这里就永远等不到 lazy-panel。
    expect(await screen.findByTestId('lazy-panel')).toBeTruthy();
  });
});
