/**
 * EventDescriptor — metadata describing a platform event type (PI-010).
 *
 * Used for registration and introspection. It is intentionally minimal: the
 * runtime event payload travels on the {@link PlatformEventObject}, while the
 * descriptor records *what the event is* (type, owning source, description).
 */

import type { EventDescriptorInit } from './types.js';

export class EventDescriptor implements EventDescriptorInit {
  public readonly type: string;
  public readonly source: string;
  public readonly description?: string;
  public readonly version: string;
  public readonly metadata: Readonly<Record<string, unknown>>;

  public constructor(init: EventDescriptorInit) {
    if (!init || init.type.trim() === '') {
      throw new Error('[PlatformEventBus] Event descriptor requires a non-empty type.');
    }
    this.type = init.type;
    this.source = init.source;
    this.description = init.description;
    this.version = init.version ?? '1.0.0';
    this.metadata = Object.freeze({ ...(init.metadata ?? {}) });
  }
}
