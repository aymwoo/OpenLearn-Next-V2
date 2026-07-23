/**
 * OpenLearn AI Capability Layer - Completion Capability
 * Implements fast text completion without LLM direct coupling.
 */

import { ICompletionCapability, AICapabilityMeta } from '../types/index.js';
import { AIRuntimeKernel } from '../../ai/index.js';
import { CapabilityLogger } from '../logging/capability-logger.js';

export class CompletionCapability implements ICompletionCapability {
  public readonly meta: AICapabilityMeta = {
    id: 'capability_completion',
    name: 'Text Completion Capability',
    type: 'completion',
    description: 'Kernel-level text completion capability',
    version: '1.0.0',
  };

  private runtimeKernel: AIRuntimeKernel;
  private logger: CapabilityLogger;

  constructor(runtimeKernel: AIRuntimeKernel, logger: CapabilityLogger) {
    this.runtimeKernel = runtimeKernel;
    this.logger = logger;
  }

  public async complete(
    prompt: string,
    options?: { systemInstruction?: string; temperature?: number }
  ): Promise<string> {
    const startTime = Date.now();
    try {
      const result = await this.runtimeKernel.providerGateway.generateText(prompt, options);

      this.logger.log({
        capabilityId: this.meta.id,
        requestPayload: { prompt, options },
        responsePayload: { result },
        latencyMs: Date.now() - startTime,
        providerId: 'provider_gateway',
        tokenCount: result.length,
        timestamp: Date.now(),
      });

      return result;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.log({
        capabilityId: this.meta.id,
        requestPayload: { prompt, options },
        responsePayload: null,
        latencyMs: Date.now() - startTime,
        providerId: 'provider_gateway',
        error: errorMsg,
        timestamp: Date.now(),
      });
      throw err;
    }
  }
}
