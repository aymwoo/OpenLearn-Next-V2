/**
 * ConfigurationContext — context passed to load/validation (PI-011).
 *
 * Carries the load timestamp and optional scope filter / metadata. It lets
 * providers and validators adapt behavior without global state.
 */

import type { ConfigurationScope } from './types.js';

export class ConfigurationContext {
  public readonly timestamp: number;
  public readonly scope?: ConfigurationScope;
  public readonly metadata: Readonly<Record<string, unknown>>;

  public constructor(init?: { scope?: ConfigurationScope; metadata?: Record<string, unknown> }) {
    this.timestamp = Date.now();
    this.scope = init?.scope;
    this.metadata = Object.freeze({ ...(init?.metadata ?? {}) });
  }
}
