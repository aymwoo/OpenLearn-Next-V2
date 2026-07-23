/**
 * ConfigurationSnapshot — an immutable read view of loaded configuration
 * (PI-011).
 *
 * Created at a point in time (e.g. after a load/reload). The underlying data is
 * deeply frozen; the snapshot exposes `get`/`tryGet`/`exists`/`toObject`/`list`
 * without any mutation capability.
 */

import { ConfigurationError } from './ConfigurationError.js';
import { deepClone, deepFreeze, getByPath, typeMatches } from './utils.js';
import type { ConfigurationValueType } from './types.js';

export class ConfigurationSnapshot {
  public readonly timestamp: number;
  public readonly version?: string;
  private readonly data: Record<string, unknown>;

  public constructor(
    data: Record<string, unknown>,
    options?: { timestamp?: number; version?: string },
  ) {
    this.data = deepFreeze(deepClone(data));
    this.timestamp = options?.timestamp ?? Date.now();
    this.version = options?.version;
  }

  public get<T = unknown>(path: string): T {
    const value = getByPath(this.data, path);
    if (value === undefined) {
      throw new ConfigurationError(`Configuration path '${path}' not found.`, 'INVALID_PATH', path);
    }
    return value as T;
  }

  public tryGet<T = unknown>(path: string, fallback?: T): T | undefined {
    const value = getByPath(this.data, path);
    return value === undefined ? fallback : (value as T);
  }

  public exists(path: string): boolean {
    return getByPath(this.data, path) !== undefined;
  }

  public getTyped<T = unknown>(path: string, type: ConfigurationValueType): T | undefined {
    const value = getByPath(this.data, path);
    return value !== undefined && typeMatches(value, type) ? (value as T) : undefined;
  }

  public toObject(): Record<string, unknown> {
    return deepClone(this.data);
  }

  /** Top-level section keys of the snapshot. */
  public list(): ReadonlyArray<string> {
    return Object.freeze(Object.keys(this.data));
  }

  public get size(): number {
    return Object.keys(this.data).length;
  }
}
