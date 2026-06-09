export interface PlatformEvent<T = unknown> {
  readonly id: string;
  readonly type: string;        // Past tense, e.g., "lesson.created"
  readonly source: string;      // Source plugin/module
  readonly payload: T;
  readonly timestamp: number;
  readonly correlationId?: string; 
}

export type EventSubscriber = (event: PlatformEvent) => void | Promise<void>;

export class EventBus {
  private subscribers = new Map<string, Set<EventSubscriber>>();

  public subscribe(eventType: string, subscriber: EventSubscriber) {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, new Set());
    }
    this.subscribers.get(eventType)!.add(subscriber);
  }

  public unsubscribe(eventType: string, subscriber: EventSubscriber) {
    this.subscribers.get(eventType)?.delete(subscriber);
  }

  public async publish(event: PlatformEvent) {
    const subs = this.subscribers.get(event.type) || new Set();
    const wildcards = this.subscribers.get('*') || new Set();
    
    const allSubs = [...subs, ...wildcards];
    
    // Asynchronously resolve all subscribers
    await Promise.all(allSubs.map(sub => Promise.resolve(sub(event)).catch(err => {
      console.error(`Error in event subscriber for ${event.type}:`, err);
    })));
  }
}
