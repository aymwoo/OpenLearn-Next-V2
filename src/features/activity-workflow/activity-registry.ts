/**
 * OpenLearn Activity Workflow - Activity Registry (Sprint P3-03)
 * Central registry for official and plugin teaching activity providers.
 */

import { ActivityType, ActivityDescriptor, IActivityProvider } from './activity-types.js';

export class ActivityRegistry {
  private providers = new Map<ActivityType, IActivityProvider>();

  public registerProvider(provider: IActivityProvider): void {
    if (!provider || !provider.id || !provider.type) {
      throw new Error('ActivityRegistry Error: IActivityProvider must have a valid ID and Type.');
    }
    this.providers.set(provider.type, provider);
  }

  public unregisterProvider(providerId: string): boolean {
    for (const [type, p] of this.providers.entries()) {
      if (p.id === providerId) {
        return this.providers.delete(type);
      }
    }
    return false;
  }

  public getProvider(type: ActivityType): IActivityProvider | undefined {
    return this.providers.get(type);
  }

  public listProviders(): ReadonlyArray<IActivityProvider> {
    return Object.freeze(Array.from(this.providers.values()));
  }

  public createActivity(
    type: ActivityType,
    title: string,
    config?: Record<string, unknown>
  ): ActivityDescriptor {
    const provider = this.providers.get(type);
    if (provider) {
      return provider.createActivity(title, config);
    }
    return {
      id: `act_${type.toLowerCase()}_${Date.now()}`,
      title,
      type,
      config,
    };
  }

  public clear(): void {
    this.providers.clear();
  }
}
