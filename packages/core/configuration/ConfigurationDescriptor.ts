/**
 * ConfigurationDescriptor — metadata & validation rules for one config key
 * (PI-011).
 */

import { ConfigurationError } from './ConfigurationError.js';
import { ALL_CONFIGURATION_SCOPES, type ConfigurationDescriptorInit, type ConfigurationScope } from './types.js';

export class ConfigurationDescriptor implements ConfigurationDescriptorInit {
  public readonly path: string;
  public readonly scope: ConfigurationScope;
  public readonly type?: ConfigurationDescriptorInit['type'];
  public readonly required: boolean;
  public readonly default?: unknown;
  public readonly min?: number;
  public readonly max?: number;
  public readonly enum?: ReadonlyArray<unknown>;
  public readonly description?: string;

  public constructor(init: ConfigurationDescriptorInit) {
    if (!init || init.path.trim() === '') {
      throw new ConfigurationError('Configuration descriptor requires a non-empty path.', 'INVALID_DESCRIPTOR');
    }
    if (!ALL_CONFIGURATION_SCOPES.includes(init.scope)) {
      throw new ConfigurationError(`Invalid configuration scope: ${String(init.scope)}`, 'INVALID_SCOPE', init.path);
    }
    this.path = init.path;
    this.scope = init.scope;
    this.type = init.type;
    this.required = init.required ?? false;
    this.default = init.default;
    this.min = init.min;
    this.max = init.max;
    this.enum = init.enum;
    this.description = init.description;
  }
}
