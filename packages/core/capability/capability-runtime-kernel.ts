/**
 * OpenLearn Master Capability Runtime Kernel
 * Master orchestrator unifying Framework Registry, Execution Pipeline, Invocation Engine, Event Bus, and SDK.
 */

import { CapabilityFrameworkRegistry } from './registry/capability-framework-registry.js';
import { CapabilityPipeline } from './pipeline/capability-pipeline.js';
import { InvocationEngine } from './invocation/invocation-engine.js';
import { CapabilityEventBus } from './event/capability-event-bus.js';
import { CapabilitySDK } from './sdk/capability-sdk.ts';
import { AICapabilityKernel } from '../ai-capability/index.js';
import { AICapabilityProviderHandler } from './providers/ai-capability-provider.js';
import { LessonCapabilityProviderHandler } from './providers/lesson-capability-provider.js';
import { AnalyticsCapabilityProviderHandler } from './providers/analytics-capability-provider.js';

export class CapabilityRuntimeKernel {
  public readonly registry: CapabilityFrameworkRegistry;
  public readonly pipeline: CapabilityPipeline;
  public readonly engine: InvocationEngine;
  public readonly eventBus: CapabilityEventBus;
  public readonly sdk: CapabilitySDK;

  constructor(aiCapabilityKernel?: AICapabilityKernel) {
    this.eventBus = new CapabilityEventBus();
    this.registry = new CapabilityFrameworkRegistry();
    this.pipeline = new CapabilityPipeline(this.eventBus);
    this.engine = new InvocationEngine(this.registry, this.pipeline, this.eventBus);
    this.sdk = new CapabilitySDK(this.registry, this.engine, this.eventBus);

    this.registerStandardProviderAdapters(aiCapabilityKernel);
  }

  private registerStandardProviderAdapters(aiCapabilityKernel?: AICapabilityKernel): void {
    if (aiCapabilityKernel) {
      this.registry.register(new AICapabilityProviderHandler(aiCapabilityKernel));
    }
    this.registry.register(new LessonCapabilityProviderHandler());
    this.registry.register(new AnalyticsCapabilityProviderHandler());
  }

  public dispose(): void {
    this.registry.clear();
    this.eventBus.clear();
  }
}
