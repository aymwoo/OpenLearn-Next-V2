/**
 * B-5：后端 worker / inline 路径的方法级收窄与跨插件边界
 *
 * ## 审计背景
 *
 * `packages/core/worker-runtime/service-host.ts` 原本只有 Barrier 1（Token 白名单）
 * 与 Barrier 2（空 manifest 降级只读），**没有 Barrier 3** —— 方法级策略只存在于
 * 浏览器侧 `src/plugin-host/method-policy.ts`，两端各写一套，规则漂移无从察觉。
 *
 * ## 本次实测确认的两个跨插件漏洞
 *
 * ① **taskType 全局冲突**
 *    `ProcessManager.handlers` 是全局 Map，`registerHandler` 直接 `set(taskType, handler)`。
 *    实测两个插件都 `registerHandler('shared-task')`：
 *      handlers 表大小 = 1；spawn 派发时先注册者的 handler 调用 **0 次**。
 *    → 插件 A 的后台任务处理器被插件 B 无声吃掉。
 *
 * ② **kill 无归属校验**
 *    `ProcessManager.kill(processId)` 只按 id UPDATE 进程表；而 processId 经
 *    **全局事件总线** `process.spawned` 广播，任何插件订阅即可拿到他人进程 id。
 *    → 插件可以杀掉别的插件的后台任务。
 *
 * 修复：① taskType 加 `<pluginId>::` 命名空间前缀；② `processes` 表加 `plugin_id` 列，
 * kill 前做归属校验。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { checkMethodPolicy } from '../plugin-host/method-policy.js';
import { ServiceHost } from '../worker-runtime/service-host.js';
import { wrapProcessManager as wrapProcessManagerForTest } from '../plugin-host/context-builder.js';
import { ResourceTracker } from '../plugin-host/resource-tracker.js';

// 后端 Token 名集合，必须与 service-host.ts 的 CORE_WORKER_TOKENS 一致
const CORE = {
  storageService: '@openlearn/core:IStorageService',
  aiService: '@openlearn/core:IAIService',
  processService: '@openlearn/core:IProcessService',
  actionRegistry: '@openlearn/core:IActionRegistryService',
} as const;

describe('B-5 · 共享 method-policy（后端视角）', () => {
  const policy = (token: string, method: string, caps: string[] = [], args: unknown = undefined) =>
    checkMethodPolicy({ token, method, args, caps, tokens: CORE });

  describe('IProcessService', () => {
    it('registerHandler / registerInterval 需 task:register 能力', () => {
      expect(policy(CORE.processService, 'registerHandler')).toContain('task:register');
      expect(policy(CORE.processService, 'registerInterval')).toContain('task:register');
    });

    it('restore 需 task:register —— 它会重放全部插件的 running 进程', () => {
      // ProcessManager.restore() 是 `SELECT * FROM processes WHERE status='running'`
      // 再逐个 resume，**没有 owner 过滤** —— 含其他插件的任务。
      expect(policy(CORE.processService, 'restore')).toContain('task:register');
    });

    it('声明能力后放行', () => {
      expect(policy(CORE.processService, 'registerHandler', ['task:register'])).toBeNull();
      expect(policy(CORE.processService, 'restore', ['task:register'])).toBeNull();
      // 只读/管理方法不需要能力
      expect(policy(CORE.processService, 'kill')).toBeNull();
    });
  });

  describe('IAIService', () => {
    it('generateText 需 ai:invoke 能力', () => {
      expect(policy(CORE.aiService, 'generateText')).toContain('ai:invoke');
      expect(policy(CORE.aiService, 'generateText', ['ai:invoke'])).toBeNull();
    });
  });

  describe('IActionRegistryService', () => {
    it('未设 exposeToAgent 的 action 需 agent:tool（默认进入 AI 工具列表）', () => {
      expect(policy(CORE.actionRegistry, 'register', [], [{ id: 'a' }])).toContain('agent:tool');
      expect(policy(CORE.actionRegistry, 'register', ['agent:tool'], [{ id: 'a' }])).toBeNull();
    });

    it('显式 exposeToAgent:false 的 action 无需能力', () => {
      expect(policy(CORE.actionRegistry, 'register', [], [{ id: 'a', exposeToAgent: false }])).toBeNull();
    });

    it('unregister 不需能力（撤回自己暴露的工具是正当操作）', () => {
      expect(policy(CORE.actionRegistry, 'unregister', [], ['a'])).toBeNull();
      expect(policy(CORE.actionRegistry, 'getAllActions')).toBeNull();
    });
  });

  it('未列入策略的 Token 不在此层裁决（交回 Barrier 1 白名单）', () => {
    expect(policy('@openlearn/core:ICommandBusService', 'execute')).toBeNull();
    expect(policy('@openlearn/core:IEventBusService', 'publish')).toBeNull();
  });

  it('能力匹配语义：* 通配；声明更具体的能力蕴含其基类', () => {
    // hasCapability 的语义是「声明 `name:*` 或 `*` 即拥有 name」——
    // 即**更具体蕴含更宽松**。反过来 `task:admin` 并不蕴含 `task:register`
    // （它们是兄弟关系，不是父子），这一点容易误判，故在此锁定。
    expect(policy(CORE.aiService, 'generateText', ['*'])).toBeNull();
    expect(policy(CORE.processService, 'restore', ['task:register'])).toBeNull();
    // 声明 `task:register:long` 蕴含 `task:register`
    expect(policy(CORE.processService, 'restore', ['task:register:long'])).toBeNull();
    // 兄弟能力不蕴含
    expect(policy(CORE.processService, 'restore', ['task:admin'])).toContain('task:register');
    expect(policy(CORE.processService, 'restore', ['task:*'])).toContain('task:register');
  });
});

describe('B-5 · ServiceHost Barrier 3 已接线', () => {
  let transport: any;
  let serviceRegistry: any;
  let capGuard: any;

  beforeEach(() => {
    transport = { postMessage: vi.fn(), onMessage: vi.fn() };
    const aiService = { generateText: vi.fn(async () => 'ok') };
    // ServiceHost.resolveService 优先走 `resolveByName(name)`（按**字符串**名解析），
    // 只有它不存在时才回落到 `resolve(new Token(name))`。桩要按真实路径提供。
    serviceRegistry = {
      resolve: vi.fn(async () => undefined),
      resolveByName: vi.fn(async (name: string) => (name === '@openlearn/core:IAIService' ? aiService : undefined)),
      register: vi.fn(),
    };
    capGuard = { check: vi.fn(() => true), grant: vi.fn(), revokeAll: vi.fn() };
  });

  afterEach(() => vi.restoreAllMocks());

  it('未声明 ai:invoke 时 generateText 被 Barrier 3 拒绝，且未执行到服务', async () => {
    const host = new ServiceHost(serviceRegistry, capGuard, 'plugin:x', ['some:cap']);
    await host.handleInvoke(
      { type: 'invoke', invokeId: 'i1', token: '@openlearn/core:IAIService', method: 'generateText', args: ['hi'] },
      transport,
    );
    const msg = transport.postMessage.mock.calls[0][0];
    expect(msg.type).toBe('error');
    expect(JSON.stringify(msg)).toContain('ai:invoke');
  });

  it('声明 ai:invoke 后放行', async () => {
    const host = new ServiceHost(serviceRegistry, capGuard, 'plugin:x', ['ai:invoke']);
    await host.handleInvoke(
      { type: 'invoke', invokeId: 'i2', token: '@openlearn/core:IAIService', method: 'generateText', args: ['hi'] },
      transport,
    );
    const msg = transport.postMessage.mock.calls[0][0];
    if (msg.type !== 'result') {
      // 失败时把完整消息打出来，便于定位是哪一层拒绝
      throw new Error(`expected result, got: ${JSON.stringify(msg)}`);
    }
    expect(msg.type).toBe('result');
  });

  it('Barrier 3 早于 Barrier 2 判定（manifest 非空但方法被策略拒绝）', async () => {
    const host = new ServiceHost(serviceRegistry, capGuard, 'plugin:x', ['some:cap']);
    await host.handleInvoke(
      { type: 'invoke', invokeId: 'i3', token: '@openlearn/core:IAIService', method: 'generateText', args: [] },
      transport,
    );
    expect(transport.postMessage.mock.calls[0][0].type).toBe('error');
  });
});

describe('B-5 · 跨插件边界：taskType 命名空间与 kill 归属', () => {
  /** 最小 processService 桩：记录注册/注销的 taskType，可查归属 */
  function mkProcessService(owners: Record<string, string> = {}) {
    const registered = new Map<string, unknown>();
    return {
      registered,
      owners,
      registerHandler: vi.fn(async (taskType: string) => {
        registered.set(taskType, true);
      }),
      unregisterHandler: vi.fn(async (taskType: string) => {
        registered.delete(taskType);
      }),
      spawn: vi.fn(async (_name: string, _taskType: string, _payload: unknown, _ownerHint?: string) => 'pid-new'),
      kill: vi.fn(async () => {}),
      registerInterval: vi.fn(async (_name: string, _intervalMs: number, _tick: unknown, _ownerHint?: string) => 'pid-new'),
      restore: vi.fn(async () => {}),
      getProcessOwner: (pid: string) => owners[pid],
    };
  }

  it('两个插件注册同名 taskType 时互不覆盖', async () => {
    const svc = mkProcessService();
    const wrapA = wrapProcessManagerForTest(svc, new ResourceTracker(), 'plugin-a');
    const wrapB = wrapProcessManagerForTest(svc, new ResourceTracker(), 'plugin-b');

    await wrapA.registerHandler('shared-task', vi.fn());
    await wrapB.registerHandler('shared-task', vi.fn());

    // 修复前：全局 Map 只有一个 key，后者顶掉前者
    expect(svc.registerHandler.mock.calls.map((c) => c[0])).toEqual(['plugin-a::shared-task', 'plugin-b::shared-task']);
  });

  it('spawn 与 registerHandler 用同一前缀，任务能派发回自己的 handler', async () => {
    const svc = mkProcessService();
    const wrap = wrapProcessManagerForTest(svc, new ResourceTracker(), 'plugin-a');
    await wrap.registerHandler('my-task', vi.fn());
    await wrap.spawn('job', 'my-task', {});
    const regKey = svc.registerHandler.mock.calls[0][0];
    const spawnKey = svc.spawn.mock.calls[0][1];
    expect(spawnKey, 'spawn 必须用与 registerHandler 相同的前缀，否则派发不到自己 handler').toBe(regKey);
  });

  it('已带前缀的 taskType 不重复加前缀', async () => {
    const svc = mkProcessService();
    const wrap = wrapProcessManagerForTest(svc, new ResourceTracker(), 'plugin-a');
    await wrap.spawn('job', 'plugin-a::already', {});
    expect(svc.spawn.mock.calls[0][1]).toBe('plugin-a::already');
  });

  it('kill 自己的进程放行', async () => {
    const svc = mkProcessService({ p1: 'plugin-a' });
    const wrap = wrapProcessManagerForTest(svc, new ResourceTracker(), 'plugin-a');
    await wrap.kill('p1');
    expect(svc.kill).toHaveBeenCalledWith('p1');
  });

  it('kill 别人的进程被拒（processId 经全局事件总线可被任意插件拿到）', async () => {
    const svc = mkProcessService({ p_other: 'plugin-b' });
    const wrap = wrapProcessManagerForTest(svc, new ResourceTracker(), 'plugin-a');
    await expect(wrap.kill('p_other')).rejects.toThrow('无权终止不属于本插件的进程');
    expect(svc.kill, '不得触达底层 kill').not.toHaveBeenCalled();
  });

  it('查不到归属时不拦截（存量行 / 内核自身任务 / 已清理）', async () => {
    const svc = mkProcessService({}); // 查不到任何归属
    const wrap = wrapProcessManagerForTest(svc, new ResourceTracker(), 'plugin-a');
    await expect(wrap.kill('unknown-pid')).resolves.toBeUndefined();
  });

  it('getProcessOwner 缺失时退化为不拦截（mock / 旧部署）', async () => {
    const svc: any = mkProcessService();
    delete svc.getProcessOwner;
    const wrap = wrapProcessManagerForTest(svc, new ResourceTracker(), 'plugin-a');
    await expect(wrap.kill('p_other')).resolves.toBeUndefined();
  });

  it('spawn / registerInterval 显式携带调用方插件 id（ownerHint，B-5）', async () => {
    const svc = mkProcessService();
    const wrap = wrapProcessManagerForTest(svc, new ResourceTracker(), 'plugin-a');
    await wrap.spawn('job', 'my-task', {});
    // spawn 第四参必须是调用方插件 id
    expect(svc.spawn.mock.calls[0][3]).toBe('plugin-a');
    await wrap.registerInterval('tick', 1000, () => {});
    // registerInterval 第四参同上
    expect(svc.registerInterval.mock.calls[0][3]).toBe('plugin-a');
  });

  it('disposeAll 清理时用的是带前缀的 key', async () => {
    const svc = mkProcessService();
    const tracker = new ResourceTracker();
    const wrap = wrapProcessManagerForTest(svc, tracker, 'plugin-a');
    await wrap.registerHandler('t1', vi.fn());
    tracker.disposeAll('plugin-a');
    expect(svc.unregisterHandler).toHaveBeenCalledWith('plugin-a::t1');
  });
});
