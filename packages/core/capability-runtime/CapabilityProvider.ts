/**
 * CapabilityProvider — the activation abstraction for a capability (PI-009).
 *
 * A provider owns the logic that materializes a capability instance. It is the
 * unit the resolver selects among: a single provider yields one instance
 * (`Single`), several providers sharing a `contract` yield many (`Multiple`),
 * and when multiple compete the highest `priority` wins (`Priority`). A
 * provider flagged `isDefault` acts as a fallback when no specific provider is
 * registered (`Default`).
 */

import { CapabilityError } from './CapabilityError.js';
import type { CapabilityActivator } from './types.js';
import type { CapabilityContext } from './CapabilityContext.js';

export type CapabilityProviderMode = 'Single' | 'Multiple' | 'Priority' | 'Default';

export interface CapabilityProviderInit {
  readonly id: string;
  /** The capability id this provider activates. */
  readonly capabilityId: string;
  readonly activator: CapabilityActivator;
  readonly mode?: CapabilityProviderMode;
  /** Higher priority wins when several providers target the same capability/contract. */
  readonly priority?: number;
  /** Marks this provider as the fallback/default for its capability/contract. */
  readonly isDefault?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export class CapabilityProvider {
  public readonly id: string;
  public readonly capabilityId: string;
  public readonly activator: CapabilityActivator;
  public readonly mode: CapabilityProviderMode;
  public readonly priority: number;
  public readonly isDefault: boolean;
  public readonly metadata: Readonly<Record<string, unknown>>;

  public constructor(init: CapabilityProviderInit) {
    if (!init || init.id.trim() === '') {
      throw new CapabilityError('Capability provider requires a non-empty id.', 'INVALID_DESCRIPTOR');
    }
    if (!init.capabilityId || init.capabilityId.trim() === '') {
      throw new CapabilityError(
        `Capability provider '${init.id}' requires a capabilityId.`,
        'INVALID_DESCRIPTOR',
        init.id,
      );
    }
    if (typeof init.activator !== 'function') {
      throw new CapabilityError(
        `Capability provider '${init.id}' requires a callable activator.`,
        'INVALID_DESCRIPTOR',
        init.id,
      );
    }

    this.id = init.id;
    this.capabilityId = init.capabilityId;
    this.activator = init.activator;
    this.mode = init.mode ?? 'Single';
    this.priority = init.priority ?? 0;
    this.isDefault = init.isDefault ?? false;
    this.metadata = Object.freeze({ ...(init.metadata ?? {}) });
  }

  /** Produce the capability instance via its activator. */
  public activate(context: CapabilityContext): unknown {
    try {
      return this.activator(context);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new CapabilityError(
        `Provider '${this.id}' failed to activate capability '${this.capabilityId}': ${message}`,
        'PROVIDER_FAILED',
        this.capabilityId,
      );
    }
  }
}
