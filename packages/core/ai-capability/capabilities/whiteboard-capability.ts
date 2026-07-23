/**
 * OpenLearn AI Capability Layer - Whiteboard Capability
 * Handles Whiteboard AI operations: Diagram generation, Selection summary, Object explanation, and Layout beautification.
 */

import { IWhiteboardCapability, AICapabilityMeta } from '../types/index.js';
import { AIRuntimeKernel } from '../../ai/index.js';
import { CapabilityLogger } from '../logging/capability-logger.js';

export class WhiteboardCapability implements IWhiteboardCapability {
  public readonly meta: AICapabilityMeta = {
    id: 'capability_whiteboard',
    name: 'Whiteboard AI Capability',
    type: 'whiteboard',
    description: 'Generates diagrams, summarizes selections, explains objects, and beautifies canvas layouts',
    version: '1.0.0',
  };

  private runtimeKernel: AIRuntimeKernel;
  private logger: CapabilityLogger;

  constructor(runtimeKernel: AIRuntimeKernel, logger: CapabilityLogger) {
    this.runtimeKernel = runtimeKernel;
    this.logger = logger;
  }

  public async generateDiagram(prompt: string): Promise<Record<string, unknown>> {
    const startTime = Date.now();
    const systemPrompt = 'You are a Whiteboard Diagram Generator. Generate a structured JSON representing canvas elements (nodes, edges, shapes).';
    const resultText = await this.runtimeKernel.providerGateway.generateText(prompt, { systemInstruction: systemPrompt });

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(resultText.replace(/```json|```/g, '').trim());
    } catch {
      parsed = { rawDiagram: resultText };
    }

    this.logger.log({
      capabilityId: this.meta.id,
      requestPayload: { prompt },
      responsePayload: parsed,
      latencyMs: Date.now() - startTime,
      providerId: 'provider_gateway',
      timestamp: Date.now(),
    });

    return parsed;
  }

  public async summarizeSelection(selectedElements: ReadonlyArray<Record<string, unknown>>): Promise<string> {
    const startTime = Date.now();
    const prompt = `Summarize the following selected whiteboard elements for key points: ${JSON.stringify(selectedElements)}`;
    const summary = await this.runtimeKernel.providerGateway.generateText(prompt);

    this.logger.log({
      capabilityId: this.meta.id,
      requestPayload: { elementsCount: selectedElements.length },
      responsePayload: { summary },
      latencyMs: Date.now() - startTime,
      providerId: 'provider_gateway',
      timestamp: Date.now(),
    });

    return summary;
  }

  public async explainObject(objectData: Record<string, unknown>): Promise<string> {
    const startTime = Date.now();
    const prompt = `Explain the educational concept of this whiteboard object: ${JSON.stringify(objectData)}`;
    const explanation = await this.runtimeKernel.providerGateway.generateText(prompt);

    this.logger.log({
      capabilityId: this.meta.id,
      requestPayload: { objectData },
      responsePayload: { explanation },
      latencyMs: Date.now() - startTime,
      providerId: 'provider_gateway',
      timestamp: Date.now(),
    });

    return explanation;
  }

  public async beautifyLayout(
    elements: ReadonlyArray<Record<string, unknown>>
  ): Promise<ReadonlyArray<Record<string, unknown>>> {
    const startTime = Date.now();
    // Re-align elements algorithmically or via AI
    const beautified = elements.map((el, idx) => ({
      ...el,
      x: (idx % 3) * 200 + 50,
      y: Math.floor(idx / 3) * 150 + 50,
    }));

    this.logger.log({
      capabilityId: this.meta.id,
      requestPayload: { elementsCount: elements.length },
      responsePayload: { count: beautified.length },
      latencyMs: Date.now() - startTime,
      providerId: 'layout_beautifier',
      timestamp: Date.now(),
    });

    return Object.freeze(beautified);
  }
}
