/**
 * G-1 回归测试：commandBus interceptor 的 **default-deny** 语义。
 *
 * 背景（审计 H-1）：interceptor 此前写成 `if (action) { ... }` 且**无 else 分支**，
 * 等价于 default-allow —— 任何只调用 `commandBus.registerHandler()` 而未在
 * actionRegistry 登记的命令，对任意已登录角色（含 student）都无任何授权检查。
 * `/api/plugins/execute-command` 仅用 `requireAuth()`（任意角色），因此可被绕过。
 *
 * 修复：descriptor 缺失 ⇒ 无可执行的授权意图 ⇒ 拒绝派发。
 */
import { describe, it, expect } from 'vitest';
import { CommandBus } from '../command-bus/index.js';
import { EventBus } from '../event-bus/index.js';
import { ActionRegistry } from '../registry/index.js';

/**
 * 复刻 kernel/index.ts 中 interceptor 的判定结构（default-deny 分支）。
 * 这里刻意独立实现而非直接实例化 Kernel —— Kernel 会连 SQLite / 注册数十个服务，
 * 而本测试只需要验证「有无 action descriptor」这一个判定。
 */
function installInterceptor(bus: CommandBus, actionRegistry: ActionRegistry, opts: { isAdmin?: boolean } = {}) {
  const { isAdmin = false } = opts;
  bus.setInterceptor(async (command) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const action = actionRegistry.getActionByCommandType(command.type);
    if (action) {
      if (action.inputSchema) {
        // 生产实现此处还会跑 validateJsonSchema；本测试不校验 payload 形态
      }
      if (action.capabilityRequired && !isAdmin) {
        // 生产实现此处走 capabilityGuard.check()；本测试只关心分支走向
        return;
      }
      if (action.isHighRisk && command.metadata?.approved !== true && !isAdmin) {
        throw new Error(`[Security] Command ${command.type} requires human approval.`);
      }
      return;
    }
    // ← default-deny 分支（本次修复新增）
    throw new Error(`[Security] Command "${command.type}" has no registered action descriptor and is denied.`);
  });
}

async function dispatch(bus: CommandBus, type: string, actorId = 'user:u1:student') {
  const cmd = bus.createCommand(type, {}, actorId);
  return bus.execute(cmd);
}

/** CommandBus 构造需要 EventBus；本测试不关心事件，仅为满足构造签名 */
function newBus(): CommandBus {
  return new CommandBus(new EventBus());
}

describe('commandBus interceptor — default-deny（G-1）', () => {
  it('无 action descriptor 的命令被拒绝（即使 actor 已登录）', async () => {
    const bus = newBus();
    const actionRegistry = new ActionRegistry();
    installInterceptor(bus, actionRegistry);

    let handlerRan = false;
    bus.registerHandler('rogue.command', {
      execute: async () => {
        handlerRan = true;
        return 'should-not-happen';
      },
    });

    await expect(dispatch(bus, 'rogue.command')).rejects.toThrow(/no registered action descriptor/);
    expect(handlerRan).toBe(false);
  });

  it('有 action descriptor 的命令正常派发', async () => {
    const bus = newBus();
    const actionRegistry = new ActionRegistry();
    installInterceptor(bus, actionRegistry);

    actionRegistry.register({
      id: 'ok',
      commandType: 'ok.command',
      description: 'ok',
      inputSchema: { type: 'OBJECT', properties: {}, required: [] },
      capabilityRequired: 'lesson:read',
    });
    bus.registerHandler('ok.command', { execute: async () => 'done' });

    await expect(dispatch(bus, 'ok.command')).resolves.toBe('done');
  });

  it('管理员也不绕过 descriptor 缺失（default-deny 与角色无关）', async () => {
    const bus = newBus();
    const actionRegistry = new ActionRegistry();
    installInterceptor(bus, actionRegistry, { isAdmin: true });

    bus.registerHandler('admin.rogue', { execute: async () => 'ran' });

    await expect(dispatch(bus, 'admin.rogue', 'role:administrator')).rejects.toThrow(/no registered action descriptor/);
  });

  it('错误信息包含命令类型，便于实现方定位（不泄露内部结构）', async () => {
    const bus = newBus();
    const actionRegistry = new ActionRegistry();
    installInterceptor(bus, actionRegistry);
    bus.registerHandler('x.y', { execute: async () => 1 });

    await expect(dispatch(bus, 'x.y')).rejects.toThrow(/x\.y/);
  });

  it('exposeToAgent:false 不影响派发 —— 它只管工具箱，不管授权（D-5 正交性）', async () => {
    const bus = newBus();
    const actionRegistry = new ActionRegistry();
    installInterceptor(bus, actionRegistry);

    actionRegistry.register({
      id: 'hidden',
      commandType: 'hidden.command',
      description: 'hidden from agent',
      inputSchema: { type: 'OBJECT', properties: {}, required: [] },
      capabilityRequired: 'lesson:write',
      exposeToAgent: false,
    });
    bus.registerHandler('hidden.command', { execute: async () => 'still-runs' });

    // 程序化路径不受 exposeToAgent 影响
    await expect(dispatch(bus, 'hidden.command')).resolves.toBe('still-runs');
    // 但确实不在 agent 工具箱里
    const [first] = actionRegistry.getAgentTools() as Array<{ functionDeclarations?: Array<{ name: string }> }>;
    expect(first?.functionDeclarations ?? []).toEqual([]);
  });
});
