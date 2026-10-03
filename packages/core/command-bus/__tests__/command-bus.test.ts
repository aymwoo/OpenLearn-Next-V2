import { describe, it, expect, vi } from 'vitest';
import { CommandBus, PlatformCommand } from '../index.js';
import { EventBus } from '../../event-bus/index.js';

describe('CommandBus', () => {
  const createMockEventBus = () => new EventBus();

  it('registers and executes a command successfully', async () => {
    const bus = new CommandBus(createMockEventBus());
    const handler = {
      execute: vi.fn().mockResolvedValue({ status: 'done' }),
    };

    bus.registerHandler('lesson.create', handler);

    const cmd = bus.createCommand('lesson.create', { title: 'Math 101' }, 'teacher-1');
    const result = await bus.execute(cmd);

    expect(result).toEqual({ status: 'done' });
    expect(handler.execute).toHaveBeenCalledTimes(1);
    expect(handler.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'lesson.create',
        actorId: 'teacher-1',
        payload: { title: 'Math 101' },
      }),
    );
  });

  it('throws error when registering duplicate command handlers', () => {
    const bus = new CommandBus(createMockEventBus());
    const handler = { execute: vi.fn() };

    bus.registerHandler('test.cmd', handler);
    expect(() => {
      bus.registerHandler('test.cmd', handler);
    }).toThrow(/already registered/);
  });

  it('throws error when executing an unregistered command', async () => {
    const bus = new CommandBus(createMockEventBus());
    const cmd = bus.createCommand('non.existent', {}, 'user-1');

    await expect(bus.execute(cmd)).rejects.toThrow(/No handler registered/);
  });

  it('supports unregistering command handlers', async () => {
    const bus = new CommandBus(createMockEventBus());
    const handler = { execute: vi.fn() };

    bus.registerHandler('test.delete', handler);
    bus.unregisterHandler('test.delete');

    const cmd = bus.createCommand('test.delete', {}, 'user-1');
    await expect(bus.execute(cmd)).rejects.toThrow(/No handler registered/);
  });

  it('executes through interceptor when set', async () => {
    const bus = new CommandBus(createMockEventBus());
    const handler = { execute: vi.fn().mockResolvedValue('ok') };
    bus.registerHandler('secure.action', handler);

    const interceptor = vi.fn().mockImplementation(async (command: PlatformCommand) => {
      if (command.actorId === 'unauthorized') {
        throw new Error('Access denied by interceptor');
      }
    });

    bus.setInterceptor(interceptor);

    // Permitted execution
    const validCmd = bus.createCommand('secure.action', {}, 'authorized-user');
    await expect(bus.execute(validCmd)).resolves.toBe('ok');
    expect(interceptor).toHaveBeenCalledTimes(1);

    // Blocked execution
    const blockedCmd = bus.createCommand('secure.action', {}, 'unauthorized');
    await expect(bus.execute(blockedCmd)).rejects.toThrow('Access denied by interceptor');
    expect(handler.execute).toHaveBeenCalledTimes(1); // Not called a second time
  });

  it('handles legacy handler fallback correctly (D-11 priority routing)', async () => {
    const bus = new CommandBus(createMockEventBus());
    const modernHandler = { execute: vi.fn().mockResolvedValue('modern-result') };
    const legacyHandler = { execute: vi.fn().mockResolvedValue('legacy-result') };

    // Register only legacy handler first
    bus.registerLegacyHandler('compat.command', legacyHandler);

    const cmd = bus.createCommand('compat.command', {}, 'user-1');
    const res1 = await bus.execute(cmd);
    expect(res1).toBe('legacy-result');
    expect(legacyHandler.execute).toHaveBeenCalledTimes(1);

    // Now register modern handler — modern handler should take priority
    bus.registerHandler('compat.command', modernHandler);

    const res2 = await bus.execute(cmd);
    expect(res2).toBe('modern-result');
    expect(modernHandler.execute).toHaveBeenCalledTimes(1);
    expect(legacyHandler.execute).toHaveBeenCalledTimes(1); // Not called again
  });

  it('defaults actorId to agent-system-0 when omitted', async () => {
    const bus = new CommandBus(createMockEventBus());
    let capturedActorId = '';

    bus.registerHandler('system.ping', {
      execute: async (cmd) => {
        capturedActorId = cmd.actorId;
      },
    });

    await bus.execute({
      id: 'cmd-1',
      type: 'system.ping',
      actorId: '',
      payload: {},
    });

    expect(capturedActorId).toBe('agent-system-0');
  });
});
