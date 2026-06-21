export interface PlatformEvent<T = unknown> {
    readonly id: string;
    readonly type: string;
    readonly source: string;
    readonly payload: T;
    readonly timestamp: number;
    readonly correlationId?: string;
}
export type EventSubscriber = (event: PlatformEvent) => void | Promise<void>;
export declare class EventBus {
    private subscribers;
    subscribe(eventType: string, subscriber: EventSubscriber): void;
    unsubscribe(eventType: string, subscriber: EventSubscriber): void;
    publish(event: PlatformEvent): Promise<void>;
}
