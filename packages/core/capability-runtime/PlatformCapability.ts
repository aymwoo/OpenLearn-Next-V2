/**
 * PlatformCapability — the runtime wrapper around a capability descriptor (PI-009).
 *
 * It binds a {@link CapabilityDescriptor} to its {@link CapabilityProvider},
 * tracks the live {@link CapabilityStatus}, and caches the activated instance.
 * All status transitions are validated against the capability lifecycle FSM.
 */

import { type CapabilityStatus, canTransition } from './CapabilityStatus.js';
import { CapabilityDescriptor } from './CapabilityDescriptor.js';
import { CapabilityProvider } from './CapabilityProvider.js';
import { CapabilityError } from './CapabilityError.js';

export class PlatformCapability<T = unknown> {
  public readonly descriptor: CapabilityDescriptor;
  public readonly provider: CapabilityProvider;
  private _status: CapabilityStatus;
  private _instance: T | undefined;

  public constructor(descriptor: CapabilityDescriptor, provider: CapabilityProvider) {
    this.descriptor = descriptor;
    this.provider = provider;
    this._status = descriptor.status;
    if (provider.capabilityId !== descriptor.id) {
      throw new CapabilityError(
        `Provider '${provider.id}' targets '${provider.capabilityId}' but descriptor is '${descriptor.id}'.`,
        'INVALID_DESCRIPTOR',
        descriptor.id,
      );
    }
  }

  public get id(): string {
    return this.descriptor.id;
  }

  public get status(): CapabilityStatus {
    return this._status;
  }

  public get instance(): T | undefined {
    return this._instance;
  }

  public get isActive(): boolean {
    return this._status === 'Active';
  }

  /** Apply a validated lifecycle transition and mirror it onto the descriptor. */
  public setStatus(status: CapabilityStatus): void {
    if (!canTransition(this._status, status)) {
      throw new CapabilityError(
        `Illegal capability status transition: ${this._status} -> ${status}.`,
        'INVALID_TRANSITION',
        this.id,
      );
    }
    this._status = status;
    this.descriptor.status = status;
  }

  /** Cache the activated instance and advance the lifecycle to Active. */
  public attachInstance(instance: T): void {
    this._instance = instance;
    if (this._status === 'Resolved' || this._status === 'Inactive' || this._status === 'Registered') {
      this.setStatus('Active');
    } else {
      this._status = 'Active';
      this.descriptor.status = 'Active';
    }
  }

  public clearInstance(): void {
    this._instance = undefined;
    if (this._status === 'Active') this.setStatus('Inactive');
  }
}
