import { describe, it, expect, vi } from 'vitest';
import type { PluginContext } from '@openlearn/plugin-sdk';
import { ClassroomFlowServerPlugin } from '../classroom-flow-server.js';

interface ActionDescriptorView {
  commandType: string;
  capabilityRequired: string;
  exposeToAgent?: boolean;
  [key: string]: unknown;
}
type CommandHandler = { execute: (command: { actorId: string; payload: unknown }) => Promise<unknown> };

/** 构造一个最小 PluginContext mock：resolve 按 token 名返回对应服务 */
function makeCtx(services: Record<string, unknown>): PluginContext {
  return {
    resolve: vi.fn(async (token: { name: string }) => services[token.name]),
  } as unknown as PluginContext;
}

describe('ClassroomFlowServerPlugin — classroom.sendMessage 命令', () => {
  it('注册 ActionDescriptor（lesson:write / 非 Agent 工具）与 handler', async () => {
    const registered: ActionDescriptorView[] = [];
    const handlers: Record<string, CommandHandler> = {};
    const actionRegistry = { register: vi.fn(async (d: ActionDescriptorView) => registered.push(d)) };
    const commandBus = {
      registerHandler: vi.fn(async (type: string, h: CommandHandler) => {
        handlers[type] = h;
      }),
    };
    const messageService = {
      send: vi.fn(() => ({ ok: true, messageId: 'm1', seq: 1 })),
      registerChannel: vi.fn(() => ({ ok: true })),
    };
    const submissionRegistry = { register: vi.fn(() => ({ ok: true })) };
    const db = { prepare: vi.fn() };
    const ctx = makeCtx({
      '@openlearn/core:ICommandBusService': commandBus,
      '@openlearn/core:IActionRegistryService': actionRegistry,
      '@openlearn/core:IClassroomMessageService': messageService,
      '@openlearn/core:IDatabase': db,
      '@openlearn/submission-adapter:IRegistry': submissionRegistry,
    });

    await ClassroomFlowServerPlugin.activate(ctx);

    expect(messageService.registerChannel).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'xuean:task', shared: true }),
    );
    expect(submissionRegistry.register).toHaveBeenCalled();
    expect(registered).toHaveLength(1);
    expect(registered[0].commandType).toBe('classroom.sendMessage');
    expect(registered[0].capabilityRequired).toBe('lesson:write');
    expect(registered[0].exposeToAgent).toBe(false);
    expect(handlers['classroom.sendMessage']).toBeDefined();
  });

  it('handler 派生 plugin actor 归属并调用 send；失败抛错', async () => {
    const handlers: Record<string, CommandHandler> = {};
    const commandBus = {
      registerHandler: vi.fn(async (type: string, h: CommandHandler) => {
        handlers[type] = h;
      }),
    };
    const actionRegistry = { register: vi.fn(async () => {}) };
    const send = vi.fn((input: Record<string, unknown>) =>
      input.channel === 'bad'
        ? { ok: false, code: 'CHANNEL_NOT_REGISTERED', error: 'nope' }
        : { ok: true, messageId: 'm1', seq: 7 },
    );
    const ctx = makeCtx({
      '@openlearn/core:ICommandBusService': commandBus,
      '@openlearn/core:IActionRegistryService': actionRegistry,
      '@openlearn/core:IClassroomMessageService': { send, registerChannel: vi.fn(() => ({ ok: true })) },
      '@openlearn/core:IDatabase': { prepare: vi.fn() },
      '@openlearn/submission-adapter:IRegistry': { register: vi.fn(() => ({ ok: true })) },
    });
    await ClassroomFlowServerPlugin.activate(ctx);
    const handler = handlers['classroom.sendMessage'];

    const ok = await handler.execute({
      actorId: 'plugin:ext-xuean',
      payload: { channel: 'xuean:task', msgType: 'request', payload: { step: 1 }, targetUserIds: ['stu-1'] },
    });
    expect(ok).toMatchObject({ ok: true, seq: 7 });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'xuean:task',
        senderPluginId: 'ext-xuean',
        senderRole: 'plugin',
        senderActorId: 'plugin:ext-xuean',
      }),
    );

    await expect(
      handler.execute({ actorId: 'plugin:ext-x', payload: { channel: 'bad', msgType: 'request', payload: {} } }),
    ).rejects.toThrow('CHANNEL_NOT_REGISTERED');
  });
});
