/**
 * OpenLearn AI Capability Kernel
 * Master orchestrator unifying Capability Registry, Telemetry Logger, and Core Domain Capabilities.
 */

import { CapabilityRegistry } from './registry/capability-registry.js';
import { CapabilityLogger } from './logging/capability-logger.js';
import { AIRuntimeKernel } from '../ai/index.js';
import { CompletionCapability } from './capabilities/completion-capability.js';
import { ChatCapability } from './capabilities/chat-capability.js';
import { ToolCapability } from './capabilities/tool-capability.js';
import { LessonCapability } from './capabilities/lesson-capability.js';
import { WhiteboardCapability } from './capabilities/whiteboard-capability.js';
import { AnalyticsCapability } from './capabilities/analytics-capability.js';
import { PluginCapability } from './capabilities/plugin-capability.js';

export class AICapabilityKernel {
  public readonly registry: CapabilityRegistry;
  public readonly logger: CapabilityLogger;
  public readonly runtimeKernel: AIRuntimeKernel;

  constructor(runtimeKernel: AIRuntimeKernel) {
    this.runtimeKernel = runtimeKernel;
    this.registry = new CapabilityRegistry();
    this.logger = new CapabilityLogger();

    this.registerStandardCapabilities();
  }

  private registerStandardCapabilities(): void {
    this.registry.registerCapability(new CompletionCapability(this.runtimeKernel, this.logger));
    this.registry.registerCapability(new ChatCapability(this.runtimeKernel, this.logger));
    this.registry.registerCapability(new ToolCapability(this.runtimeKernel, this.logger));
    this.registry.registerCapability(new LessonCapability(this.runtimeKernel, this.logger));
    this.registry.registerCapability(new WhiteboardCapability(this.runtimeKernel, this.logger));
    this.registry.registerCapability(new AnalyticsCapability(this.runtimeKernel, this.logger));
    this.registry.registerCapability(new PluginCapability(this.runtimeKernel, this.logger));
  }

  public dispose(): void {
    this.registry.clear();
    this.logger.clear();
  }
}
