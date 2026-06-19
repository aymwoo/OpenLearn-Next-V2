import { describe, it, expect, beforeEach } from 'vitest';
import { CommandBus } from '../command-bus/index.js';
import { EventBus } from '../event-bus/index.js';

describe('CommandBus D-11 priority routing (modern > legacy)', () => {
  let commandBus: CommandBus;
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    commandBus = new CommandBus(eventBus);
  });

  it('executes modern handler when only modern handler is registered', async () => {
    const modernHandler = { execute: async () => 'modern-result' };
    commandBus.registerHandler('test.command', modernHandler);

    const command = commandBus.createCommand('test.command', {}, 'test-actor');
    const result = await commandBus.execute(command);
    expect(result).toBe('modern-result');
  });

  it('executes legacy handler when only legacy handler is registered', async () => {
    const legacyHandler = { execute: async () => 'legacy-result' };
    commandBus.registerLegacyHandler('test.command', legacyHandler);

    const command = commandBus.createCommand('test.command', {}, 'test-actor');
    const result = await commandBus.execute(command);
    expect(result).toBe('legacy-result');
  });

  it('prefers modern handler when both modern and legacy handlers are registered for same type', async () => {
    const modernHandler = { execute: async () => 'modern-result' };
    const legacyHandler = { execute: async () => 'legacy-result' };
    commandBus.registerHandler('test.command', modernHandler);
    commandBus.registerLegacyHandler('test.command', legacyHandler);

    const command = commandBus.createCommand('test.command', {}, 'test-actor');
    const result = await commandBus.execute(command);
    expect(result).toBe('modern-result');
  });

  it('throws error when no handler is registered for the command type', async () => {
    const command = commandBus.createCommand('nonexistent.command', {}, 'test-actor');
    await expect(commandBus.execute(command)).rejects.toThrow(
      'No handler registered for command: nonexistent.command',
    );
  });

  it('unregisters from both modern and legacy maps', async () => {
    const modernHandler = { execute: async () => 'modern' };
    const legacyHandler = { execute: async () => 'legacy' };
    commandBus.registerHandler('test.command', modernHandler);
    commandBus.registerLegacyHandler('test.command', legacyHandler);

    commandBus.unregisterHandler('test.command');

    const command = commandBus.createCommand('test.command', {}, 'test-actor');
    await expect(commandBus.execute(command)).rejects.toThrow(
      'No handler registered for command: test.command',
    );
  });

  it('legacy handler registration does not conflict with existing modern handler', async () => {
    const modernHandler = { execute: async () => 'modern-result' };
    commandBus.registerHandler('test.command', modernHandler);

    // Registering a legacy handler for the same type should not throw
    expect(() => {
      commandBus.registerLegacyHandler('test.command', { execute: async () => 'legacy' });
    }).not.toThrow();

    const command = commandBus.createCommand('test.command', {}, 'test-actor');
    const result = await commandBus.execute(command);
    expect(result).toBe('modern-result');
  });

  it('modern handler registration throws on duplicate modern type', async () => {
    commandBus.registerHandler('test.command', { execute: async () => 'first' });
    expect(() => {
      commandBus.registerHandler('test.command', { execute: async () => 'second' });
    }).toThrow('already registered');
  });
});
