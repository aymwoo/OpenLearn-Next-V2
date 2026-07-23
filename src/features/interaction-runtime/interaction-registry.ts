/**
 * OpenLearn Interaction Runtime - Handler Registry (Sprint P2-09)
 * Central registry managing domain interaction handlers and priority dispatching.
 */

import { InteractionDomain, InteractionHandler, InteractionEvent } from './interaction-types.js';

export class InteractionRegistry {
  private handlers = new Map<string, InteractionHandler>();

  public register(handler: InteractionHandler): void {
    if (!handler || !handler.id) {
      throw new Error('InteractionRegistry Error: InteractionHandler must have a valid ID.');
    }
    this.handlers.set(handler.id, handler);
  }

  public unregister(handlerId: string): boolean {
    return this.handlers.delete(handlerId);
  }

  public getHandlers(domain: InteractionDomain): ReadonlyArray<InteractionHandler> {
    const matched = Array.from(this.handlers.values()).filter((h) => h.domain === domain);
    matched.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    return Object.freeze(matched);
  }

  public dispatch(event: InteractionEvent): boolean {
    const handlers = this.getHandlers(event.domain);
    for (const handler of handlers) {
      const intercepted = handler.handle(event);
      if (intercepted === true) {
        return true; // Event consumed/intercepted by high-priority handler
      }
    }
    return false;
  }

  public clear(): void {
    this.handlers.clear();
  }
}
