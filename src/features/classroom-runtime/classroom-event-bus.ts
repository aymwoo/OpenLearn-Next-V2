/**
 * OpenLearn Classroom Event Model - Namespaced Event Bus (Sprint P4-03)
 * Unifies classroom events under the 'classroom.*' namespace over EventBus (PI-010).
 */

import { EventBus } from '../../../packages/core/event-bus-runtime/EventBus.js';

export type ClassroomEventType =
  | 'classroom.created'
  | 'classroom.prepared'
  | 'classroom.ready'
  | 'classroom.teaching'
  | 'classroom.paused'
  | 'classroom.resumed'
  | 'classroom.finished'
  | 'classroom.archived'
  | 'classroom.disposed';

export interface ClassroomNamespacedEvent<T = Record<string, unknown>> {
  readonly id: string;
  readonly type: ClassroomEventType;
  readonly classroomId: string;
  readonly timestamp: number;
  readonly payload?: T;
}

export class ClassroomEventBus {
  private eventBus: EventBus;

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus ?? new EventBus();
  }

  public publish<T = Record<string, unknown>>(
    type: ClassroomEventType,
    classroomId: string,
    payload?: T
  ): void {
    const event: ClassroomNamespacedEvent<T> = {
      id: `evt_cls_${type.replace('.', '_')}_${Date.now()}`,
      type,
      classroomId,
      timestamp: Date.now(),
      payload,
    };

    this.eventBus.publish({
      id: event.id,
      type: event.type,
      source: 'ClassroomRuntime',
      payload: event as unknown as Record<string, unknown>,
      timestamp: event.timestamp,
    });
  }

  public subscribe(
    type: ClassroomEventType | '*',
    handler: (event: ClassroomNamespacedEvent) => void
  ): () => void {
    return this.eventBus.subscribe((evt) => {
      if (type === '*' || evt.type === type) {
        handler(evt.payload as unknown as ClassroomNamespacedEvent);
      }
    });
  }
}
