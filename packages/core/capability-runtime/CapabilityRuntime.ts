/**
 * CapabilityRuntime — the top-level orchestrator of the Capability Runtime (PI-009).
 *
 * It binds together the {@link CapabilityRegistry}, {@link CapabilityResolver},
 * and the host platform infrastructure:
 *  - `PlatformServiceRegistry` — capabilities are also exposed as platform
 *    services so the rest of the kernel can resolve them uniformly.
 *  - `PlatformContainer` (DI) — when supplied, each capability with an
 *    activator is mirrored as a DI service, so capabilities participate in the
 *    dependency-injection graph (never bypassing the registry).
 *  - `PlatformBuilder` (via {@link attachBuilder}) — capabilities declared on
 *    the builder can be cross-referenced for integration awareness.
 *
 * The runtime implements {@link CapabilityResolutionHost}, so a capability
 * activator can resolve sibling capabilities and platform services through the
 * `CapabilityContext` it receives.
 */

import { PlatformServiceRegistry } from '../../service-registry/platform-service-registry.js';
import type { PlatformContainer } from '../../di/container/index.js';
import { CapabilityRegistry } from './CapabilityRegistry.js';
import { CapabilityResolver } from './CapabilityResolver.js';
import { CapabilityContext } from './CapabilityContext.js';
import { CapabilityDescriptor } from './CapabilityDescriptor.js';
import { CapabilityProvider, type CapabilityProviderInit } from './CapabilityProvider.js';
import { PlatformCapability } from './PlatformCapability.js';
import { CapabilityError } from './CapabilityError.js';
import type {
  BuilderIntegrationSource,
  CapabilityDescriptorInit,
  CapabilityResolutionHost,
  CapabilityResolutionOptions,
  CapabilityValidationError,
  CapabilityValidationReport,
} from './types.js';

export interface CapabilityRuntimeOptions {
  readonly container?: PlatformContainer;
  readonly builder?: BuilderIntegrationSource;
}

export class CapabilityRuntime implements CapabilityResolutionHost {
  private readonly serviceRegistry: PlatformServiceRegistry;
  private readonly container?: PlatformContainer;
  private readonly registry = new CapabilityRegistry();
  private readonly resolver: CapabilityResolver;
  private readonly contextStack: CapabilityContext[] = [];
  private readonly resolvedContexts = new Map<string, CapabilityContext>();
  private builderSource?: BuilderIntegrationSource;

  public constructor(
    serviceRegistry: PlatformServiceRegistry,
    options?: CapabilityRuntimeOptions,
  ) {
    this.serviceRegistry = serviceRegistry;
    this.container = options?.container;
    this.builderSource = options?.builder;
    this.resolver = new CapabilityResolver(this.registry);
    console.log('[CapabilityRuntime] Initialized.');
  }

  // ── CapabilityResolutionHost ──────────────────────────────────────────

  public resolveCapability(capabilityId: string, options?: CapabilityResolutionOptions): unknown {
    const reuse = this.activeContext;
    const ctx = reuse ?? new CapabilityContext(this);
    if (!reuse) this.contextStack.push(ctx);
    try {
      return this.resolver.resolve(capabilityId, ctx, options ?? {});
    } finally {
      if (!reuse) {
        this.contextStack.pop();
        this.resolvedContexts.set(capabilityId, ctx);
      }
    }
  }

  public resolveService(serviceId: string): unknown {
    if (this.container) return this.container.resolve(serviceId);
    return this.serviceRegistry.resolve(serviceId);
  }

  public hasCapability(capabilityId: string): boolean {
    return this.registry.exists(capabilityId);
  }

  // ── Registration ─────────────────────────────────────────────────────

  public register(
    descriptor: CapabilityDescriptor | CapabilityDescriptorInit,
    providerInit?: CapabilityProviderInit,
  ): PlatformCapability {
    const resolvedDescriptor =
      descriptor instanceof CapabilityDescriptor
        ? descriptor
        : new CapabilityDescriptor(descriptor);
    const provider = this.makeProvider(resolvedDescriptor, providerInit);

    const capability = this.registry.register(resolvedDescriptor, provider);
    this.mirrorToContainer(resolvedDescriptor);
    console.log(`[CapabilityRuntime] Registered capability '${resolvedDescriptor.id}'.`);
    return capability;
  }

  public unregister(capabilityId: string): boolean {
    const removed = this.registry.unregister(capabilityId);
    if (removed) {
      try {
        this.serviceRegistry.unregister(capabilityId);
      } catch {
        /* registry may not hold it as a service; ignore */
      }
      console.log(`[CapabilityRuntime] Unregistered capability '${capabilityId}'.`);
    }
    return removed;
  }

  public replace(
    descriptor: CapabilityDescriptor | CapabilityDescriptorInit,
    providerInit?: CapabilityProviderInit,
  ): PlatformCapability {
    const resolvedDescriptor =
      descriptor instanceof CapabilityDescriptor
        ? descriptor
        : new CapabilityDescriptor(descriptor);
    const provider = this.makeProvider(resolvedDescriptor, providerInit);
    const capability = this.registry.replace(resolvedDescriptor, provider);
    this.mirrorToContainer(resolvedDescriptor);
    console.log(`[CapabilityRuntime] Replaced capability '${resolvedDescriptor.id}'.`);
    return capability;
  }

  // ── Lookup ───────────────────────────────────────────────────────────

  public exists(capabilityId: string): boolean {
    return this.registry.exists(capabilityId);
  }

  public find(capabilityId: string): PlatformCapability | undefined {
    return this.registry.find(capabilityId);
  }

  public list(): ReadonlyArray<PlatformCapability> {
    return this.registry.list();
  }

  public listByContract(contract: string): ReadonlyArray<PlatformCapability> {
    return this.registry.listByContract(contract);
  }

  // ── Resolution (public API) ──────────────────────────────────────────

  public resolve<T = unknown>(
    capabilityId: string,
    options?: CapabilityResolutionOptions,
  ): T {
    return this.resolveCapability(capabilityId, options) as T;
  }

  public resolveAll<T = unknown>(contract: string): ReadonlyArray<T> {
    const reuse = this.activeContext;
    const ctx = reuse ?? new CapabilityContext(this);
    if (!reuse) this.contextStack.push(ctx);
    try {
      return this.resolver.resolveAll(contract, ctx) as ReadonlyArray<T>;
    } finally {
      if (!reuse) this.contextStack.pop();
    }
  }

  public getDiagnostics(capabilityId: string): ReadonlyArray<unknown> {
    return this.resolvedContexts.get(capabilityId)?.getDiagnostics() ?? Object.freeze([]);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  public activate(capabilityId: string): PlatformCapability {
    const capability = this.require(capabilityId);
    this.resolve(capabilityId);
    return capability;
  }

  public deactivate(capabilityId: string): void {
    const capability = this.require(capabilityId);
    if (capability.status === 'Active') capability.setStatus('Inactive');
    capability.clearInstance();
  }

  public enable(capabilityId: string): void {
    const capability = this.require(capabilityId);
    if (capability.status === 'Disabled') capability.setStatus('Registered');
  }

  public disable(capabilityId: string): void {
    const capability = this.require(capabilityId);
    if (capability.status !== 'Disposed') capability.setStatus('Disabled');
    capability.clearInstance();
  }

  public dispose(capabilityId: string): void {
    const capability = this.require(capabilityId);
    capability.setStatus('Disposed');
    capability.clearInstance();
  }

  // ── Builder integration ───────────────────────────────────────────────

  /** Attach a builder integration source to enable cross-referencing. */
  public attachBuilder(source: BuilderIntegrationSource): void {
    this.builderSource = source;
  }

  /** True when the attached builder also declares this capability. */
  public isBuilderAware(capabilityId: string): boolean {
    return this.builderSource?.capabilityCatalog.hasCapability(capabilityId) ?? false;
  }

  // ── Validation ──────────────────────────────────────────────────────────

  public validate(): CapabilityValidationReport {
    const errors: CapabilityValidationError[] = [];
    const warnings: string[] = [];
    const capabilities = this.registry.list();

    for (const cap of capabilities) {
      const descriptor = cap.descriptor;
      if (!descriptor.id || descriptor.id.trim() === '') {
        errors.push({ code: 'INVALID_CAPABILITY_ID', message: 'Capability id is empty.', capabilityId: descriptor.id });
      }
      if (!cap.provider.activator && descriptor.activator === undefined) {
        errors.push({
          code: 'MISSING_ACTIVATOR',
          message: `Capability '${descriptor.id}' has no activator.`,
          capabilityId: descriptor.id,
        });
      }
      for (const dep of descriptor.dependencies) {
        if (!this.registry.exists(dep)) {
          errors.push({
            code: 'MISSING_DEPENDENCY',
            message: `Capability '${descriptor.id}' depends on unknown '${dep}'.`,
            capabilityId: descriptor.id,
          });
        }
      }
    }

    this.detectCycles(capabilities, errors);

    if (this.builderSource) {
      const unmatched = capabilities.filter((c) => !this.isBuilderAware(c.id));
      if (unmatched.length) {
        warnings.push(
          `${unmatched.length} capability(ies) not declared on the attached builder.`,
        );
      }
    }

    return {
      isValid: errors.length === 0,
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings),
    };
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private get activeContext(): CapabilityContext | undefined {
    return this.contextStack[this.contextStack.length - 1];
  }

  private require(capabilityId: string): PlatformCapability {
    const capability = this.registry.find(capabilityId);
    if (!capability) {
      throw new CapabilityError(
        `Capability '${capabilityId}' is not registered.`,
        'MISSING_CAPABILITY',
        capabilityId,
      );
    }
    return capability;
  }

  private makeProvider(
    descriptor: CapabilityDescriptor,
    providerInit?: CapabilityProviderInit,
  ): CapabilityProvider {
    if (providerInit) {
      return new CapabilityProvider({ capabilityId: descriptor.id, ...providerInit });
    }
    if (descriptor.activator) {
      return new CapabilityProvider({
        id: `${descriptor.id}__provider`,
        capabilityId: descriptor.id,
        activator: descriptor.activator,
        priority: descriptor.priority,
        isDefault: descriptor.isDefault,
      });
    }
    throw new CapabilityError(
      `register('${descriptor.id}') requires a provider or descriptor.activator.`,
      'INVALID_DESCRIPTOR',
      descriptor.id,
    );
  }

  /**
   * Expose the capability through the Platform Service Registry (the single
   * source of truth). When a DI container is present we register a factory on
   * it (which writes into the shared registry and bridges ServiceScope →
   * CapabilityContext); otherwise we register a lazy factory directly. Either
   * way the capability becomes a resolvable platform service.
   */
  private mirrorToContainer(descriptor: CapabilityDescriptor): void {
    if (!descriptor.activator) return;
    if (this.serviceRegistry.exists(descriptor.id)) {
      try {
        this.serviceRegistry.unregister(descriptor.id);
      } catch {
        /* ignore */
      }
    }
    if (this.container) {
      this.container.registerFactory(descriptor.id, () => this.resolveCapability(descriptor.id));
    } else {
      this.serviceRegistry.register({
        id: descriptor.id,
        lifetime: 'Singleton',
        factory: () => this.resolveCapability(descriptor.id),
      });
    }
  }

  private detectCycles(
    capabilities: ReadonlyArray<PlatformCapability>,
    errors: CapabilityValidationError[],
  ): void {
    const byId = new Map(capabilities.map((c) => [c.id, c]));
    const visited = new Set<string>();
    const stack: string[] = [];

    const visit = (id: string): void => {
      if (stack.includes(id)) {
        errors.push({
          code: 'CIRCULAR_DEPENDENCY',
          message: `Capability dependency cycle: ${[...stack, id].join(' -> ')}`,
          capabilityId: id,
        });
        return;
      }
      if (visited.has(id)) return;
      stack.push(id);
      const cap = byId.get(id);
      for (const dep of cap?.descriptor.dependencies ?? []) visit(dep);
      stack.pop();
      visited.add(id);
    };

    for (const cap of capabilities) visit(cap.id);
  }
}
