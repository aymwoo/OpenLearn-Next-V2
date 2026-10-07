/**
 * H-3 回归测试：activate 超时后仍在运行的插件代码不得泄漏资源。
 *
 * 背景：`activate(ctx)` 被 5s `Promise.race` 超时打断时，宿主只是**停止等待**，
 * 并不会取消插件代码本身。随后 catch 分支 `disposeAll(pluginId)` 把追踪表整个删掉。
 * 仍在后台运行的插件代码继续调 `tracker.track()` 时会进入一个**新建的 list**，
 * 而那个 list 永远不会再被 `disposeAll` 触及 —— 资源永久泄漏且无任何报错。
 *
 * 修复：`ResourceTracker` 记录「已关闭」的 pluginId，对它们的 `track()` 立即 dispose；
 * 每次 `activatePluginExclusive` 入口调 `reopen()` 重置标记。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResourceTracker } from '../resource-tracker.js';

function makeDisposable() {
  return { dispose: vi.fn() };
}

describe('H-3：超时后仍运行的插件代码不得泄漏资源', () => {
  let tracker: ResourceTracker;

  beforeEach(() => {
    tracker = new ResourceTracker();
  });

  it('disposeAll 之后再 track 的资源被立即 dispose，不进入追踪表', () => {
    const early = makeDisposable();
    tracker.track('p1', early);
    tracker.disposeAll('p1');
    expect(early.dispose).toHaveBeenCalledTimes(1);

    // 模拟超时后仍在运行的 activate 继续注册资源
    const late = makeDisposable();
    tracker.track('p1', late);

    // 关键断言：立即被回收，而不是静静躺在表里
    expect(late.dispose).toHaveBeenCalledTimes(1);
    // 且不再出现在快照里
    expect(tracker.snapshot('p1')).toEqual([]);
  });

  it('reopen() 之后该插件可正常注册资源（关闭标记不永久生效）', () => {
    const d0 = makeDisposable();
    tracker.track('p1', d0);
    tracker.disposeAll('p1');

    tracker.reopen('p1');

    const d1 = makeDisposable();
    tracker.track('p1', d1);
    expect(d1.dispose).not.toHaveBeenCalled();
    expect(tracker.snapshot('p1')).toEqual([d1]);

    // 且能被后续 disposeAll 正常回收
    tracker.disposeAll('p1');
    expect(d1.dispose).toHaveBeenCalledTimes(1);
  });

  it('关闭标记按 pluginId 隔离，不影响其它插件', () => {
    tracker.track('p1', makeDisposable());
    tracker.disposeAll('p1');

    const other = makeDisposable();
    tracker.track('p2', other);
    expect(other.dispose).not.toHaveBeenCalled();
  });

  it('disposeAll 仍是幂等的', () => {
    const d = makeDisposable();
    tracker.track('p1', d);
    tracker.disposeAll('p1');
    expect(() => tracker.disposeAll('p1')).not.toThrow();
    expect(d.dispose).toHaveBeenCalledTimes(1);
  });

  it('reap() 只移除不 dispose，且不将插件标记为关闭（热重载成功路径）', () => {
    // 模拟热重载：快照旧资源 → 注册新资源 → 精确清理旧资源
    const oldRes = makeDisposable();
    tracker.track('p1', oldRes);
    const snapshot = tracker.snapshot('p1');

    const newRes = makeDisposable();
    tracker.track('p1', newRes);

    tracker.reap('p1', snapshot);

    // reap 的契约是「仅从追踪表移除」；dispose 由调用方
    // （PluginHost.disposeSnapshot）负责 —— 这里断言它确实没有 dispose
    expect(oldRes.dispose).not.toHaveBeenCalled();
    // 新资源保留且未被立即 dispose
    expect(newRes.dispose).not.toHaveBeenCalled();
    expect(tracker.snapshot('p1')).toEqual([newRes]);

    // 关键：reap 之后继续 track 必须仍然正常（若被误标 closed，这里会立刻 dispose）
    const later = makeDisposable();
    tracker.track('p1', later);
    expect(later.dispose).not.toHaveBeenCalled();
    expect(tracker.snapshot('p1')).toEqual([newRes, later]);
  });

  it('late track 的 dispose 抛错不影响后续流程', () => {
    tracker.track('p1', makeDisposable());
    tracker.disposeAll('p1');

    const bad = {
      dispose: () => {
        throw new Error('dispose boom');
      },
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => tracker.track('p1', bad)).not.toThrow();
    spy.mockRestore();
  });
});
