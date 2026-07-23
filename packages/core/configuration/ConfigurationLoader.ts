/**
 * ConfigurationLoader — merges provider outputs into one config object (PI-011).
 *
 * Providers are loaded in priority order (highest first). Nested objects are
 * deep-merged; scalars and arrays replace. After merge, descriptor `default`
 * values are applied to any still-missing keys.
 */

import type { IPlatformLogger } from '../bootstrap/types/index.js';
import { ConfigurationProvider } from './ConfigurationProvider.js';
import type { ConfigurationContext } from './ConfigurationContext.js';
import { deepMerge, getByPath, setByPath } from './utils.js';

export class ConfigurationLoader {
  private readonly logger: IPlatformLogger;

  public constructor(logger: IPlatformLogger) {
    this.logger = logger;
  }

  public async load(
    providers: ReadonlyArray<ConfigurationProvider>,
    _context: ConfigurationContext,
  ): Promise<Record<string, unknown>> {
    // Ascending by priority: lower-priority providers are merged first, so
    // higher-priority providers override them in the final accumulated object.
    const sorted = [...providers].sort((a, b) => a.priority - b.priority);

    let merged: Record<string, unknown> = {};
    for (const provider of sorted) {
      const values = await provider.load(_context);
      merged = deepMerge(merged, values ?? {});
      this.logger.info(`[PlatformConfiguration] Loaded provider '${provider.id}' (scope=${provider.scope}).`);
    }

    // Apply defaults from descriptors for keys still missing.
    for (const provider of providers) {
      for (const descriptor of provider.descriptors) {
        if (descriptor.default !== undefined) {
          if (getByPath(merged, descriptor.path) === undefined) {
            setByPath(merged, descriptor.path, descriptor.default);
          }
        }
      }
    }

    return merged;
  }
}
