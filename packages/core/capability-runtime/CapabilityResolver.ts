/**
 * CapabilityResolver — resolves capabilities by id or by contract (PI-009).
 *
 * Resolution modes:
 *  - `Single`    — resolve by capability id (default).
 *  - `Optional`  — like Single but returns `undefined`/fallback when missing.
 *  - `Validation`— return the descriptor only; never activates.
 *  - `Multiple`  — resolve `capabilityId` as a *contract*; return every member.
 *  - `Priority`  — resolve `capabilityId` as a *contract*; return the highest
 *                  priority member.
 *  - `Default`   — resolve by id, falling back to a `isDefault` provider of the
 *                  same contract when the id is absent.
 *
 * Activated instances are cached on their {@link PlatformCapability}, so
 * repeated resolution returns the same instance (singleton semantics).
 */

import { PlatformCapability } from './PlatformCapability.js';
import { CapabilityRegistry } from './CapabilityRegistry.js';
import { CapabilityContext } from './CapabilityContext.js';
import { CapabilityError } from './CapabilityError.js';
import type { CapabilityResolutionMode, CapabilityResolutionOptions } from './types.js';

export class CapabilityResolver {
  private readonly registry: CapabilityRegistry;

  public constructor(registry: CapabilityRegistry) {
    this.registry = registry;
  }

  public resolve(
    capabilityId: string,
    context: CapabilityContext,
    options?: CapabilityResolutionOptions,
  ): unknown {
    const mode: CapabilityResolutionMode = options?.mode ?? 'Single';
    const start = Date.now();

    if (mode === 'Validation') {
      const cap = this.registry.find(capabilityId);
      if (!cap) {
        if (options?.optional) return undefined;
        throw new CapabilityError(
          `Cannot validate missing capability '${capabilityId}'.`,
          'MISSING_CAPABILITY',
          capabilityId,
        );
      }
      context.record(capabilityId, 'validate', mode, cap.status, Date.now() - start);
      return cap.descriptor;
    }

    if (mode === 'Multiple') {
      const caps = this.registry.listByContract(capabilityId);
      if (!caps.length) {
        if (options?.optional) return [];
        throw new CapabilityError(
          `No capabilities registered under contract '${capabilityId}'.`,
          'MISSING_CAPABILITY',
          capabilityId,
        );
      }
      return caps.map((cap) => this.activate(cap, context, mode));
    }

    if (mode === 'Priority') {
      const caps = this.registry.listByContract(capabilityId);
      if (!caps.length) {
        if (options?.optional) return undefined;
        throw new CapabilityError(
          `No capabilities registered under contract '${capabilityId}'.`,
          'MISSING_CAPABILITY',
          capabilityId,
        );
      }
      const best = caps.reduce((a, b) =>
        b.descriptor.priority > a.descriptor.priority ? b : a,
      );
      return this.activate(best, context, mode);
    }

    // Single / Optional / Default
    let capability = this.registry.find(capabilityId);

    if (!capability && mode === 'Default') {
      capability = this.registry
        .list()
        .find((c) => c.provider.isDefault && c.descriptor.contract === capabilityId);
    }

    if (!capability) {
      if (options?.optional || mode === 'Optional') {
        context.record(capabilityId, 'skip', mode, 'Registered', Date.now() - start);
        return options?.fallback;
      }
      throw new CapabilityError(
        `Capability '${capabilityId}' is not registered.`,
        'MISSING_CAPABILITY',
        capabilityId,
      );
    }

    return this.activate(capability, context, mode);
  }

  /** Resolve every capability belonging to a contract. */
  public resolveAll(contract: string, context: CapabilityContext): ReadonlyArray<unknown> {
    const caps = this.registry.listByContract(contract);
    return Object.freeze(caps.map((cap) => this.activate(cap, context, 'Multiple')));
  }

  private activate(
    capability: PlatformCapability,
    context: CapabilityContext,
    mode: CapabilityResolutionMode,
  ): unknown {
    context.enter(capability.id);
    const start = Date.now();
    try {
      if (capability.isActive && capability.instance !== undefined) {
        context.record(capability.id, 'resolve', mode, 'Active', Date.now() - start);
        return capability.instance;
      }
      // Bring the capability to a state from which attachInstance can reach Active.
      //  - Inactive can re-activate directly (Inactive -> Active).
      //  - Disabled can re-resolve (Disabled -> Resolved).
      //  - Registered/other move to Resolved first (Registered -> Resolved).
      if (capability.status === 'Inactive') {
        capability.setStatus('Active');
      } else if (capability.status === 'Registered') {
        capability.setStatus('Resolved');
      }
      const instance = capability.provider.activate(context);
      capability.attachInstance(instance);
      context.record(capability.id, 'activate', mode, 'Active', Date.now() - start);
      return instance;
    } finally {
      context.leave(capability.id);
    }
  }
}
