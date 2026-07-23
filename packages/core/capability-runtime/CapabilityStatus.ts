/**
 * CapabilityStatus — the lifecycle states of a platform capability (PI-009).
 *
 * States: Registered → Resolved → Active ⇄ Inactive, with Disabled and
 * Disposed as terminal-ish states. `canTransition` enforces a valid finite
 * state machine so lifecycle transitions cannot be applied arbitrarily.
 */

export type CapabilityStatus =
  | 'Registered'
  | 'Resolved'
  | 'Active'
  | 'Inactive'
  | 'Disabled'
  | 'Disposed';

export const CAPABILITY_STATUS_TRANSITIONS: Record<CapabilityStatus, CapabilityStatus[]> = {
  Registered: ['Resolved', 'Disabled', 'Disposed'],
  Resolved: ['Active', 'Inactive', 'Disabled', 'Disposed'],
  Active: ['Inactive', 'Disabled', 'Disposed'],
  Inactive: ['Active', 'Disabled', 'Disposed'],
  Disabled: ['Registered', 'Resolved', 'Disposed'],
  Disposed: [],
};

export function canTransition(from: CapabilityStatus, to: CapabilityStatus): boolean {
  return CAPABILITY_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}
