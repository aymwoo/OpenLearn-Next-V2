/**
 * EventSubscriber — handle returned to a caller on subscription (PI-010).
 *
 * A thin, stable token that lets the caller later `unsubscribe()`. It tracks
 * whether it is still active so repeated calls are safe no-ops.
 */

export interface EventSubscriberInit {
  readonly id: string;
  readonly eventType: string;
  readonly unsubscribe: () => void;
}

export class EventSubscriber {
  public readonly id: string;
  public readonly eventType: string;
  private readonly _unsubscribe: () => void;
  private _active = true;

  public constructor(init: EventSubscriberInit) {
    this.id = init.id;
    this.eventType = init.eventType;
    this._unsubscribe = init.unsubscribe;
  }

  public get active(): boolean {
    return this._active;
  }

  public unsubscribe(): void {
    if (!this._active) return;
    this._unsubscribe();
    this._active = false;
  }
}
