/**
 * OpenLearn Capability Invocation Framework - AI Capability Provider Adapter
 * Adapts AI Capability Layer into standard Capability Framework Handlers.
 */

import {
  CapabilityDescriptor,
  ICapabilityProviderHandler,
  InvocationRequest,
} from '../types/index.js';
import { AICapabilityKernel } from '../../ai-capability/index.js';

export class AICapabilityProviderHandler implements ICapabilityProviderHandler {
  public readonly descriptor: CapabilityDescriptor;
  private aiCapabilityKernel: AICapabilityKernel;

  constructor(aiCapabilityKernel: AICapabilityKernel) {
    this.aiCapabilityKernel = aiCapabilityKernel;
    this.descriptor = {
      id: 'cap_ai_completion',
      name: 'AI Completion Capability',
      category: 'ai',
      provider: 'ai_capability_provider',
      permission: ['Teacher', 'Student', 'Plugin', 'AI', 'System'],
      inputSchema: { type: 'object', properties: { prompt: { type: 'string' } } },
      outputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      metadata: { resultType: 'markdown' },
      tags: Object.freeze(['ai', 'text', 'completion']),
      version: '1.0.0',
    };
  }

  public async execute(request: InvocationRequest): Promise<unknown> {
    const prompt = (request.payload.prompt as string) || '';
    const completionCap = this.aiCapabilityKernel.registry.resolveCapability<import('../../ai-capability/index.js').ICompletionCapability>('capability_completion');
    return completionCap.complete(prompt);
  }
}
