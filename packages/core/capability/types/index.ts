/**
 * OpenLearn Capability Invocation Framework - Strict TypeScript Definitions
 * No `any` types permitted. Uses Interfaces, Generics, and Readonly types throughout.
 */

export type CapabilityRole = 'Teacher' | 'Student' | 'Plugin' | 'AI' | 'Observer' | 'System';

export type CapabilityCategory =
  | 'lesson'
  | 'whiteboard'
  | 'notebook'
  | 'plugin'
  | 'analytics'
  | 'ai'
  | string;

export type ResultType =
  | 'teaching_object'
  | 'whiteboard_object'
  | 'markdown'
  | 'quiz'
  | 'code'
  | 'image'
  | 'analytics_insight'
  | 'plugin_data'
  | 'generic';

export interface CapabilityDescriptor {
  readonly id: string;
  readonly name: string;
  readonly category: CapabilityCategory;
  readonly provider: string;
  readonly permission: ReadonlyArray<CapabilityRole>;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
  readonly tags: ReadonlyArray<string>;
  readonly version: string;
}

export interface CapabilityContext {
  readonly lessonId?: string;
  readonly whiteboardId?: string;
  readonly studentId?: string;
  readonly teacherId?: string;
  readonly analyticsSessionId?: string;
  readonly conversationId?: string;
  readonly pluginId?: string;
  readonly actorRole: CapabilityRole;
}

export interface InvocationRequest {
  readonly id: string;
  readonly capabilityId: string;
  readonly payload: Record<string, unknown>;
  readonly context: CapabilityContext;
  readonly timeoutMs?: number;
}

export interface CapabilityResult<T = unknown> {
  readonly invocationId: string;
  readonly capabilityId: string;
  readonly resultType: ResultType;
  readonly data: T;
  readonly executionTimeMs: number;
  readonly success: boolean;
  readonly error?: string;
}

// ── Framework Capability Handler Interface ────────────────────────────────

export interface ICapabilityProviderHandler {
  readonly descriptor: CapabilityDescriptor;
  execute(request: InvocationRequest): Promise<unknown>;
}

// ── Capability Events ─────────────────────────────────────────────────────

export interface CapabilityEventMap {
  CapabilityRequested: { readonly request: InvocationRequest };
  CapabilityStarted: { readonly invocationId: string; readonly capabilityId: string };
  CapabilityFinished: { readonly result: CapabilityResult };
  CapabilityCancelled: { readonly invocationId: string; readonly reason: string };
  CapabilityFailed: { readonly invocationId: string; readonly error: string };
  CapabilityPublished: { readonly result: CapabilityResult };
}

export type CapabilityEventType = keyof CapabilityEventMap;

export interface CapabilityEventEnvelope<K extends CapabilityEventType = CapabilityEventType> {
  readonly id: string;
  readonly type: K;
  readonly payload: CapabilityEventMap[K];
  readonly timestamp: number;
}

export type CapabilityEventSubscriber<K extends CapabilityEventType> = (
  event: CapabilityEventEnvelope<K>
) => void | Promise<void>;
