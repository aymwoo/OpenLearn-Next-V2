/**
 * OpenLearn Activity Ecosystem — Activity Registry (Sprint P7-01)
 *
 * The single source of truth that maps every Activity Provider (official or
 * plugin). Activities are NOT hardcoded into the Lesson or Workspace — they are
 * registered here and discovered dynamically. The host registers official
 * activities; plugins register their own through the very same
 * `registerProvider` API (resolved via the `IActivityRegistryToken` DI token).
 */

import type {
  ActivityContext,
  ActivityProvider,
  ActivityProviderDescriptor,
  ActivityRole,
  ActivityCategory,
} from './types.js';
import { ACTIVITY_EVENTS } from './provider.js';

export interface StartActivityResult {
  provider: string;
  /** Whether a backing command existed and was dispatched. */
  dispatched: boolean;
  result?: unknown;
}

export class ActivityRegistry {
  private readonly providers = new Map<string, ActivityProvider>();

  /**
   * Register an Activity Provider. Throws on missing id or duplicate id.
   * Official and plugin providers go through this identical method.
   */
  public registerProvider(provider: ActivityProvider): void {
    if (!provider || !provider.descriptor || !provider.descriptor.id) {
      throw new Error('ActivityRegistry: an ActivityProvider must expose a descriptor with a valid id.');
    }
    const id = provider.descriptor.id;
    if (this.providers.has(id)) {
      throw new Error(`ActivityRegistry: activity provider "${id}" is already registered.`);
    }
    this.providers.set(id, provider);
    if (typeof (provider as any).markRegistered === 'function') {
      (provider as any).markRegistered();
    }
  }

  /** Remove a provider by id. Returns true if it was present. */
  public unregisterProvider(id: string): boolean {
    return this.providers.delete(id);
  }

  public getProvider(id: string): ActivityProvider | undefined {
    return this.providers.get(id);
  }

  public listProviders(): ReadonlyArray<ActivityProvider> {
    return Array.from(this.providers.values());
  }

  /** List the declarative descriptors (for Workspace catalogue / REST). */
  public listDescriptors(): ActivityProviderDescriptor[] {
    return this.listProviders().map((p) => p.descriptor);
  }

  /** Activities visible to a given role (`all` matches everything). */
  public listByRole(role: ActivityRole): ActivityProvider[] {
    return this.listProviders().filter(
      (p) =>
        p.descriptor.supportedRoles.includes('all') ||
        p.descriptor.supportedRoles.includes(role),
    );
  }

  public listByCategory(category: ActivityCategory): ActivityProvider[] {
    return this.listProviders().filter((p) => p.descriptor.category === category);
  }

  /**
   * Execute an activity's `start` lifecycle on the supplied context.
   *
   * Permission isolation: when the provider declares `permissions`, at least
   * one must be granted to `actorId` via the (reused) capability service,
   * otherwise a PERMISSION_DENIED error is thrown (403 at the REST layer).
   *
   * The activity itself reuses the Command Bus / Event Bus — this method only
   * orchestrates the lifecycle and enforces permission.
   */
  public async startActivity(
    id: string,
    context: ActivityContext,
    payload?: Record<string, unknown>,
    actorId?: string,
  ): Promise<StartActivityResult> {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`ActivityRegistry: activity provider "${id}" not found.`);
    }

    const required = provider.descriptor.permissions ?? [];
    if (required.length > 0 && actorId) {
      // `capability.check` is async (returns Promise<boolean>) — await all.
      const results = await Promise.all(
        required.map((cap) => context.capability.check(actorId, cap)),
      );
      const granted = results.some(Boolean);
      if (!granted) {
        const err = new Error(
          `[ActivityPermission] Actor "${actorId}" is missing a required permission ` +
            `(${required.join(', ')}) for activity "${id}".`,
        );
        (err as Error & { code?: string }).code = 'PERMISSION_DENIED';
        throw err;
      }
    }

    const result = await provider.start(context, payload);
    return {
      provider: provider.descriptor.provider,
      dispatched: Boolean(provider.descriptor.commandType),
      result,
    };
  }

  public clear(): void {
    this.providers.clear();
  }
}

export { ACTIVITY_EVENTS };
