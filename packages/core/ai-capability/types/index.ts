/**
 * OpenLearn AI Capability Layer - Strict TypeScript Definitions
 * No `any` types permitted. Uses Interfaces, Generics, and Readonly types throughout.
 */

export type CapabilityType =
  | 'chat'
  | 'completion'
  | 'tool'
  | 'embedding'
  | 'vision'
  | 'image_generation'
  | 'audio'
  | 'streaming'
  | 'conversation'
  | 'prompt'
  | 'memory'
  | 'lesson'
  | 'whiteboard'
  | 'analytics'
  | 'plugin'
  | string;

export interface AICapabilityMeta {
  readonly id: string;
  readonly name: string;
  readonly type: CapabilityType;
  readonly description: string;
  readonly version: string;
}

export interface CapabilityLogEntry {
  readonly capabilityId: string;
  readonly requestPayload: unknown;
  readonly responsePayload: unknown;
  readonly latencyMs: number;
  readonly providerId: string;
  readonly tokenCount?: number;
  readonly error?: string;
  readonly timestamp: number;
}

// ── Base Interface ────────────────────────────────────────────────────────

export interface IAICapability {
  readonly meta: AICapabilityMeta;
}

// ── Standard Capability Interfaces ────────────────────────────────────────

export interface IChatCapability extends IAICapability {
  chat(message: string, sessionId?: string): Promise<{ reply: string; sessionId: string }>;
}

export interface ICompletionCapability extends IAICapability {
  complete(prompt: string, options?: { systemInstruction?: string; temperature?: number }): Promise<string>;
}

export interface IToolCapability extends IAICapability {
  executeToolCall(toolName: string, args: Record<string, unknown>): Promise<{ success: boolean; result?: unknown; error?: string }>;
}

export interface ILessonCapability extends IAICapability {
  generateLessonPlan(subject: string, grade: string, topic: string): Promise<Record<string, unknown>>;
  generateQuiz(stageTitle: string, knowledgePoints: ReadonlyArray<string>, count?: number): Promise<ReadonlyArray<Record<string, unknown>>>;
  generateSummary(activityTitle: string, activityType: string): Promise<string>;
}

export interface IWhiteboardCapability extends IAICapability {
  generateDiagram(prompt: string): Promise<Record<string, unknown>>;
  summarizeSelection(selectedElements: ReadonlyArray<Record<string, unknown>>): Promise<string>;
  explainObject(objectData: Record<string, unknown>): Promise<string>;
  beautifyLayout(elements: ReadonlyArray<Record<string, unknown>>): Promise<ReadonlyArray<Record<string, unknown>>>;
}

export interface IAnalyticsCapability extends IAICapability {
  generateInsight(metrics: Record<string, unknown>): Promise<ReadonlyArray<Record<string, unknown>>>;
  generateSuggestion(indicators: Record<string, unknown>): Promise<string>;
  generateReflection(lessonAnalytics: Record<string, unknown>): Promise<string>;
}

export interface IPluginCapability extends IAICapability {
  invokeAI(pluginId: string, prompt: string, options?: Record<string, unknown>): Promise<string>;
}
