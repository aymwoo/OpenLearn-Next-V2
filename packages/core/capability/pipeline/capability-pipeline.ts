/**
 * OpenLearn Capability Invocation Framework - Execution Pipeline
 * Standard 7-step pipeline: Request -> Validation -> Permission -> Context Injection -> Capability -> Result Transform -> Publish
 */

import {
  InvocationRequest,
  CapabilityResult,
  ICapabilityProviderHandler,
  ResultType,
} from '../types/index.js';
import { PermissionChecker } from './permission-checker.js';
import { CapabilityEventBus } from '../event/capability-event-bus.js';

export class CapabilityPipeline {
  private eventBus: CapabilityEventBus;

  constructor(eventBus: CapabilityEventBus) {
    this.eventBus = eventBus;
  }

  public async executePipeline(
    request: InvocationRequest,
    handler: ICapabilityProviderHandler
  ): Promise<CapabilityResult> {
    const startTime = Date.now();
    const desc = handler.descriptor;

    // Step 1: Request Event
    await this.eventBus.publish('CapabilityRequested', { request });

    // Step 2: Validation
    if (!request.payload) {
      throw new Error(`Pipeline Validation Failed: Payload missing for ${request.capabilityId}`);
    }

    // Step 3: Permission Check
    const hasPermission = PermissionChecker.validatePermission(desc, request.context.actorRole);
    if (!hasPermission) {
      const err = `Access Denied: Role '${request.context.actorRole}' is not authorized for capability '${desc.id}'`;
      await this.eventBus.publish('CapabilityFailed', { invocationId: request.id, error: err });
      throw new Error(err);
    }

    // Step 4: Context Injection
    const enrichedRequest: InvocationRequest = {
      ...request,
      payload: {
        ...request.payload,
        __injectedContext: request.context,
      },
    };

    // Step 5: Capability Execution
    await this.eventBus.publish('CapabilityStarted', {
      invocationId: request.id,
      capabilityId: request.capabilityId,
    });

    try {
      const rawData = await handler.execute(enrichedRequest);

      // Step 6: Result Transformation
      const resultType: ResultType = (desc.metadata.resultType as ResultType) || 'generic';
      const result: CapabilityResult = Object.freeze({
        invocationId: request.id,
        capabilityId: request.capabilityId,
        resultType,
        data: rawData,
        executionTimeMs: Date.now() - startTime,
        success: true,
      });

      // Step 7: Publish & Finish
      await this.eventBus.publish('CapabilityFinished', { result });
      await this.eventBus.publish('CapabilityPublished', { result });

      return result;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.eventBus.publish('CapabilityFailed', {
        invocationId: request.id,
        error: errorMsg,
      });
      throw err;
    }
  }
}
