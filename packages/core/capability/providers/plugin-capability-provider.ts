/**
 * OpenLearn Capability Invocation Framework - Plugin Capability Provider Adapter
 * Adapts ActionRegistry Actions & Commands into standard Capability Framework Handlers.
 */

import {
  CapabilityDescriptor,
  ICapabilityProviderHandler,
  InvocationRequest,
} from '../types/index.js';
import { CommandBus } from '../../command-bus/index.js';

export class PluginCapabilityProviderHandler implements ICapabilityProviderHandler {
  public readonly descriptor: CapabilityDescriptor;
  private commandBus: CommandBus;

  constructor(commandBus: CommandBus, commandType: string, description: string) {
    this.commandBus = commandBus;
    this.descriptor = {
      id: `cap_cmd_${commandType}`,
      name: `Command Capability: ${commandType}`,
      category: 'plugin',
      provider: 'plugin_capability_provider',
      permission: ['Teacher', 'System'],
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      metadata: { resultType: 'plugin_data' },
      tags: Object.freeze(['command', 'plugin']),
      version: '1.0.0',
    };
  }

  public async execute(request: InvocationRequest): Promise<unknown> {
    const cmdType = this.descriptor.id.replace('cap_cmd_', '');
    return this.commandBus.execute({
      id: `cmd_${globalThis.crypto.randomUUID()}`,
      type: cmdType,
      actorId: request.context.teacherId || request.context.studentId || 'system',
      timestamp: Date.now(),
      payload: request.payload,
    });
  }
}
