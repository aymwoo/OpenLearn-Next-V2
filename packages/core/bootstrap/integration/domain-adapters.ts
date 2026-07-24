/**
 * OpenLearn Platform Kernel - Business Domain Integration Adapters (PI-007)
 * Interfaces only - decoupling Platform Kernel from business engine implementations.
 */

import { IIntegrationAdapter } from './integration-types.js';

export interface IAIRuntimeAdapter extends IIntegrationAdapter {
  generateText(prompt: string, options?: unknown): Promise<string>;
}

/**
 * Lightweight domain adapter interface for PluginHost.
 * Canonically implemented by IPluginRuntime (@openlearn/core/plugin-host).
 */
export interface IPluginHostAdapter extends IIntegrationAdapter {
  getActivePlugins(): Promise<ReadonlyArray<Record<string, unknown>>>;
}

export interface ILessonEngineAdapter extends IIntegrationAdapter {
  getActiveLesson(lessonId: string): Promise<Record<string, unknown> | null>;
}

export interface IWhiteboardAdapter extends IIntegrationAdapter {
  getElements(whiteboardId: string): Promise<ReadonlyArray<Record<string, unknown>>>;
}

export interface IAnalyticsAdapter extends IIntegrationAdapter {
  recordEvent(eventType: string, payload: unknown): Promise<void>;
}
