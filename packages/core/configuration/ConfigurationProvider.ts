/**
 * ConfigurationProvider — a registered unit that contributes configuration
 * (PI-011).
 *
 * A provider owns a {@link ConfigurationSource} (the origin) and an optional
 * set of {@link ConfigurationDescriptor}s describing the keys it provides
 * (used for defaults, required/type/range/enum validation).
 */

import { ConfigurationError } from './ConfigurationError.js';
import { ConfigurationDescriptor } from './ConfigurationDescriptor.js';
import {
  buildSource,
  ConfigurationSource,
} from './ConfigurationSource.js';
import {
  ALL_CONFIGURATION_SCOPES,
  type ConfigurationProviderInit,
  type ConfigurationScope,
} from './types.js';
import type { ConfigurationContext } from './ConfigurationContext.js';

export class ConfigurationProvider {
  public readonly id: string;
  public readonly scope: ConfigurationScope;
  public readonly priority: number;
  public readonly source: ConfigurationSource;
  public readonly descriptors: ReadonlyArray<ConfigurationDescriptor>;
  public readonly description?: string;

  public constructor(init: ConfigurationProviderInit) {
    if (!init || init.id.trim() === '') {
      throw new ConfigurationError('Configuration provider requires a non-empty id.', 'INVALID_DESCRIPTOR');
    }
    if (!ALL_CONFIGURATION_SCOPES.includes(init.scope)) {
      throw new ConfigurationError(`Invalid provider scope: ${String(init.scope)}`, 'INVALID_SCOPE', init.id);
    }
    this.id = init.id;
    this.scope = init.scope;
    this.priority = init.priority ?? 0;
    this.source =
      init.source instanceof ConfigurationSource ? init.source : buildSource(init.source);
    this.descriptors = Object.freeze(
      (init.descriptors ?? []).map((d) => new ConfigurationDescriptor(d)),
    );
    this.description = init.description;
  }

  public load(_context: ConfigurationContext): Promise<Record<string, unknown>> {
    return this.source.read();
  }
}
