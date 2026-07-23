/**
 * OpenLearn AI Capability Layer - Plugin Capability
 * Safe plugin AI capability preventing direct provider couplings.
 */

import { IPluginCapability, AICapabilityMeta } from '../types/index.js';
import { AIRuntimeKernel } from '../../ai/index.js';
import { CapabilityLogger } from '../logging/capability-logger.js';

export class PluginCapability implements IPluginCapability {
  public readonly meta: AICapabilityMeta = {
    id: 'capability_plugin',
    name: 'Plugin AI Invocation Capability',
    type: 'plugin',
    description: 'Provides safe, provider-agnostic AI invocation interface for third-party plugins',
    version: '1.0.0',
  };

  private runtimeKernel: AIRuntimeKernel;
  private logger: CapabilityLogger;

  constructor(runtimeKernel: AIRuntimeKernel, logger: CapabilityLogger) {
    this.runtimeKernel = runtimeKernel;
    this.logger = logger;
  }

  public async invokeAI(
    pluginId: string,
    prompt: string,
    options?: Record<string, unknown>
  ): Promise<string> {
    const startTime = Date.now();
    try {
      const result = await this.runtimeKernel.providerGateway.generateText(prompt, {
        temperature: (options?.temperature as number) ?? 0.3,
        systemInstruction: options?.systemInstruction as string,
      });

      this.logger.log({
        capabilityId: this.meta.id,
        requestPayload: { pluginId, prompt, options },
        responsePayload: { result },
        latencyMs: Date.now() - startTime,
        providerId: 'provider_gateway',
        timestamp: Date.now(),
      });

      return result;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.log({
        capabilityId: this.meta.id,
        requestPayload: { pluginId, prompt, options },
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
