/**
 * C-6 回归测试：看门狗崩溃重启不得「复活」已停用/已卸载的插件。
 *
 * 背景：`WorkerRegistry` 在 worker 崩溃后用 `setTimeout(...)` 排队重启（指数退避 1–4s）。
 * 修复前该定时器的返回值被**丢弃**，`terminate()` 只做 `crashStats.delete(pluginId)`，
 * 因此：worker 崩溃 → 排定时器 → 用户在同一秒内停用/卸载插件 → 定时器照常触发 →
 * `recreateWorkerCallback` 给已停用/已卸载的插件重建 Worker。
 *
 * 且 `pluginInstances.workerRef` 不会随之更新，`dispatchHttpRequest` 与命令派发
 * 仍指向已死 transport。
 *
 * 测试直接驱动 `scheduleWatchdogRestart()`（已从 exit 闭包抽出，见该方法注释），
 * 用假定时器推进时间，不真的 sleep。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerRegistry } from '../worker-manager.js';

describe('C-6：watchdog 不得复活已停用/已卸载的插件', () => {
  let registry: WorkerRegistry;
  let recreateCalls: string[];

  const params = (id: string) => ({
    manifest: { id, name: id, version: '1.0.0', main: 'index.js' },
    sourceCode: 'export default {}',
    serviceTokens: ['@openlearn/core:ICommandBusService'],
    eventBus: {},
    pluginDir: '/tmp',
  });

  beforeEach(() => {
    vi.useFakeTimers();
    recreateCalls = [];
    registry = new WorkerRegistry();
    registry.recreateWorkerCallback = (async (pluginId: string) => {
      recreateCalls.push(pluginId);
      return null as never;
    }) as never;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('排定重启后 terminate()，定时器不得触发重建', async () => {
    registry.scheduleWatchdogRestart('ext-crash-a', params('ext-crash-a'));
    expect(recreateCalls).toHaveLength(0);

    // 用户在同一秒内停用/卸载该插件
    await registry.terminate('ext-crash-a');

    // 推进时间越过退避窗口
    await vi.advanceTimersByTimeAsync(5000);

    expect(recreateCalls).toEqual([]);
  });

  it('未 terminate 时仍会按退避重启（不能把正常自愈也一起禁掉）', async () => {
    registry.scheduleWatchdogRestart('ext-crash-b', params('ext-crash-b'));
    await vi.advanceTimersByTimeAsync(1200);

    expect(recreateCalls).toEqual(['ext-crash-b']);
  });

  it('反复崩溃后退避递增：第 2 次为 2000ms', async () => {
    registry.scheduleWatchdogRestart('ext-crash-c', params('ext-crash-c'));
    await vi.advanceTimersByTimeAsync(1200);
    expect(recreateCalls).toEqual(['ext-crash-c']);

    registry.scheduleWatchdogRestart('ext-crash-c', params('ext-crash-c'));
    // 1200ms 时第二次还没到期（退避 2000ms）
    await vi.advanceTimersByTimeAsync(1200);
    expect(recreateCalls).toEqual(['ext-crash-c']);
    // 再过 1000ms 累计 3400ms > 2000ms → 触发
    await vi.advanceTimersByTimeAsync(1000);
    expect(recreateCalls).toEqual(['ext-crash-c', 'ext-crash-c']);
  });

  it('cancelWatchdog 之后仍可再次排定重启（取消不应永久禁用看门狗）', async () => {
    registry.scheduleWatchdogRestart('ext-crash-d', params('ext-crash-d'));
    await registry.terminate('ext-crash-d');
    await vi.advanceTimersByTimeAsync(5000);
    expect(recreateCalls).toEqual([]);

    // 插件被重新启用后再崩溃一次 → 应能正常排定并执行
    registry.scheduleWatchdogRestart('ext-crash-d', params('ext-crash-d'));
    await vi.advanceTimersByTimeAsync(1200);
    expect(recreateCalls).toEqual(['ext-crash-d']);
  });

  it('第 4 次崩溃触发熔断而非继续重启', async () => {
    const breaker: string[] = [];
    registry.onCircuitBreakerTriggered = (id: string) => breaker.push(id);

    for (let i = 0; i < 4; i++) {
      registry.scheduleWatchdogRestart('ext-crash-e', params('ext-crash-e'));
    }
    await vi.advanceTimersByTimeAsync(20_000);

    // 只重启 3 次，第 4 次熔断
    expect(recreateCalls).toHaveLength(3);
    expect(breaker).toEqual(['ext-crash-e']);
  });

  it('cancelWatchdog 幂等：无定时器时为无操作', () => {
    expect(() => registry.cancelWatchdog('never-existed')).not.toThrow();
    expect(() => registry.cancelWatchdog('never-existed')).not.toThrow();
  });

  it('同插件多次崩溃各自排定重启（不得因单槽覆盖而丢失）', async () => {
    registry.scheduleWatchdogRestart('ext-crash-f', params('ext-crash-f'));
    registry.scheduleWatchdogRestart('ext-crash-f', params('ext-crash-f'));
    await vi.advanceTimersByTimeAsync(20_000);

    // 两次排定都应执行
    expect(recreateCalls).toEqual(['ext-crash-f', 'ext-crash-f']);
  });
});
