/**
 * CapabilityContext — the context handed to a capability activator (PI-009).
 *
 * It exposes the minimal host surface a capability needs at activation time:
 * resolving sibling capabilities and platform services, plus a diagnostics
 * recorder and a resolution stack for cycle detection. It depends only on the
 * `CapabilityResolutionHost` interface (not the concrete runtime) to avoid a
 * value-level import cycle.
 */

import { CapabilityError } from './CapabilityError.js';
import type {
  CapabilityResolutionDiagnostic,
  CapabilityResolutionHost,
  CapabilityResolutionMode,
} from './types.js';
import type { CapabilityStatus } from './CapabilityStatus.js';

export class CapabilityContext {
  public readonly host: CapabilityResolutionHost;
  public readonly scopeId: string;
  private readonly diagnostics: CapabilityResolutionDiagnostic[] = [];
  private readonly stack: string[] = [];

  public constructor(host: CapabilityResolutionHost, scopeId = 'application') {
    this.host = host;
    this.scopeId = scopeId;
  }

  /** Resolve a sibling capability through the host runtime. */
  public resolveDependency(capabilityId: string): unknown {
    return this.host.resolveCapability(capabilityId);
  }

  /** Resolve a platform service through the host runtime (delegates to the DI container). */
  public resolveService(serviceId: string): unknown {
    return this.host.resolveService(serviceId);
  }

  public record(
    capabilityId: string,
    action: CapabilityResolutionDiagnostic['action'],
    mode: CapabilityResolutionMode,
    status: CapabilityStatus,
    durationMs: number,
  ): void {
    this.diagnostics.push({ capabilityId, action, mode, status, durationMs });
  }

  public getDiagnostics(): ReadonlyArray<CapabilityResolutionDiagnostic> {
    return Object.freeze([...this.diagnostics]);
  }

  /** Push a capability onto the resolution stack; throws on a detected cycle. */
  public enter(capabilityId: string): void {
    if (this.stack.includes(capabilityId)) {
      throw new CapabilityError(
        `Circular capability dependency: ${[...this.stack, capabilityId].join(' -> ')}`,
        'CIRCULAR_DEPENDENCY',
        capabilityId,
        [...this.stack, capabilityId],
      );
    }
    this.stack.push(capabilityId);
  }

  public leave(capabilityId: string): void {
    const idx = this.stack.lastIndexOf(capabilityId);
    if (idx >= 0) this.stack.splice(idx, 1);
  }
}
