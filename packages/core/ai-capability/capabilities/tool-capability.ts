/**
 * OpenLearn AI Capability Layer - Tool Capability (Tool Gateway)
 * Manages tool execution, permissions, logging, timeouts, and exception handling.
 */

import { IToolCapability, AICapabilityMeta } from '../types/index.js';
import { AIRuntimeKernel } from '../../ai/index.js';
import { CapabilityLogger } from '../logging/capability-logger.js';

export class ToolCapability implements IToolCapability {
  public readonly meta: AICapabilityMeta = {
    id: 'capability_tool',
    name: 'Tool Execution Gateway Capability',
    type: 'tool',
    description: 'Kernel-level tool execution and permission gateway capability',
    version: '1.0.0',
  };

  private runtimeKernel: AIRuntimeKernel;
  private logger: CapabilityLogger;

  constructor(runtimeKernel: AIRuntimeKernel, logger: CapabilityLogger) {
    this.runtimeKernel = runtimeKernel;
    this.logger = logger;
  }

  public async executeToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    const startTime = Date.now();
    const result = await this.runtimeKernel.toolRegistry.executeTool(toolName, args);

    this.logger.log({
      capabilityId: this.meta.id,
      requestPayload: { toolName, args },
      responsePayload: result,
      latencyMs: Date.now() - startTime,
      providerId: 'tool_registry',
      error: result.error,
      timestamp: Date.now(),
    });

    return result;
  }
}
