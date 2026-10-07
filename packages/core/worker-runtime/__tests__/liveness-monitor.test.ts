/**
 * Worker 存活探活（P0 · L-1）单元测试。
 *
 * ## 这个模块治的威胁
 *
 * `while(true)` 的插件永久占住一个 Worker 槽位（上限 32），打满即全平台 DoS。
 * 崩溃看门狗监听 `exit`，而死循环**不产生 exit** ⇒ 永不触发。
 *
 * ## 判据的关键性质（也是本文件最要紧的断言组）
 *
 * **不能**用「N 秒内没收到任何消息就判定卡死」—— 那会误杀健康但空闲的插件
 * （等着下一节课的插件本就可以长时间不说话）。
 *
 * 本模块用「ping 有无响应」，并由 `noteActivity()` 让**任何**入站消息都算存活证据：
 * 空闲 worker 的事件循环是通的，ping 会立刻回 pong。
 *
 * ## 全部用例都用可控时钟（host.now），不靠 setTimeout 真等
 *
 * 这样 (a) 测试是确定的，(b) 用例里出现的大数值不会让人误以为要跑几分钟。
 */

import { describe, it, expect, vi } from 'vitest';
import { WorkerLivenessMonitor, LIVENESS_DEFAULTS, type LivenessHost } from '../liveness-monitor.js';

/** 可控时钟 + 记录调用的假宿主 */
function makeHost(pluginIds: string[] = ['ext-a']) {
  const state = {
    t: 1_000_000,
    pings: Array<{ pluginId: string; seq: number }>(),
    terminated: Array<{ pluginId: string; reason: string }>(),
    running: new Set(pluginIds),
    /** 模拟 pong 丢失（卡死） */
    pongsEnabled: true,
    /** sendPing 抛错（transport 已 dispose） */
    pingThrows: false,
  };

  const host: LivenessHost = {
    listRunningPluginIds: () => [...state.running],
    sendPing: (pluginId, seq) => {
      if (state.pingThrows) throw new Error('transport disposed');
      state.pings.push({ pluginId, seq });
      if (state.pongsEnabled) monitor.notePong(pluginId, seq);
    },
    terminate: (pluginId, reason) => {
      state.terminated.push({ pluginId, reason });
    },
    now: () => state.t,
  };

  const monitor = new WorkerLivenessMonitor(host, { intervalMs: 1000, graceMs: 500 });
  return { state, host, monitor };
}

describe('P0 · Worker 存活探活', () => {
  it('健康但空闲的插件**不会**被判卡死（本设计的核心性质）', () => {
    const { state, monitor } = makeHost();

    // 连续 40 个 tick（= 40s）该插件一次消息都不发
    for (let i = 0; i < 40; i++) {
      state.t += 1000;
      monitor.tick();
    }

    expect(state.terminated, '空闲插件被误杀了 —— 这是「静默计时器」判据的致命缺陷，本判据必须避免它').toEqual([]);
    // 但确实发了 ping（证明它在被探活，而不是被遗忘）
    expect(state.pings.length).toBeGreaterThan(0);
  });

  it('ping 会得到 pong，pong 视为存活证据', () => {
    const { state, monitor } = makeHost();
    // 首轮 tick 只建立跟踪起点（不判、不发 ping），第二轮才到间隔 —— 这是刻意的：
    // 激活刚完成时立刻 ping 没有意义。
    state.t += 1000;
    monitor.tick();
    expect(state.pings, '建立跟踪的那一轮不应发 ping').toHaveLength(0);

    state.t += 1000;
    monitor.tick();
    expect(state.pings, '到间隔后应发出 ping').toHaveLength(1);
    expect(state.pings[0].pluginId).toBe('ext-a');
  });

  it('pong 丢失（事件循环被堵死）→ 判定卡死并终止', () => {
    const { state, monitor } = makeHost();
    // 前几轮正常：ping 会得到 pong
    for (let i = 0; i < 3; i++) {
      state.t += 1000;
      monitor.tick();
    }
    expect(state.terminated).toEqual([]);

    // 现在 worker 卡死：pong 不再回来
    state.pongsEnabled = false;
    state.t += 1000; // 发 ping（无 pong）
    monitor.tick();
    state.t += 500; // 到达 grace 边界
    const verdicts = monitor.tick();

    expect(
      verdicts.map((v) => v.pluginId),
      'pong 丢失且已过宽限期应判定卡死',
    ).toEqual(['ext-a']);
    expect(state.terminated.map((t) => t.pluginId)).toEqual(['ext-a']);
  });

  it('【反向对照】未决 ping 必须按「发出多久」判定，而非假定 pong 已到', () => {
    // 初版 tick() 的缺陷：看到未决 ping 就直接清掉并刷新 lastSeen，
    // 于是卡死 worker 每轮都走这条分支，**永远不被告警**，阈值形同虚设。
    // 本用例锁死正确语义：pending ping 必须在 graceMs 后独立到期。
    const { state, monitor } = makeHost();
    state.pongsEnabled = false;

    state.t += 1000; // 首轮：建立跟踪
    monitor.tick();
    state.t += 1000; // 到间隔 → 发 ping
    monitor.tick();

    // 明确断言「发 ping 那一轮不判定」——宽限期还没用完
    state.t += 100;
    expect(monitor.tick(), '宽限期内不得判卡死').toEqual([]);

    // 越过宽限期
    state.t += 400; // 距 ping 发出 500ms >= graceMs 500
    expect(
      monitor.tick().map((v) => v.pluginId),
      '越过宽限期必须判定卡死',
    ).toEqual(['ext-a']);
  });

  it('同一插件只终止一次（不重复报）', () => {
    const { state, monitor } = makeHost();
    state.pongsEnabled = false;
    state.t += 1000;
    monitor.tick(); // 建立跟踪
    state.t += 1000;
    monitor.tick(); // 发 ping（无 pong）
    state.t += 500;
    monitor.tick(); // 越过宽限期 → 判定并终止
    expect(state.terminated.length, '越过宽限期应终止一次').toBe(1);

    // 再跑很多轮，不应重复终止
    for (let i = 0; i < 10; i++) {
      state.t += 1000;
      monitor.tick();
    }
    expect(state.terminated.length, '卡死只应被报告一次，否则会反复 terminate').toBe(1);
  });

  it('stopTracking 后该插件不再被探活（停用/卸载必须清理）', () => {
    const { state, monitor } = makeHost();
    monitor.startTracking('ext-a');
    monitor.stopTracking('ext-a');

    state.t += 1000;
    monitor.tick(); // 重新建立跟踪
    const afterRestart = state.pings.length;

    for (let i = 0; i < 10; i++) {
      state.t += 1000;
      monitor.tick();
    }
    expect(state.pings.length, 'stopTracking 后状态被清空，应重新走「建立跟踪」而非沿用旧状态').toBeGreaterThan(
      afterRestart,
    );
    expect(state.terminated).toEqual([]);
  });

  it('只探活 running 的 worker', () => {
    const { state, monitor } = makeHost(['ext-a', 'ext-b']);
    monitor.startTracking('ext-a');
    monitor.startTracking('ext-b');
    state.running.delete('ext-b');

    state.t += 1000;
    monitor.tick();
    state.t += 1000;
    monitor.tick();
    expect(
      state.pings.map((p) => p.pluginId),
      '已停用的插件不该被 ping',
    ).not.toContain('ext-b');
  });

  it('sendPing 抛错不构成卡死证据（transport dispose ≠ worker 卡死）', () => {
    const { state, monitor } = makeHost();
    monitor.startTracking('ext-a');
    state.pingThrows = true;

    state.t += 1000;
    monitor.tick();
    state.t += 1000;
    monitor.tick(); // sendPing 抛错
    state.t += 2000;
    monitor.tick();

    expect(
      state.terminated,
      'transport 已 dispose 时终止 worker 是错的 —— 那会让停用流程反过来杀掉自己的 worker',
    ).toEqual([]);
  });

  it('disabled 时完全不工作', () => {
    const { state, monitor } = makeHost();
    const off = new WorkerLivenessMonitor(
      {
        listRunningPluginIds: () => ['ext-a'],
        sendPing: () => state.pings.push({ pluginId: 'ext-a', seq: 1 }),
        terminate: () => state.terminated.push({ pluginId: 'ext-a', reason: '' }),
        now: () => state.t,
      },
      { disabled: true },
    );

    for (let i = 0; i < 20; i++) {
      state.t += 1000;
      off.tick();
    }
    off.start();
    expect(state.pings).toEqual([]);
    expect(state.terminated).toEqual([]);
  });

  it('定时器句柄被记录，stop() 能清干净（审计 C-6 同源坑：僵尸定时器）', () => {
    vi.useFakeTimers();
    try {
      const { state, monitor } = makeHost();
      monitor.start();
      const spy = vi.spyOn(monitor, 'tick');
      vi.advanceTimersByTime(1000);
      expect(spy, '定时器未按 interval 触发').toHaveBeenCalled();

      monitor.stop();
      const callsBefore = spy.mock.calls.length;
      vi.advanceTimersByTime(10_000);
      expect(spy.mock.calls.length, 'stop() 之后定时器仍在跑 —— 会给已停用插件继续发 ping').toBe(callsBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it('默认阈值可读且与环境变量无关（构造时显式传入优先）', () => {
    const { monitor } = makeHost();
    expect(monitor.intervalMs).toBe(1000);
    expect(monitor.graceMs).toBe(500);
    expect(LIVENESS_DEFAULTS.intervalMs).toBe(30_000);
    expect(LIVENESS_DEFAULTS.graceMs).toBe(15_000);
  });

  it('noteActivity 让任意入站消息都算存活（不只认 pong）', () => {
    const { state, monitor } = makeHost();
    state.pongsEnabled = false; // pong 全丢
    monitor.startTracking('ext-a');

    // 插件持续有其他流量（RPC 响应等），只是不回 pong
    for (let i = 0; i < 10; i++) {
      state.t += 1000;
      monitor.noteActivity('ext-a');
      monitor.tick();
    }
    expect(
      state.terminated,
      'worker 有持续消息往来却因不回 pong 被杀 —— 说明「只认 pong」会误杀高频通信的插件',
    ).toEqual([]);
  });
});
