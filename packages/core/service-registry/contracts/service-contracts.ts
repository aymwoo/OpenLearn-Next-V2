/**
 * OpenLearn Platform Service Contracts
 * Standard interface contracts preventing direct business class coupling.
 */

export interface IAIServiceContract {
  generateText(prompt: string, options?: { systemInstruction?: string; temperature?: number }): Promise<string>;
}

export interface ILessonServiceContract {
  getLesson(lessonId: string): Promise<Record<string, unknown>>;
  createLesson(title: string, subject: string): Promise<Record<string, unknown>>;
}

export interface IWhiteboardServiceContract {
  getElements(whiteboardId: string): Promise<ReadonlyArray<Record<string, unknown>>>;
  createElement(whiteboardId: string, elementData: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface IAnalyticsServiceContract {
  getMetrics(): Promise<Record<string, unknown>>;
  publishEvent(eventType: string, payload: Record<string, unknown>): Promise<void>;
}

export interface IStorageServiceContract {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

export interface IPluginServiceContract {
  getActivePlugins(): Promise<ReadonlyArray<Record<string, unknown>>>;
}

export interface IRuntimeServiceContract {
  getSessionState(): Promise<Record<string, unknown>>;
}
