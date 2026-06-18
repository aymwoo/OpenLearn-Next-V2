/**
 * ResourceTracker 单元测试。
 *
 * 覆盖：
 * - Test 1: track 追加资源
 * - Test 2: disposeAll 调用所有已追踪资源的 dispose
 * - Test 3: disposeAll 幂等性（二次调用无副作用）
 * - Test 4: 单个 dispose 失败时继续清理其余资源
 * - Test 5: 不同 pluginId 的资源隔离
 * - Test 6: 不存在的 pluginId 调用 disposeAll 静默返回
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResourceTracker } from '../resource-tracker.js';

describe('ResourceTracker', () => {
  let tracker: ResourceTracker;

  beforeEach(() => {
    tracker = new ResourceTracker();
  });

  // ── Test 1: track 追加资源 ────────────────────────────────────────

  it('track 追加资源 — 同一 pluginId 多次 track 后内部状态正确', () => {
    const d1 = { dispose: vi.fn() };
    const d2 = { dispose: vi.fn() };

    tracker.track('plugin-a', d1);
    tracker.track('plugin-a', d2);

    // 通过 spy 验证：一次性 disposeAll，断言 dispose 各被调一次
    tracker.disposeAll('plugin-a');

    expect(d1.dispose).toHaveBeenCalledTimes(1);
    expect(d2.dispose).toHaveBeenCalledTimes(1);
  });

  // ── Test 2: disposeAll 调用所有已追踪资源的 dispose ─────────────────

  it('disposeAll 调用所有已追踪资源的 dispose', () => {
    const d1 = { dispose: vi.fn() };
    const d2 = { dispose: vi.fn() };

    tracker.track('plugin-a', d1);
    tracker.track('plugin-a', d2);
    tracker.disposeAll('plugin-a');

    expect(d1.dispose).toHaveBeenCalledTimes(1);
    expect(d2.dispose).toHaveBeenCalledTimes(1);
  });

  // ── Test 3: disposeAll 幂等性 ──────────────────────────────────────

  it('disposeAll 后再次调用为无操作（幂等）', () => {
    const d1 = { dispose: vi.fn() };

    tracker.track('plugin-a', d1);
    tracker.disposeAll('plugin-a');
    // 第二次调用应静默返回，dispose 不被再次调用
    tracker.disposeAll('plugin-a');

    expect(d1.dispose).toHaveBeenCalledTimes(1);
  });

  // ── Test 4: 单个 dispose 失败时继续清理 ─────────────────────────────

  it('disposeAll 在单个 dispose 失败时继续清理其余资源', () => {
    const d1 = { dispose: vi.fn() };
    const failing = {
      dispose: vi.fn(() => {
        throw new Error('boom');
      }),
    };
    const d3 = { dispose: vi.fn() };

    tracker.track('plugin-a', d1);
    tracker.track('plugin-a', failing);
    tracker.track('plugin-a', d3);

    // 抑制 console.error 在测试输出中的噪音
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    tracker.disposeAll('plugin-a');

    expect(d1.dispose).toHaveBeenCalledTimes(1);
    expect(failing.dispose).toHaveBeenCalledTimes(1);
    expect(d3.dispose).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });

  // ── Test 5: 不同 pluginId 的资源隔离 ───────────────────────────────

  it('不同 pluginId 的资源隔离 — disposeAll(p1) 不影响 p2 资源', () => {
    const d1 = { dispose: vi.fn() };
    const d2 = { dispose: vi.fn() };

    tracker.track('p1', d1);
    tracker.track('p2', d2);

    tracker.disposeAll('p1');

    expect(d1.dispose).toHaveBeenCalledTimes(1);
    // p2 的资源不受影响
    expect(d2.dispose).not.toHaveBeenCalled();
  });

  // ── Test 6: 不存在的 pluginId 静默返回 ─────────────────────────────

  it('不存在的 pluginId 调用 disposeAll 静默返回，无副作用', () => {
    // 不应抛出错误
    expect(() => tracker.disposeAll('nonexistent')).not.toThrow();

    // 已有资源的插件不受影响
    const d1 = { dispose: vi.fn() };
    tracker.track('plugin-a', d1);
    tracker.disposeAll('nonexistent');

    expect(d1.dispose).not.toHaveBeenCalled();
  });
});
