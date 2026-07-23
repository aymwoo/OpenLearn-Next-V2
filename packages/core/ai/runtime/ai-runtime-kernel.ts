/**
 * OpenLearn AI Infrastructure - Master AI Runtime Kernel
 * Master orchestrator unifying Provider Gateway, Prompt Registry, AI Context Service,
 * Tool Registry, Conversation Service, Streaming Service, Memory Service, and AI Event Bus.
 */

import { AIEventBus } from '../event/ai-event-bus.js';
import { AIProviderGateway } from '../provider/provider-gateway.js';
import { PromptRegistry } from '../prompt/prompt-registry.js';
import { AIContextService } from '../context/ai-context-service.js';
import { ToolRegistry } from '../tool/tool-registry.js';
import { ConversationService } from '../conversation/conversation-service.js';
import { StreamingService } from '../streaming/streaming-service.js';
import { MemoryService } from '../memory/memory-service.js';

export class AIRuntimeKernel {
  public readonly eventBus: AIEventBus;
  public readonly providerGateway: AIProviderGateway;
  public readonly promptRegistry: PromptRegistry;
  public readonly contextService: AIContextService;
  public readonly toolRegistry: ToolRegistry;
  public readonly conversationService: ConversationService;
  public readonly streamingService: StreamingService;
  public readonly memoryService: MemoryService;

  constructor() {
    this.eventBus = new AIEventBus();
    this.providerGateway = new AIProviderGateway(this.eventBus);
    this.promptRegistry = new PromptRegistry(this.eventBus);
    this.contextService = new AIContextService();
    this.toolRegistry = new ToolRegistry(this.eventBus);
    this.conversationService = new ConversationService(this.eventBus);
    this.streamingService = new StreamingService(this.eventBus);
    this.memoryService = new MemoryService();
  }

  public dispose(): void {
    this.eventBus.clear();
    this.toolRegistry.clear();
    this.conversationService.clear();
    this.memoryService.clear();
  }
}
