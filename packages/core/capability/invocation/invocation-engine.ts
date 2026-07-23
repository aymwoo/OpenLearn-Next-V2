/**
 * OpenLearn Capability Invocation Framework - Invocation Engine
 * Core invocation semantics: invoke, stream, cancel, retry, batch, schedule.
 */

import {
  InvocationRequest,
  CapabilityResult,
} from '../types/index.js';
import { CapabilityFrameworkRegistry } from '../registry/capability-framework-registry.js';
import { CapabilityPipeline } from '../pipeline/capability-pipeline.js';
import { CapabilityEventBus } from '../event/capability-event-bus.js';

export class InvocationEngine {
  private registry: CapabilityFrameworkRegistry;
  private pipeline: CapabilityPipeline;
  private eventBus: CapabilityEventBus;
  private cancelledInvocations = new Set<string>();

  constructor(
    registry: CapabilityFrameworkRegistry,
    pipeline: CapabilityPipeline,
    eventBus: CapabilityEventBus
  ) {
    this.registry = registry;
    this.pipeline = pipeline;
    this.eventBus = eventBus;
  }

  public async invoke(request: InvocationRequest): Promise<CapabilityResult> {
    if (this.cancelledInvocations.has(request.id)) {
      const err = `Invocation ${request.id} was cancelled prior to execution.`;
      await this.eventBus.publish('CapabilityCancelled', { invocationId: request.id, reason: err });
      throw new Error(err);
    }

    const handler = this.registry.resolve(request.capabilityId);
    return this.pipeline.executePipeline(request, handler);
  }

  public cancel(invocationId: string, reason = 'User requested cancellation'): void {
    this.cancelledInvocations.add(invocationId);
    this.eventBus.publish('CapabilityCancelled', { invocationId, reason });
  }

  public async retry(request: InvocationRequest, maxRetries = 3): Promise<CapabilityResult> {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.invoke(request);
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[InvocationEngine] Retry attempt ${attempt}/${maxRetries} failed for ${request.capabilityId}`);
      }
    }
    throw lastError || new Error(`Max retries (${maxRetries}) exceeded for ${request.capabilityId}`);
  }

  public async batch(requests: ReadonlyArray<InvocationRequest>): Promise<ReadonlyArray<CapabilityResult>> {
    return Promise.all(requests.map((req) => this.invoke(req)));
  }

  public async schedule(request: InvocationRequest, delayMs: number): Promise<CapabilityResult> {
    await new Promise((r) => setTimeout(r, delayMs));
    return this.invoke(request);
  }
}
