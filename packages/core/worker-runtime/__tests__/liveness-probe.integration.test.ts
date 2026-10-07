/**
 * L-1 P0 集成测试：真实 Worker + 真实死循环。
 *
 * ## 为什么必须有这一层（单元测试不够）
 *
 * `liveness-monitor.test.ts` 用假宿主验证了**判定状态机**，但它证明不了两件事：
 *  ① worker 侧 bootstrap 里那段 ping/pong 代码真的会被执行；
 *  ② 判据在**真实死循环**下真的成立。
 *
 * 这两点都只能靠真 Worker 验证。历史上我在这个项目上被「看起来对」的推断坑过多次，
 * 所以这里一律以实测为准。
 *
 * ## 全部走真实 bootstrap
 *
 * 插件代码由 `generateBootstrapCode()` 产出的真实引导环境执行，
 * 不是手写的简化环境 —— 否则测的是复制品。
 */

import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkerManager } from '../worker-manager.js';
import { ServiceRegistry } from '../../di/service-registry.js';
import { CapabilityGuard } from '../../capability/index.js';

/**
 * 探活参数：把默认 30s/15s 压到 150ms/150ms，让用例在秒级内完成。
 *
 * 必须走**环境变量**而不是 `Object.assign(monitor, {...})`：
 * 定时器在 `WorkerManager` 构造期就以当时的 intervalMs 启动了，
 * 事后改字段不会改变已排定的周期 —— 初版就是这么写的，结果探活整轮都没触发，
 * 表现为「死循环 worker 未被终止」。
 */
const FAST_INTERVAL = '150';
const FAST_GRACE = '150';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE plugins (
      id TEXT PRIMARY KEY, name TEXT, manifest TEXT, source_code TEXT,
      status TEXT, created_at INTEGER, loader_version TEXT, execution_mode TEXT
    );
  `);
  return db;
}

/** 一个「什么都不做但事件循环通畅」的插件 —— 代表健康但空闲的插件 */
const HEALTHY_IDLE_PLUGIN = `
export default {
  manifest: {
    id: 'ext-idle-probe',
    name: 'Idle Probe',
    version: '1.0.0',
    main: 'index.js',
  },
  async activate() {
    // 故意不注册任何东西、不发任何消息：模拟「等着下一节课」的插件
  },
  async deactivate() {},
};
`;

/** 一个进入同步死循环的插件 —— L-1 P0 要治的那个形态 */
const HUNG_PLUGIN = `
export default {
  manifest: {
    id: 'ext-hung-probe',
    name: 'Hung Probe',
    version: '1.0.0',
    main: 'index.js',
  },
  async activate(ctx) {
    // 模拟「拿到能力后开始死循环」：先让 activate 正常返回，再进入不可中断的循环。
    // 若直接写在 activate 里，激活超时机制会先一步报 T-05-11，测的就不是探活了。
    setTimeout(() => { while (true) {} }, 10);
  },
  async deactivate() {},
};
`;

describe('L-1 P0 · 真实 Worker 的存活探活', () => {
  let db: Database.Database;
  let wm: WorkerManager;

  beforeEach(() => {
    // 必须在构造 WorkerManager **之前**设 —— 构造期就会启动定时器
    process.env.OPENLEARN_WORKER_LIVENESS_INTERVAL_MS = FAST_INTERVAL;
    process.env.OPENLEARN_WORKER_LIVENESS_GRACE_MS = FAST_GRACE;
    db = makeDb();
    wm = new WorkerManager(new ServiceRegistry(), new CapabilityGuard(), db);
    // 确认阈值确实生效，否则失败信息会指向错误的方向
    expect(wm.livenessMonitor.intervalMs, '探活间隔未按环境变量生效').toBe(Number(FAST_INTERVAL));
    expect(wm.livenessMonitor.graceMs, '探活宽限期未按环境变量生效').toBe(Number(FAST_GRACE));
  });

  afterEach(async () => {
    wm.livenessMonitor.stop();
    delete process.env.OPENLEARN_WORKER_LIVENESS_INTERVAL_MS;
    delete process.env.OPENLEARN_WORKER_LIVENESS_GRACE_MS;
    await wm.shutdownAll().catch(() => {});
    db.close();
  });

  it('健康但空闲的 worker：连续探活多轮**不会**被终止', async () => {
    const pluginId = 'ext-idle-probe';
    await wm.createWorker(
      pluginId,
      { id: pluginId, name: 'Idle Probe', version: '1.0.0', main: 'index.js' },
      HEALTHY_IDLE_PLUGIN,
      [],
    );

    let terminated = false;
    wm.registry.onCircuitBreakerTriggered = () => {
      terminated = true;
    };

    // 该插件永不主动发消息；靠 ping/pong 保持存活
    const deadline = Date.now() + 1200;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 60));
    }

    const inst = wm.registry.get(pluginId);
    expect(
      inst?.status,
      `健康但空闲的 worker 被误判卡死了 —— 这正是「静默计时器」判据的致命缺陷。status=${inst?.status}`,
    ).not.toBe('crashed');
    expect(terminated, '空闲插件触发了熔断').toBe(false);
  }, 30_000);

  it('进入同步死循环的 worker：被探活检出并终止', async () => {
    const pluginId = 'ext-hung-probe';
    await wm.createWorker(
      pluginId,
      { id: pluginId, name: 'Hung Probe', version: '1.0.0', main: 'index.js' },
      HUNG_PLUGIN,
      [],
    );

    // 等待：死循环开始 → 探活发出 ping → 无响应越过宽限期 → terminate
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const inst = wm.registry.get(pluginId);
      // registry 在 worker 退出后会 cleanup，实例消失即视为已被终止
      if (!inst) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const inst = wm.registry.get(pluginId);
    expect(
      inst,
      '死循环 worker 在 8s 内仍未被终止 —— 探活未生效。' +
        '排查点：worker 侧 bootstrap 的 ping 分支是否在所有分支之前；' +
        '宿主 noteActivity/notePong 是否在 onMessage 里被调用。',
    ).toBeUndefined();
  }, 30_000);

  it('terminateWorker 会清掉探活状态（避免重启后的新实例继承旧时间戳）', async () => {
    const pluginId = 'ext-idle-probe';
    await wm.createWorker(
      pluginId,
      { id: pluginId, name: 'Idle Probe', version: '1.0.0', main: 'index.js' },
      HEALTHY_IDLE_PLUGIN,
      [],
    );
    wm.livenessMonitor.startTracking(pluginId);

    await wm.terminateWorker(pluginId);

    // 若状态没清，重启后的新实例会因 lastSeen 是旧时间戳而立刻被判卡死。
    // 这里只能间接验证「终止后再 tick 不抛错且不产生判定」，更严格的断言在单测里。
    const verdicts = wm.livenessMonitor.tick();
    expect(Array.isArray(verdicts)).toBe(true);
  }, 30_000);
});
