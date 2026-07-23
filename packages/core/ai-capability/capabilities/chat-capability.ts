/**
 * OpenLearn AI Capability Layer - Chat Capability
 * Multi-turn agent chat capability linked with ConversationService.
 */

import { IChatCapability, AICapabilityMeta } from '../types/index.js';
import { AIRuntimeKernel } from '../../ai/index.js';
import { CapabilityLogger } from '../logging/capability-logger.js';

export class ChatCapability implements IChatCapability {
  public readonly meta: AICapabilityMeta = {
    id: 'capability_chat',
    name: 'Multi-turn Chat Capability',
    type: 'chat',
    description: 'Kernel-level multi-turn chat and session capability',
    version: '1.0.0',
  };

  private runtimeKernel: AIRuntimeKernel;
  private logger: CapabilityLogger;

  constructor(runtimeKernel: AIRuntimeKernel, logger: CapabilityLogger) {
    this.runtimeKernel = runtimeKernel;
    this.logger = logger;
  }

  public async chat(
    message: string,
    sessionId?: string
  ): Promise<{ reply: string; sessionId: string }> {
    const startTime = Date.now();

    let session = sessionId ? this.runtimeKernel.conversationService.getSession(sessionId) : undefined;
    if (!session) {
      session = this.runtimeKernel.conversationService.createSession('Chat Session');
    }

    this.runtimeKernel.conversationService.addMessage(session.id, 'user', message);

    try {
      const reply = await this.runtimeKernel.providerGateway.generateText(message);
      this.runtimeKernel.conversationService.addMessage(session.id, 'assistant', reply);

      this.logger.log({
        capabilityId: this.meta.id,
        requestPayload: { message, sessionId: session.id },
        responsePayload: { reply },
        latencyMs: Date.now() - startTime,
        providerId: 'provider_gateway',
        tokenCount: reply.length,
        timestamp: Date.now(),
      });

      return { reply, sessionId: session.id };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.log({
        capabilityId: this.meta.id,
        requestPayload: { message, sessionId: session.id },
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
