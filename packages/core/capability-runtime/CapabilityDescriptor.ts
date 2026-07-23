/**
 * CapabilityDescriptor — immutable metadata describing a platform capability (PI-009).
 *
 * A descriptor records the identity and characteristics of a capability: its
 * id, human-readable name, version, owning provider, grouping `contract`,
 * selection `priority`, declared `dependencies`, and free-form `metadata`.
 * The live lifecycle `status` is mirrored here so the descriptor always
 * reflects the current state, but transitions are validated by
 * {@link CapabilityStatus.canTransition}.
 */

import { type CapabilityStatus, canTransition } from './CapabilityStatus.js';
import { CapabilityError } from './CapabilityError.js';
import type { CapabilityActivator, CapabilityCategory, CapabilityDescriptorInit } from './types.js';

export class CapabilityDescriptor implements CapabilityDescriptorInit {
  public readonly id: string;
  public readonly name: string;
  public readonly displayName: string;
  public readonly version: string;
  public readonly description: string;
  public readonly category: CapabilityCategory;
  public readonly provider?: string;
  public readonly dependencies: ReadonlyArray<string>;
  public readonly metadata: Readonly<Record<string, unknown>>;
  public readonly priority: number;
  public readonly contract?: string;
  public readonly optional: boolean;
  public readonly isDefault: boolean;
  public readonly activator?: CapabilityActivator;

  /** Mutable lifecycle state — mirrored onto the descriptor for visibility. */
  public status: CapabilityStatus;

  public constructor(init: CapabilityDescriptorInit) {
    if (!init || init.id.trim() === '') {
      throw new CapabilityError(
        'Capability descriptor requires a non-empty id.',
        'INVALID_DESCRIPTOR',
      );
    }
    if (!init.activator && init.contract === undefined && init.provider === undefined) {
      throw new CapabilityError(
        `Capability '${init.id}' must declare an activator, a contract, or a provider.`,
        'INVALID_DESCRIPTOR',
        init.id,
      );
    }

    this.id = init.id;
    this.name = init.name ?? init.id;
    this.displayName = init.displayName ?? init.name ?? init.id;
    this.version = init.version ?? '1.0.0';
    this.description = init.description ?? '';
    this.category = init.category ?? 'general';
    this.provider = init.provider;
    this.dependencies = Object.freeze([...(init.dependencies ?? [])]);
    this.metadata = Object.freeze({ ...(init.metadata ?? {}) });
    this.priority = init.priority ?? 0;
    this.contract = init.contract;
    this.optional = init.optional ?? false;
    this.isDefault = init.isDefault ?? false;
    this.activator = init.activator;
    this.status = 'Registered';
  }

  /** Returns a copy of this descriptor with the given status, validating the transition. */
  public withStatus(status: CapabilityStatus): CapabilityDescriptor {
    if (!canTransition(this.status, status)) {
      throw new CapabilityError(
        `Illegal capability status transition: ${this.status} -> ${status}.`,
        'INVALID_TRANSITION',
        this.id,
      );
    }
    const next = new CapabilityDescriptor(this);
    next.status = status;
    return next;
  }
}
