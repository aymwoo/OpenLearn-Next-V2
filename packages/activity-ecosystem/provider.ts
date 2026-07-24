/**
 * OpenLearn Activity Ecosystem — Activity Provider (Sprint P7-01)
 *
 * `BaseActivityProvider` is the shared implementation used by BOTH official
 * activities and third-party plugin activities. It implements the required
 * lifecycle (register → initialize → start → pause → resume → finish → dispose)
 * and reuses the existing Classroom Action API (Command Bus) and Classroom
 * Event Bus — it never builds new dispatch or event infrastructure.
 */

import { v7 as uuidv7 } from 'uuid';
import type {
  ActivityContext,
  ActivityProvider,
  ActivityProviderDescriptor,
  ActivityLifecycleState,
} from './types.js';

/** Canonical activity event names published on the (reused) Event Bus. */
export const ACTIVITY_EVENTS = {
  REGISTERED: 'activity.registered',
  INITIALIZED: 'activity.initialized',
  STARTED: 'activity.started',
  PAUSED: 'activity.paused',
  RESUMED: 'activity.resumed',
  FINISHED: 'activity.finished',
  DISPOSED: 'activity.disposed',
} as const;

export type ActivityEventName = (typeof ACTIVITY_EVENTS)[keyof typeof ACTIVITY_EVENTS];

/** Optional lifecycle hooks supplied to `BaseActivityProvider`. */
export interface BaseActivityProviderOptions {
  descriptor: ActivityProviderDescriptor;
  /** Custom initialize hook. */
  onInitialize?: (context: ActivityContext) => void | Promise<void>;
  /**
   * Custom start hook. When provided it fully owns the start behaviour
   * (e.g. call the command bus itself). When omitted, the provider falls back
   * to dispatching `descriptor.commandType` (if set) and publishing the event.
   */
  onStart?: (
    context: ActivityContext,
    payload?: Record<string, unknown>,
  ) => unknown | Promise<unknown>;
  onPause?: (context: ActivityContext) => void | Promise<void>;
  onResume?: (context: ActivityContext) => void | Promise<void>;
  onFinish?: (context: ActivityContext) => void | Promise<void>;
  onDispose?: (context: ActivityContext) => void | Promise<void>;
}

function publishEvent(
  context: ActivityContext,
  type: ActivityEventName,
  descriptor: ActivityProviderDescriptor,
  payload: Record<string, unknown>,
): void {
  // Reuse the existing Event Bus — never create a second event system.
  context.eventBus.publish({
    id: uuidv7(),
    type,
    source: `activity:${descriptor.id}`,
    payload,
    timestamp: Date.now(),
  });
}

export class BaseActivityProvider implements ActivityProvider {
  public readonly descriptor: ActivityProviderDescriptor;
  private _state: ActivityLifecycleState = 'registered';
  private readonly hooks: BaseActivityProviderOptions;

  constructor(options: BaseActivityProviderOptions) {
    if (!options?.descriptor?.id) {
      throw new Error('BaseActivityProvider requires a descriptor with a valid id.');
    }
    this.descriptor = options.descriptor;
    this.hooks = options;
  }

  public get state(): ActivityLifecycleState {
    return this._state;
  }

  /** Internal marker used by the registry on registration. */
  public markRegistered(): void {
    this._state = 'registered';
  }

  public async initialize(context: ActivityContext): Promise<void> {
    this._state = 'initialized';
    publishEvent(context, ACTIVITY_EVENTS.INITIALIZED, this.descriptor, {
      activityId: this.descriptor.id,
      provider: this.descriptor.provider,
    });
    if (this.hooks.onInitialize) {
      await this.hooks.onInitialize(context);
    }
  }

  public async start(
    context: ActivityContext,
    payload?: Record<string, unknown>,
  ): Promise<unknown> {
    let result: unknown;

    if (this.hooks.onStart) {
      // Plugin / custom behaviour owns the start.
      result = await this.hooks.onStart(context, payload);
    } else if (this.descriptor.commandType) {
      // Reuse the existing Classroom Action API (Command Bus) — no new dispatcher.
      // `createCommand` may be sync (kernel) or async (mock) — await covers both.
      const command = await context.commandBus.createCommand(
        this.descriptor.commandType,
        payload ?? {},
        this.descriptor.provider,
        { activityId: this.descriptor.id },
      );
      try {
        result = await context.commandBus.execute(command);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Graceful degradation: if the backing command handler is not installed
        // (e.g. an optional plugin is absent), the activity still "starts" by
        // publishing its event. Any other error is re-thrown.
        if (!/No handler registered for command/.test(message)) {
          throw err;
        }
      }
    }

    this._state = 'running';
    publishEvent(context, ACTIVITY_EVENTS.STARTED, this.descriptor, {
      activityId: this.descriptor.id,
      provider: this.descriptor.provider,
      commandType: this.descriptor.commandType,
      payload,
    });
    return result;
  }

  public async pause(context: ActivityContext): Promise<void> {
    this._state = 'paused';
    publishEvent(context, ACTIVITY_EVENTS.PAUSED, this.descriptor, {
      activityId: this.descriptor.id,
    });
    if (this.hooks.onPause) {
      await this.hooks.onPause(context);
    }
  }

  public async resume(context: ActivityContext): Promise<void> {
    this._state = 'running';
    publishEvent(context, ACTIVITY_EVENTS.RESUMED, this.descriptor, {
      activityId: this.descriptor.id,
    });
    if (this.hooks.onResume) {
      await this.hooks.onResume(context);
    }
  }

  public async finish(context: ActivityContext): Promise<void> {
    this._state = 'finished';
    publishEvent(context, ACTIVITY_EVENTS.FINISHED, this.descriptor, {
      activityId: this.descriptor.id,
    });
    if (this.hooks.onFinish) {
      await this.hooks.onFinish(context);
    }
  }

  public async dispose(context: ActivityContext): Promise<void> {
    this._state = 'disposed';
    publishEvent(context, ACTIVITY_EVENTS.DISPOSED, this.descriptor, {
      activityId: this.descriptor.id,
    });
    if (this.hooks.onDispose) {
      await this.hooks.onDispose(context);
    }
  }
}

/**
 * Convenience factory for defining an Activity Provider. Accepts either a full
 * `ActivityProvider` instance or a descriptor (+ optional hooks) and returns a
 * `BaseActivityProvider`. Used by official activities and third-party plugins
 * alike, so both share the exact same API.
 */
export function defineActivityProvider(
  input: ActivityProviderDescriptor | BaseActivityProviderOptions,
  hooks?: Omit<BaseActivityProviderOptions, 'descriptor'>,
): BaseActivityProvider {
  if (input instanceof BaseActivityProvider) {
    return input;
  }
  if ('descriptor' in input) {
    return new BaseActivityProvider(input);
  }
  return new BaseActivityProvider({ descriptor: input, ...(hooks ?? {}) });
}
