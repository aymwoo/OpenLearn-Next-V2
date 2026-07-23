export type TeachingEventType =
  | 'ObjectStarted'
  | 'ObjectFinished'
  | 'QuizSubmitted'
  | 'QuizGraded'
  | 'CodeExecuted'
  | 'VideoEnded'
  | 'StudentAnswered'
  | 'TeacherReviewed'
  | 'AIFinished'
  | 'PluginUpdated';

export interface TeachingEventMap {
  ObjectStarted: { objectId: string; timestamp: number };
  ObjectFinished: { objectId: string; timestamp: number };
  QuizSubmitted: { objectId: string; studentId: string; selectedOption: string; timestamp: number };
  QuizGraded: { objectId: string; studentId: string; score: number; isPassed: boolean };
  CodeExecuted: { objectId: string; code: string; output: string; executionTimeMs: number };
  VideoEnded: { objectId: string; timestamp: number };
  StudentAnswered: { objectId: string; studentId: string; answerPayload: any };
  TeacherReviewed: { objectId: string; teacherId: string; feedback: string };
  AIFinished: { objectId: string; prompt: string; result: string };
  PluginUpdated: { objectId: string; pluginId: string; state: Record<string, unknown> };
}

export type TeachingEventListener<T extends TeachingEventType> = (event: TeachingEventMap[T]) => void;

export class TeachingEventBus {
  private listeners = new Map<TeachingEventType, Set<TeachingEventListener<any>>>();

  public on<T extends TeachingEventType>(type: T, listener: TeachingEventListener<T>): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);

    return () => {
      this.listeners.get(type)?.delete(listener);
    };
  }

  public emit<T extends TeachingEventType>(type: T, payload: TeachingEventMap[T]): void {
    const subs = this.listeners.get(type);
    if (!subs) return;

    subs.forEach((listener) => {
      try {
        listener(payload);
      } catch (err) {
        console.error(`[TeachingEventBus] Error handling event "${type}":`, err);
      }
    });
  }
}

export const teachingEventBus = new TeachingEventBus();
