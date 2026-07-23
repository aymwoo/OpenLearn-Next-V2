/**
 * OpenLearn AI Infrastructure - Strict TypeScript Definitions
 * No `any` types permitted. Uses Interfaces, Generics, and Readonly types throughout.
 */

export interface AIProviderConfig {
  readonly id: string;
  readonly name: string;
  readonly apiUrl: string;
  readonly apiKey?: string;
  readonly modelName: string;
}

export interface AIGenerateOptions {
  readonly systemInstruction?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly tools?: ReadonlyArray<Record<string, unknown>>;
}

export interface PromptTemplate {
  readonly id: string;
  readonly name: string;
  readonly category: 'agent' | 'lesson' | 'ocr' | 'eval' | 'general';
  readonly version: number;
  readonly template: string;
  readonly tags: ReadonlyArray<string>;
}

export interface AIContextObject {
  readonly lessonContext?: string;
  readonly stageContext?: string;
  readonly whiteboardContext?: string;
  readonly analyticsContext?: string;
  readonly studentContext?: string;
  readonly teacherContext?: string;
}

export interface AIToolSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface ToolExecutionResult {
  readonly callName: string;
  readonly success: boolean;
  readonly result?: unknown;
  readonly error?: string;
}

export interface ConversationMessage {
  readonly id: string;
  readonly role: 'user' | 'model' | 'assistant' | 'system' | 'tool';
  readonly content: string;
  readonly timestamp: number;
  readonly toolCalls?: ReadonlyArray<Record<string, unknown>>;
  readonly toolResults?: ReadonlyArray<ToolExecutionResult>;
}

export interface ConversationSession {
  readonly id: string;
  readonly title: string;
  readonly messages: ReadonlyArray<ConversationMessage>;
  readonly createdAt: number;
  readonly updatedAt: number;
}

// ── AI Event Map ──────────────────────────────────────────────────────────

export interface AIEventMap {
  ModelStarted: { readonly providerId: string; readonly modelName: string; readonly promptLength: number };
  ModelFinished: { readonly providerId: string; readonly durationMs: number; readonly tokenCount?: number };
  ToolCalled: { readonly toolName: string; readonly args: Record<string, unknown>; readonly success: boolean };
  PromptBuilt: { readonly promptId: string; readonly interpolatedPrompt: string };
  StreamingStarted: { readonly streamId: string };
  StreamingFinished: { readonly streamId: string; readonly totalBytes: number };
  ConversationCreated: { readonly conversationId: string };
}

export type AIEventType = keyof AIEventMap;

export interface AIEventEnvelope<K extends AIEventType = AIEventType> {
  readonly id: string;
  readonly type: K;
  readonly payload: AIEventMap[K];
  readonly timestamp: number;
}

export type AIEventSubscriber<K extends AIEventType> = (
  event: AIEventEnvelope<K>
) => void | Promise<void>;
